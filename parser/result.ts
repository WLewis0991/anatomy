import { readFile } from "node:fs/promises";

import type { ParseResult } from "./types.ts";

/**
 * Reading a written result back. Everything built after this phase reads the
 * file rather than the parser, so the check that the file is actually what it
 * claims to be lives here and fails loudly when it is not.
 */

function fail(message: string): never {
  throw new Error(`not a parse result: ${message}`);
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(`${field} is not an array`);
  return value;
}

export function assertParseResult(value: unknown): ParseResult {
  if (typeof value !== "object" || value === null) fail("not an object");
  const candidate = value as Partial<ParseResult>;
  if (candidate.version !== 1) fail(`version is ${String(candidate.version)}, expected 1`);
  if (typeof candidate.root !== "string") fail("root is missing");
  if (typeof candidate.generatedAt !== "string") fail("generatedAt is missing");
  if (typeof candidate.adapter !== "string") fail("adapter is missing");

  const files = requireArray(candidate.files, "files") as ParseResult["files"];
  const edges = requireArray(candidate.edges, "edges") as ParseResult["edges"];
  const coverage = candidate.coverage;
  if (typeof coverage !== "object" || coverage === null) fail("coverage is missing");
  requireArray(coverage.skipped, "coverage.skipped");
  requireArray(coverage.unresolvedImports, "coverage.unresolvedImports");
  requireArray(coverage.ignoredDirectories, "coverage.ignoredDirectories");

  const known = new Set<string>();
  for (const file of files) {
    if (typeof file.path !== "string") fail("a file has no path");
    if (typeof file.folder !== "string") fail(`${file.path} has no folder`);
    known.add(file.path);
  }

  for (const edge of edges) {
    if (!known.has(edge.from)) fail(`edge from ${edge.from} points at no file`);
    if (!known.has(edge.to)) fail(`edge from ${edge.from} points at missing ${edge.to}`);
  }

  return candidate as ParseResult;
}

export async function readResultFile(file: string): Promise<ParseResult> {
  const raw = await readFile(file, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${file} is not JSON: ${error instanceof Error ? error.message : error}`);
  }
  return assertParseResult(parsed);
}