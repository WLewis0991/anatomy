import type { Edge, ParsedFile } from "../../parser/types.ts";

/**
 * Four facts about the edge list, and the file lengths beside it. Nothing here
 * is a verdict and nothing here is a model: every sentence below is fixed, and
 * every entry is a path a person can go and look at.
 *
 * Pure, over a file list and an edge list.
 */

/** Imports that make a file unusually depended on. */
export const HIGH_FAN_IN = 10;

/** Lines past which a file stops fitting in one read. */
export const LONG_FILE_LINES = 500;

/** Entries one insight lists before it says how many more there are. */
export const INSIGHT_LIMIT = 20;

/**
 * Cycles longer than this are reported by size rather than printed. A strongly
 * connected component of a few files reads as a loop; one of two hundred does
 * not, and writing out the path of a loop nobody can follow helps nobody.
 */
export const PRINTABLE_CYCLE = 4;

/**
 * Order is the order of usefulness to someone reading an unfamiliar
 * repository. "Nothing imports this" tells you where to start, "this many
 * things depend on this one" tells you what not to touch, and the last two
 * sound like a judgement, so they sit underneath.
 */
export type InsightKind = "unimported" | "highFanIn" | "cycle" | "longFile";

export interface InsightEntry {
  /** The file to open. For a cycle, the member that sorts first. */
  path: string;
  /** Anything the path alone does not say. Null when it says enough. */
  note: string | null;
}

export interface Insight {
  kind: InsightKind;
  title: string;
  /** One of four fixed sentences. Never a generated claim about the code. */
  sentence: string;
  entries: InsightEntry[];
  /** How many entries there are, however many are listed. */
  total: number;
}

export interface Insights {
  /** Every insight that found something, in reading order. */
  list: Insight[];
  /** Entries held back from the lists because of INSIGHT_LIMIT. */
  truncated: number;
}

const SENTENCES: Readonly<Record<InsightKind, string>> = {
  unimported: "Nothing in this repository imports these.",
  highFanIn: "An unusual number of files import these.",
  cycle: "These files import each other in a loop.",
  longFile: "These files are long enough that reading one is work.",
};

const TITLES: Readonly<Record<InsightKind, string>> = {
  unimported: "Nothing imports",
  highFanIn: "Unusually depended on",
  cycle: "Import cycles",
  longFile: "Long files",
};

function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * Files nothing imports, minus the ones something other than an import reaches.
 *
 * A page, a route, a layout and a middleware are loaded by the framework under
 * a name the import graph never sees, and a package entry is loaded by whoever
 * installs the package. Reporting those would be the parser describing the
 * limits of its own view as though it were a finding about the code.
 */
function unimportedFiles(files: readonly ParsedFile[], fanIn: ReadonlyMap<string, number>): InsightEntry[] {
  return files
    .filter((file) => file.reach === "none" && (fanIn.get(file.path) ?? 0) === 0)
    .map((file): InsightEntry => ({ path: file.path, note: null }))
    .sort(byPath);
}

function highFanInFiles(fanIn: ReadonlyMap<string, number>, files: readonly ParsedFile[]): InsightEntry[] {
  const known = new Set(files.map((file) => file.path));
  return [...fanIn.entries()]
    .filter(([path, count]) => count >= HIGH_FAN_IN && known.has(path))
    .sort((a, b) => b[1] - a[1] || byPath({ path: a[0] }, { path: b[0] }))
    .map(([path, count]): InsightEntry => ({ path, note: `${count} import${count === 1 ? "" : "s"}` }));
}

function longFiles(files: readonly ParsedFile[]): InsightEntry[] {
  return files
    .filter((file) => file.lines >= LONG_FILE_LINES)
    .sort((a, b) => b.lines - a.lines || byPath(a, b))
    .map((file): InsightEntry => ({ path: file.path, note: `${file.lines} lines` }));
}

/**
 * Strongly connected components with more than one member, plus any file that
 * imports itself, found by Tarjan's algorithm.
 *
 * Iterative. A recursive Tarjan walks the same path a recursive walk does, and
 * a repository with a deep import graph takes the call stack with it.
 */
function importCycles(files: readonly ParsedFile[], edges: readonly Edge[]): InsightEntry[] {
  const links = new Map<string, string[]>();
  const selfImporting = new Set<string>();
  const known = new Set(files.map((file) => file.path));

  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    if (edge.from === edge.to) {
      selfImporting.add(edge.from);
      continue;
    }
    const list = links.get(edge.from);
    if (list === undefined) links.set(edge.from, [edge.to]);
    else list.push(edge.to);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const file of files) {
    if (index.has(file.path)) continue;

    index.set(file.path, counter);
    low.set(file.path, counter);
    counter += 1;
    stack.push(file.path);
    onStack.add(file.path);

    // One frame per file on the current path, holding how far along its
    // neighbours it has got. This is the recursion, written down.
    const frames: Array<{ path: string; next: number }> = [{ path: file.path, next: 0 }];

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const neighbours = links.get(frame.path) ?? [];
      const frameLow = low.get(frame.path) ?? 0;

      if (frame.next < neighbours.length) {
        const next = neighbours[frame.next];
        frame.next += 1;

        const seen = index.get(next);
        if (seen === undefined) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          frames.push({ path: next, next: 0 });
          continue;
        }
        if (onStack.has(next)) {
          low.set(frame.path, Math.min(frameLow, seen));
          continue;
        }
        // Already finished and popped: its component is closed, nothing to lower.
        continue;
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) {
        low.set(parent.path, Math.min(low.get(parent.path) ?? 0, frameLow));
      }

      if (frameLow !== index.get(frame.path)) continue;

      const component: string[] = [];
      for (;;) {
        const member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        component.push(member);
        if (member === frame.path) break;
      }
      if (component.length > 1) components.push(component.sort((a, b) => byPath({ path: a }, { path: b })));
    }
  }

  for (const path of [...selfImporting].sort()) {
    components.push([path]);
  }

  function cmpComponents(a: string[], b: string[]): number {
    return b.length - a.length || byPath({ path: a[0] }, { path: b[0] });
  }

  return components
    .sort(cmpComponents)
    .map((component): InsightEntry => ({
      path: component[0],
      note:
        component.length <= PRINTABLE_CYCLE
          ? [...component, component[0]].join(" → ")
          : `${component.length} files, each reaching the others`,
    }));
}

function assemble(
  kind: InsightKind,
  entries: InsightEntry[],
  truncated: { count: number },
): Insight {
  if (entries.length > INSIGHT_LIMIT) truncated.count += entries.length - INSIGHT_LIMIT;
  return {
    kind,
    title: TITLES[kind],
    sentence: SENTENCES[kind],
    entries: entries.slice(0, INSIGHT_LIMIT),
    total: entries.length,
  };
}

export function computeInsights(files: readonly ParsedFile[], edges: readonly Edge[]): Insights {
  const fanIn = new Map<string, number>();
  for (const edge of edges) fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1);

  const truncated = { count: 0 };
  const found = [
    assemble("unimported", unimportedFiles(files, fanIn), truncated),
    assemble("highFanIn", highFanInFiles(fanIn, files), truncated),
    assemble("cycle", importCycles(files, edges), truncated),
    assemble("longFile", longFiles(files), truncated),
  ];

  return { list: found.filter((insight) => insight.total > 0), truncated: truncated.count };
}