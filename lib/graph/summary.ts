import type { FoldNode } from "../../parser/folding.ts";
import type { Edge, ModuleKind, ParsedFile } from "../../parser/types.ts";
import { KIND_ORDER } from "../kinds.ts";

/**
 * What the pane says about the repository before anything is selected.
 *
 * Pure, over a file list and an edge list, so the same inputs always describe the
 * same repository and the numbers can be checked from a plain script.
 *
 * Counts are derived from `edges` rather than read from the parse result's fan-in
 * records, so a count here and the rows under it in the pane cannot drift apart.
 */

export interface RankedFile {
  path: string;
  /** Imports that landed on this file. */
  count: number;
  kind: ModuleKind;
}

/** Rows the most-depended-on list shows before it reports the rest. */
export const TOP_LIMIT = 10;

/** Rows the list of files nothing imports shows before it reports the rest. */
export const ORPHAN_LIMIT = 20;

export interface RepositorySummary {
  fileCount: number;
  importCount: number;
  /** Files whose extension no convention identified. */
  unidentifiedCount: number;
  mostDependedOn: RankedFile[];
  /** Every file at least one other file imports, however many are listed. */
  mostDependedOnTotal: number;
  importsNothing: ParsedFile[];
  /** Every file nothing imports, however many are listed. */
  importsNothingTotal: number;
}

export function summariseRepository(
  files: readonly ParsedFile[],
  edges: readonly Edge[],
): RepositorySummary {
  const fanIn = new Map<string, number>();
  for (const edge of edges) fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1);

  const kindOf = new Map(files.map((file) => [file.path, file.kind]));

  // Ordered by how many things import it, then by path so two files with the same
  // count always appear in the same order.
  const ranked = [...fanIn.entries()]
    .filter(([, count]) => count > 0)
    .map(([path, count]): RankedFile | null => {
      const kind = kindOf.get(path);
      if (kind === undefined) return null;
      return { path, count, kind };
    })
    .filter((row): row is RankedFile => row !== null)
    .sort((a, b) => b.count - a.count || (a.path < b.path ? -1 : 1));

  const orphans = files
    .filter((file) => (fanIn.get(file.path) ?? 0) === 0)
    .sort((a, b) => (a.path < b.path ? -1 : 1));

  return {
    fileCount: files.length,
    importCount: edges.length,
    // "Other" is the kind no extension convention produced. A file the parser
    // skipped never became a ParsedFile at all, so it is not counted here.
    unidentifiedCount: files.filter((file) => file.kind === "other").length,
    mostDependedOn: ranked.slice(0, TOP_LIMIT),
    mostDependedOnTotal: ranked.length,
    importsNothing: orphans.slice(0, ORPHAN_LIMIT),
    importsNothingTotal: orphans.length,
  };
}

export interface KindCount {
  kind: ModuleKind;
  count: number;
}

/**
 * What kinds of files a folder holds directly, largest first. Files in subfolders
 * belong to those folders and are not counted here.
 */
export function countKindsIn(folder: FoldNode): KindCount[] {
  const counts = new Map<ModuleKind, number>();
  for (const file of folder.files) counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1);

  return KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => ({
    kind,
    count: counts.get(kind) ?? 0,
  }));
}

/** The folded folder at `path`, or null when the fold has no such node. */
export function findFolder(root: FoldNode, path: string): FoldNode | null {
  if (root.path === path) return root;
  for (const child of root.children) {
    const found = findFolder(child, path);
    if (found !== null) return found;
  }
  return null;
}