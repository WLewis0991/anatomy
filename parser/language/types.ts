/**
 * What a language frontend reads out of a file, and what a frontend is.
 *
 * A frontend knows how a language is written — decorators, definitions,
 * `__init__.py`. It does not know any framework's name. Recognising a
 * framework is the adapter's job, and adapters sit apart from frontends. So the
 * symbols here are deliberately syntax-shaped, not framework-shaped: a decorator
 * is a dotted name and its arguments, never "a route".
 *
 * Both readers (TypeScript/JavaScript and Python) produce exactly this shape, so
 * a framework adapter can be written once against it.
 */

/**
 * One argument of a call or a decorator, kept structural rather than stringified.
 *
 * The route adapters have to tell a literal string from a concatenation, an
 * f-string, or a variable, because a route whose pattern is not a literal emits
 * nothing at all. Flattening an argument to text would throw that distinction
 * away, which is the one distinction that matters here.
 */
export type SymbolArg =
  | { kind: "string"; value: string }
  | { kind: "strings"; values: string[] }
  | { kind: "call"; callee: string; args: SymbolArg[]; keywords: Record<string, SymbolArg> }
  | { kind: "other"; text?: string };

export interface CallSymbol {
  /** Dotted callee exactly as written: `path`, `include_router`, `app.get`. */
  callee: string;
  args: SymbolArg[];
  keywords: Record<string, SymbolArg>;
  line: number;
}

export interface DecoratorSymbol {
  /** Dotted decorator name as written: `Controller`, `Get`, `app.route`. */
  name: string;
  args: SymbolArg[];
  keywords: Record<string, SymbolArg>;
  line: number;
}

export interface FunctionSymbol {
  name: string;
  line: number;
  exported: boolean;
  decorators: DecoratorSymbol[];
  /** Prologue string directives at the top of this function body, e.g. `"use server"`. */
  directives: string[];
}

export interface ClassSymbol {
  name: string;
  line: number;
  exported: boolean;
  decorators: DecoratorSymbol[];
  methods: FunctionSymbol[];
}

export interface FileSymbols {
  path: string;
  /**
   * Prologue string directives, at file level and inside functions: `"use
   * server"` is the one that matters, and it is a directive rather than a call
   * so it needs its own slot.
   */
  directives: string[];
  classes: ClassSymbol[];
  functions: FunctionSymbol[];
  /** Decorators the reader could not attach to a class or a function. */
  decorators: DecoratorSymbol[];
  /** Every call expression, with its arguments structurally captured. */
  calls: CallSymbol[];
}

export interface FrontendFile {
  /** Repository-relative, forward slashes. */
  path: string;
  extension: string;
  contents: string;
}

export interface FrontendReadResult {
  symbols: Map<string, FileSymbols>;
  /** Files the reader could not read, with why. Never dropped silently. */
  failures: Array<{ path: string; detail: string }>;
}

/** What a frontend needs from configuration files to find its entry points. */
export interface ProjectConfig {
  /** Raw `pyproject.toml`, or null when the repository has none. */
  pyproject: string | null;
}

/**
 * A language frontend: the set of extensions it reads, the directories and
 * extensions it structurally excludes, how it finds entry points, and its
 * syntax reader.
 */
export interface LanguageFrontend {
  readonly name: string;
  readonly sourceExtensions: ReadonlySet<string>;
  /** Extensions this language deliberately skips, e.g. Python `.pyi` stubs. */
  readonly excludedExtensions: ReadonlySet<string>;
  /** Directory names this language never contains project code. */
  readonly excludedDirectories: readonly string[];
  /** Directory-name suffixes to exclude, e.g. Python `.egg-info`. */
  readonly excludedDirectorySuffixes: readonly string[];
  /**
   * Files that seed the walk for this language, given every path the walk found
   * and the project config. Empty when the language has no entry-point concept
   * beyond what the adapter already recognises.
   */
  entryPoints(paths: readonly string[], config: ProjectConfig): ReadonlySet<string>;
  readSymbols(files: readonly FrontendFile[]): FrontendReadResult;
}

export function stringArg(value: string): SymbolArg {
  return { kind: "string", value };
}
