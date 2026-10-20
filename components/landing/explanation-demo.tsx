"use client";

import { styles } from "@/components/landing/styles";

import { DEMO_FILES, type DemoFileId } from "./demo-data";
import { useDemoSelection } from "./demo-selection";

const CHIPS = [
  "parse",
  "pipeline",
  "derive",
  "map",
  "roles",
] as const satisfies readonly DemoFileId[];

export function ExplanationDemo() {
  const { selectedId, select } = useDemoSelection();
  const selected = DEMO_FILES[selectedId];

  return (
    <div className={styles.explainGrid}>
      <div className={styles.explainCopy}>
        <p>
          Folders tell you where something lives. They rarely tell you why it
          exists, who depends on it, or which change would quietly break three
          other screens.
        </p>
        <p>
          Anatomy keeps the graph and the explanation side by side. Select a file
          and you get its role in one paragraph, followed by the relationships
          that matter.
        </p>
        <p>
          The explanation is written from the file&apos;s real neighbours. Every
          path it names is one the parser resolved, and an import it could not
          resolve is reported with a reason rather than guessed.
        </p>
        <div className={styles.chips} role="group" aria-label="Example files">
          {CHIPS.map((id) => (
            <button
              key={id}
              className={styles.chip}
              type="button"
              aria-pressed={id === selectedId}
              onClick={() => select(id)}
            >
              {DEMO_FILES[id].path.split("/").pop()}
            </button>
          ))}
        </div>
      </div>

      <article className={styles.panel} aria-labelledby="panel-path">
        <div className={styles.panelHead}>
          <span className={styles.panelPath} id="panel-path">
            {selected.path}
          </span>
          <span className={styles.panelTag}>{selected.tag}</span>
        </div>
        <div className={styles.panelBody}>
          <p className={styles.panelSummary}>{selected.summary}</p>

          <dl className={styles.panelFacts}>
            <div className={styles.fact}>
              <dt>Layer</dt>
              <dd className={styles.isEm}>{selected.layer}</dd>
            </div>
            <div className={styles.fact}>
              <dt>Key imports</dt>
              <dd>{selected.imports.length}</dd>
            </div>
            <div className={styles.fact}>
              <dt>Key dependents</dt>
              <dd>{selected.dependents.length}</dd>
            </div>
          </dl>

          <dl className={styles.panelLists}>
            <div className={styles.fact}>
              <dt>Exports</dt>
              <dd className={styles.isEm}>{selected.exports}</dd>
              <dt>Key imports</dt>
              <dd>
                <ul className={styles.miniList} aria-label="Key imports">
                  {selected.imports.length === 0 ? (
                    <li className={styles.isEmpty}>No local imports</li>
                  ) : (
                    selected.imports.map((path) => <li key={path}>{path}</li>)
                  )}
                </ul>
              </dd>
            </div>
            <div className={styles.fact}>
              <dt>Key dependents</dt>
              <dd>
                <ul className={styles.miniList} aria-label="Key dependents">
                  {selected.dependents.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>

          <p className={styles.fineprint}>
            Every path above is a real file in this map. The explanation is
            written from these neighbours, not from a model&apos;s memory of the
            repository.
          </p>
        </div>
      </article>
    </div>
  );
}
