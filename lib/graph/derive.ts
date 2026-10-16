import type { FoldNode } from "@/parser/folding";
import type { Edge, ParsedFile } from "@/parser/types";
import {
  METRICS,
  type CanvasEdge,
  type CanvasGraph,
  type CanvasNode,
} from "./types.ts";

/**
 * Deriving the canvas from the fold.
 *
 * A folded folder is one node. An opened folder is a panel with its files as
 * rows inside it, and edges that would have terminated on the panel now terminate
 * on the row for the file they actually name. Nothing is invented: an edge points
 * where the parser resolved it, and a file with no edge simply has no line.
 */

/** Rows listed per click on a panel's "more" affordance. */
export const ROWS_PER_STEP = 14;

/** A file's node id. Its row when listed, and nothing else — the panel id is separate. */
export function rowId(filePath: string): string {
  return `file:${filePath}`;
}

/** The id a folder is addressed by, whether it is folded shut or opened into a panel. */
export function folderNodeId(folderPath: string): string {
  return `folder:${folderPath}`;
}

/** What a row calls its file. */
export function rowLabel(file: ParsedFile): string {
  return file.path.split("/").pop() ?? file.path;
}

function measureWidth(label: string, fileCount: number, fanIn: number, fanOut: number): number {
  const badge = `${fileCount}f${fanIn > 0 ? ` ${fanIn}` : ""}${fanOut > 0 ? ` ${fanOut}` : ""}`;
  const text = `${label}  ${badge}`;
  const width = text.length * METRICS.charWidth + METRICS.labelGap * 2;
  return Math.round(Math.min(Math.max(width, METRICS.minWidth), METRICS.maxWidth));
}

function textWidth(text: string): number {
  return Math.round(text.length * METRICS.charWidth);
}

/** The degrees a row shows, spelled the way the row spells them. */
export function degreesText(fanIn: number, fanOut: number): string {
  if (fanIn === 0 && fanOut === 0) return "";
  const left = fanIn > 0 ? `\u2193${fanIn}` : "";
  const right = fanOut > 0 ? `\u2192${fanOut}` : "";
  return `${left}${fanIn > 0 && fanOut > 0 ? "/" : ""}${right}`;
}

/**
 * The width one file row needs: its swatch, its name, and its two degrees.
 *
 * Measured in one place because the panel's width and the check that the name fits
 * both depend on it, and two estimates of the same thing drift apart.
 */
export function measureRow(name: string, fanIn: number, fanOut: number): number {
  const swatchAndGap = METRICS.charWidth * 2;
  return Math.ceil(textWidth(name) + textWidth(degreesText(fanIn, fanOut)) + swatchAndGap);
}

/**
 * The width a folder needs, which is not the width of its label.
 *
 * A panel lists file names inside the box, so it has to be wide enough for the
 * longest one it will ever show — otherwise a folder called `sc` truncates
 * `MongoSchemaBuilder.ts` to nothing useful.
 *
 * It is measured against every file the folder holds rather than only the rows
 * currently listed, and the same width is used folded and open. Using only the
 * listed rows would widen the box as it expanded, and a box that changes width
 * between states moves every node on the map.
 */
function reservedWidth(
  folder: FoldNode,
  fanIn: number,
  fanOut: number,
  fileFanIn: Readonly<Record<string, number>>,
  fileFanOut: Readonly<Record<string, number>>,
): number {
  let widest = 0;
  for (const file of folder.files) {
    const name = file.path.split("/").pop() ?? file.path;
    widest = Math.max(widest, measureRow(name, fileFanIn[file.path] ?? 0, fileFanOut[file.path] ?? 0));
  }
  const fromRows = widest + METRICS.rowInset * 2;
  return Math.round(Math.min(Math.max(measureWidth(folder.label, folder.fileCount, fanIn, fanOut), fromRows), METRICS.maxWidth));
}

function measureFolderHeight(fanIn: number): number {
  const grown = Math.min(fanIn * METRICS.fanInUnit, METRICS.fanInMax);
  return Math.round(METRICS.folderBaseHeight + grown);
}

function measurePanelHeight(rowCount: number, hasOverflow: boolean): number {
  const rows = rowCount * (METRICS.panelRowHeight + METRICS.panelRowGap);
  const overflow = hasOverflow ? METRICS.panelOverflowHeight : 0;
  return Math.round(METRICS.panelHeaderHeight + rows + overflow + 8);
}

/** Matches held by this folder and nothing beneath it. */
function directMatches(folder: FoldNode, matchPaths: ReadonlySet<string> | null): number {
  if (matchPaths === null) return 0;
  let count = 0;
  for (const file of folder.files) {
    if (matchPaths.has(file.path)) count += 1;
  }
  return count;
}

/**
 * Whether anything in this folder's whole folded subtree matches. Recursive
 * because folding is recursive, and the depth is a directory's nesting rather
 * than an import chain.
 */
function subtreeHasMatch(folder: FoldNode, matchPaths: ReadonlySet<string> | null): boolean {
  if (matchPaths === null) return false;
  for (const file of folder.files) {
    if (matchPaths.has(file.path)) return true;
  }
  for (const child of folder.children) {
    if (subtreeHasMatch(child, matchPaths)) return true;
  }
  return false;
}

export interface DeriveInput {
  root: FoldNode;
  /** Folder paths currently opened into panels. */
  openFolders: ReadonlySet<string>;
  /**
   * How many rows each panel lists, keyed by folder path. A folder absent from the
   * record lists one step. This is the whole of the expansion state: the panel's
   * height, its row list and which edges terminate on a row all follow from it, so
   * nothing else has to be kept in step by hand.
   */
  listedRows: Readonly<Record<string, number>>;
  edges: readonly Edge[];
  fileFanIn: Readonly<Record<string, number>>;
  fileFanOut: Readonly<Record<string, number>>;
  /**
   * The files matching the rail's active category, or null when no category is
   * active. Read for the per-node match counts only: it changes what a node says
   * about itself, never where a node is, so the map does not move when a category
   * is chosen.
   */
  matchPaths: ReadonlySet<string> | null;
}

export function deriveCanvas(input: DeriveInput): CanvasGraph {
  const { root, openFolders, listedRows, edges, fileFanIn, fileFanOut, matchPaths } = input;

  // Which folder holds each file, so an edge can be redirected to a row or the
  // folder that contains it.
  const folderOfFile = new Map<string, FoldNode>();
  indexFiles(root, folderOfFile);

  // Fan-in and fan-out between folders, counting only edges that cross a folder
  // boundary. An edge inside one folder raises that folder's file count but is
  // not a dependency between folders.
  const folderFanIn = new Map<string, number>();
  const folderFanOut = new Map<string, number>();
  for (const edge of edges) {
    const fromFolder = folderOfFile.get(edge.from);
    const toFolder = folderOfFile.get(edge.to);
    if (fromFolder === undefined || toFolder === undefined) continue;
    if (fromFolder.path === toFolder.path) continue;
    folderFanOut.set(fromFolder.path, (folderFanOut.get(fromFolder.path) ?? 0) + 1);
    folderFanIn.set(toFolder.path, (folderFanIn.get(toFolder.path) ?? 0) + 1);
  }

  const nodes: CanvasNode[] = [];
  const topLevel: CanvasNode[] = [];
  // Every file the canvas actually lists as a row. A file outside this set is
  // folded up into its panel as far as edges are concerned.
  const rowIds = new Set<string>();

  function emit(folder: FoldNode): void {
    const open = openFolders.has(folder.path);
    const fanIn = folderFanIn.get(folder.path) ?? 0;
    const fanOut = folderFanOut.get(folder.path) ?? 0;

    if (!open) {
      const node: CanvasNode = {
        id: folderNodeId(folder.path),
        kind: "folder",
        label: folder.label,
        folderPath: folder.path,
        file: null,
        rowIndex: -1,
        overflow: 0,
        canCollapse: false,
        fileCount: folder.fileCount,
        fanIn,
        fanOut,
width: reservedWidth(folder, fanIn, fanOut, fileFanIn, fileFanOut),
        height: measureFolderHeight(fanIn),
        parentId: null,
        matchCount: directMatches(folder, matchPaths),
        containsMatch: subtreeHasMatch(folder, matchPaths),
      };
      nodes.push(node);
        topLevel.push(node);
      return;
    }

    const panelId = folderNodeId(folder.path);
    const limit = listedRows[folder.path] ?? ROWS_PER_STEP;
    const shown = folder.files.slice(0, Math.max(limit, 0));
    // Only files held directly by this folder are listed. Files in subfolders stay
    // visible as their own nodes, so the panel does not claim to hold them.
    const overflow = folder.files.length - shown.length;

    const panel: CanvasNode = {
      id: panelId,
      kind: "panel",
      label: folder.label,
      folderPath: folder.path,
      file: null,
      rowIndex: -1,
      overflow,
      canCollapse: shown.length > ROWS_PER_STEP,
      fileCount: folder.fileCount,
      fanIn,
      fanOut,
      width: reservedWidth(folder, fanIn, fanOut, fileFanIn, fileFanOut),
      height: measurePanelHeight(shown.length, overflow > 0),
      parentId: null,
      matchCount: directMatches(folder, matchPaths),
      containsMatch: subtreeHasMatch(folder, matchPaths),
    };
    nodes.push(panel);
    topLevel.push(panel);

    shown.forEach((file, index) => {
      rowIds.add(rowId(file.path));
      const name = rowLabel(file);
      const rowFanIn = fileFanIn[file.path] ?? 0;
      const rowFanOut = fileFanOut[file.path] ?? 0;
      nodes.push({
        id: rowId(file.path),
        kind: "row",
        label: name,
        folderPath: folder.path,
        file,
        rowIndex: index,
        overflow: 0,
        canCollapse: false,
        fileCount: 1,
        fanIn: rowFanIn,
        fanOut: rowFanOut,
        width: 0,
        height: METRICS.panelRowHeight,
        parentId: panelId,
        matchCount: matchPaths?.has(file.path) === true ? 1 : 0,
        containsMatch: matchPaths?.has(file.path) === true,
      });
    });
  }

  // The repository root is not a node: it holds every other node, so drawing it
  // would put a box around the whole map. Files sitting directly in the repository
  // root do need a home, and that home is the root folder itself.
  function visit(folder: FoldNode, isRoot: boolean): void {
    if (!isRoot || folder.files.length > 0) emit(folder);
    for (const child of folder.children) visit(child, false);
  }

  visit(root, true);

  // A file's row when the panel lists it, and the panel itself when it does not.
  //
  // A panel shows a limited number of rows and reports the rest rather than growing
  // without limit. An edge pointing at one of the unlisted files still has to land
  // somewhere real, so it lands on the panel holding that file. Dropping it instead
  // would quietly delete an import the parser found, and the file would quietly stop
  // looking depended on.
  // A row's node id, or the panel id when the folder is shut or the row is not listed.
  function anchorFor(filePath: string): string | null {
    const folder = folderOfFile.get(filePath);
    if (folder === undefined) return null;
    if (!openFolders.has(folder.path)) return folderNodeId(folder.path);
    const row = rowId(filePath);
    return rowIds.has(row) ? row : folderNodeId(folder.path);
  }

  const existing = new Set(nodes.map((node) => node.id));
  const canvasEdges: CanvasEdge[] = [];
  const seenEdge = new Set<string>();

  for (const edge of edges) {
    const source = anchorFor(edge.from);
    const target = anchorFor(edge.to);
    if (source === null || target === null) continue;
    if (source === target) continue;
    if (!existing.has(source) || !existing.has(target)) continue;
    // Two files in the same closed folder landing on one node are the same line.
    const key = `${source}\u0000${target}\u0000${edge.specifier}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    canvasEdges.push({
      id: key,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      source,
      target,
      contained: false,
    });
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of canvasEdges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source !== undefined && target !== undefined && source.parentId !== null && source.parentId === target.parentId) {
      edge.contained = true;
    }
  }

  const folderPathOfFile = new Map<string, string>();
  for (const [filePath, folder] of folderOfFile) folderPathOfFile.set(filePath, folder.path);

  return { nodes, edges: canvasEdges, byId, topLevel, folderOfFile: folderPathOfFile };
}

function indexFiles(folder: FoldNode, into: Map<string, FoldNode>): void {
  for (const file of folder.files) into.set(file.path, folder);
  for (const child of folder.children) indexFiles(child, into);
}

/**
 * What stands for a file on the canvas right now: its own row when the panel
 * listing it is open, and otherwise the folder node that holds it.
 *
 * This is the public twin of the anchor lookup inside `deriveCanvas`. Anything
 * outside the canvas — the detail pane selecting a path, a hover resolving to
 * something to ring — needs this answer and must not rebuild it.
 */
export interface FileAnchor {
  /** The node that currently represents the file. */
  nodeId: string;
  /** True only when the file has a row of its own rather than being folded away. */
  rowExists: boolean;
  /** The folded folder holding the file, which is not always the file's own folder. */
  folderPath: string;
}

export function anchorForFile(graph: CanvasGraph, file: ParsedFile): FileAnchor | null {
  const row = graph.byId.get(rowId(file.path));
  if (row !== undefined && row.kind === "row") {
    return { nodeId: row.id, rowExists: true, folderPath: row.folderPath };
  }
  const folderPath = graph.folderOfFile.get(file.path);
  if (folderPath === undefined) return null;
  return { nodeId: folderNodeId(folderPath), rowExists: false, folderPath };
}