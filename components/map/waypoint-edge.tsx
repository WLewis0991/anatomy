"use client";

import { memo } from "react";
import { BaseEdge, type EdgeProps } from "reactflow";

import type { PositionedEdge } from "@/lib/graph/layout";

interface Point {
  x: number;
  y: number;
}

/**
 * A Catmull-Rom spline through the layout's waypoints, emitted as cubic beziers.
 *
 * The waypoints themselves come from dagre and are what stops a line from taking a
 * route that makes no sense. Joining them with straight segments turned every one
 * of those routes into a pair of hard right angles, which read as a circuit diagram
 * rather than a dependency map. The curve leaves and arrives horizontally, so lines
 * still meet the side of a node rather than clipping its corner.
 */
export function smoothPath(points: readonly Point[], tension = 1): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]?.x ?? 0},${points[0]?.y ?? 0}`;
  if (points.length === 2) {
    const [a, b] = points as [Point, Point];
    return `M ${a.x},${a.y} L ${b.x},${b.y}`;
  }

  let d = `M ${points[0]?.x ?? 0},${points[0]?.y ?? 0}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const previous = points[i - 1] ?? points[i];
    const current = points[i] as Point;
    const next = points[i + 1] as Point;
    const after = points[i + 2] ?? next;
    const k = tension / 6;
    d +=
      ` C ${current.x + (next.x - previous.x) * k},${current.y + (next.y - previous.y) * k}` +
      ` ${next.x - (after.x - current.x) * k},${next.y - (after.y - current.y) * k}` +
      ` ${next.x},${next.y}`;
  }
  return d;
}

/**
 * Why a line is drawn the way it is.
 *
 * `idle` is an ordinary line on a map with nothing chosen. `in` and `out` are the
 * lines attached to the selection — green arriving, amber leaving — and they use the
 * same two tokens the fan-in and fan-out badges on the node use, so one meaning has
 * one colour. `dimmed` is everything else while something is selected.
 */
export type EdgeMode = "idle" | "in" | "out" | "dimmed";

export interface WaypointEdgeData {
  edge: PositionedEdge;
  mode: EdgeMode;
}

function lineStyle(mode: EdgeMode, contained: boolean): React.CSSProperties {
  const shared = {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    fill: "none",
  } as const;

  const selected = mode === "in" || mode === "out";

  // A line between two files inside one panel never leaves it, so it stays a
  // background detail until the selection is one of its endpoints.
  if (contained && !selected) {
    return { ...shared, stroke: "var(--line-strong)", strokeWidth: 1, opacity: 0.3 };
  }

  switch (mode) {
    case "in":
      return { ...shared, stroke: "var(--incoming)", strokeWidth: 1.8, opacity: 0.95 };
    case "out":
      return { ...shared, stroke: "var(--outgoing)", strokeWidth: 1.8, opacity: 0.95 };
    case "dimmed":
      return { ...shared, stroke: "var(--line)", strokeWidth: 1, opacity: 0.25 };
    default:
      return { ...shared, stroke: "var(--fg-muted)", strokeWidth: 1.15, opacity: 0.6 };
  }
}

function WaypointEdgeImpl({ data, style, interactionWidth }: EdgeProps<WaypointEdgeData>) {
  if (data === undefined) return null;
  const points = data.edge.points;
  if (points.length < 2) return null;

  return (
    <BaseEdge
      path={smoothPath(points)}
      interactionWidth={interactionWidth}
      style={{ ...lineStyle(data.mode, data.edge.contained), ...style }}
    />
  );
}

export const WaypointEdge = memo(WaypointEdgeImpl);
WaypointEdge.displayName = "WaypointEdge";