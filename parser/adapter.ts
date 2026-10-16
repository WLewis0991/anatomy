import type { FileReach, ModuleKind } from "./types.ts";

/**
 * Framework knowledge is an adapter, not a branch. The parser asks the adapter
 * what a file is; anything that needs to know what a Next.js route looks like
 * belongs in an adapter of its own, and never in the walking or the parsing.
 */

export interface FileDescriptor {
  /** Repository-relative, forward slashes. */
  path: string;
  extension: string;
}

export interface ModuleInfo {
  kind: ModuleKind;
  reach: FileReach;
}

export interface FrameworkAdapter {
  readonly name: string;
  describe(file: FileDescriptor): ModuleInfo;
}

const EXTENSION_KINDS: ReadonlyMap<string, ModuleKind> = new Map([
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".css", "style"],
  [".scss", "style"],
  [".sass", "style"],
  [".less", "style"],
  [".json", "json"],
  [".md", "markdown"],
  [".mdx", "markdown"],
  [".png", "asset"],
  [".jpg", "asset"],
  [".jpeg", "asset"],
  [".svg", "asset"],
  [".gif", "asset"],
  [".webp", "asset"],
  [".ico", "asset"],
]);

/**
 * Files the framework loads by name rather than by an import. These are
 * recognised from the path alone, because the path is all the descriptor
 * carries. That is a deliberate limit: a bin entry point named in a
 * package.json looks like an ordinary file here, so it is still reported.
 */
const FRAMEWORK_BASENAMES: ReadonlySet<string> = new Set([
  "page",
  "layout",
  "route",
  "template",
  "default",
  "loading",
  "error",
  "global-error",
  "not-found",
  "middleware",
  "instrumentation",
]);

const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

/** The package entry, at the root of the tree that was parsed. */
const ROOT_ENTRY_STEMS: ReadonlySet<string> = new Set(["index"]);

function reachOf(file: FileDescriptor): FileReach {
  const segments = file.path.split("/");
  const basename = segments[segments.length - 1];
  const stem = basename.slice(0, basename.length - file.extension.length);

  if (CODE_EXTENSIONS.has(file.extension) && FRAMEWORK_BASENAMES.has(stem)) {
    return "framework";
  }
  if (basename.startsWith("next.config")) {
    return "framework";
  }
  // Only the root entry. A nested index.ts is usually a barrel file, and a
  // barrel nothing imports is worth saying out loud.
  if (segments.length === 1 && ROOT_ENTRY_STEMS.has(stem)) {
    return "entrypoint";
  }
  return "none";
}

/** The adapter used when nothing else claims the repository. */
export const fallbackAdapter: FrameworkAdapter = {
  name: "no-framework",
  describe(file: FileDescriptor): ModuleInfo {
    return { kind: EXTENSION_KINDS.get(file.extension) ?? "other", reach: reachOf(file) };
  },
};