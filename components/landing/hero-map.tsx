"use client";

import type { CSSProperties } from "react";

import { styles } from "@/components/landing/styles";

import {
  DEMO_EDGES,
  DEMO_FILES,
  DEMO_NODES,
  type DemoEdgeKind,
  type DemoNodeRole,
} from "./demo-data";
import { useDemoSelection } from "./demo-selection";

const DOT_CLASS: Record<DemoNodeRole, string> = {
  entry: styles.nodeDotEntry,
  core: styles.nodeDotCore,
  util: styles.nodeDotUtil,
  component: styles.nodeDotComponent,
  hook: styles.nodeDotHook,
  config: styles.nodeDotConfig,
};

const EDGE_CLASS: Record<DemoEdgeKind, string> = {
  import: styles.edgeImport,
  reexport: styles.edgeReexport,
  dynamic: styles.edgeDynamic,
  type: styles.edgeType,
};

export function HeroMap() {
  const { selectedId, select } = useDemoSelection();
  const selected = DEMO_FILES[selectedId];

  function jumpToExplanation() {
    const target = document.getElementById("files");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  return (
    <div
      className={styles.heroMap}
      role="group"
      aria-label="Example map of the Anatomy codebase"
    >
      <div className={styles.mapMeta}>
        <span>map / anatomy</span>
        <span>
          {DEMO_NODES.length} files · {DEMO_EDGES.length} links
        </span>
      </div>

      <div className={styles.mapCanvas}>
        <div
          className={styles.nodeGhost}
          style={{ "--x": "36%", "--y": "56%" } as CSSProperties}
          aria-hidden
        />
        <div
          className={styles.nodeGhost}
          style={{ "--x": "66%", "--y": "24%" } as CSSProperties}
          aria-hidden
        />

        <svg
          className={styles.mapEdges}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
          focusable="false"
        >
          {DEMO_EDGES.map((edge) => {
            const related = edge.from === selectedId || edge.to === selectedId;

            return (
              <path
                key={`${edge.from}-${edge.to}`}
                className={[
                  styles.edge,
                  EDGE_CLASS[edge.kind],
                  related ? styles.edgeLit : styles.edgeDim,
                ].join(" ")}
                d={edge.path}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {DEMO_NODES.map((node) => {
          const file = DEMO_FILES[node.id];
          const isSelected = node.id === selectedId;

          return (
            <button
              key={node.id}
              type="button"
              className={[
                styles.node,
                node.secondary ? styles.nodeSecondary : "",
                isSelected ? styles.isSelected : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ "--x": node.x, "--y": node.y } as CSSProperties}
              data-node={node.id}
              aria-pressed={isSelected}
              onClick={() => select(node.id)}
            >
              <span className={styles.nodeTop}>
                <span className={`${styles.nodeDot} ${DOT_CLASS[file.role]}`} />
                <span className={styles.nodePath}>{file.path}</span>
              </span>
              <span className={styles.nodeLine} />
              <span className={`${styles.nodeLine} ${styles.nodeLineShort}`} />
            </button>
          );
        })}
      </div>

      <div className={styles.mapFoot}>
        <div className={styles.mapSelected}>
          <span className={styles.mapPath}>{selected.path}</span>
          <span className={styles.mapRole}>{selected.summary}</span>
          <button className={styles.mapJump} type="button" onClick={jumpToExplanation}>
            Read the full explanation
          </button>
        </div>
        <ul className={styles.mapLegend}>
          <li className={styles.legendItem}>
            <span className={`${styles.legendLine} ${styles.legendImport}`} />
            import
          </li>
          <li className={styles.legendItem}>
            <span className={`${styles.legendLine} ${styles.legendType}`} />
            type only
          </li>
        </ul>
      </div>
    </div>
  );
}
