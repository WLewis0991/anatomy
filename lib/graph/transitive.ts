import type { Edge, ParsedFile } from "../../parser/types.ts";

/**
 * The transitive walk over the edge list, written once and pointed at a
 * direction.
 *
 * Blast radius is what breaks if a file changes: everything that reaches it,
 * which in an `from` → `to` edge list means walking `to` → `from`. Dependency
 * chain is what a file needs: everything it reaches, walking `from` → `to`.
 *
 * Pure, over a file list and an edge list, so the same answer comes out of a
 * plain script as out of the pane.
 *
 * Iterative on purpose. A real repository has long import chains, and a
 * recursive walk of one blows the call stack in the browser rather than in a
 * terminal where it would be noticed.
 */

/**
 * Deep enough to show what a file touches, shallow enough to stay an answer.
 * Three levels down returns most of a repository and stops being one thing.
 */
export const DEFAULT_DEPTH = 2;

export type WalkDirection = "upstream" | "downstream";

export interface WalkResult {
  /** Reached files, excluding the one walked from, shortest distance first. */
  paths: string[];
  /** How many edges deep each reached file is. Zero is the start file. */
  depthOf: ReadonlyMap<string, number>;
  /** The depth the walk actually stopped at, so an answer can say it was capped. */
  reachedDepth: number;
}

interface Frontier {
  path: string;
  depth: number;
}

/**
 * Adjacency in both directions, built once per walk. Building it is O(edges);
 * walking it is bounded by depth and the number of edges out of the reached set.
 */
function adjacency(
  files: readonly ParsedFile[],
  edges: readonly Edge[],
  direction: WalkDirection,
): Map<string, string[]> {
  const known = new Set(files.map((file) => file.path));
  const map = new Map<string, string[]>();

  const link = (from: string, to: string): void => {
    const list = map.get(from);
    if (list === undefined) map.set(from, [to]);
    else list.push(to);
  };

  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    if (direction === "upstream") link(edge.to, edge.from);
    else link(edge.from, edge.to);
  }
  return map;
}

export function walkTransitive(
  files: readonly ParsedFile[],
  edges: readonly Edge[],
  start: string,
  direction: WalkDirection,
  depth: number = DEFAULT_DEPTH,
): WalkResult {
  const known = new Set(files.map((file) => file.path));
  if (!known.has(start) || depth < 1) {
    return { paths: [], depthOf: new Map(), reachedDepth: 0 };
  }

  const links = adjacency(files, edges, direction);
  const depthOf = new Map<string, number>([[start, 0]]);

  // A queue, not a stack: the order paths come back in is shortest-first, which
  // is what someone reading a blast radius wants.
  const queue: Frontier[] = [{ path: start, depth: 0 }];
  for (let head = 0; head < queue.length; head += 1) {
    const { path, depth: at } = queue[head];
    if (at >= depth) continue;

    for (const next of links.get(path) ?? []) {
      // A file already reached keeps its shortest distance. A cycle walks back
      // into the start file, which is why the start is in the map from the off.
      const seen = depthOf.get(next);
      if (seen !== undefined) continue;
      depthOf.set(next, at + 1);
      queue.push({ path: next, depth: at + 1 });
    }
  }

  const paths = [...depthOf.entries()]
    .filter(([path]) => path !== start)
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
    .map(([path]) => path);

  const deepest = Math.max(...depthOf.values());

  return { paths, depthOf, reachedDepth: deepest };
}

export function blastRadius(
  files: readonly ParsedFile[],
  edges: readonly Edge[],
  start: string,
  depth: number = DEFAULT_DEPTH,
): WalkResult {
  return walkTransitive(files, edges, start, "upstream", depth);
}

export function dependencyChain(
  files: readonly ParsedFile[],
  edges: readonly Edge[],
  start: string,
  depth: number = DEFAULT_DEPTH,
): WalkResult {
  return walkTransitive(files, edges, start, "downstream", depth);
}