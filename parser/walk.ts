import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { IgnoredDirectory, SkippedFile } from "./types.ts";

/**
 * Which directories are never part of the code being mapped. Each entry says
 * why, so the report can name it rather than quietly losing the files.
 */
const IGNORED_DIRECTORIES: ReadonlyArray<readonly [string, string]> = [
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
];

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

  if (isBinary(buffer)) {
    return fail("binary", `${buffer.length} bytes containing NUL`);
  }

  if (!PARSEABLE_EXTENSIONS.has(extension)) {
    return fail(
      "unsupported-extension",
      extension.length > 0 ? extension : "no extension",
    );
  }

  const contents = buffer.toString("utf8");
  if (contents.trim().length === 0) return fail("empty", "0 bytes of text");

  return {
    parsed: {
      absolutePath,
      relativePath,
      extension,
      folder: folderOf(relativePath),
      contents,
      lines: countLines(contents),
      bytes: buffer.length,
      hash: createHash("sha256").update(buffer).digest("hex").slice(0, 16),
    },
  };
}

async function countFiles(directory: string): Promise<number> {
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
        if (IGNORED_DIRECTORIES.some(([name]) => name === entry.name)) continue;
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
      const ignored = IGNORED_DIRECTORIES.find(([name]) => name === entry.name);
      if (ignored) {
        result.ignoredDirectories.push({
          path: relativePath,
          reason: ignored[1],
          files: await countFiles(absolutePath),
        });
        continue;
      }
      await walkDirectory(root, absolutePath, result);
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

    const classified = await classifyFile(absolutePath, relativePath);
    if ("skipped" in classified) result.skipped.push(classified.skipped);
    else result.files.push(classified.parsed);
  }
}

export async function walkRepository(root: string): Promise<WalkResult> {
  const result: WalkResult = { files: [], skipped: [], ignoredDirectories: [] };
  await walkDirectory(root, root, result);
  return result;
}