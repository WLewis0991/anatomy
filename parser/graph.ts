import type {
  Coverage,
  Edge,
  ExcludedImport,
  ImportRecord,
  ParsedFile,
  ReexportGap,
  UnresolvedImport,
} from "./types.ts";

/**
 * Pure arithmetic over a file list and an edge list. No filesystem, no parsing,
 * no adapters. Two imports between the same pair of files are one edge.
 */

/**
 * The ordered file pair is the whole of an edge's identity. A file importing the
 * same file twice, through two specifiers or as both a static and a dynamic
 * import, is one edge; whichever record came first is the one kept.
 */
function edgeKey(edge: Edge): string {
  return `${edge.from}\u0000${edge.to}`;
}

export function dedupeEdges(edges: readonly Edge[]): Edge[] {
  const seen = new Set<string>();
  const out: Edge[] = [];
  for (const edge of edges) {
    const key = edgeKey(edge);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

export function countDegree(
  files: readonly ParsedFile[],
  edges: readonly Edge[],
  end: "from" | "to",
): Record<string, number> {
  const degrees: Record<string, number> = {};
  for (const file of files) degrees[file.path] = 0;
  for (const edge of edges) {
    const key = edge[end];
    if (key in degrees) degrees[key] += 1;
  }
  return degrees;
}

export function edgesFromRecords(records: readonly ImportRecord[]): Edge[] {
  const edges: Edge[] = [];
  for (const record of records) {
    if (record.resolution.outcome !== "internal") continue;
    edges.push({
      from: record.from,
      to: record.resolution.to,
      specifier: record.specifier,
      kind: record.kind,
      line: record.line,
    });
  }
  return dedupeEdges(edges);
}

export function unresolvedFromRecords(
  records: readonly ImportRecord[],
): UnresolvedImport[] {
  const out: UnresolvedImport[] = [];
  for (const record of records) {
    const { resolution } = record;
    if (resolution.outcome !== "unresolved") continue;
    out.push({
      from: record.from,
      specifier: record.specifier,
      kind: record.kind,
      line: record.line,
      reason: resolution.reason,
      detail: resolution.detail,
    });
  }
  return out;
}

export function summariseCoverage(
  files: readonly ParsedFile[],
  records: readonly ImportRecord[],
  edges: readonly Edge[],
  skipped: Coverage["skipped"],
  ignoredDirectories: Coverage["ignoredDirectories"],
): Coverage {
  let internal = 0;
  let external = 0;
  let unresolved = 0;
  let reexportsSeen = 0;
  const excludedImports: ExcludedImport[] = [];
  const reexportGaps: ReexportGap[] = [];

  for (const record of records) {
    switch (record.resolution.outcome) {
      case "internal":
        internal += 1;
        break;
      case "external":
        external += 1;
        break;
      case "excluded":
        excludedImports.push({
          from: record.from,
          specifier: record.specifier,
          kind: record.kind,
          line: record.line,
          detail: record.resolution.detail,
        });
        break;
      case "unresolved":
        unresolved += 1;
        break;
    }
    if (record.kind !== "reexport") continue;
    reexportsSeen += 1;
    const { resolution } = record;
    if (resolution.outcome === "internal") continue;
    reexportGaps.push({
      from: record.from,
      specifier: record.specifier,
      line: record.line,
      outcome: resolution.outcome,
      reason:
        resolution.outcome === "unresolved"
          ? resolution.reason
          : resolution.outcome === "external"
            ? "external-package"
            : "not-a-node",
      detail: resolution.detail,
    });
  }

  return {
    filesFound: files.length + skipped.length,
    filesParsed: files.length,
    filesSkipped: skipped.length,
    importsSeen: records.length,
    edges: edges.length,
    internal,
    external,
    excluded: excludedImports.length,
    excludedImports,
    unresolved,
    reexportsSeen,
    reexportsResolved: reexportsSeen - reexportGaps.length,
    reexportGaps,
    duplicateImports: internal - edges.length,
    skipped,
    unresolvedImports: unresolvedFromRecords(records),
    ignoredDirectories,
  };
}