import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Resolution, SkippedFile } from "./types.ts";

/**
 * Turning a specifier written in a file into a file on disk. Everything here is
 * TypeScript's own resolution rules plus what tsconfig.json declares. No
 * framework knowledge: nothing in this file knows what a Next.js route is.
 */

const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** ESM-style import of a TypeScript file, where the specifier says `.js`. */
const JS_TO_TS_EXTENSIONS = new Map([
  [".js", [".ts", ".tsx", ".js"]],
  [".mjs", [".mts", ".mjs"]],
  [".cjs", [".cts", ".cjs"]],
]);

export interface PathMapping {
  pattern: string;
  targets: string[];
}

export interface Resolver {
  resolve(fromFile: string, specifier: string): Promise<Resolution>;
}

interface TsconfigInfo {
  mappings: PathMapping[];
  baseUrl: string | undefined;
  /** The tsconfig the mappings came from, so a failure can name it. */
  source: string | undefined;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

interface LooseJson {
  extends?: unknown;
  compilerOptions?: {
    paths?: unknown;
    baseUrl?: unknown;
  };
}

/** tsconfig.json is JSON with comments and trailing commas. */
function parseLooseJson(source: string): LooseJson {
  const withoutComments = source
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (match, comment: string | undefined) =>
      comment === undefined ? match : "",
    )
    .replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(withoutComments) as LooseJson;
  } catch {
    return {};
  }
}

async function readTsconfig(root: string): Promise<TsconfigInfo> {
  const entry = path.join(root, "tsconfig.json");
  let source: string;
  try {
    source = await readFile(entry, "utf8");
  } catch {
    return { mappings: [], baseUrl: undefined, source: undefined };
  }

  const byPattern = new Map<string, string[]>();
  let baseUrl: string | undefined;
  let currentFile = entry;
  const seen = new Set<string>([entry]);

  // Only a relative `extends` is followed. A bare package specifier would mean
  // reading node_modules for configuration, which is a repository's own choice
  // of tooling rather than something this phase needs to understand.
  for (let depth = 0; depth < 5; depth += 1) {
    const parsed = parseLooseJson(source);
    const options = parsed.compilerOptions ?? {};
    if (options.paths && typeof options.paths === "object") {
      for (const [pattern, targets] of Object.entries(
        options.paths as Record<string, unknown>,
      )) {
        if (!Array.isArray(targets)) continue;
        const strings = targets.filter((value): value is string => typeof value === "string");
        byPattern.set(pattern, [...(byPattern.get(pattern) ?? []), ...strings]);
      }
    }
    if (typeof options.baseUrl === "string") {
      baseUrl = path.resolve(path.dirname(currentFile), options.baseUrl);
    }
    const extendsValue = parsed.extends;
    if (typeof extendsValue !== "string" || !extendsValue.startsWith(".")) break;
    const parent = path.resolve(path.dirname(currentFile), extendsValue);
    if (seen.has(parent)) break;
    seen.add(parent);
    try {
      source = await readFile(parent, "utf8");
    } catch {
      break;
    }
    currentFile = parent;
  }

  return {
    mappings: [...byPattern.entries()].map(([pattern, targets]) => ({ pattern, targets })),
    baseUrl,
    source: entry,
  };
}

function isRelative(specifier: string): boolean {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier === "." ||
    specifier === ".."
  );
}

function looksLikeUrl(specifier: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(specifier) || specifier.startsWith("//");
}

/**
 * What a compiler tries, in order: the path as written, then the same path with
 * each extension appended, then the directory's index file. A specifier that
 * already names an extension still gets extensions appended, because
 * `@/lib/database.types` is how you import `database.types.ts`.
 */
function candidatePaths(base: string): string[] {
  const candidates: string[] = [base];
  const extension = path.extname(base).toLowerCase();
  const replacements = JS_TO_TS_EXTENSIONS.get(extension);
  if (replacements) {
    const stem = base.slice(0, base.length - extension.length);
    for (const replacement of replacements) candidates.push(stem + replacement);
  }
  for (const candidate of RESOLVABLE_EXTENSIONS) candidates.push(base + candidate);
  for (const candidate of RESOLVABLE_EXTENSIONS) {
    candidates.push(path.join(base, `index${candidate}`));
  }
  return candidates;
}

async function existsOnDisk(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

export async function createResolver(
  root: string,
  known: ReadonlySet<string>,
  skipped: ReadonlyMap<string, SkippedFile>,
): Promise<Resolver> {
  const { mappings, baseUrl, source: tsconfigPath } = await readTsconfig(root);

  function classify(relative: string): Resolution | undefined {
    const skip = skipped.get(relative);
    if (known.has(relative) && skip === undefined) {
      return { outcome: "internal", to: relative };
    }
    if (skip) {
      return {
        outcome: "excluded",
        detail: `on disk, but not a node: ${skip.reason}${
          skip.detail.length > 0 ? ` (${skip.detail})` : ""
        }`,
      };
    }
    return undefined;
  }

  async function tryBase(base: string): Promise<Resolution | undefined> {
    const candidates = candidatePaths(base);
    for (const candidate of candidates) {
      const match = classify(toPosix(path.relative(root, candidate)));
      if (match) return match;
    }
    for (const candidate of candidates) {
      if (await existsOnDisk(candidate)) {
        return {
          outcome: "excluded",
          detail: `${toPosix(path.relative(root, candidate))} is not part of the mapped code`,
        };
      }
    }
    return undefined;
  }

  async function tryMappings(specifier: string): Promise<{
    resolution: Resolution | undefined;
    matched: boolean;
  }> {
    for (const mapping of mappings) {
      const star = mapping.pattern.indexOf("*");
      let middle: string | undefined;

      if (star === -1) {
        if (mapping.pattern !== specifier) continue;
      } else {
        const prefix = mapping.pattern.slice(0, star);
        const suffix = mapping.pattern.slice(star + 1);
        if (
          !specifier.startsWith(prefix) ||
          !specifier.endsWith(suffix) ||
          specifier.length < prefix.length + suffix.length
        ) {
          continue;
        }
        middle = specifier.slice(prefix.length, specifier.length - suffix.length);
      }

      for (const target of mapping.targets) {
        const base = path.resolve(
          baseUrl ?? root,
          middle === undefined ? target : target.replace("*", middle),
        );
        const resolution = await tryBase(base);
        if (resolution) return { resolution, matched: true };
      }
      return { resolution: undefined, matched: true };
    }
    return { resolution: undefined, matched: false };
  }

  return {
    async resolve(fromFile, specifier): Promise<Resolution> {
      if (specifier.length === 0) {
        return {
          outcome: "unresolved",
          reason: "empty-specifier",
          detail: "an import statement with no specifier",
        };
      }
      if (looksLikeUrl(specifier)) {
        return { outcome: "external", detail: `URL import (${specifier})` };
      }

      if (isRelative(specifier) || specifier.startsWith("/")) {
        const fromDirectory = path.dirname(path.join(root, fromFile));
        const base = specifier.startsWith("/")
          ? path.resolve(root, `.${specifier}`)
          : path.resolve(fromDirectory, specifier);
        const resolution = await tryBase(base);
        if (resolution) return resolution;
        return {
          outcome: "unresolved",
          reason: "file-not-found",
          detail: `no file at ${specifier}`,
        };
      }

      const mapped = await tryMappings(specifier);
      if (mapped.resolution) return mapped.resolution;
      if (mapped.matched) {
        return {
          outcome: "unresolved",
          reason: "file-not-found",
          detail: `${tsconfigPath ?? "tsconfig.json"} maps ${specifier} but no file is there`,
        };
      }

      const packageName = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : (specifier.split("/")[0] ?? specifier);
      const installed = await existsOnDisk(path.join(root, "node_modules", packageName));
      return {
        outcome: "external",
        detail: installed
          ? `installed package (${packageName}), outside the repository`
          : `unmapped bare specifier, treated as an external package (${packageName})`,
      };
    },
  };
}