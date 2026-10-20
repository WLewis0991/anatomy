import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { IgnoredDirectory, SkippedFile } from "./types.ts";

/**
 * Which directories are never part of the code being mapped. Each entry says
 * why, so the report can name it rather than quietly losing the files.
 */
export const DEFAULT_IGNORED_DIRECTORIES: ReadonlyMap<string, string> = new Map([
  [".git", "version control metadata"],
  [".hg", "version control metadata"],
  [".svn", "version control metadata"],
  ["node_modules", "installed dependencies, not the repository's own code"],
  ["bower_components", "installed dependencies, not the repository's own code"],
  [".next", "build output"],
  [".nuxt", "build output"],
  [".output", "build output"],
  [".svelte-kit", "build output"],
  ["out", "build output"],
  ["dist", "build output"],
  ["build", "build output"],
  ["coverage", "test coverage report"],
  [".turbo", "build cache"],
  [".cache", "build cache"],
  [".vercel", "deployment metadata"],
  [".gradle", "build cache"],
  ["target", "build output"],
  ["vendor", "vendored third-party code"],
  ["__pycache__", "python bytecode cache"],
  [".venv", "python virtual environment"],
]);

/** Code extensions the import extractor parses into a syntax tree. */
export const PARSEABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/**
 * Text that is part of the repository and has a role, but carries no imports.
 * Read as UTF-8 so it can be counted and named; a NUL byte still means binary.
 */
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".md",
  ".mdx",
  ".json",
  ".svg",
]);

/** Bytes that are a file in the map without ever being source. */
const BINARY_ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
  ".tiff",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

export interface WalkOptions {
  /** Extensions that count as source and are handed to a language frontend. */
  sourceExtensions: ReadonlySet<string>;
  /** Extensions that are skipped and reported as unsupported. */
  excludedExtensions: ReadonlySet<string>;
  /** Directory names that are ignored entirely, mapped to a reason. */
  ignoredDirectories: ReadonlyMap<string, string>;
  /** Directory-name suffixes that are ignored entirely, mapped to a reason. */
  ignoredDirectorySuffixes: ReadonlyMap<string, string>;
}

export const DEFAULT_WALK_OPTIONS: WalkOptions = {
  sourceExtensions: PARSEABLE_EXTENSIONS,
  excludedExtensions: new Set(),
  ignoredDirectories: DEFAULT_IGNORED_DIRECTORIES,
  ignoredDirectorySuffixes: new Map(),
};

export interface DiscoveredFile {
  absolutePath: string;
  relativePath: string;
  extension: string;
  folder: string;
  contents: string;
  lines: number;
  bytes: number;
  hash: string;
}

export type Classified =
  | { parsed: DiscoveredFile }
  | { skipped: SkippedFile };

export interface WalkResult {
  files: DiscoveredFile[];
  skipped: SkippedFile[];
  ignoredDirectories: IgnoredDirectory[];
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function folderOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  return slash === -1 ? "." : relativePath.slice(0, slash);
}

function countLines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return text.length === 0 ? 0 : text.endsWith("\n") ? count : count + 1;
}

function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0);
}

async function classifyFile(
  absolutePath: string,
  relativePath: string,
  options: WalkOptions,
): Promise<Classified> {
  const extension = path.extname(absolutePath).toLowerCase();
  const fail = (reason: SkippedFile["reason"], detail: string): Classified => ({
    skipped: { path: relativePath, reason, detail },
  });

  let stats;
  try {
    stats = await stat(absolutePath);
  } catch (error) {
    return fail("unreadable", error instanceof Error ? error.message : String(error));
  }
  if (!stats.isFile()) return fail("unreadable", "not a regular file");

  let buffer: Buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch (error) {
    return fail("unreadable", error instanceof Error ? error.message : String(error));
  }

  const isCode = options.sourceExtensions.has(extension);
  const isText = TEXT_EXTENSIONS.has(extension);
  const isAsset = BINARY_ASSET_EXTENSIONS.has(extension);

  if (options.excludedExtensions.has(extension)) {
    return fail(
      "unsupported-extension",
      extension.length > 0 ? extension : "no extension",
    );
  }

  // Text and assets are part of the repository even though they carry no
  // imports, so the walk keeps them and the rail can account for them.
  if (!isCode && !isText && !isAsset) {
    return fail(
      "unsupported-extension",
      extension.length > 0 ? extension : "no extension",
    );
  }

  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const base = {
    absolutePath,
    relativePath,
    extension,
    folder: folderOf(relativePath),
    bytes: buffer.length,
    hash,
  };

  // An asset is part of the repository without being source. Its bytes are
  // enough to identify it on a rerun; there is no text to count or read.
  if (isAsset) {
    return { parsed: { ...base, contents: "", lines: 0 } };
  }

  if (isBinary(buffer)) {
    return fail("binary", `${buffer.length} bytes containing NUL`);
  }

  const contents = buffer.toString("utf8");
  if (contents.trim().length === 0) return fail("empty", "0 bytes of text");

  return {
    parsed: {
      ...base,
      contents,
      lines: countLines(contents),
    },
  };
}

async function countFiles(
  directory: string,
  options: WalkOptions,
): Promise<number> {
  let total = 0;
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (options.ignoredDirectories.has(entry.name)) continue;
        const suffixIgnored = [...options.ignoredDirectorySuffixes.keys()].some(
          (suffix) => entry.name.endsWith(suffix),
        );
        if (suffixIgnored) continue;
        stack.push(path.join(current, entry.name));
      } else if (entry.isFile()) {
        total += 1;
      }
    }
  }
  return total;
}

async function walkDirectory(
  root: string,
  directory: string,
  result: WalkResult,
  options: WalkOptions,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    result.ignoredDirectories.push({
      path: toPosix(path.relative(root, directory)) || ".",
      reason: `could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
      files: 0,
    });
    return;
  }

  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = toPosix(path.relative(root, absolutePath));

    if (entry.isDirectory()) {
      const reason = options.ignoredDirectories.get(entry.name);
      if (reason !== undefined) {
        result.ignoredDirectories.push({
          path: relativePath,
          reason,
          files: await countFiles(absolutePath, options),
        });
        continue;
      }
      const suffixReason = [...options.ignoredDirectorySuffixes.entries()].find(
        ([suffix]) => entry.name.endsWith(suffix),
      );
      if (suffixReason !== undefined) {
        const [, reason] = suffixReason;
        result.ignoredDirectories.push({
          path: relativePath,
          reason,
          files: await countFiles(absolutePath, options),
        });
        continue;
      }
      await walkDirectory(root, absolutePath, result, options);
      continue;
    }

    if (entry.isSymbolicLink()) {
      // Following a link can leave the repository entirely, and where it points
      // is not this file's business. It is reported rather than dropped.
      result.skipped.push({
        path: relativePath,
        reason: "symlink",
        detail: "symbolic link, not followed",
      });
      continue;
    }

    if (!entry.isFile()) continue;

    const classified = await classifyFile(absolutePath, relativePath, options);
    if ("skipped" in classified) result.skipped.push(classified.skipped);
    else result.files.push(classified.parsed);
  }
}

export async function walkRepository(
  root: string,
  options: WalkOptions = DEFAULT_WALK_OPTIONS,
): Promise<WalkResult> {
  const result: WalkResult = { files: [], skipped: [], ignoredDirectories: [] };
  await walkDirectory(root, root, result, options);
  return result;
}