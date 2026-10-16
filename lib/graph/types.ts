import type { ImportKind, ParsedFile } from "@/parser/types";

/**
 * What the canvas shows. Derived from the fold, the file list and the edge list;
 * nothing here holds state, so the same inputs always describe the same graph.
 */

export type CanvasNodeKind = "folder" | "panel" | "row";

/** Row and measurement constants. Sized in pixels so layout needs no DOM. */
export const METRICS = {
  fontSize: 11,
  charWidth: 6.3,
  labelGap: 14,
  minWidth: 104,
  /**
   * Wide enough for the longest file name a repository tends to carry. Repositories
   * full of generated provider names run to fifty-odd characters, and clipping those
   * defeats the point of listing the files at all. Past this the row ellipsis-es.
   */
  maxWidth: 480,
  /** Inset from a panel's left and right edge to its rows. */
  rowInset: 10,
  /** Height of a folded node before fan-in adds to it. */
  folderBaseHeight: 34,
  /** Each dependent file adds this much height. */
  fanInUnit: 2.5,
  fanInMax: 72,
  panelHeaderHeight: 26,
  panelRowHeight: 19,
  panelRowGap: 1,
  panelOverflowHeight: 20,
  /** Rows a panel lists before it reports the rest instead of growing. */
  maxRows: 14,
} as const;

export interface CanvasNode {
  /** Unique on the canvas. Folders are addressed by their folded path. */
  id: string;
  kind: CanvasNodeKind;
  /** Shown on the node. Shortest thing still unique where it sits. */
  label: string;
  /** Path of the folded folder this came from. */
  folderPath: string;
  /** Set only on rows. */
  file: ParsedFile | null;
  /** Position in the panel's row list, for rows. */
  rowIndex: number;
  /** Files the panel holds beyond the rows it lists. */
  overflow: number;
  /** True once a panel has listed more than one page, so it can offer to go back. */
  canCollapse: boolean;
  fileCount: number;
  fanIn: number;
  fanOut: number;
  width: number;
  height: number;
  /** Panel id, for rows. */
  parentId: string | null;
  /**
   * Files this node holds directly that match the active category filter. Zero
   * when no filter is on. Direct rather than inherited, so the panels across the
   * map sum to the number the rail shows without counting a file twice.
   */
  matchCount: number;
  /**
   * Whether this node, or anything folded into it, holds a match. Used for dimming:
   * a folder whose category all lives in a subfolder still belongs to the category,
   * and dimming it would take the shape of the map with it.
   */
  containsMatch: boolean;
}

export interface CanvasEdge {
  id: string;
  /** The file-level edge this came from, unchanged. */
  from: string;
  to: string;
  kind: ImportKind;
  source: string;
  target: string;
  /** Both ends sit inside one panel, so the edge never leaves it. */
  contained: boolean;
}

export interface CanvasGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  byId: Map<string, CanvasNode>;
  /** Top-level nodes are the ones dagre places. */
  topLevel: CanvasNode[];
  /**
   * Which folded folder holds each file. A file's own `folder` cannot answer this:
   * folding merges directories, so the folder a file was written in is often not
   * the node that holds it.
   */
  folderOfFile: Map<string, string>;
}

/** What the detail pane is currently describing. */
export type Selection =
  | { kind: "folder"; id: string; folderPath: string; label: string }
  | { kind: "row"; id: string; folderPath: string; label: string; file: ParsedFile };