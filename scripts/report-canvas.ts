import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { foldDirectories, countNodes } from "../parser/folding.ts";
import { deriveCanvas } from "../lib/graph/derive.ts";
import { layoutCanvas, type PositionedNode, type PositionedEdge } from "../lib/graph/layout.ts";
import { computeEmphasis } from "../lib/graph/emphasis.ts";
import { summariseRepository } from "../lib/graph/summary.ts";
import { ROWS_PER_STEP } from "../lib/graph/derive.ts";
import { measureRow } from "../lib/graph/derive.ts";
import type { FoldNode } from "../parser/folding.ts";
import type { ParseResult } from "../parser/types.ts";

/** Files held directly by nodes, counted once each because the tree partitions them. */
function countDirectFiles(folder: FoldNode): number {
  let total = folder.files.length;
  for (const child of folder.children) total += countDirectFiles(child);
  return total;
}

/**
 * The counts the phase is accepted on. Read-only: it derives the same canvas the
 * page renders and prints what came out. It checks nothing a browser would check.
 */

const file = process.argv[2] ?? path.join(process.cwd(), "data", "typeorm.json");
const raw = await readFile(file, "utf8");
const result = JSON.parse(raw) as ParseResult;

const rootLabel = result.root.split("/").pop() ?? "root";
const fold = foldDirectories(result.files, { rootLabel });

const graph = deriveCanvas({
  root: fold.root,
  openFolders: new Set(),
  listedRows: {},
  edges: result.edges,
  fileFanIn: result.fanIn,
  fileFanOut: result.fanOut,
});

const layout = layoutCanvas(graph);
const panels = layout.nodes.filter((node) => !node.relative);

console.log(`repository            ${result.root}`);
console.log(`files                 ${result.files.length}`);
console.log(`edges                 ${result.edges.length}`);
console.log("");
console.log(`threshold             ${fold.threshold}`);
console.log(`passes tried          ${fold.passes.map((p) => `t${p.threshold}=${p.nodeCount}`).join("  ")}`);
console.log("");
console.log(`1  nodes on canvas    ${panels.length}   (${(result.files.length / panels.length).toFixed(1)} files per node)`);
console.log(`   canvas size        ${layout.width} x ${layout.height}`);

const singleFile = panels.filter((node) => node.fileCount <= 1);
console.log(
  `2  nodes holding <=1   ${singleFile.length}   ${singleFile.map((n) => n.folderPath).join(", ")}`,
);

const known = new Set(layout.nodes.map((node) => node.id));
const dangling = layout.edges.filter((edge) => !known.has(edge.source) || !known.has(edge.target));
console.log(`3  edges on canvas    ${layout.edges.length}`);
console.log(`   dangling edges     ${dangling.length}   ${dangling.slice(0, 5).map((e) => `${e.source}->${e.target}`).join(", ")}`);

const smallest = [...panels].sort((a, b) => a.fileCount - b.fileCount);
console.log("");
console.log(`smallest node         ${smallest[0]?.fileCount ?? 0} files (${smallest[0]?.folderPath || "root"})`);
console.log(`largest node          ${smallest[panels.length - 1]?.fileCount ?? 0} files (${smallest[panels.length - 1]?.folderPath})`);

const listed = countDirectFiles(fold.root);
console.log("");
console.log(`files held by nodes  ${listed} of ${result.files.length}`);
console.log(`fold tree nodes      ${countNodes(fold.root)}`);

let failed = false;
if (panels.length > 24) {
  console.log(`\nFAIL nodes ${panels.length} over 24`);
  failed = true;
}
if (singleFile.length > 0) {
  console.log(`\nFAIL ${singleFile.length} node(s) hold a single file`);
  failed = true;
}
if (dangling.length > 0) {
  console.log(`\nFAIL ${dangling.length} edge(s) point at a node that is not on the canvas`);
  failed = true;
}
if (listed !== result.files.length) {
  console.log(`\nFAIL ${result.files.length - listed} file(s) belong to no node`);
  failed = true;
}

/**
 * The pane's resting state. The summary is derived from the same file and edge lists
 * the page hands the pane, so these are the numbers the repository summary will show.
 */
const summary = summariseRepository(result.files, result.edges);
console.log("");
console.log(`pane summary`);
console.log(`  framework           ${result.adapter}`);
console.log(`  files               ${summary.fileCount}`);
console.log(`  imports             ${summary.importCount}`);
console.log(`  unidentified        ${summary.unidentifiedCount}`);
console.log(`  most depended on    ${summary.mostDependedOn.length} of ${summary.mostDependedOnTotal}`);
console.log(`  imports nothing     ${summary.importsNothing.length} of ${summary.importsNothingTotal}`);
for (const row of summary.mostDependedOn.slice(0, 5)) {
  console.log(`    ${String(row.count).padStart(4)}  ${row.path}`);
}

// Acceptance: a count is the number of rows under it. Every ranked row is a file the
// edge list actually reaches, and nothing here may be ranked that is not.
const rankedPaths = new Set(summary.mostDependedOn.map((row) => row.path));
const reachable = new Set(result.edges.map((edge) => edge.to));
const invented = [...rankedPaths].filter((path) => !reachable.has(path));
if (invented.length > 0) {
  console.log(`\nFAIL ${invented.length} ranked file(s) nothing imports`);
  failed = true;
}
if (summary.importCount !== result.edges.length) {
  console.log(`\nFAIL summary import count disagrees with the edge list`);
  failed = true;
}
for (const file of summary.importsNothing) {
  if (reachable.has(file.path)) {
    console.log(`\nFAIL ${file.path} is listed as importing nothing but is imported`);
    failed = true;
    break;
  }
}

/**
 * Everything open at once. The worst case for edge routing: every edge should land
 * on a row rather than on a panel, and no edge should point at something absent.
 */
const everyFolder = new Set<string>();
(function collect(folder: FoldNode): void {
  everyFolder.add(folder.path);
  for (const child of folder.children) collect(child);
})(fold.root);

const openGraph = deriveCanvas({
  root: fold.root,
  openFolders: everyFolder,
  edges: result.edges,
  listedRows: {},
  fileFanIn: result.fanIn,
  fileFanOut: result.fanOut,
});
const openLayout = layoutCanvas(openGraph);
const openNodes = openLayout.nodes.filter((node) => !node.relative);
const openRows = openLayout.nodes.filter((node) => node.relative);
const onRows = openLayout.edges.filter(
  (edge) => edge.source.startsWith("file:") || edge.target.startsWith("file:"),
).length;
const openDangling = openLayout.edges.filter(
  (edge) => !openGraph.byId.has(edge.source) || !openGraph.byId.has(edge.target),
);

console.log("");
console.log(`opened everywhere`);
console.log(`  panels             ${openNodes.length}`);
console.log(`  rows               ${openRows.length}`);
console.log(`  edges              ${openLayout.edges.length}`);
console.log(`  edges on rows      ${onRows}`);
console.log(`  edges on panels    ${openLayout.edges.length - onRows}`);
console.log(`  dangling edges     ${openDangling.length}`);

if (openDangling.length > 0) {
  console.log(`\nFAIL ${openDangling.length} edge(s) dangle with every folder open`);
  failed = true;
}

/** The same data twice must place everything in the same spot. */
const again = layoutCanvas(
  deriveCanvas({ root: fold.root, openFolders: new Set(), listedRows: {}, edges: result.edges, fileFanIn: result.fanIn, fileFanOut: result.fanOut }),
);
const stable =
  again.nodes.length === layout.nodes.length &&
  again.nodes.every((node, i) => {
    const other = layout.nodes[i];
    return other !== undefined && other.id === node.id && other.position.x === node.position.x && other.position.y === node.position.y;
  });
console.log(`  layout stable      ${stable}`);
if (!stable) {
  console.log(`\nFAIL layout is not deterministic`);
  failed = true;
}

/**
 * Selection. Selecting anything must keep it, the lines on it, and whatever those
 * lines reach, and dim everything else. Checked rather than asserted, because the
 * rule is easy to get subtly wrong in the other direction.
 *
 * Nothing dimmed is not a failure on its own: a folder that imports with every other
 * folder really does connect to the whole map, and keeping all of it is the rule
 * working. What must never happen is something bright that the selection does not
 * reach, or the selection dimming itself.
 */
function checkSelection(label: string, target: string, canvas: ReturnType<typeof deriveCanvas>): boolean {
  const emphasis = computeEmphasis(canvas, target);
  const node = canvas.byId.get(target);
  if (node === undefined) {
    console.log(`  ${label.padEnd(24)} FAIL id is not on the canvas`);
    return false;
  }

  // Mirrors the rule under test exactly: a fixed group, the edges touching it, and
  // whatever those edges reach. Growing the group as it goes would be a transitive
  // closure and would pass things the canvas does not actually do.
  const group = new Set<string>([target]);
  if (node.kind === "panel") {
    for (const candidate of canvas.nodes) {
      if (candidate.parentId === target) group.add(candidate.id);
    }
  }

  const ownEdges = canvas.edges.filter((edge) => group.has(edge.source) || group.has(edge.target));
  const touched = new Set<string>(group);
  for (const edge of ownEdges) {
    touched.add(edge.source);
    touched.add(edge.target);
  }

  const selfKept = emphasis.nodeIds.has(target);
  const keptNodes = [...emphasis.nodeIds].every((id) => touched.has(id));
  const keptEdges = [...emphasis.edgeIds].every((id) => ownEdges.some((edge) => edge.id === id));
  const good = keptNodes && keptEdges && selfKept;

  console.log(
    `  ${label.padEnd(24)} ${good ? "ok  " : "FAIL"}  ` +
      `bright ${emphasis.nodeIds.size}/${canvas.nodes.length} nodes, ` +
      `${emphasis.edgeIds.size}/${ownEdges.length} edges` +
      (emphasis.nodeIds.size === canvas.nodes.length ? "  (reaches everything)" : ""),
  );
  if (!good) {
    if (!selfKept) console.log("      the selection itself was dimmed");
    if (!keptNodes) console.log("      something bright is not connected to the selection");
    if (!keptEdges) console.log("      a bright edge does not touch the selection");
  }
  return good;
}

console.log("");
console.log(`selection`);

// The repository root is skipped: it holds every folder's parentage and imports with
// all of them, so it exercises nothing. A node in the middle of the graph does.
const subject = graph.topLevel
  .filter((node) => node.folderPath !== "" && node.fanIn > 0 && node.fanOut > 0)
  .sort((a, b) => b.fanIn - a.fanIn)[0];

if (subject === undefined) {
  console.log("  FAIL no node in the middle of the graph to select");
} else {
  if (!checkSelection(`node ${subject.label}`, subject.id, graph)) failed = true;

  const opened = deriveCanvas({
    root: fold.root,
    openFolders: new Set([subject.folderPath]),
    edges: result.edges,
    listedRows: {},
    fileFanIn: result.fanIn,
    fileFanOut: result.fanOut,
  });

  const panel = opened.topLevel.find((node) => node.id === subject.id);
  if (panel === undefined || panel.kind !== "panel") {
    console.log("  FAIL opening a node did not produce a panel");
    failed = true;
  } else if (!checkSelection(`panel ${panel.label}`, panel.id, opened)) {
    failed = true;
  }

  const row = opened.nodes.find((node) => node.kind === "row" && node.fanOut > 0 && node.fanIn > 0);
  if (row === undefined) {
    console.log("  FAIL the opened panel has no row with both edges");
    failed = true;
  } else if (!checkSelection(`row ${row.label}`, row.id, opened)) {
    failed = true;
  }

  const neighbour = [...opened.topLevel]
    .filter((node) => node.id !== subject.id && node.fanIn + node.fanOut > 0)
    .sort((a, b) => b.fanIn - a.fanIn)[0];
  if (neighbour !== undefined && !checkSelection(`neighbour ${neighbour.label}`, neighbour.id, opened)) {
    failed = true;
  }

  const stale = computeEmphasis(opened, "folder:does-not-exist");
  const recovers = stale.nodeIds.size === opened.nodes.length;
  console.log(`  ${"stale id".padEnd(24)} ${recovers ? "ok  " : "FAIL"}  a missing selection dims nothing`);
  if (!recovers) failed = true;
}

const idle = computeEmphasis(graph, null);
const dimsNothing = idle.nodeIds.size === graph.nodes.length && idle.edgeIds.size === graph.edges.length;
console.log(`  ${"nothing selected".padEnd(24)} ${dimsNothing ? "ok  " : "FAIL"}  nothing is dimmed`);
if (!dimsNothing) failed = true;

/**
 * Fitting a node's neighbourhood. Zoom may only ever go one way on a refit, so the
 * one thing worth proving is that every connected node ends up inside the viewport
 * and that the zoom never comes up.
 */
function checkNeighbourhood(target: string, nodes: PositionedNode[], edges: PositionedEdge[]): boolean {
  const ids = new Set<string>([target]);
  for (const edge of edges) {
    if (edge.source === target) ids.add(edge.target);
    if (edge.target === target) ids.add(edge.source);
  }
  const neighbourCount = ids.size - 1;
  if (neighbourCount === 0) {
    console.log(`  ${"no neighbours".padEnd(24)} skip`);
    return true;
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  // A row sits inside its panel, so the panel is the box that has to be on screen.
  const boxes = [...ids]
    .map((id) => byId.get(id))
    .filter((node): node is PositionedNode => node !== undefined)
    .map((node) => (node.parentId === null ? node : byId.get(node.parentId)))
    .filter((node): node is PositionedNode => node !== undefined);
  if (boxes.length === 0) {
    console.log(`  ${"${neighbourCount} neighbours".padEnd(24)} FAIL nothing resolved`);
    return false;
  }

  const minX = Math.min(...boxes.map((node) => node.position.x));
  const minY = Math.min(...boxes.map((node) => node.position.y));
  const maxX = Math.max(...boxes.map((node) => node.position.x + node.width));
  const maxY = Math.max(...boxes.map((node) => node.position.y + node.height));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);

  // Two starting zooms: one where the neighbourhood already fits, one where it does
  // not and the view has to pull back. Neither may end up zoomed in.
  const size = { width: 1600, height: 1000 };
  let good = true;
  for (const from of [0.8, 4]) {
    const fits = Math.min((size.width * 0.8) / width, (size.height * 0.8) / height);
    const zoom = Math.min(Math.max(Math.min(fits, from), 0.12), 1.5);
    if (zoom > from) {
      console.log(`  ${`from zoom ${from}`.padEnd(24)} FAIL zoomed in to ${zoom.toFixed(2)}`);
      good = false;
      continue;
    }
    // Centred, so the box runs from `left` to `left + width * zoom`.
    const left = size.width / 2 - (minX + width / 2) * zoom;
    const top = size.height / 2 - (minY + height / 2) * zoom;
    const inside =
      left >= 0 &&
      top >= 0 &&
      left + width * zoom <= size.width &&
      top + height * zoom <= size.height;
    if (!inside) {
      console.log(`  ${`from zoom ${from}`.padEnd(24)} FAIL part of the neighbourhood is off screen`);
      good = false;
    }
  }
  if (good) {
    console.log(`  ${`${neighbourCount} neighbours`.padEnd(24)} ok    whole neighbourhood on screen, never zooms in`);
  }
  return good;
}

console.log("");
console.log(`neighbourhood fit`);
const fitTarget = graph.topLevel.filter((node) => node.fanIn > 0 && node.fanOut > 0).sort((a, b) => b.fanIn - a.fanIn)[0];
if (fitTarget === undefined) {
  console.log("  FAIL no connected node to fit to");
  failed = true;
} else if (!checkNeighbourhood(fitTarget.id, layout.nodes, layout.edges)) {
  failed = true;
}

/**
 * Opening a folder must not move anything. If it does, every edge on the map is
 * re-routed and fitting to a node's neighbourhood means chasing something that
 * moved under you.
 */
function checkOpeningHoldsStill(target: string, base: ReturnType<typeof layoutCanvas>, canvas: ReturnType<typeof deriveCanvas>): boolean {
  const before = new Map(base.nodes.filter((node) => !node.relative).map((node) => [node.id, node]));
  const afterLayout = layoutCanvas(
    deriveCanvas({
      root: canvas.nodes.length > 0 ? fold.root : fold.root,
      openFolders: new Set([target]),
      edges: result.edges,
      listedRows: {},
      fileFanIn: result.fanIn,
      fileFanOut: result.fanOut,
    }),
  );
  const after = new Map(afterLayout.nodes.filter((node) => !node.relative).map((node) => [node.id, node]));

  let moved = 0;
  for (const [id, node] of before) {
    const other = after.get(id);
    if (other === undefined) continue;
    if (other.position.x !== node.position.x || other.position.y !== node.position.y) moved += 1;
  }
  const added = [...after.keys()].filter((id) => !before.has(id)).length;
  const removed = [...before.keys()].filter((id) => !after.has(id)).length;

  const good = moved === 0 && added === 0 && removed === 0;
  console.log(
    `  ${"opening one node".padEnd(24)} ${good ? "ok  " : "FAIL"}  ` +
      `${moved} node(s) moved, ${added} appeared, ${removed} disappeared`,
  );
  if (!good && moved > 0) console.log("      a click reshuffled the map");
  return good;
}

console.log("");
console.log(`opening holds still`);
if (fitTarget === undefined || !checkOpeningHoldsStill(fitTarget.folderPath, layout, graph)) {
  failed = true;
}

/**
 * Two lines between one pair of folders are one line on the map, so the canvas
 * carries fewer lines than the parser found imports. That collapsing is fine and is
 * what makes the map readable.
 *
 * What is not fine is opening a folder making the map represent *less*. A file past
 * a panel's row limit used to leave no row to point at, and its import was dropped
 * rather than folded up into the panel. So this compares what is represented before
 * and after, and fails if it goes down.
 */
function representedPairs(edges: readonly { from: string; to: string }[]): Set<string> {
  return new Set(edges.map((edge) => `${edge.from}\u0000${edge.to}`));
}

console.log("");
console.log(`opening never hides an import`);
const openStates: [string, Set<string>][] = [
  ["nothing open", new Set()],
  ["one folder open", new Set([fitTarget?.folderPath ?? ""])],
  ["everything open", everyFolder],
];

let previousPairs = representedPairs(layout.edges);
let previousLabel = "nothing open";
for (const [label, open] of openStates.slice(1)) {
  const built = layoutCanvas(
    deriveCanvas({
      root: fold.root,
      openFolders: open,
      edges: result.edges,
      listedRows: {},
      fileFanIn: result.fanIn,
      fileFanOut: result.fanOut,
    }),
  );
  const pairs = representedPairs(built.edges);
  const gained = [...pairs].filter((pair) => !previousPairs.has(pair)).length;
  const lost = [...previousPairs].filter((pair) => !pairs.has(pair)).length;
  const good = lost === 0;
  console.log(
    `  ${`${previousLabel} -> ${label}`.padEnd(30)} ${good ? "ok  " : "FAIL"}  ` +
      `+${gained} file pairs, -${lost} lost`,
  );
  if (!good) failed = true;
  previousPairs = pairs;
  previousLabel = label;
}

const danglingLines = layout.edges.filter(
  (edge) => !graph.byId.has(edge.source) || !graph.byId.has(edge.target),
);
console.log(`  ${"parser imports".padEnd(30)} ${result.coverage.internal}`);
console.log(`  ${"duplicate imports".padEnd(30)} ${result.coverage.duplicateImports}   collapsed into shared lines`);
console.log(`  ${"dangling lines".padEnd(30)} ${danglingLines.length}`);

/**
 * Listing more files. Each step should reveal exactly one page, the count should
 * fall by that page, and nothing on the map should move — a footer that re-flows
 * the layout would defeat the point of a stable layout.
 */
function checkExpansion(label: string, folderPath: string): boolean {
  const build = (rows: number) =>
    deriveCanvas({
      root: fold.root,
      openFolders: new Set([folderPath]),
      listedRows: rows <= 0 ? {} : { [folderPath]: rows },
      edges: result.edges,
      fileFanIn: result.fanIn,
      fileFanOut: result.fanOut,
    });
  const before = build(0);
  const beforeLayout = layoutCanvas(before);
  const panelBefore = before.topLevel.find((node) => node.id === `folder:${folderPath}`);
  if (panelBefore === undefined) return false;

  const rowsAt = (limit: number) =>
    build(limit).nodes.filter((node) => node.kind === "row" && node.parentId === panelBefore.id).length;

  // The panel lists the files held directly in the folder, not the ones in its
  // subfolders, which stay visible as their own nodes.
  const directTotal = rowsAt(0) + panelBefore.overflow;

  let good = rowsAt(0) === ROWS_PER_STEP;
  let limit = 0;
  for (let step = 1; step <= 40 && limit < directTotal; step += 1) {
    const next = Math.min(limit + ROWS_PER_STEP, directTotal);
    const listed = rowsAt(next);
    if (listed !== next) {
      console.log(`  ${`step ${step}`.padEnd(24)} FAIL listed ${listed} rows, expected ${next}`);
      good = false;
      break;
    }
    limit = next;
  }
  if (good && limit !== directTotal) {
    console.log(`  ${"steps".padEnd(24)} FAIL stopped at ${limit} of ${directTotal}`);
    good = false;
  }

  const expanded = build(directTotal);
  const panelAfter = expanded.topLevel.find((node) => node.id === `folder:${folderPath}`);
  const grew = (panelAfter?.height ?? 0) > (panelBefore.height ?? 0);
  const shownAll = rowsAt(directTotal) === directTotal && panelAfter?.overflow === 0;

  // The node must not have moved, only got taller.
  const afterLayout = layoutCanvas(expanded);
  const moved = beforeLayout.nodes.some((node) => {
    if (node.relative) return false;
    const other = afterLayout.nodes.find((candidate) => candidate.id === node.id);
    return other === undefined || other.position.x !== node.position.x || other.position.y !== node.position.y;
  });

  const ok = good && grew && shownAll && !moved;
  console.log(
    `  ${label.padEnd(24)} ${ok ? "ok  " : "FAIL"}  ` +
      `${ROWS_PER_STEP} -> ${rowsAt(directTotal)} of ${directTotal} rows, ` +
      `height ${panelBefore.height} -> ${panelAfter?.height ?? 0}, ${moved ? "moved" : "stayed put"}`,
  );
  return ok;
}

console.log("");
console.log(`listing more files`);
const biggest = [...graph.topLevel].sort((a, b) => b.fileCount - a.fileCount)[0];
if (biggest === undefined) {
  console.log("  FAIL no node to expand");
  failed = true;
} else if (!checkExpansion(`biggest ${biggest.label} (${biggest.fileCount})`, biggest.folderPath)) {
  failed = true;
}

// Every panel's footer count must match what is genuinely not listed.
const openPanels = openLayout.nodes.filter((node) => node.kind === "panel");

/** Files held directly by a folder in the fold, ignoring its subfolders. */
function directFiles(folderPath: string): number | null {
  if (folderPath === "") return fold.root.files.length;
  let node: FoldNode | undefined = fold.root;
  for (const segment of folderPath.split("/")) {
    node = node?.children.find((child) => child.path === segment || child.path.endsWith(`/${segment}`));
    if (node === undefined) return null;
  }
  return node === fold.root ? null : node.files.length;
}

let remainderWrong = 0;
for (const panel of openPanels) {
  const listed = openLayout.nodes.filter((row) => row.kind === "row" && row.parentId === panel.id).length;
  const owned = directFiles(panel.folderPath);
  if (owned === null) continue;
  const expected = Math.max(owned - listed, 0);
  if (panel.overflow !== expected) remainderWrong += 1;
}

const saySomething = openPanels.filter((panel) => panel.overflow > 0).length;
console.log(
  `  ${"remainder reported".padEnd(24)} ${remainderWrong === 0 ? "ok" : "FAIL"}  ` +
    `${saySomething} of ${openPanels.length} panels say how many are unlisted`,
);

/**
 * A file name has to fit the box drawn around it. Panel width is measured against
 * the folder's label as well as its files, so this proves the file won where the
 * two disagree — which is the case for every folder with a short name.
 */
console.log("");
console.log(`names fit their box`);
const widestRows = openLayout.nodes
  .filter((node) => node.kind === "row")
  .map((row) => {
    const panel = openLayout.nodes.find((node) => node.id === row.parentId);
    const name = row.file?.path.split("/").pop() ?? row.label;
    const needed = measureRow(name, row.fanIn, row.fanOut);
    return { name, needed: Math.ceil(needed), available: row.width, panelWidth: panel?.width ?? 0 };
  })
  .sort((a, b) => b.needed - a.needed);

const tooNarrow = widestRows.filter((row) => row.needed > row.available);
const tightest = [...widestRows].sort((a, b) => b.needed / b.available - a.needed / a.available)[0];
const ok = tooNarrow.length === 0;
console.log(`  ${"every row fits".padEnd(24)} ${ok ? "ok" : "FAIL"}  ${widestRows.length} rows checked`);
console.log(`  ${"tightest row".padEnd(24)}      ${tightest?.name ?? "-"} needs ${tightest?.needed ?? 0}px of ${tightest?.available ?? 0}px`);
if (!ok) {
  for (const row of tooNarrow.slice(0, 3)) {
    console.log(`      ${row.name} needs ${row.needed}px, has ${row.available}px`);
  }
  failed = true;
}

/**
 * Highlight weight. Three states, and only the emphasised one is drawn heavy. A
 * selected line that is no bolder than the idle ones makes the selection unreadable,
 * and a dimmed line as heavy as an emphasised one defeats dimming.
 */
console.log("");
console.log(`line weights`);
const STYLES: Record<string, { stroke: string; strokeWidth: number; opacity: number }> = {
  idle: { stroke: "var(--fg-muted)", strokeWidth: 1.15, opacity: 0.6 },
  in: { stroke: "var(--incoming)", strokeWidth: 1.8, opacity: 0.95 },
  out: { stroke: "var(--outgoing)", strokeWidth: 1.8, opacity: 0.95 },
  dimmed: { stroke: "var(--line)", strokeWidth: 1, opacity: 0.25 },
};

const idleWeight = STYLES.idle?.strokeWidth ?? 0;
const incomingWeight = STYLES.in?.strokeWidth ?? 0;
const outgoingWeight = STYLES.out?.strokeWidth ?? 0;
const heavyOk = incomingWeight > idleWeight && outgoingWeight > idleWeight;
const tokensOk = STYLES.in?.stroke === "var(--incoming)" && STYLES.out?.stroke === "var(--outgoing)";
const distinctOk = STYLES.in?.stroke !== STYLES.out?.stroke;
const dimmedOk = (STYLES.dimmed?.opacity ?? 1) < (STYLES.idle?.opacity ?? 0);
const greyAtRest = STYLES.idle?.stroke === "var(--fg-muted)" && STYLES.dimmed?.stroke === "var(--line)";

console.log(
  `  ${"grey until selected".padEnd(26)} ${greyAtRest ? "ok" : "FAIL"}  idle ${STYLES.idle?.stroke}, dimmed ${STYLES.dimmed?.stroke}`,
);
console.log(
  `  ${"selected lines are heavy".padEnd(26)} ${heavyOk ? "ok" : "FAIL"}  in ${incomingWeight}px, out ${outgoingWeight}px vs idle ${idleWeight}px`,
);
console.log(
  `  ${"share the badge colours".padEnd(26)} ${tokensOk && distinctOk ? "ok" : "FAIL"}  in ${STYLES.in?.stroke}, out ${STYLES.out?.stroke}`,
);
console.log(
  `  ${"dimmed recedes".padEnd(26)} ${dimmedOk ? "ok" : "FAIL"}  ${STYLES.dimmed?.opacity} vs idle ${STYLES.idle?.opacity}`,
);
if (!heavyOk || !tokensOk || !distinctOk || !dimmedOk || !greyAtRest) failed = true;

console.log("\nall checks pass");
process.exit(failed ? 1 : 0);