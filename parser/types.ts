/**
 * The shape the parser writes. Everything built after this reads this file, so
 * these types are a contract: adding a field is fine, changing one is not.
 */

export type ModuleKind =
  | "typescript"
  | "javascript"
  | "style"
  | "json"
  | "markdown"
  | "config"
  | "asset"
  | "other";

export interface ParsedFile {
  /** Repository-relative, forward slashes. */
  path: string;
  /** Repository-relative directory the file belongs to, "." at the root. */
  folder: string;
  extension: string;
  kind: ModuleKind;
  lines: number;
  bytes: number;
  /** Hex digest of the contents, so a rerun can tell whether anything changed. */
  hash: string;
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
  files: ParsedFile[];
  edges: Edge[];
  fanIn: Record<string, number>;
  fanOut: Record<string, number>;
  coverage: Coverage;
}