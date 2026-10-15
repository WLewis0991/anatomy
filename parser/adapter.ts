import type { ModuleKind } from "./types.ts";

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

/** The adapter used when nothing else claims the repository. */
export const fallbackAdapter: FrameworkAdapter = {
  name: "no-framework",
  describe(file: FileDescriptor): ModuleInfo {
    return { kind: EXTENSION_KINDS.get(file.extension) ?? "other" };
  },
};