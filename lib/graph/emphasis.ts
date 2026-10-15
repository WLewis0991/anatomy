import type { CanvasGraph } from "./types.ts";

/**
 * What stays at full strength when something is selected. Pure, so the canvas
 * never has to walk the graph itself to decide what to dim.
 */

export interface Emphasis {
  /** Nodes drawn at full strength. Everything not listed is dimmed. */
  nodeIds: ReadonlySet<string>;
  /** Edges drawn at full strength. */
  edgeIds: ReadonlySet<string>;
}

/**
 * Everything at full strength. Used when nothing is selected, and when the selected
 * thing is no longer on the canvas — dimming the whole map because an id went stale
 * would be worse than showing it all.
 */
function everything(graph: CanvasGraph): Emphasis {
  return {
    nodeIds: new Set(graph.nodes.map((node) => node.id)),
    edgeIds: new Set(graph.edges.map((edge) => edge.id)),
  };
}

/**
 * Selecting anything keeps it, the lines attached to it, and whatever those lines
 * reach, and dims everything else.
 *
 * An opened folder has to be treated as itself plus the rows inside it. Its edges
 * terminate on those rows rather than on the panel, so a selection keyed on the
 * panel's own id would find no edges and would dim every line the folder is
 * actually responsible for.
 */
export function computeEmphasis(graph: CanvasGraph, selectedId: string | null): Emphasis {
  if (selectedId === null) return everything(graph);

  const selected = graph.byId.get(selectedId);
  if (selected === undefined) return everything(graph);

  const group = new Set<string>([selectedId]);
  if (selected.kind === "panel") {
    for (const node of graph.nodes) {
      if (node.parentId === selectedId) group.add(node.id);
    }
  }

  const nodeIds = new Set<string>(group);
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!group.has(edge.source) && !group.has(edge.target)) continue;
    edgeIds.add(edge.id);
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }

  return { nodeIds, edgeIds };
}