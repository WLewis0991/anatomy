/**
 * The shape the parser writes. Everything built after this reads this file, so
 * these types are a contract: adding a field is fine, changing one is not.
 */

export type ModuleKind =
  | "typescript"
  | "javascript"
  | "python"
  | "style"
  | "json"
  | "markdown"
  | "config"
  | "asset"
  | "other";

/**
 * How a file gets executed, for the files that nothing imports. An import graph
 * cannot see the framework loading a page by name, or a consumer loading a
 * package through its entry point, so the adapter records that separately.
 * "none" means an ordinary file: if nothing imports it, that is a real finding.
 */
export type FileReach = "none" | "framework" | "entrypoint";

/**
 * A fact about a file that is true alongside its kind and its role, rather than
 * instead of them. A `.test.tsx` is a test and a component; the role says what
 * sort of file it is, a flag says what else is true of it. Facets are a set, so
 * a file can carry more than one.
 */
export type FileFlag = "test";

export interface ParsedFile {
  /** Repository-relative, forward slashes. */
  path: string;
  /** Repository-relative directory the file belongs to, "." at the root. */
  folder: string;
  extension: string;
  kind: ModuleKind;
  reach: FileReach;
  lines: number;
  bytes: number;
  /** Hex digest of the contents, so a rerun can tell whether anything changed. */
  hash: string;
  /** Orthogonal facts about the file, path-derived and language-agnostic. */
  flags: FileFlag[];
}

export type ImportKind = "static" | "reexport" | "dynamic";

export interface Edge {
  from: string;
  to: string;
  specifier: string;
  kind: ImportKind;
  line: number;
}

export type UnresolvedReason =
  | "external-package"
  | "external-url"
  | "alias-unmapped"
  | "file-not-found"
  | "non-literal-specifier"
  | "empty-specifier";

export type Resolution =
  | { outcome: "internal"; to: string }
  | { outcome: "external"; detail: string }
  | { outcome: "excluded"; detail: string }
  | { outcome: "unresolved"; reason: UnresolvedReason; detail: string };

/** Every import the parser saw, including the ones that produced no edge. */
export interface ImportRecord {
  from: string;
  specifier: string;
  kind: ImportKind;
  line: number;
  resolution: Resolution;
}

export type SkipReason =
  | "unsupported-extension"
  | "binary"
  | "unreadable"
  | "empty"
  | "parse-failed"
  | "symlink";

/** One file's role, as an adapter (or the generic fallback) names it. */
export interface FileRole {
  /** Repository-relative, forward slashes. */
  path: string;
  role: string;
}

/** One extracted route: the pattern, and the method when one is bound. */
export interface ExtractedRoute {
  path: string;
  method: string | null;
}

export interface SkippedFile {
  path: string;
  reason: SkipReason;
  detail: string;
}

export interface IgnoredDirectory {
  path: string;
  reason: string;
  files: number;
}

export interface UnresolvedImport {
  from: string;
  specifier: string;
  kind: ImportKind;
  line: number;
  reason: UnresolvedReason;
  detail: string;
}

/** An import that pointed at a real file that is deliberately not a node. */
export interface ExcludedImport {
  from: string;
  specifier: string;
  kind: ImportKind;
  line: number;
  detail: string;
}

/** A re-export that did not land inside the repository, and why. */
export interface ReexportGap {
  from: string;
  specifier: string;
  line: number;
  outcome: "external" | "excluded" | "unresolved";
  reason: UnresolvedReason | "external-package" | "not-a-node";
  detail: string;
}

export interface Coverage {
  filesFound: number;
  filesParsed: number;
  filesSkipped: number;
  importsSeen: number;
  edges: number;
  internal: number;
  external: number;
  excluded: number;
  excludedImports: ExcludedImport[];
  unresolved: number;
  reexportsSeen: number;
  reexportsResolved: number;
  /** Every re-export that did not land inside the repository, with its reason. */
  reexportGaps: ReexportGap[];
  /** Imports seen that pointed at a file already reached by another import. */
  duplicateImports: number;
  skipped: SkippedFile[];
  unresolvedImports: UnresolvedImport[];
  ignoredDirectories: IgnoredDirectory[];
}

export interface ParseResult {
  version: 1;
  root: string;
  generatedAt: string;
  adapter: string;
  frontend: string;
  files: ParsedFile[];
  edges: Edge[];
  fanIn: Record<string, number>;
  fanOut: Record<string, number>;
  coverage: Coverage;
  /** One role per file the recogniser could name, additive to `files`. */
  roles: FileRole[];
  /** Every route the recogniser could extract, exact or absent. */
  routes: ExtractedRoute[];
}