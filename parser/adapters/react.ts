import type { FileSymbols } from "../language/types.ts";
import type { ExtractedRoute } from "../types.ts";
import type { FrameworkAdapter } from "../adapter.ts";
import { describeModule } from "../adapter.ts";
import { callsNamed } from "./helpers.ts";

function isReactExtension(path: string): boolean {
  const extension = path.split("/").pop()?.split(".").pop() ?? "";
  return extension === "tsx" || extension === "jsx";
}

export const reactAdapter: FrameworkAdapter = {
  name: "react",
  language: "typescript",
  describe(file) {
    return describeModule(file);
  },
  detect(symbols: ReadonlyMap<string, FileSymbols>): boolean {
    for (const path of symbols.keys()) {
      if (isReactExtension(path)) return true;
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
  routes(): ExtractedRoute[] {
    return [];
  },
};

function roleOf(path: string, symbols: FileSymbols): string {
  if (!isReactExtension(path)) return "other";
  for (const func of symbols.functions) {
    if (func.name.startsWith("use")) return "hook";
  }
  if (callsNamed(symbols, "createContext").length > 0) return "context";
  if (
    symbols.functions.some((func) => func.exported) ||
    symbols.classes.some((class_) => class_.exported)
  ) {
    return "component";
  }
  return "other";
}
