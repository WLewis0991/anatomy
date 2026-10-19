"use client";

import { useId, useState } from "react";

import type { Edge, ParsedFile } from "@/parser/types";
import type { FoldNode } from "@/parser/folding";
import type { Selection } from "@/lib/graph/types";
import { countKindsIn, findFolder, summariseRepository } from "@/lib/graph/summary";
import { blastRadius, dependencyChain, DEFAULT_DEPTH, type WalkResult } from "@/lib/graph/transitive";
import { computeInsights } from "@/lib/graph/insights";
import { kindLabel, SWATCH_CLASS } from "@/lib/kinds";
import type { ExplanationSubjectKind, ExplanationView, FileRoleView } from "@/lib/ai/types";
import { ExplanationText } from "./explanation-text";

/**
 * The right-hand column.
 *
 * It has a resting state rather than an empty one: with nothing selected it
 * describes the repository, because "click something first" is a worse answer than
 * what the parse already found.
 *
 * Every path here is a button that moves the map's selection, and hovering one
 * highlights it on the map. Both go through the same two callbacks, so the pane
 * never talks to the canvas directly.
 */

const KIND_MARK: Record<Edge["kind"], string> = {
  static: "import",
  reexport: "re-export",
  dynamic: "dynamic",
};

export type PaneTab = "structure" | "explanation";

export interface DetailPaneProps {
  selection: Selection | null;
  files: readonly ParsedFile[];
  edges: readonly Edge[];
  /** The folded tree, for the folder view's breakdown of what it holds. */
  root: FoldNode;
  repositoryName: string;
  /** The adapter that classified the files. Reported, never re-derived. */
  adapter: string;
  tab: PaneTab;
  onTabChange: (tab: PaneTab) => void;
  hoverPath: string | null;
  onHover: (filePath: string | null) => void;
  onSelectPath: (filePath: string) => void;
  rolesByPath: ReadonlyMap<string, FileRoleView>;
  /** Explanation cache and request state for the current subject, held above the pane. */
  explanation: ExplanationView | null;
  explanationStale: boolean;
  explanationBusy: boolean;
  explanationError: string | null;
  tracingEnabled: boolean;
  paths: ReadonlySet<string>;
  onExplain: (kind: ExplanationSubjectKind, path: string) => void;
  onRerun: () => void;
  reanalysisNote: string | null;
}

export function DetailPane(props: DetailPaneProps) {
  const { selection, tab, onTabChange } = props;
  const baseId = useId();
  const tabs: { id: PaneTab; label: string }[] = [
    { id: "structure", label: "Structure" },
    { id: "explanation", label: "Explanation" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-line bg-surface-2 px-3 py-1.5" role="tablist" aria-label="Detail">
        {tabs.map((entry) => {
          const active = entry.id === tab;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`${baseId}-${entry.id}`}
              aria-selected={active}
              aria-controls={`${baseId}-panel`}
              // Roving tabindex: one stop in the tab order, arrows move within.
              tabIndex={active ? 0 : -1}
              className={`rounded-[3px] px-2 py-1 text-xs ${
                active ? "bg-surface text-fg" : "text-fg-muted hover:text-fg"
              } focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent`}
              onClick={() => onTabChange(entry.id)}
              onKeyDown={(event) => {
                const order = tabs.map((t) => t.id);
                const here = order.indexOf(entry.id);
                if (event.key === "ArrowRight") onTabChange(order[(here + 1) % order.length] ?? entry.id);
                else if (event.key === "ArrowLeft") onTabChange(order[(here - 1 + order.length) % order.length] ?? entry.id);
                else return;
                event.preventDefault();
              }}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <div
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-${tab}`}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto p-3 text-sm"
      >
        {tab === "explanation" ? (
          <ExplanationPanel {...props} />
        ) : selection === null ? (
          <RepositorySummary {...props} />
        ) : selection.kind === "row" ? (
          <FileDetail key={selection.file.path} {...props} file={selection.file} />
        ) : (
          <FolderDetail {...props} />
        )}
      </div>
    </div>
  );
}

/**
 * The explanation tab. The answer lives above the pane, keyed by subject, so
 * leaving the tab or moving the selection and coming back does not lose it and
 * does not ask the server again.
 */
function ExplanationPanel(props: DetailPaneProps) {
  const { selection, explanation, explanationStale, explanationBusy, explanationError, tracingEnabled } = props;

  if (selection === null) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-fg">Nothing selected.</p>
        <p className="text-xs text-fg-muted">
          Choose a file or a folded folder, then explain it. The answer is written from the edges the
          parser resolved.
        </p>
      </div>
    );
  }

  const kind: ExplanationSubjectKind = selection.kind === "row" ? "file" : "folder";
  const path = selection.kind === "row" ? selection.file.path : selection.folderPath;
  const label = selection.kind === "row" ? selection.file.path : selection.label;

  return (
    <div className="space-y-3 text-fg">
      <div>
        <p className="micro-label">{kind}</p>
        <h2 className="font-mono text-sm break-all">{label}</h2>
        {kind === "folder" && path !== "" && (
          <p className="mt-0.5 font-mono text-xs break-all text-fg-muted">{path}</p>
        )}
      </div>

      {!tracingEnabled && (
        <p className="border-l-2 border-line pl-2 text-xs text-fg-muted">
          AI tracing is off for this server. Add <span className="font-mono">LANGSMITH_API_KEY</span> to
          record these calls.
        </p>
      )}

      {explanationStale && (
        <div className="space-y-1.5 border border-line bg-surface-2 p-2">
          <p className="text-xs text-fg">
            This explanation is stale. The repository has moved past the commit that was analysed.
          </p>
          <button
            type="button"
            onClick={props.onRerun}
            className="rounded-[3px] border border-line bg-surface px-2 py-1 text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            Re-analyse repository
          </button>
          {props.reanalysisNote !== null && (
            <p className="text-xs text-fg-muted">{props.reanalysisNote}</p>
          )}
        </div>
      )}

      {explanationError !== null && (
        <p role="alert" className="text-xs text-fg">
          {explanationError}
        </p>
      )}

      {explanation !== null ? (
        <div className="space-y-2">
          <ExplanationText body={explanation.body} paths={props.paths} onSelectPath={props.onSelectPath} />
          {explanationStale ? (
            <p className="text-xs text-fg-muted">Shown from the previous commit until you re-analyse.</p>
          ) : (
            <button
              type="button"
              disabled={explanationBusy}
              onClick={() => props.onExplain(kind, path)}
              className="rounded-[3px] border border-line bg-surface px-2 py-1 text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              Explain again
            </button>
          )}
        </div>
      ) : explanationBusy ? (
        <p className="text-xs text-fg-muted">Writing an explanation from the parser&apos;s edges...</p>
      ) : explanationStale ? null : (
        <button
          type="button"
          onClick={() => props.onExplain(kind, path)}
          className="rounded-[3px] border border-line bg-surface px-2 py-1 text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
        >
          Explain this {kind}
        </button>
      )}
    </div>
  );
}

function RepositorySummary(props: DetailPaneProps) {
  const { files, edges, repositoryName, adapter } = props;
  const pane = hoverProps(props);
  const summary = summariseRepository(files, edges);

  return (
    <div className="space-y-4 text-fg">
      <div>
        <h2 className="font-mono text-sm break-all">{repositoryName}</h2>
        <p className="mt-0.5 text-xs text-fg-muted">{frameworkLine(adapter)}</p>
        <p className="mt-0.5 text-xs text-fg-muted tabular-nums">
          {summary.fileCount} files &middot; {summary.importCount} imports
        </p>
      </div>

      <Section title="most depended on" count={summary.mostDependedOnTotal}>
        {summary.mostDependedOn.length === 0 ? (
          <Empty>Nothing inside the repository imports anything inside it.</Empty>
        ) : (
          <>
            <PathList
              rows={summary.mostDependedOn.map((row) => ({ path: row.path, count: row.count, kind: row.kind }))}
              {...pane}
            />
            <More total={summary.mostDependedOnTotal} shown={summary.mostDependedOn.length} />
          </>
        )}
      </Section>

      <Section title="imports nothing" count={summary.importsNothingTotal}>
        {summary.importsNothing.length === 0 ? (
          <Empty>Every file here is imported by something.</Empty>
        ) : (
          <>
            <PathList rows={summary.importsNothing.map((file) => ({ path: file.path, count: null, kind: file.kind }))} {...pane} />
            <More total={summary.importsNothingTotal} shown={summary.importsNothing.length} />
          </>
        )}
      </Section>

      {summary.unidentifiedCount > 0 && (
        <Section title="no convention identified" count={summary.unidentifiedCount}>
          <p className="text-xs text-fg-muted">
            {summary.unidentifiedCount} file{summary.unidentifiedCount === 1 ? "" : "s"} had no extension
            convention the parser could name them by.
          </p>
        </Section>
      )}

      <InsightsPanel files={files} edges={edges} />
    </div>
  );
}

/**
 * The adapter's own name. What it reports is what this shows — a repository parsed
 * by the fallback adapter has no framework detected, and saying so is different from
 * saying one was looked for and missed.
 */
function frameworkLine(adapter: string): string {
  return adapter === "no-framework" ? "no framework detected" : `framework: ${adapter}`;
}

function InsightsPanel({ files, edges }: { files: readonly ParsedFile[]; edges: readonly Edge[] }) {
  const insights = computeInsights(files, edges);
  if (insights.list.length === 0) return null;

  return (
    <details className="mt-6">
      <summary className="micro-label cursor-pointer select-none text-fg-muted">
        Insights
        {insights.truncated > 0 && <span className="ml-1.5 tabular-nums text-fg">({insights.truncated} more)</span>}
      </summary>
      <div className="mt-3 space-y-4 text-fg">
        {insights.list.map((insight) => (
          <Section key={insight.kind} title={insight.title} count={insight.total}>
            <p className="mb-2 text-xs text-fg-muted">{insight.sentence}</p>
            {insight.entries.length === 0 ? (
              <Empty>None found.</Empty>
            ) : (
              <>
                <PathList
                  rows={insight.entries.map((entry) => ({ path: entry.path, count: null, kind: files.find((f) => f.path === entry.path)?.kind ?? null }))}
                  hoverPath={null}
                  onHover={() => {}}
                  onSelectPath={() => {}}
                />
                <More total={insight.total} shown={insight.entries.length} />
              </>
            )}
          </Section>
        ))}
      </div>
    </details>
  );
}

function FileDetail(props: DetailPaneProps & { file: ParsedFile }) {
  const { file, edges, files } = props;
  const pane = hoverProps(props);
  const outgoing = edges.filter((edge) => edge.from === file.path);
  const incoming = edges.filter((edge) => edge.to === file.path);

  const [blast, setBlast] = useState<WalkResult | null>(null);
  const [chain, setChain] = useState<WalkResult | null>(null);

  const showBlast = () => setBlast(blastRadius(files, edges, file.path, DEFAULT_DEPTH));
  const showChain = () => setChain(dependencyChain(files, edges, file.path, DEFAULT_DEPTH));

  return (
    <div className="space-y-4 text-fg">
      <div>
        <span className={`mr-1.5 inline-block h-2 w-2 rounded align-middle ${SWATCH_CLASS[file.kind]}`} aria-hidden="true" />
        <h2 className="font-mono text-sm break-all">{file.path}</h2>
        <p className="mt-1 text-xs text-fg-muted">
          {file.lines} lines &middot; {kindLabel(file.kind)}
        </p>
        {props.rolesByPath.get(file.path) !== undefined && (
          <p className="mt-0.5 text-xs text-fg-muted">
            role: <span className="font-mono text-fg">{props.rolesByPath.get(file.path)?.role}</span>
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={showBlast} className="rounded-[3px] px-2 py-1 text-xs border border-line bg-surface hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
          Blast radius
        </button>
        <button type="button" onClick={showChain} className="rounded-[3px] px-2 py-1 text-xs border border-line bg-surface hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
          Dependency chain
        </button>
      </div>

      {blast && (
        <Section title={`blast radius (${blast.reachedDepth} level${blast.reachedDepth === 1 ? "" : "s"})`} count={blast.paths.length}>
          {blast.paths.length === 0 ? (
            <Empty>Nothing in the repository depends on this.</Empty>
          ) : (
            <PathList rows={blast.paths.map((path) => ({ path, count: null, kind: files.find((f) => f.path === path)?.kind ?? null }))} {...pane} />
          )}
        </Section>
      )}

      {chain && (
        <Section title={`dependency chain (${chain.reachedDepth} level${chain.reachedDepth === 1 ? "" : "s"})`} count={chain.paths.length}>
          {chain.paths.length === 0 ? (
            <Empty>Imports nothing inside the repository.</Empty>
          ) : (
            <PathList rows={chain.paths.map((path) => ({ path, count: null, kind: files.find((f) => f.path === path)?.kind ?? null }))} {...pane} />
          )}
        </Section>
      )}

      <Section title="depends on" count={outgoing.length}>
        {outgoing.length === 0 ? (
          <Empty>Imports nothing inside the repository.</Empty>
        ) : (
          <EdgeList edges={outgoing} side="out" {...pane} />
        )}
      </Section>

      <Section title="depended on by" count={incoming.length}>
        {incoming.length === 0 ? (
          <Empty>Nothing in the repository imports this.</Empty>
        ) : (
          <EdgeList edges={incoming} side="in" {...pane} />
        )}
      </Section>
    </div>
  );
}

/**
 * A folder connects to other folders by way of the files inside it, and it holds a
 * mix of kinds of files. Both are listed. The subfolder line exists because a
 * folder's file count covers everything beneath it while its own list does not, and
 * the difference is otherwise invisible.
 */
function FolderDetail(props: DetailPaneProps) {
  const { selection, edges, root } = props;
  if (selection === null || selection.kind !== "folder") return null;
  const pane = hoverProps(props);
  const { folderPath, label } = selection;
  const folder = findFolder(root, folderPath);
  const kinds = folder === null ? [] : countKindsIn(folder);

  // A file's own `folder` cannot be used here: folding merges directories, so the
  // folder a file was written in is often not the node that holds it afterwards.
  const owned = new Set(folder === null ? [] : folder.files.map((file) => file.path));

  const out = new Map<string, number>();
  const into = new Map<string, number>();
  let outside = 0;

  for (const edge of edges) {
    const mine = owned.has(edge.from);
    const theirs = owned.has(edge.to);
    if (mine && theirs) {
      outside += 1;
      continue;
    }
    if (!mine && !theirs) continue;
    const other = mine ? edge.to : edge.from;
    const bucket = mine ? out : into;
    bucket.set(other, (bucket.get(other) ?? 0) + 1);
  }

  const inSubfolders = (folder?.fileCount ?? 0) - (folder?.files.length ?? 0);

  return (
    <div className="space-y-4 text-fg">
      <div>
        <h2 className="font-mono text-sm break-all">{label}</h2>
        <p className="mt-1 text-xs text-fg-muted">
          {owned.size} file{owned.size === 1 ? "" : "s"} directly in this folder
          {folderPath !== "" ? ` · ${folderPath}` : " · repository root"}
        </p>
      </div>

      <Section title="files by kind" count={owned.size}>
        {kinds.length === 0 ? (
          <Empty>This folder holds no files of its own.</Empty>
        ) : (
          <ul>
            {kinds.map(({ kind, count }) => (
              <li key={kind} className="flex items-center gap-1.5 border-b border-line py-1 last:border-0">
                <span className={`h-1.5 w-1.5 shrink-0 rounded ${SWATCH_CLASS[kind]}`} aria-hidden="true" />
                <span className="text-xs text-fg">{kindLabel(kind)}</span>
                <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-fg-muted">{count}</span>
              </li>
            ))}
          </ul>
        )}
        {inSubfolders > 0 && (
          <p className="mt-1.5 text-xs text-fg-muted">{inSubfolders} more in subfolders.</p>
        )}
      </Section>

      <Section title="depends on" count={out.size}>
        <FolderList rows={[...out]} {...pane} />
      </Section>

      <Section title="depended on by" count={into.size}>
        <FolderList rows={[...into]} {...pane} />
      </Section>

      {outside > 0 && (
        <p className="text-xs text-fg-muted">
          {outside} import{outside === 1 ? "" : "s"} stay{outside === 1 ? "s" : ""} inside this folder.
        </p>
      )}
    </div>
  );
}

interface Row {
  path: string;
  /** Null where the list is not ranked and has no count to show. */
  count: number | null;
  kind: ParsedFile["kind"] | null;
}

function PathList({ rows, hoverPath, onHover, onSelectPath }: { rows: Row[] } & HoverProps) {
  return (
    <ul>
      {rows.map((row) => (
        <PathRow key={row.path} row={row} hoverPath={hoverPath} onHover={onHover} onSelectPath={onSelectPath} />
      ))}
    </ul>
  );
}

function PathRow({ row, hoverPath, onHover, onSelectPath }: { row: Row } & HoverProps) {
  const lit = hoverPath === row.path;
  return (
    <li className={`border-b border-line last:border-0 ${lit ? "bg-surface-2" : ""}`}>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 py-1 text-left"
        onClick={() => onSelectPath(row.path)}
        onMouseEnter={() => onHover(row.path)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(row.path)}
        onBlur={() => onHover(null)}
      >
        {row.kind !== null && (
          <span className={`h-1.5 w-1.5 shrink-0 rounded ${SWATCH_CLASS[row.kind]}`} aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 font-mono text-xs break-all text-fg">{row.path}</span>
        {row.count !== null && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-fg-muted">{row.count}</span>
        )}
      </button>
    </li>
  );
}

function EdgeList({ edges, side, hoverPath, onHover, onSelectPath }: { edges: Edge[]; side: "in" | "out" } & HoverProps) {
  return (
    <ul>
      {edges.map((edge) => {
        const path = side === "out" ? edge.to : edge.from;
        const lit = hoverPath === path;
        return (
          <li key={`${edge.from}:${edge.to}:${edge.specifier}:${edge.line}`} className={`border-b border-line last:border-0 ${lit ? "bg-surface-2" : ""}`}>
            <button
              type="button"
              className="block w-full py-1 text-left"
              onClick={() => onSelectPath(path)}
              onMouseEnter={() => onHover(path)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(path)}
              onBlur={() => onHover(null)}
            >
              <span className="block font-mono text-xs break-all text-fg">{path}</span>
              <span className="font-mono text-xs text-fg-muted">
                {KIND_MARK[edge.kind]} &ldquo;{edge.specifier}&rdquo; &middot; line {edge.line}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FolderList({ rows, onSelectPath, onHover }: { rows: [string, number][] } & HoverProps) {
  if (rows.length === 0) return <Empty>Nothing links outside this folder.</Empty>;
  const sorted = [...rows].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return (
    <ul>
      {sorted.map(([path, count]) => (
        <li key={path} className="border-b border-line last:border-0">
          <button
            type="button"
            className="flex w-full items-baseline gap-2 py-1 text-left"
            onClick={() => onSelectPath(path)}
            onMouseEnter={() => onHover(path)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(path)}
            onBlur={() => onHover(null)}
          >
            <span className="min-w-0 flex-1 font-mono text-xs break-all">{path}</span>
            <span className="font-mono text-xs tabular-nums text-fg-muted">{count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A truncated list says how much it left out rather than quietly ending. */
function More({ total, shown }: { total: number; shown: number }) {
  if (total <= shown) return null;
  return <p className="mt-1.5 text-xs text-fg-muted">{total - shown} more.</p>;
}

interface HoverProps {
  hoverPath: string | null;
  onHover: (filePath: string | null) => void;
  onSelectPath: (filePath: string) => void;
}

/**
 * Split out of the pane props because every list needs exactly these three and the
 * pane carries a great deal more than that.
 */
function hoverProps(props: DetailPaneProps): HoverProps {
  return { hoverPath: props.hoverPath, onHover: props.onHover, onSelectPath: props.onSelectPath };
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="micro-label mb-1.5">
        {title} <span className="tabular-nums">{count}</span>
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-fg-muted">{children}</p>;
}