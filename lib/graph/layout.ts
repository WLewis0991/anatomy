import dagre from "dagre";
import { METRICS, type CanvasEdge, type CanvasGraph, type CanvasNode } from "./types.ts";

/**
 * Placement. Deterministic by construction: dagre is handed the same nodes in the
 * same order every run, and every position is a function of the graph rather than
 * of when the component happened to render.
 */

export interface PositionedNode extends CanvasNode {
  position: { x: number; y: number };
  /** A row's position is relative to its panel; a panel's is canvas-absolute. */
  relative: boolean;
}

export interface PositionedEdge extends CanvasEdge {
  /** Waypoints from source to target, in canvas coordinates. */
  points: Point[];
}

export interface CanvasLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

const NODE_SEP = 36;
const RANK_SEP = 110;
const MARGIN = 40;

/** A row's inset from the panel's left edge. Shared with the width measurement. */
export const ROW_INSET = METRICS.rowInset;

/** A row's offset from the top of its panel, which the header sits above. */
export function rowOffset(index: number): number {
  return METRICS.panelHeaderHeight + 4 + index * (METRICS.panelRowHeight + METRICS.panelRowGap);
}

export function layoutCanvas(graph: CanvasGraph): CanvasLayout {
  const panels = placePanels(graph);
  const rows = placeRows(graph, panels);

  const byId = new Map<string, PositionedNode>();
  for (const node of [...panels, ...rows]) byId.set(node.id, node);

  const edges = graph.edges.map((edge) => ({ ...edge, points: route(edge, byId) }));

  let width = 0;
  let height = 0;
  for (const panel of panels) {
    width = Math.max(width, panel.position.x + panel.width);
    height = Math.max(height, panel.position.y + foldedHeight(panel.fanIn));
  }

  return { nodes: [...panels, ...rows], edges, width: width + MARGIN, height: height + MARGIN };
}

/**
 * The height a node occupies when it is folded shut.
 *
 * Placement uses this for every node, open or not. An opened panel is drawn at the
 * spot its folded node was given and grows downwards from there, so the picture on
 * screen is decided by the repository's shape and not by what happens to be open.
 * Laying out against a panel's open height instead would let one click reshuffle
 * every other node and re-route every edge on the map.
 */
export function foldedHeight(fanIn: number): number {
  return Math.round(METRICS.folderBaseHeight + Math.min(fanIn * METRICS.fanInUnit, METRICS.fanInMax));
}

/**
 * dagre places the nodes. Edges between them set the routes; rows hang off their
 * panel afterwards and take no part in ranking.
 */
function placePanels(graph: CanvasGraph): PositionedNode[] {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: "LR",
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    marginx: MARGIN,
    marginy: MARGIN,
    edgesep: 12,
    ranker: "network-simplex",
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.topLevel) {
    g.setNode(node.id, { width: node.width, height: foldedHeight(node.fanIn) });
  }

  // One edge per ordered pair of folders. Contained edges never leave their
  // folder, so they are left out rather than drawn as a loop back to the start.
  //
  // A row is resolved back to the panel holding it, so the edges dagre ranks by are
  // the same whether folders are open or shut. Using the live edge list would mean
  // an open folder contributes none of its own, the ranking shifts, and every node
  // on the map moves the moment anything is clicked.
  const owner = new Map<string, string>();
  for (const node of graph.nodes) {
    owner.set(node.id, node.parentId === null ? node.id : node.parentId);
  }

  const pairs = new Map<string, [string, string]>();
  for (const edge of graph.edges) {
    if (edge.contained) continue;
    const source = owner.get(edge.source);
    const target = owner.get(edge.target);
    if (source === undefined || target === undefined) continue;
    if (!g.hasNode(source) || !g.hasNode(target)) continue;
    if (source === target) continue;
    pairs.set(`${source}\u0000${target}`, [source, target]);
  }
  for (const [key, [source, target]] of pairs) {
    g.setEdge(source, target, {}, key);
  }

  dagre.layout(g);

  return graph.topLevel.map((node) => {
    const placed = g.node(node.id) as { x: number; y: number } | undefined;
    // Positioned by its folded height, drawn at whatever height it now is, so an
    // open panel grows from where its node was rather than jumping to somewhere new.
    const height = foldedHeight(node.fanIn);
    return {
      ...node,
      position: placed
        ? { x: Math.round(placed.x - node.width / 2), y: Math.round(placed.y - height / 2) }
        : { x: 0, y: 0 },
      relative: false,
    };
  });
}

/** Rows stack in the order the parser listed the files, inside their panel. */
function placeRows(graph: CanvasGraph, panels: PositionedNode[]): PositionedNode[] {
  const panelsById = new Map(panels.map((panel) => [panel.id, panel]));
  const rows: PositionedNode[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== "row" || node.parentId === null) continue;
    const panel = panelsById.get(node.parentId);
    if (panel === undefined) continue;
    rows.push({
      ...node,
      width: Math.max(panel.width - ROW_INSET * 2, 0),
      position: { x: ROW_INSET, y: rowOffset(node.rowIndex) },
      relative: true,
    });
  }
  return rows;
}

/** The on-canvas box a line should meet. A row is placed inside its panel. */
function boxOf(node: PositionedNode, byId: Map<string, PositionedNode>): PositionedNode | undefined {
  if (!node.relative) return node;
  return node.parentId === null ? undefined : byId.get(node.parentId);
}

/** Where on that box the line starts or ends, on the vertical middle of the row. */
function attachAt(box: PositionedNode, row: PositionedNode | undefined, right: boolean): Point {
  const y = row === undefined ? box.position.y + box.height / 2 : box.position.y + row.position.y + row.height / 2;
  return { x: right ? box.position.x + box.width : box.position.x, y: Math.round(y) };
}

/**
 * Four points: off the source, across, into the target. The dogleg in the middle
 * is what makes a set of edges between the same two panels readable instead of a
 * single line with everything on it.
 */
function route(edge: CanvasEdge, byId: Map<string, PositionedNode>): Point[] {
  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  if (source === undefined || target === undefined) return [];

  const sourceBox = boxOf(source, byId);
  const targetBox = boxOf(target, byId);
  if (sourceBox === undefined || targetBox === undefined) return [];

  const forwards = sourceBox.position.x <= targetBox.position.x;
  const from = attachAt(sourceBox, source.relative ? source : undefined, forwards);
  const to = attachAt(targetBox, target.relative ? target : undefined, !forwards);

  const midX = Math.round((from.x + to.x) / 2);
  return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
}