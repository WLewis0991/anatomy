import type { FileSymbols, SymbolArg } from "../language/types.ts";
import type { ExtractedRoute } from "../types.ts";
import type { FrameworkAdapter } from "../adapter.ts";
import { describeModule } from "../adapter.ts";
import { isDottedCall, lookupModule } from "./helpers.ts";

function basenameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

function stemOf(path: string): string {
  const basename = basenameOf(path);
  const dot = basename.lastIndexOf(".");
  return dot === -1 ? basename : basename.slice(0, dot);
}

function isPathCall(call: { callee: string }): boolean {
  return isDottedCall(call.callee, "path");
}

function isIncludeCall(call: { callee: string }): boolean {
  return isDottedCall(call.callee, "include");
}

function firstStringArgOf(args: readonly SymbolArg[]): string | null {
  const first = args[0];
  return first?.kind === "string" ? first.value : null;
}

/** The literal dotted module an include() names, or null if it is not literal. */
function includeTarget(arg: SymbolArg | undefined): string | null {
  if (arg === undefined || arg.kind !== "call" || !isDottedCall(arg.callee, "include")) {
    return null;
  }
  return firstStringArgOf(arg.args);
}

/**
 * A prefix and a pattern joined the way the framework joins them: the developer
 * writes the slash in the prefix, so the two are concatenated as written. Both
 * are literals here; a computed one never reaches this function.
 */
function joinPrefix(prefix: string, pattern: string): string {
  return prefix + pattern;
}

export const urlconfAdapter: FrameworkAdapter = {
  name: "django",
  language: "python",
  describe(file) {
    return describeModule(file);
  },
  detect(symbols: ReadonlyMap<string, FileSymbols>): boolean {
    for (const symbols_ of symbols.values()) {
      for (const call of symbols_.calls) {
        if (
          isDottedCall(call.callee, "path") ||
          isDottedCall(call.callee, "include") ||
          isDottedCall(call.callee, "re_path")
        ) {
          return true;
        }
      }
    }
    return false;
  },
  roles(symbols: ReadonlyMap<string, FileSymbols>): Map<string, string> {
    const out = new Map<string, string>();
    for (const path of symbols.keys()) {
      out.set(path, roleOf(path));
    }
    return out;
  },
  routes(symbols: ReadonlyMap<string, FileSymbols>): ExtractedRoute[] {
    const routes: ExtractedRoute[] = [];
    const filePaths = [...symbols.keys()];

    // A module another urls file includes is mounted there, so its own patterns
    // are emitted by the includer (joined with the literal prefix), never on
    // their own. Emitting them bare would report a route the site does not have.
    const includedPaths = new Set<string>();
    for (const symbols_ of symbols.values()) {
      for (const call of symbols_.calls) {
        for (const arg of call.args) {
          const target = includeTarget(arg);
          if (target === null) continue;
          const path = lookupModule(target, filePaths);
          if (path !== null) includedPaths.add(path);
        }
      }
    }

    // Terminal path() calls in files that are not mounted elsewhere.
    for (const [path, symbols_] of symbols) {
      if (includedPaths.has(path)) continue;
      for (const call of symbols_.calls) {
        if (!isPathCall(call)) continue;
        if (call.args.some((arg) => includeTarget(arg) !== null)) continue;
        const pattern = firstStringArgOf(call.args);
        if (pattern === null) continue;
        routes.push({ path: pattern, method: null });
      }
    }

    // Included patterns: a bare include() mounts a module at the root; a
    // path("prefix/", include(...)) mounts it under the literal prefix.
    for (const symbols_ of symbols.values()) {
      for (const call of symbols_.calls) {
        if (isIncludeCall(call)) {
          const target = firstStringArgOf(call.args);
          if (target === null) continue;
          const innerPath = lookupModule(target, filePaths);
          if (innerPath === null) continue;
          const innerSymbols = symbols.get(innerPath);
          if (innerSymbols === undefined) continue;
          for (const inner of innerSymbols.calls) {
            if (!isPathCall(inner)) continue;
            const pattern = firstStringArgOf(inner.args);
            if (pattern === null) continue;
            routes.push({ path: pattern, method: null });
          }
          continue;
        }

        if (!isPathCall(call)) continue;
        const prefix = firstStringArgOf(call.args);
        const target = includeTarget(
          call.args.find((arg) => includeTarget(arg) !== null),
        );
        if (prefix === null || target === null) continue;
        const innerPath = lookupModule(target, filePaths);
        if (innerPath === null) continue;
        const innerSymbols = symbols.get(innerPath);
        if (innerSymbols === undefined) continue;
        for (const inner of innerSymbols.calls) {
          if (!isPathCall(inner)) continue;
          const pattern = firstStringArgOf(inner.args);
          if (pattern === null) continue;
          routes.push({ path: joinPrefix(prefix, pattern), method: null });
        }
      }
    }

    return dedupe(routes);
  },
};

function roleOf(path: string): string {
  const stem = stemOf(path);
  switch (stem) {
    case "urls":
      return "urls";
    case "views":
      return "views";
    case "models":
      return "models";
    case "serializers":
      return "serializers";
    case "admin":
      return "admin";
    default:
      return "other";
  }
}

function dedupe(routes: ExtractedRoute[]): ExtractedRoute[] {
  const seen = new Set<string>();
  const out: ExtractedRoute[] = [];
  for (const route of routes) {
    const key = `${route.path}\u0000${route.method}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(route);
  }
  return out;
}
