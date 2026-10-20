import type { DecoratorSymbol, FileSymbols } from "../language/types.ts";
import type { ExtractedRoute } from "../types.ts";
import type { FrameworkAdapter } from "../adapter.ts";
import { describeModule } from "../adapter.ts";
import {
  firstPositionalString,
  httpMethod,
  isDottedCall,
  isHttpMethod,
  joinPaths,
  keywordStringArg,
} from "./helpers.ts";

function basenameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

function stemOf(path: string): string {
  const basename = basenameOf(path);
  const dot = basename.lastIndexOf(".");
  return dot === -1 ? basename : basename.slice(0, dot);
}

function methodNameOf(decorator: DecoratorSymbol): string {
  return decorator.name.replace(/.*\./, "");
}

function firstSegmentOf(decorator: DecoratorSymbol): string | null {
  return decorator.name.includes(".")
    ? decorator.name.slice(0, decorator.name.lastIndexOf("."))
    : null;
}

function collectDecorators(symbols: FileSymbols): DecoratorSymbol[] {
  const out: DecoratorSymbol[] = [];
  for (const class_ of symbols.classes) {
    out.push(...class_.decorators);
    for (const method of class_.methods) out.push(...method.decorators);
  }
  for (const func of symbols.functions) out.push(...func.decorators);
  out.push(...symbols.decorators);
  return out;
}

function hasApiRouterCall(symbols: FileSymbols): boolean {
  for (const call of symbols.calls) {
    if (isDottedCall(call.callee, "APIRouter") || isDottedCall(call.callee, "FastAPI")) {
      return true;
    }
  }
  return false;
}

export const fastapiAdapter: FrameworkAdapter = {
  name: "fastapi",
  language: "python",
  describe(file) {
    return describeModule(file);
  },
  detect(symbols: ReadonlyMap<string, FileSymbols>): boolean {
    for (const symbols_ of symbols.values()) {
      if (hasApiRouterCall(symbols_)) return true;
      for (const decorator of collectDecorators(symbols_)) {
        if (isHttpMethod(methodNameOf(decorator))) return true;
      }
    }
    return false;
  },
  roles(symbols: ReadonlyMap<string, FileSymbols>): Map<string, string> {
    const out = new Map<string, string>();
    for (const [path, symbols_] of symbols) {
      out.set(path, roleOf(path, symbols_));
    }
    return out;
  },
  routes(symbols: ReadonlyMap<string, FileSymbols>): ExtractedRoute[] {
    const routes: ExtractedRoute[] = [];
    for (const symbols_ of symbols.values()) {
      const decorators = collectDecorators(symbols_);

      // Routers included through include_router() with a literal prefix.
      const includedRouters = new Map<string, string>();
      for (const call of symbols_.calls) {
        if (!isDottedCall(call.callee, "include_router")) continue;
        const prefix = keywordStringArg(call, "prefix");
        const firstArg = call.args[0];
        const routerVar =
          firstArg !== undefined && firstArg.kind === "other"
            ? firstArg.text ?? null
            : null;
        if (prefix === null || routerVar === null) continue;
        if (!hasApiRouterCall(symbols_)) continue;
        if (
          !decorators.some(
            (decorator) =>
              (decorator.name === routerVar ||
                decorator.name.startsWith(`${routerVar}.`)) &&
              isHttpMethod(methodNameOf(decorator)),
          )
        ) {
          continue;
        }
        includedRouters.set(routerVar, prefix);
      }

      for (const decorator of decorators) {
        const method = methodNameOf(decorator);
        if (!isHttpMethod(method)) continue;
        const path = firstPositionalString(decorator.args);
        if (path === null) continue;
        const firstSegment = firstSegmentOf(decorator);
        if (
          firstSegment !== null && includedRouters.has(firstSegment)
        ) {
          continue;
        }
        routes.push({ path, method: httpMethod(method) });
      }

      for (const [routerVar, prefix] of includedRouters) {
        for (const decorator of decorators) {
          if (
            decorator.name !== routerVar &&
            !decorator.name.startsWith(`${routerVar}.`)
          ) {
            continue;
          }
          const method = methodNameOf(decorator);
          if (!isHttpMethod(method)) continue;
          const path = firstPositionalString(decorator.args);
          if (path === null) continue;
          routes.push({
            path: joinPaths(prefix, path),
            method: httpMethod(method),
          });
        }
      }
    }
    return dedupe(routes);
  },
};

function roleOf(path: string, symbols: FileSymbols): string {
  const stem = stemOf(path);
  if (stem.startsWith("_")) return "other";
  if (hasApiRouterCall(symbols)) return "router";
  if (stem === "schemas" || stem === "schema") return "schema";
  for (const func of symbols.functions) {
    for (const decorator of func.decorators) {
      if (isHttpMethod(methodNameOf(decorator))) return "endpoint";
    }
  }
  for (const class_ of symbols.classes) {
    for (const method of class_.methods) {
      for (const decorator of method.decorators) {
        if (isHttpMethod(methodNameOf(decorator))) return "endpoint";
      }
    }
  }
  for (const call of symbols.calls) {
    if (isDottedCall(call.callee, "Depends")) return "dependency";
  }
  return "other";
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
