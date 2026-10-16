import { stat } from "node:fs/promises";
import path from "node:path";

import { fallbackAdapter, type FrameworkAdapter } from "./adapter.ts";
import { extractImports } from "./extract-imports.ts";
import { countDegree, edgesFromRecords, summariseCoverage } from "./graph.ts";
import { createResolver } from "./resolve.ts";
import type { ImportRecord, ParseResult, ParsedFile, SkippedFile } from "./types.ts";
import { walkRepository } from "./walk.ts";

/**
 * The whole parser: a directory path in, data out. Nothing here imports a web
 * framework, a UI library or a database client, so it runs from a plain script
 * with nothing else started.
 */

export interface ParseOptions {
  root: string;
  adapter?: FrameworkAdapter;
}

export async function parseRepository(options: ParseOptions): Promise<ParseResult> {
  const root = path.resolve(options.root);
  const adapter = options.adapter ?? fallbackAdapter;

  const rootStats = await stat(root);
  if (!rootStats.isDirectory()) {
    throw new Error(`${root} is not a directory`);
  }

  const walk = await walkRepository(root);
  const skipped: SkippedFile[] = [...walk.skipped];

  // Extraction first, because a file that could not be parsed must not become
  // the target of an edge that points at nothing.
  const { imports, failures } = extractImports(walk.files);
  const failedPaths = new Set(failures.map((failure) => failure.path));
  for (const failure of failures) {
    skipped.push({ path: failure.path, reason: "parse-failed", detail: failure.detail });
  }

  const parsed = walk.files.filter((file) => !failedPaths.has(file.relativePath));
  const files: ParsedFile[] = parsed.map((file) => {
    const described = adapter.describe({ path: file.relativePath, extension: file.extension });
    return {
      path: file.relativePath,
      folder: file.folder,
      extension: file.extension,
      kind: described.kind,
      reach: described.reach,
      lines: file.lines,
      bytes: file.bytes,
      hash: file.hash,
    };
  });

  const resolver = await createResolver(
    root,
    new Set(files.map((file) => file.path)),
    new Map(skipped.map((file) => [file.path, file])),
  );

  const records: ImportRecord[] = [];
  for (const found of imports) {
    records.push({
      from: found.from,
      specifier: found.specifier,
      kind: found.kind,
      line: found.line,
      resolution: found.unresolvable
        ? { outcome: "unresolved", ...found.unresolvable }
        : await resolver.resolve(found.from, found.specifier),
    });
  }

  const edges = edgesFromRecords(records);

  return {
    version: 1,
    root,
    generatedAt: new Date().toISOString(),
    adapter: adapter.name,
    files,
    edges,
    fanIn: countDegree(files, edges, "to"),
    fanOut: countDegree(files, edges, "from"),
    coverage: summariseCoverage(files, records, edges, skipped, walk.ignoredDirectories),
  };
}