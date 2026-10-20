import type { FileSymbols } from "../language/types.ts";
import type { ExtractedRoute } from "../types.ts";
import type { FrameworkAdapter } from "../adapter.ts";
import { describeModule } from "../adapter.ts";

/**
 * Express, recognised by the package it imports and classified by folder
 * convention. Routes are deliberately not extracted: an Express route table is
 * assembled at runtime from routers, variables and middleware chains, and the
 * rule is exact or absent. An Express repository gets roles and an empty table.
 */

/**
 * Directory-name convention, singular and plural folded onto one key. Real
 * repositories use both spellings, and a rail that split `controller` from
 * `controllers` would report two halves of one thing.
 */
const DIRECTORY_ROLES: ReadonlyMap<string, string> = new Map([
  ["route", "route"],
  ["routes", "route"],
  ["controller", "controller"],
  ["controllers", "controller"],
  ["service", "service"],
  ["services", "service"],
  ["model", "model"],
  ["models", "model"],
  ["schema", "schema"],
  ["schemas", "schema"],
  ["middleware", "middleware"],
  ["middlewares", "middleware"],
  ["config", "config"],
  ["util", "util"],
  ["utils", "util"],
  ["db", "db"],
]);

function namesExpress(symbols: FileSymbols): boolean {
  return symbols.imports.includes("express");
}

export const expressAdapter: FrameworkAdapter = {
  name: "express",
  language: "typescript",
  describe(file) {
    return describeModule(file);
  },
  detect(symbols: ReadonlyMap<string, FileSymbols>): boolean {
    // The literal `express` package in an import or a require is the only
    // sufficient signal. A bare `Router(...)`/`router(...)` call is supporting
    // evidence at best — a generic TypeScript repository with its own `router()`
    // helper must keep falling back to no-framework — so it is not read here.
    for (const symbols_ of symbols.values()) {
      if (namesExpress(symbols_)) return true;
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
  routes(): ExtractedRoute[] {
    return [];
  },
};

/**
 * The file's role from the first directory on its path that names one, so
 * `src/routes/v1/users.js` is a route. A file in no conventional directory is
 * left unnamed for the caller to fall back on.
 */
function roleOf(path: string): string {
  const directories = path.split("/").slice(0, -1);
  for (const directory of directories) {
    const role = DIRECTORY_ROLES.get(directory);
    if (role !== undefined) return role;
  }
  return "other";
}
