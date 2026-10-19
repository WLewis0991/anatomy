import type { FileSymbols } from "../language/types.ts";
import type { ExtractedRoute } from "../types.ts";
import type { FrameworkAdapter } from "../adapter.ts";
import { describeModule } from "../adapter.ts";
import {
  decoratorsNamed,
  firstPositionalString,
} from "./helpers.ts";

function basenameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

function stemOf(path: string): string {
  const basename = basenameOf(path);
  const dot = basename.lastIndexOf(".");
  return dot === -1 ? basename : basename.slice(0, dot);
}

export const flaskAdapter: FrameworkAdapter = {
  name: "flask",
  language: "python",
  describe(file) {
    return describeModule(file);
  },
  detect(symbols: ReadonlyMap<string, FileSymbols>): boolean {
    for (const symbols_ of symbols.values()) {
      for (const call of symbols_.calls) {
        if (call.callee === "Flask" || call.callee === "Blueprint") {
          return true;
        }
      }
      for (const decorator of decoratorsNamed(symbols_, "route")) {
        return true;
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
      for (const decorator of decoratorsNamed(symbols_, "route")) {
        const path = firstPositionalString(decorator.args);
        if (path === null) continue;
        const methodsArg = decorator.keywords["methods"];
        const methods: string[] = [];
        if (methodsArg !== undefined) {
          if (methodsArg.kind === "strings") methods.push(...methodsArg.values);
          else if (methodsArg.kind === "string") methods.push(methodsArg.value);
        }
        const method = methods.length > 0 ? methods.join(", ") : null;
        routes.push({ path, method });
      }
    }
    return dedupe(routes);
  },
};

function roleOf(path: string, symbols: FileSymbols): string {
  const stem = stemOf(path);
  if (stem.startsWith("_")) return "other";
  for (const call of symbols.calls) {
    if (call.callee === "Blueprint") return "blueprint";
  }
  for (const func of symbols.functions) {
    for (const decorator of func.decorators) {
      if (
        decorator.name === "route" ||
        decorator.name.endsWith(".route")
      ) {
        return "route";
      }
    }
  }
  for (const class_ of symbols.classes) {
    for (const method of class_.methods) {
      for (const decorator of method.decorators) {
        if (
          decorator.name === "route" ||
          decorator.name.endsWith(".route")
        ) {
          return "route";
        }
      }
    }
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
