/**
 * Small, framework-free helpers the adapters share: finding literal string
 * arguments, matching decorators by name, and joining path segments. None of
 * these names a framework.
 */

import type { CallSymbol, DecoratorSymbol, FileSymbols, SymbolArg } from "../language/types.ts";

export function isHttpMethod(name: string): boolean {
  switch (name.toLowerCase()) {
    case "get":
    case "post":
    case "put":
    case "patch":
    case "delete":
    case "head":
    case "options":
    case "trace":
      return true;
    default:
      return false;
  }
}

export function httpMethod(name: string): string {
  return name.toLowerCase() === "head" ? "HEAD" : name.toUpperCase();
}

/** The literal first positional argument of a call, if it is a string. */
export function firstStringArg(call: CallSymbol): string | null {
  return firstPositionalString(call.args);
}

/**
 * Whether a written callee names a function, bare (`include`) or through a
 * receiver (`app.include_router`). Only the final segment is matched, so a
 * framework's method is found however it was reached.
 */
export function isDottedCall(callee: string, name: string): boolean {
  return callee === name || callee.endsWith(`.${name}`);
}

/** The literal first positional argument of an args list, if it is a string. */
export function firstPositionalString(args: readonly SymbolArg[]): string | null {
  const first = args[0];
  return first?.kind === "string" ? first.value : null;
}

/** Every literal positional argument of a call. */
export function stringArgs(call: CallSymbol): string[] {
  return call.args
    .map((arg) => (arg.kind === "string" ? arg.value : null))
    .filter((value): value is string => value !== null);
}

/** The literal value of a keyword argument, if it is a string. */
export function keywordStringArg(
  call: CallSymbol,
  keyword: string,
): string | null {
  const arg = call.keywords[keyword];
  return arg?.kind === "string" ? arg.value : null;
}

/** Every decorator whose dotted name is `name` or ends in `.${name}`. */
export function decoratorsNamed(
  symbols: FileSymbols,
  name: string,
): DecoratorSymbol[] {
  const found: DecoratorSymbol[] = [];
  const collect = (list: readonly DecoratorSymbol[]): void => {
    for (const decorator of list) {
      if (decorator.name === name || decorator.name.endsWith(`.${name}`)) {
        found.push(decorator);
      }
    }
  };
  for (const class_ of symbols.classes) {
    collect(class_.decorators);
    for (const method of class_.methods) collect(method.decorators);
  }
  for (const func of symbols.functions) collect(func.decorators);
  collect(symbols.decorators);
  return found;
}

/** Every call whose dotted callee is `name` or ends in `.${name}`. */
export function callsNamed(symbols: FileSymbols, name: string): CallSymbol[] {
  const found: CallSymbol[] = [];
  const collect = (list: readonly CallSymbol[]): void => {
    for (const call of list) {
      if (call.callee === name || call.callee.endsWith(`.${name}`)) {
        found.push(call);
      }
    }
  };
  collect(symbols.calls);
  return found;
}

/** Join path segments, collapsing duplicate slashes. */
export function joinPaths(...segments: string[]): string {
  const joined = segments
    .map((segment) => segment.replace(/^\/+/, "").replace(/\/+$/, ""))
    .filter((segment) => segment.length > 0)
    .join("/");
  if (joined.length === 0) return "";
  return segments.some((segment) => segment.startsWith("/")) ? `/${joined}` : joined;
}

/** Resolve a literal dotted module name to a repo-relative path. */
export function lookupModule(
  dotted: string,
  filePaths: readonly string[],
): string | null {
  const bySlash = dotted.replace(/\./g, "/");
  const candidates = [bySlash + ".py", bySlash + "/__init__.py"];
  for (const candidate of candidates) {
    for (const path of filePaths) {
      if (path === candidate || path.endsWith("/" + candidate)) {
        return path;
      }
    }
  }
  return null;
}

