"use client";

import { Handle, Position } from "@reactflow/core";

import { METRICS } from "@/lib/graph/types";
import type { PositionedNode } from "@/lib/graph/layout";
import { SWATCH_CLASS } from "@/lib/kinds";
import { pathOf } from "./node-labels";

/**
 * Marks the strip on a panel that closes it. Clicks are handled once, on the canvas,
 * so this only has to say which part of the panel was hit.
 */
export const PANEL_HEADER_ATTR = "data-panel-header";

/** Marks the footer that reveals or hides a panel's remaining files. */
export const PANEL_MORE_ATTR = "data-panel-more";
export const PANEL_LESS_ATTR = "data-panel-less";

/**
 * React Flow resolves an edge's endpoints from a node's handles, so every node
 * carries a pair. They are invisible: the line is drawn from the layout's
 * waypoints, and these only stop the library resolving to nothing.
 */
const HANDLE_CLASS = "!h-px !w-px !min-w-0 !border-0 !bg-transparent !opacity-0";

function Handles() {
  return (
    <>
      <Handle id="in" type="target" position={Position.Left} className={HANDLE_CLASS} />
      <Handle id="out" type="source" position={Position.Right} className={HANDLE_CLASS} />
    </>
  );
}

export interface CanvasNodeViewData {
  node: PositionedNode;
  selected: boolean;
  dimmed: boolean;
  /** The file this node stands for is under the pointer. */
  hovered: boolean;
}

/**
 * One node type for the canvas. Which body renders is decided by the node's kind.
 *
 * A panel does not draw its own rows: each file is a child node positioned inside
 * it, because that is what an edge has to terminate on. The panel only draws the
 * space the rows occupy.
 *
 * Nothing here handles clicks. React Flow only makes a node interactive when it is
 * given something to react to, so click handling lives on the canvas itself.
 */
export function CanvasNodeView({ data }: { data: CanvasNodeViewData }) {
  const { node, selected, dimmed, hovered } = data;
  // A hovered node stays at full strength even where emphasis has dimmed it, or the
  // ring would be drawn on something already faded back. Outline rather than border,
  // because a border would change the box and every measurement that sized it.
  const common = { opacity: dimmed && !hovered ? 0.28 : 1 };
  const ring = hovered ? "outline outline-1 outline-offset-1 outline-fg-muted" : "";

  if (node.kind === "row") {
    return (
      <div className={`flex h-full w-full items-center gap-1.5 rounded px-1 ${selected ? "bg-accent/20" : ""} ${ring}`} style={common} title={pathOf(node)}>
        <Handles />
        <span className={`h-1.5 w-1.5 shrink-0 rounded ${swatchOf(node)}`} aria-hidden="true" />
        <span className="truncate font-mono text-xs text-fg">{node.label}</span>
        <Degrees fanIn={node.fanIn} fanOut={node.fanOut} />
      </div>
    );
  }

  if (node.kind === "panel") {
    return (
      <div
        className={`flex h-full w-full flex-col rounded border bg-surface ${
          selected ? "border-accent" : "border-node-border-strong"
        } ${ring}`}
        style={common}
      >
        <Handles />
        <div
          {...{ [PANEL_HEADER_ATTR]: "" }}
          className="flex shrink-0 cursor-pointer items-center gap-2 border-b border-line bg-surface-2 px-2"
          style={{ height: METRICS.panelHeaderHeight }}
          title={`Close ${node.label}`}
        >
          <span className="truncate font-mono text-sm text-fg">{node.label}</span>
          <Counts count={node.fileCount} fanIn={node.fanIn} fanOut={node.fanOut} />
        </div>

        {/* Rows are child nodes laid out over this space, not content of it. */}
        <div className="flex-1" style={{ minHeight: 0 }} />

        {node.overflow > 0 && (
          <div
            {...{ [PANEL_MORE_ATTR]: "" }}
            className="flex shrink-0 cursor-pointer items-center justify-center gap-1 border-t border-line bg-surface-2 font-mono text-xs text-fg-muted hover:text-fg"
            style={{ height: METRICS.panelOverflowHeight }}
            title={`List ${Math.min(node.overflow, 14)} more file${Math.min(node.overflow, 14) === 1 ? "" : "s"}`}
          >
            show {Math.min(node.overflow, 14)} more of {node.overflow}
          </div>
        )}

        {node.overflow === 0 && node.canCollapse && (
          <div
            {...{ [PANEL_LESS_ATTR]: "" }}
            className="flex shrink-0 cursor-pointer items-center justify-center border-t border-line bg-surface-2 font-mono text-xs text-fg-muted hover:text-fg"
            style={{ height: METRICS.panelOverflowHeight }}
            title="List fewer files"
          >
            show fewer
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex h-full w-full cursor-pointer items-center gap-2 rounded border px-2 ${
        selected ? "border-accent bg-accent/10" : "border-node-border bg-surface"
      } ${ring}`}
      style={common}
      title={pathOf(node)}
    >
      <Handles />
      <span className="truncate font-mono text-sm text-fg">{node.label}</span>
      <Counts count={node.fileCount} fanIn={node.fanIn} fanOut={node.fanOut} />
    </div>
  );
}

function swatchOf(node: PositionedNode): string {
  return node.file ? SWATCH_CLASS[node.file.kind] : "bg-line-strong";
}

function Counts({ count, fanIn, fanOut }: { count: number; fanIn: number; fanOut: number }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums text-fg-muted">
      <span title={`${count} files`}>{count}</span>
      <Degrees fanIn={fanIn} fanOut={fanOut} />
    </span>
  );
}

function Degrees({ fanIn, fanOut }: { fanIn: number; fanOut: number }) {
  if (fanIn === 0 && fanOut === 0) return null;
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums">
      {fanIn > 0 && (
        <span className="text-incoming" title={`${fanIn} depend on this`}>
          &darr;{fanIn}
        </span>
      )}
      {fanIn > 0 && fanOut > 0 && <span className="px-0.5 text-fg-muted">/</span>}
      {fanOut > 0 && (
        <span className="text-outgoing" title={`depends on ${fanOut}`}>
          &rarr;{fanOut}
        </span>
      )}
    </span>
  );
}