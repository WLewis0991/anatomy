"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge as FlowEdge,
  type Node,
  type Viewport,
} from "reactflow";
import "reactflow/dist/style.css";

import type { Edge, ParsedFile } from "@/parser/types";
import { folderHoldingFile, type FoldResult } from "@/parser/folding";
import { deriveCanvas, rowId, rowLabel, ROWS_PER_STEP } from "@/lib/graph/derive";
import { layoutCanvas, type PositionedNode } from "@/lib/graph/layout";
import { computeEmphasis } from "@/lib/graph/emphasis";
import type { Selection } from "@/lib/graph/types";
import { CanvasNodeView, PANEL_HEADER_ATTR, PANEL_LESS_ATTR, PANEL_MORE_ATTR, type CanvasNodeViewData } from "./folder-nodes";
import { WaypointEdge } from "./waypoint-edge";

export interface DependencyMapProps {
  files: readonly ParsedFile[];
  edges: readonly Edge[];
  fileFanIn: Readonly<Record<string, number>>;
  fileFanOut: Readonly<Record<string, number>>;
  fold: FoldResult;
  /**
   * The one selection. It lives above the map because the pane both reads it and
   * moves it, and two copies of it cannot both be right.
   */
  selection: Selection | null;
  /** The file under the pointer, wherever the pointer is. */
  hoverPath: string | null;
  onSelect: (selection: Selection | null) => void;
  onHover: (filePath: string | null) => void;
  /**
   * The pane asking for a file by path. A handle rather than a watched prop,
   * because only the map knows what is open, and asking is something the pane does
   * when a path is clicked — not a state change the map should react to afterwards.
   */
  ref?: React.Ref<DependencyMapHandle>;
}

/** What the pane may ask the map to do. */
export interface DependencyMapHandle {
  /** Selects a file, opening whatever it takes to put that file on the canvas. */
  selectFile: (path: string) => void;
}

const FIT_PADDING = 0.1;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 1.5;

interface Size {
  width: number;
  height: number;
}

/**
 * The container's own size. React Flow's viewport carries only x, y and zoom, so
 * fitting needs the pixels it is fitting into, measured rather than assumed.
 */
function useContainerSize(): [React.RefObject<HTMLDivElement | null>, Size] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

export function DependencyMap({ ref, ...props }: DependencyMapProps) {
  return (
    <ReactFlowProvider>
      <DependencyMapCanvas {...props} ref={ref} />
    </ReactFlowProvider>
  );
}

function DependencyMapCanvas({ files, edges, fileFanIn, fileFanOut, fold, selection, hoverPath, onSelect, onHover, ref }: DependencyMapProps) {
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(() => new Set());
  // How many rows each open panel lists, keyed by folder path. Reset when a panel
  // closes, so reopening starts at one step rather than where it was left.
  const [listedRows, setListedRows] = useState<Readonly<Record<string, number>>>({});
  const selectedId = selection?.id ?? null;
  const instance = useReactFlow();
  const [containerRef, size] = useContainerSize();

  /**
   * Which node the next refit is for. Set just before a click changes what is on
   * the canvas, so the refit that follows knows to centre that node's
   * neighbourhood rather than the whole graph.
   */
  const pendingFocus = useRef<string | null>(null);
  const focusOn = useCallback((id: string) => {
    pendingFocus.current = id;
  }, []);

  // The graph depends only on the fold and what is open. Selecting changes what is
  // drawn, never where anything sits, so the layout cannot shift under a click.
  const graph = useMemo(
    () => deriveCanvas({ root: fold.root, openFolders, listedRows, edges, fileFanIn, fileFanOut }),
    [fold.root, openFolders, listedRows, edges, fileFanIn, fileFanOut],
  );

  const layout = useMemo(() => layoutCanvas(graph), [graph]);
  const emphasis = useMemo(() => computeEmphasis(graph, selectedId), [graph, selectedId]);

  const showMoreRows = useCallback((folderPath: string) => {
    setListedRows((current) => ({ ...current, [folderPath]: (current[folderPath] ?? ROWS_PER_STEP) + ROWS_PER_STEP }));
  }, []);

  const showFewerRows = useCallback((folderPath: string) => {
    setListedRows((current) => ({ ...current, [folderPath]: ROWS_PER_STEP }));
  }, []);

  const toggleFolder = useCallback(
    (folderPath: string) => {
      setListedRows((current) => {
        const next = { ...current };
        delete next[folderPath];
        return next;
      });
      // Only when the selection is inside the folder being folded away. Clearing
      // unconditionally would also drop a selection in a folder that never moved,
      // which reads as the map losing what it had.
      setOpenFolders((current) => {
        const next = new Set(current);
        if (next.has(folderPath)) next.delete(folderPath);
        else next.add(folderPath);
        return next;
      });
      if (selection?.folderPath === folderPath) onSelect(null);
    },
    [onSelect, selection],
  );

  /**
   * Clicking the selected node again clears it. The map does not hold the decision
   * — it reports the node and the owner decides whether that is a change — but the
   * "same node twice means deselect" rule lives here, with the rest of the map's
   * own click behaviour.
   */
  const select = useCallback(
    (id: string) => {
      if (selection?.id === id) {
        onSelect(null);
        return;
      }
      const node = graph.byId.get(id);
      if (node === undefined) return;
      if (node.kind === "row" && node.file !== null) {
        onSelect({ kind: "row", id, folderPath: node.folderPath, label: node.label, file: node.file });
        return;
      }
      onSelect({ kind: "folder", id, folderPath: node.folderPath, label: node.label });
    },
    [graph.byId, onSelect, selection],
  );

  const clearSelection = useCallback(() => {
    onSelect(null);
  }, [onSelect]);

  /**
   * The pane asked for a file by path.
   *
   * A file inside a shut folder has no row, and the only node standing for it is
   * the folder itself. Selecting that would leave the pane describing a file while
   * the map lit a folder, which is not what was asked for. So the folder opens and
   * the panel lists far enough to include the file.
   *
   * The row's id is fixed by its path whether or not the panel is open yet, so the
   * selection is reported in the same click that opens the folder. The render before
   * the row exists finds no node under that id and emphasis falls back to showing
   * everything, which is what a stale id already does.
   */
  const selectFile = useCallback(
    (path: string) => {
      const file = files.find((candidate) => candidate.path === path);
      if (file === undefined) return;
      const folder = folderHoldingFile(fold.root, file.path);
      if (folder === null) return;

      setOpenFolders((current) => {
        if (current.has(folder.path)) return current;
        return new Set(current).add(folder.path);
      });
      const index = folder.files.findIndex((held) => held.path === file.path);
      if (index !== -1) {
        setListedRows((current) => ({
          ...current,
          [folder.path]: Math.max(current[folder.path] ?? 0, index + 1),
        }));
      }

      focusOn(rowId(file.path));
      onSelect({
        kind: "row",
        id: rowId(file.path),
        folderPath: folder.path,
        label: rowLabel(file),
        file,
      });
    },
    [files, fold.root, focusOn, onSelect],
  );

  useImperativeHandle(ref, () => ({ selectFile }), [selectFile]);

  /**
   * React Flow only lets a node take pointer events when it is selectable,
   * draggable, or has a handler to call. With none of those it marks the node inert
   * and nothing inside it can be clicked, so this handler is what makes both
   * selection and opening work at all.
   */
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const canvas = node.data.node as PositionedNode | undefined;
      if (canvas === undefined) return;
      const hit = event.target as HTMLElement | null;
      const header = hit?.closest(`[${PANEL_HEADER_ATTR}]`);
      const more = hit?.closest(`[${PANEL_MORE_ATTR}]`);
      const less = hit?.closest(`[${PANEL_LESS_ATTR}]`);

      // The footer lists more of the folder's files, or fewer again. Neither changes
      // which node is where, so neither moves anything.
      if (canvas.kind === "panel" && more !== null && more !== undefined) {
        showMoreRows(canvas.folderPath);
        return;
      }
      if (canvas.kind === "panel" && less !== null && less !== undefined) {
        showFewerRows(canvas.folderPath);
        return;
      }

      // The header closes an open folder. Everything else on a closed folder opens
      // it, because asking to see the files in it is the whole point of the click.
      if (canvas.kind === "panel" && header !== null && header !== undefined) {
        focusOn(canvas.id);
        toggleFolder(canvas.folderPath);
        return;
      }
      if (canvas.kind === "folder") {
        focusOn(canvas.id);
        toggleFolder(canvas.folderPath);
        return;
      }
      select(canvas.id);
    },
    [select, toggleFolder, focusOn, showMoreRows, showFewerRows],
  );

  const nodeTypes = useMemo(() => ({ canvas: CanvasNodeView }), []);
  const edgeTypes = useMemo(() => ({ waypoint: WaypointEdge }), []);

  /**
   * A hovered node reports the file it stands for, so the pane can ring the matching
   * row. A folder node stands for no single file and reports nothing — the pane has
   * no concept of a folder row to highlight.
   *
   * Leave is guarded on where the pointer went: moving from a row out onto its own
   * panel fires leave, and clearing there would strobe the highlight off between two
   * things the pointer is still inside.
   */
  const onNodeMouseEnter = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const canvas = node.data.node as PositionedNode | undefined;
      onHover(canvas?.file?.path ?? null);
    },
    [onHover],
  );

  const onNodeMouseLeave = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const to = event.relatedTarget as HTMLElement | null;
      const landing = to?.closest(".react-flow__node");
      if (landing !== null && landing !== undefined) return;
      const canvas = node.data.node as PositionedNode | undefined;
      // Only clear if this node is the one the pointer left from. A later leave for
      // an older node must not wipe the highlight a newer one just set.
      if (canvas?.file?.path !== hoverPath) return;
      onHover(null);
    },
    [hoverPath, onHover],
  );

  const flowNodes = useMemo<Node[]>(
    () =>
      layout.nodes.map((node) => {
        // A node is hovered when it stands for the file under the pointer. A folder
        // node can stand for many files, so it matches when the pointer is on any
        // of the files it holds.
        const hovered = hoverPath !== null && node.file?.path === hoverPath;
        const data: CanvasNodeViewData = {
          node,
          selected: selectedId === node.id,
          dimmed: selectedId !== null && !emphasis.nodeIds.has(node.id),
          hovered,
        };
        return {
          id: node.id,
          type: "canvas",
          position: node.position,
          parentId: node.relative ? (node.parentId ?? undefined) : undefined,
          extent: node.relative ? "parent" : undefined,
          draggable: false,
          selectable: false,
          // Focusable so the node can be reached and opened from the keyboard.
          // Selection is this component's business, not React Flow's.
          focusable: true,
          width: node.width,
          height: node.height,
          style: { width: node.width, height: node.height },
          "aria-label": describe(node),
          data,
        };
      }),
    [layout.nodes, selectedId, emphasis, hoverPath],
  );

  const flowEdges = useMemo<FlowEdge[]>(
    () =>
      layout.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: "out",
        targetHandle: "in",
        type: "waypoint",
        selectable: false,
        focusable: false,
        zIndex: edge.contained ? -1 : 0,
        data: {
          edge,
          // Green for what arrives at the selection, amber for what leaves it.
          mode:
            selectedId === null
              ? "idle"
              : edge.target === selectedId
                ? "in"
                : edge.source === selectedId
                  ? "out"
                  : "dimmed",
        },
      })),
    [layout.edges, selectedId],
  );

  /**
   * Refit on open. The fit may only ever zoom out: fitting to a newly opened panel
   * would otherwise zoom into it and lose the rest of the graph.
   */
  const fit = useCallback(
    (onlyZoomOut: boolean) => {
      const current = instance.getViewport();
      const limit = onlyZoomOut ? current.zoom : MAX_ZOOM;
      const target = fitViewport(layout.width, layout.height, size, current, limit);
      instance.setViewport(target, { duration: 0 });
    },
    [instance, layout.width, layout.height, size],
  );

  /**
   * Bring a node and everything it connects to into view.
   *
   * It zooms out when the neighbourhood is too big to see and pans to centre it
   * when it is not, but it never zooms in: zooming in on a node's neighbourhood
   * loses the rest of the graph, which is the thing the map is for.
   */
  const fitNeighbourhood = useCallback(
    (targetId: string) => {
      const ids = new Set<string>([targetId]);
      for (const edge of layout.edges) {
        if (edge.source === targetId) ids.add(edge.target);
        if (edge.target === targetId) ids.add(edge.source);
      }
      // A row lives inside its panel, so the panel is what needs to be on screen.
      const boxes = layout.nodes
        .filter((node) => ids.has(node.id))
        .map((node) => (node.relative ? layout.nodes.find((c) => c.id === node.parentId) : node))
        .filter((node): node is PositionedNode => node !== undefined && !node.relative);
      if (boxes.length === 0) return;

      const minX = Math.min(...boxes.map((node) => node.position.x));
      const minY = Math.min(...boxes.map((node) => node.position.y));
      const maxX = Math.max(...boxes.map((node) => node.position.x + node.width));
      const maxY = Math.max(...boxes.map((node) => node.position.y + node.height));
      const width = Math.max(maxX - minX, 1);
      const height = Math.max(maxY - minY, 1);

      const current = instance.getViewport();
      const fits = Math.min(
        (size.width * (1 - FIT_PADDING * 2)) / width,
        (size.height * (1 - FIT_PADDING * 2)) / height,
      );
      const zoom = Math.min(Math.max(Math.min(fits, current.zoom), MIN_ZOOM), MAX_ZOOM);
      instance.setViewport(
        {
          x: size.width / 2 - (minX + width / 2) * zoom,
          y: size.height / 2 - (minY + height / 2) * zoom,
          zoom,
        },
        { duration: 0 },
      );
    },
    [instance, layout.edges, layout.nodes, size],
  );


  // Refit whenever what is on the canvas changes. The first fit may zoom in; every
  // later one may only zoom out.
  const signature = useMemo(
    () => layout.nodes.filter((node) => !node.relative).map((node) => `${node.id}/${node.height}`).join("|"),
    [layout.nodes],
  );
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    if (fittedFor.current === signature) return;
    const isFirst = fittedFor.current === null;
    fittedFor.current = signature;
    const focus = pendingFocus.current;
    pendingFocus.current = null;
    if (focus !== null) {
      fitNeighbourhood(focus);
      return;
    }
    fit(!isFirst);
  }, [signature, fit, fitNeighbourhood, size]);

  return (
    <div ref={containerRef} className="relative h-full w-full bg-ground">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        edgesFocusable={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll
        zoomOnPinch
        panOnDrag
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        proOptions={{ hideAttribution: true }}
        onNodeClick={onNodeClick}
        onPaneClick={clearSelection}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
      >
        <Legend />
      </ReactFlow>
    </div>
  );
}

/**
 * Fit a graph of this size into the viewport. When `zoomLimit` is given the result
 * may not exceed it, which is how a refit on open is kept from zooming in.
 */
export function fitViewport(
  width: number,
  height: number,
  size: Size,
  viewport: Viewport,
  zoomLimit: number,
): Viewport {
  const zoom = Math.min(
    (size.width * (1 - FIT_PADDING * 2)) / Math.max(width, 1),
    (size.height * (1 - FIT_PADDING * 2)) / Math.max(height, 1),
    zoomLimit,
  );
  const clamped = Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
  return {
    x: (size.width - width * clamped) / 2,
    y: (size.height - height * clamped) / 2,
    zoom: clamped,
  };
}

/** What a screen reader should hear for a node. */
function describe(node: PositionedNode): string {
  if (node.kind === "row") return `${node.file?.path ?? node.label}, ${node.fanIn} imports, ${node.fanOut} exports`;
  return `${node.label}, folder, ${node.fileCount} files, ${node.fanIn} imports, ${node.fanOut} exports`;
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex items-center gap-3 font-mono text-xs text-fg-muted">
      <span>
        <span className="text-incoming">&darr;</span> depended on by
      </span>
      <span>
        <span className="text-outgoing">&rarr;</span> depends on
      </span>
    </div>
  );
}