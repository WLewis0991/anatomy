import type {
  CallSymbol,
  ClassSymbol,
  DecoratorSymbol,
  FileSymbols,
  FrontendFile,
  FrontendReadResult,
  FunctionSymbol,
  LanguageFrontend,
  ProjectConfig,
  SymbolArg,
} from "./types.ts";

/** Python source files. */
export const PYTHON_EXTENSIONS: ReadonlySet<string> = new Set([".py"]);

/** Stub files the parser deliberately does not read. */
export const PYTHON_EXCLUDED_EXTENSIONS: ReadonlySet<string> = new Set([".pyi"]);

/**
 * Directory names Python never keeps project code in. These are named rather
 * than discovered, so a virtualenv next to the source is reported as excluded
 * instead of quietly losing its files.
 */
export const PYTHON_EXCLUDED_DIRECTORIES: readonly string[] = [
  "venv",
  ".venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "site-packages",
  "__pypackages__",
  "build",
  "dist",
  "__pycache__",
];

/** Directory-name suffixes Python excludes, e.g. `pkg.egg-info`. */
export const PYTHON_EXCLUDED_DIRECTORY_SUFFIXES: readonly string[] = [".egg-info"];

/** Entry-point filenames that seed a Python walk. */
const PYTHON_ENTRY_FILENAMES: ReadonlySet<string> = new Set([
  "manage.py",
  "main.py",
  "app.py",
  "wsgi.py",
  "asgi.py",
]);

/** Keywords that are never the callee of a call, however they are parenthesised. */
const CALL_KEYWORDS = new Set([
  "if",
  "while",
  "for",
  "with",
  "try",
  "except",
  "assert",
  "return",
  "yield",
  "raise",
  "del",
  "pass",
  "break",
  "continue",
  "in",
  "is",
  "and",
  "or",
  "not",
  "lambda",
  "def",
  "class",
  "await",
  "import",
  "from",
  "global",
  "nonlocal",
  "async",
]);

function isIdentifierStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentifierPart(ch: string): boolean {
  return isIdentifierStart(ch) || (ch >= "0" && ch <= "9");
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v";
}

function readStringLiteral(
  line: string,
  index: number,
): { value: string; end: number } | null {
  const start = line[index];
  if (start !== '"' && start !== "'") return null;

  let i = index + 1;
  const chunks: string[] = [];

  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      chunks.push(line.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (ch === start) {
      i += 1;
      return { value: chunks.join(""), end: i };
    }
    chunks.push(ch);
    i += 1;
  }
  return null;
}

/**
 * Split source into logical lines: physical lines joined while brackets are
 * open or a string is unterminated, with comments stripped. Each logical line
 * carries the 1-based line it started on.
 */
export function logicalLines(source: string): Array<{ text: string; startLine: number }> {
  const out: Array<{ text: string; startLine: number }> = [];
  const lines = source.split("\n");
  let buffer = "";
  let startLine = 1;
  let depth = 0;
  let inString = false;
  let quote = "";
  let triple = false;

  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed.length > 0) out.push({ text: trimmed, startLine });
    buffer = "";
    depth = 0;
    inString = false;
    quote = "";
    triple = false;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (buffer.length === 0) startLine = lineIndex + 1;

    let i = 0;
    while (i < line.length) {
      const ch = line[i];

      if (inString) {
        if (ch === "\\" && i + 1 < line.length) {
          buffer += ch + line[i + 1];
          i += 2;
          continue;
        }
        if (triple) {
          if (line.slice(i, i + 3) === quote.repeat(3)) {
            buffer += line.slice(i, i + 3);
            i += 3;
            inString = false;
            triple = false;
            quote = "";
            continue;
          }
          buffer += ch;
          i += 1;
          continue;
        }
        if (ch === quote) {
          inString = false;
          quote = "";
          buffer += ch;
          i += 1;
          continue;
        }
        buffer += ch;
        i += 1;
        continue;
      }

      // Not inside a string: a `#` starts a comment that runs to end of line.
      if (ch === "#") break;

      if (ch === '"' || ch === "'") {
        // A triple-quoted opening that closes on this line is consumed whole.
        if (line.slice(i, i + 3) === ch.repeat(3)) {
          const closing = line.indexOf(ch.repeat(3), i + 3);
          if (closing !== -1) {
            buffer += line.slice(i, closing + 3);
            i = closing + 3;
            continue;
          }
          // Otherwise it opens a multiline triple string.
          buffer += line.slice(i, i + 3);
          i += 3;
          inString = true;
          quote = ch;
          triple = true;
          continue;
        }
        // A single-quoted string.
        const literal = readStringLiteral(line, i);
        if (literal !== null) {
          buffer += line.slice(i, literal.end);
          i = literal.end;
          continue;
        }
        // Unterminated on this line: treat the rest as an open string.
        inString = true;
        quote = ch;
        triple = false;
        buffer += ch;
        i += 1;
        continue;
      }

      if (ch === "(" || ch === "[" || ch === "{") {
        depth += 1;
        buffer += ch;
        i += 1;
        continue;
      }
      if (ch === ")" || ch === "]" || ch === "}") {
        depth -= 1;
        buffer += ch;
        i += 1;
        continue;
      }

      buffer += ch;
      i += 1;
    }

    if (!inString && depth === 0) {
      flush();
    } else {
      buffer += "\n";
    }
  }

  const trimmed = buffer.trim();
  if (trimmed.length > 0) out.push({ text: trimmed, startLine });
  return out;
}

/** Split a call's argument text into positional args and keyword args. */
function parseArgs(argumentText: string): {
  args: SymbolArg[];
  keywords: Record<string, SymbolArg>;
} {
  const args: SymbolArg[] = [];
  const keywords: Record<string, SymbolArg> = {};

  let depth = 0;
  let inString = false;
  let quote = "";
  let current = "";

  const push = () => {
    const trimmed = current.trim();
    current = "";
    if (trimmed.length === 0) return;
    const equals = trimmed.indexOf("=");
    const isKeyword =
      equals > 0 &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed.slice(0, equals)) &&
      trimmed[equals - 1] !== ">" &&
      trimmed[equals + 1] !== "=";
    const valueText = isKeyword ? trimmed.slice(equals + 1).trim() : trimmed;
    const converted = convertArgument(valueText);
    if (isKeyword) {
      keywords[trimmed.slice(0, equals)] = converted;
    } else {
      args.push(converted);
    }
  };

  for (let i = 0; i < argumentText.length; i += 1) {
    const ch = argumentText[i];
    if (inString) {
      if (ch === "\\") {
        current += ch + argumentText[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) inString = false;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      push();
      continue;
    }
    current += ch;
  }
  push();
  return { args, keywords };
}

/** Convert one argument's text into a SymbolArg, conservatively. */
function convertArgument(text: string): SymbolArg {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { kind: "other" };

  // A plain string literal, possibly with an r/b/f/u prefix. f-strings are not
  // literal: their value is computed at runtime.
  const prefixMatch = /^[rbfuRBFU]*(['"])/.exec(trimmed);
  if (prefixMatch) {
    const quote = prefixMatch[1];
    const bodyStart = prefixMatch[0].length;
    const isF = /[fF]/.test(prefixMatch[0]);
    if (
      !isF &&
      trimmed.length > bodyStart + 1 &&
      trimmed.endsWith(quote)
    ) {
      return { kind: "string", value: trimmed.slice(bodyStart, -1) };
    }
    return { kind: "other" };
  }

  // Adjacent string literals concatenated: "a" "b".
  const restMatch = trimmed.match(/^(['"].*?['"]\s*)+$/);
  if (restMatch) {
    const parts: string[] = [];
    let rest = trimmed;
    while (rest.length > 0) {
      const match = /^(['"])(?:\\.|(?!\1).)*?\1/.exec(rest);
      if (match === null) break;
      parts.push(match[0].slice(1, -1));
      rest = rest.slice(match[0].length).trim();
    }
    if (rest.length === 0) return { kind: "strings", values: parts };
    return { kind: "other" };
  }

  // A list/tuple literal of only string literals.
  const bracket = /^[\[\(\{](.*)[\]\}\)]$/.exec(trimmed);
  if (bracket) {
    const inner = bracket[1];
    const { args } = parseArgs(inner);
    if (args.every((arg) => arg.kind === "string")) {
      return { kind: "strings", values: args.map((arg) => arg.value) };
    }
    return { kind: "other" };
  }

  // A nested call, such as `include("app.urls")` inside a `path(...)`
  // argument. Kept as a call so an adapter can join a literal include prefix.
  const callMatch = /^([A-Za-z_][A-Za-z0-9_.]*)\s*\(([\s\S]*)\)$/.exec(trimmed);
  if (callMatch) {
    const { args: nestedArgs, keywords: nestedKeywords } = parseArgs(callMatch[2]);
    return { kind: "call", callee: callMatch[1], args: nestedArgs, keywords: nestedKeywords };
  }

  // A plain identifier: keep its name so adapters can match variables (for
  // example `include_router(router, prefix="/x")`).
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return { kind: "other", text: trimmed };
  }

  return { kind: "other" };
}

/** Find every `dotted.name(...)` call in one logical line, in source order. */
function extractCalls(text: string, startLine: number): CallSymbol[] {
  const calls: CallSymbol[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (isIdentifierStart(ch)) {
      let j = i;
      while (
        j < text.length &&
        (isIdentifierPart(text[j]) || text[j] === ".")
      ) {
        j += 1;
      }
      const name = text.slice(i, j);
      if (!CALL_KEYWORDS.has(name)) {
        let k = j;
        while (k < text.length && isWhitespace(text[k])) k += 1;
        if (k < text.length && text[k] === "(") {
          const end = findMatchingParen(text, k);
          if (end !== -1) {
            const { args, keywords } = parseArgs(text.slice(k + 1, end));
            calls.push({
              callee: name,
              args,
              keywords,
              line: startLine,
            });
            i = end + 1;
            continue;
          }
        }
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return calls;
}

/** Index of the `)` matching the `(` at `open`, scanning brackets and strings. */
function findMatchingParen(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  let quote = "";
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; continue; }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function readDecorator(
  line: string,
  startLine: number,
): DecoratorSymbol | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("@")) return null;
  const rest = trimmed.slice(1);
  const paren = rest.indexOf("(");
  let name: string;
  let args: SymbolArg[];
  let keywords: Record<string, SymbolArg> = {};
  if (paren !== -1) {
    const end = findMatchingParen(rest, paren);
    name = rest.slice(0, paren).trim();
    if (end !== -1) {
      const parsed = parseArgs(rest.slice(paren + 1, end));
      args = parsed.args;
      keywords = parsed.keywords;
    } else {
      args = [];
    }
  } else {
    name = rest.trim();
    args = [];
  }
  return { name, args, keywords, line: startLine };
}

const CLASS_DEF = /^class\s+([A-Za-z_][A-Za-z0-9_]*)/;
const DEF_DEF = /^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/;

function readFileSymbols(
  file: FrontendFile,
): { symbols: FileSymbols; failures: FrontendReadResult["failures"] } {
  const classes: ClassSymbol[] = [];
  const functions: FunctionSymbol[] = [];
  const decorators: DecoratorSymbol[] = [];
  const calls: CallSymbol[] = [];

  let lines: Array<{ text: string; startLine: number }>;
  try {
    lines = logicalLines(file.contents);
  } catch (error) {
    return {
      symbols: {
        path: file.path,
        imports: [],
        directives: [],
        classes: [],
        functions: [],
        decorators: [],
        calls: [],
      },
      failures: [
        {
          path: file.path,
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  // Decorators attach to the next class or function definition. A decorator
  // that ends up attached to nothing is reported separately.
  let pendingDecorators: DecoratorSymbol[] = [];

  let currentClass: ClassSymbol | null = null;

  for (const { text, startLine } of lines) {
    const trimmed = text.trim();

    if (trimmed.startsWith("@")) {
      const decorator = readDecorator(trimmed, startLine);
      if (decorator !== null) pendingDecorators.push(decorator);
      continue;
    }

    const classMatch = CLASS_DEF.exec(trimmed);
    if (classMatch !== null) {
      const name = classMatch[1];
      const classSymbol: ClassSymbol = {
        name,
        line: startLine,
        exported: !name.startsWith("_"),
        decorators: [...pendingDecorators],
        methods: [],
      };
      classes.push(classSymbol);
      currentClass = classSymbol;
      pendingDecorators = [];
      continue;
    }

    const defMatch = DEF_DEF.exec(trimmed);
    if (defMatch !== null) {
      const name = defMatch[1];
      const functionSymbol: FunctionSymbol = {
        name,
        line: startLine,
        exported: !name.startsWith("_"),
        decorators: [...pendingDecorators],
        directives: [],
      };
      if (currentClass !== null) {
        currentClass.methods.push(functionSymbol);
      } else {
        functions.push(functionSymbol);
      }
      pendingDecorators = [];
      calls.push(...extractCalls(trimmed, startLine));
      currentClass = null;
      continue;
    }

    if (trimmed.startsWith("return ") || trimmed.startsWith("raise ")) {
      currentClass = null;
    }

    calls.push(...extractCalls(trimmed, startLine));
  }

  for (const decorator of pendingDecorators) decorators.push(decorator);

  return {
    symbols: {
      path: file.path,
      imports: [],
      directives: [],
      classes,
      functions,
      decorators,
      calls,
    },
    failures: [],
  };
}

export function readPythonSymbols(
  files: readonly FrontendFile[],
): FrontendReadResult {
  const symbols = new Map<string, FileSymbols>();
  const failures: FrontendReadResult["failures"] = [];

  for (const file of files) {
    const { symbols: fileSymbols, failures: fileFailures } = readFileSymbols(file);
    symbols.set(file.path, fileSymbols);
    failures.push(...fileFailures);
  }

  return { symbols, failures };
}

/**
 * Repo-relative paths (forward slashes) that seed a Python walk: the fixed
 * entry filenames plus any file named by `pyproject.toml`
 * `[project.scripts]` / `[tool.poetry.scripts]`.
 */
export function pythonEntryPoints(
  paths: readonly string[],
  config: ProjectConfig,
): ReadonlySet<string> {
  const out = new Set<string>();

  for (const path of paths) {
    const basename = path.split("/").pop() ?? "";
    if (PYTHON_ENTRY_FILENAMES.has(basename)) out.add(path);
  }

  if (config.pyproject !== null) {
    for (const section of ["[project.scripts]", "[tool.poetry.scripts]"]) {
      let inSection = false;
      for (const rawLine of config.pyproject.split("\n")) {
        const line = rawLine.trim();
        if (line.startsWith("[")) {
          inSection = line === section;
          continue;
        }
        if (!inSection || line.length === 0 || line.startsWith("#")) continue;
        const equals = line.indexOf("=");
        if (equals === -1) continue;
        const value = line.slice(equals + 1).trim();
        const moduleName = value.replace(/^["']|["']$/g, "").split(":")[0].trim();
        const segments = moduleName.split(".");
        const candidates = [
          segments.join("/") + ".py",
          segments.join("/") + "/__init__.py",
        ];
        for (const path of paths) {
          for (const candidate of candidates) {
            if (path === candidate || path.endsWith("/" + candidate)) {
              out.add(path);
            }
          }
        }
      }
    }
  }

  return out;
}

export const pythonFrontend: LanguageFrontend = {
  name: "python",
  sourceExtensions: PYTHON_EXTENSIONS,
  excludedExtensions: PYTHON_EXCLUDED_EXTENSIONS,
  excludedDirectories: PYTHON_EXCLUDED_DIRECTORIES,
  excludedDirectorySuffixes: PYTHON_EXCLUDED_DIRECTORY_SUFFIXES,
  entryPoints: pythonEntryPoints,
  readSymbols: readPythonSymbols,
};
