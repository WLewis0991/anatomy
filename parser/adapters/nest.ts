import type { FileSymbols } from "../language/types.ts";
import type { ExtractedRoute } from "../types.ts";
import type { FrameworkAdapter } from "../adapter.ts";
import { describeModule } from "../adapter.ts";
import {
  decoratorsNamed,
  firstPositionalString,
  httpMethod,
  isHttpMethod,
  joinPaths,
} from "./helpers.ts";

function basenameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

function stemOf(path: string): string {
  const basename = basenameOf(path);
  const dot = basename.lastIndexOf(".");
  return dot === -1 ? basename : basename.slice(0, dot);
}

function hasDecorator(decorators: readonly { name: string }[], name: string): boolean {
  return decorators.some(
    (decorator) => decorator.name === name || decorator.name.endsWith(`.${name}`),
  );
}

export const nestjsAdapter: FrameworkAdapter = {
  name: "nestjs",
  language: "typescript",
  describe(file) {
    return describeModule(file);
  },
  detect(symbols: ReadonlyMap<string, FileSymbols>): boolean {
    for (const symbols_ of symbols.values()) {
      if (
        decoratorsNamed(symbols_, "Controller").length > 0 ||
        decoratorsNamed(symbols_, "Module").length > 0 ||
        decoratorsNamed(symbols_, "Injectable").length > 0
      ) {
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
      for (const class_ of symbols_.classes) {
        const controller = class_.decorators.find(
          (decorator) =>
            decorator.name === "Controller" ||
            decorator.name.endsWith(".Controller"),
        );
                const base = controller ? firstPositionalString(controller.args) ?? "" : "";
        for (const method of class_.methods) {
          for (const decorator of method.decorators) {
            const methodName = decorator.name.replace(/.*\./, "");
            if (!isHttpMethod(methodName)) continue;
            const methodPath = firstPositionalString(decorator.args);
            if (methodPath === null) continue;
            routes.push({
              path: joinPaths(base, methodPath),
              method: httpMethod(methodName),
            });
          }
        }
      }
    }
    return routes;
  },
};

function roleOf(path: string, symbols: FileSymbols): string {
  const stem = stemOf(path);
  if (stem.startsWith("_")) return "other";
  for (const class_ of symbols.classes) {
    if (hasDecorator(class_.decorators, "Controller")) return "controller";
    if (hasDecorator(class_.decorators, "Injectable")) return "service";
    if (hasDecorator(class_.decorators, "Module")) return "module";
    if (hasDecorator(class_.decorators, "Entity")) return "entity";
  }
  return "other";
}
