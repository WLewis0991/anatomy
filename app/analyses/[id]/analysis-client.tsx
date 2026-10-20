"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  FileReach,
  FileRole,
  ModuleKind,
  ParsedFile,
  Edge,
  Coverage,
} from "@/parser/types";
import { foldDirectories } from "@/parser/folding";
import type { FoldNode, FoldResult } from "@/parser/folding";
import type { Selection } from "@/lib/graph/types";
import { kindFromPath } from "@/lib/kinds";
import type { MapFilter } from "@/lib/roles";

import { MapShell } from "@/components/map/map-shell";
import { DependencyMap, type DependencyMapHandle } from "@/components/map/dependency-map";
import { DetailPane, type PaneTab } from "@/components/map/detail-pane";

import type { Database } from "@/lib/database.types";
import type {
  ExplanationResponsePayload,
  ExplanationSubjectKind,
  ExplanationView,
  FileRoleView,
} from "@/lib/ai/types";

interface AnalysisClientProps {
  analysis: {
    id: string;
    status: string;
    stage: string;
    stage_message: string | null;
    error_detail: string | null;
    head_sha: string | null;
    adapter: string | null;
    coverage_json: Database["public"]["Tables"]["analyses"]["Row"]["coverage_json"];
    project_id: string;
    created_at: string;
    /** Which role schema the stored files were written with; 0 means none. */
    role_schema_version: number;
  };
  project: {
    id: string;
    name: string;
    url: string;
  };
  files: Array<{
    id: string;
    path: string;
    role: string | null;
    kind: string | null;
    reach: string | null;
    server_action_count: number | null;
  }>;
  edges: Array<{ id: string; from_file_id: string; to_file_id: string; kind: string; specifier: string }>;
  roles: Array<{ file_id: string; role: string; source: string }>;
  tracingEnabled: boolean;
}

interface ExplanationSlot {
  explanation: ExplanationView | null;
  stale: boolean;
  error: string | null;
}

/** A filter value present in the schema but with no files in this analysis. */
const EMPTY_PATHS: ReadonlySet<string> = new Set();

export function AnalysisClient({
  analysis,
  project,
  files: dbFiles,
  edges: dbEdges,
  roles,
  tracingEnabled,
}: AnalysisClientProps) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<PaneTab>("structure");
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const [filter, setFilter] = useState<MapFilter | null>(null);
  // The explanation cache the user can feel. Keyed by subject, not by tab: this
  // is what makes moving away and back instant without a second request.
  const [explanations, setExplanations] = useState<Record<string, ExplanationSlot>>({});
  const [explanationBusyKey, setExplanationBusyKey] = useState<string | null>(null);
  const [reanalysisNote, setReanalysisNote] = useState<string | null>(null);
  const map = useRef<DependencyMapHandle | null>(null);

  // Whether this run stored a role for every file. An analysis written before
  // phase 11 has none, and a missing role is not the same as `unclassified`.
  const rolesAvailable = analysis.role_schema_version >= 1;

  // The convention role per path, straight from the rows. Kept separate from the
  // AI's `rolesByPath` and from the parsed files so a fallback can never leak into
  // a role filter: a file stored with no role is null here, and null is excluded
  // from every role set.
  const conventionRoleByPath = useMemo((): ReadonlyMap<string, FileRole | null> => {
    const byPath = new Map<string, FileRole | null>();
    for (const file of dbFiles) byPath.set(file.path, toFileRole(file.role));
    return byPath;
  }, [dbFiles]);

  // Convert database rows to parser types. A row stored before phase 11 carries
  // no role, kind or reach; the kind falls back to a display-only value from the
  // path. The coerced role below is never read by the rail or the pane.
  const parsedFiles = useMemo((): ParsedFile[] => {
    return dbFiles.map((f) => ({
      path: f.path,
      folder: f.path.includes("/") ? f.path.substring(0, f.path.lastIndexOf("/")) : ".",
      extension: f.path.includes(".") ? f.path.substring(f.path.lastIndexOf(".")) : "",
      kind: toModuleKind(f.kind, f.path),
      reach: toFileReach(f.reach),
      role: conventionRoleByPath.get(f.path) ?? "unclassified",
      serverActionCount: f.server_action_count,
      lines: 0,
      bytes: 0,
      hash: "",
    }));
  }, [dbFiles, conventionRoleByPath]);

  // The one set every role count, dim and panel match reads. Null roles are never
  // coerced into `unclassified`.
  const rolePaths = useMemo((): ReadonlyMap<FileRole, ReadonlySet<string>> => {
    const byRole = new Map<FileRole, Set<string>>();
    for (const [path, role] of conventionRoleByPath) {
      if (role === null) continue;
      const paths = byRole.get(role) ?? new Set<string>();
      paths.add(path);
      byRole.set(role, paths);
    }
    return byRole;
  }, [conventionRoleByPath]);

  const kindPaths = useMemo((): ReadonlyMap<ModuleKind, ReadonlySet<string>> => {
    const byKind = new Map<ModuleKind, Set<string>>();
    for (const file of parsedFiles) {
      const paths = byKind.get(file.kind) ?? new Set<string>();
      paths.add(file.path);
      byKind.set(file.kind, paths);
    }
    return byKind;
  }, [parsedFiles]);

  const activeMatchPaths = useMemo((): ReadonlySet<string> | null => {
    if (filter === null) return null;
    if (filter.facet === "role") return rolePaths.get(filter.value as FileRole) ?? EMPTY_PATHS;
    return kindPaths.get(filter.value as ModuleKind) ?? EMPTY_PATHS;
  }, [filter, rolePaths, kindPaths]);

  // We need a different approach - let's fetch file paths for edges
  // For now, let's create a map of file_id to path
  const fileIdToPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of dbFiles) map.set(f.id, f.path);
    return map;
  }, [dbFiles]);

  const rolesByPath = useMemo((): ReadonlyMap<string, FileRoleView> => {
    const byPath = new Map<string, FileRoleView>();
    for (const role of roles) {
      const path = fileIdToPath.get(role.file_id);
      if (path === undefined) continue;
      byPath.set(path, { role: role.role, source: role.source });
    }
    return byPath;
  }, [roles, fileIdToPath]);

  const resolvedEdges = useMemo((): Edge[] => {
    return dbEdges
      .map((e) => {
        const from = fileIdToPath.get(e.from_file_id);
        const to = fileIdToPath.get(e.to_file_id);
        if (!from || !to) return null;
        return {
          from,
          to,
          specifier: e.specifier,
          kind: e.kind as Edge["kind"],
          line: 0, // We don't store line numbers in the database yet
        };
      })
      .filter((e): e is Edge => e !== null);
  }, [dbEdges, fileIdToPath]);

  const fold = useMemo((): FoldResult => {
    return foldDirectories(parsedFiles, {
      rootLabel: project.name.split("/").pop() ?? "root",
    });
  }, [parsedFiles, project.name]);

  // Every real file and folded folder path. Explanation links only move to these.
  const paths = useMemo((): ReadonlySet<string> => {
    const set = new Set<string>();
    for (const file of dbFiles) set.add(file.path);

    const visit = (node: FoldNode): void => {
      if (node.path !== "") set.add(node.path);
      for (const child of node.children) visit(child);
    };
    visit(fold.root);
    return set;
  }, [dbFiles, fold.root]);

  const coverage = useMemo(() => {
    return analysis.coverage_json as Coverage | null;
  }, [analysis.coverage_json]);

  const fanIn = useMemo((): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const edge of resolvedEdges) {
      counts[edge.to] = (counts[edge.to] ?? 0) + 1;
    }
    return counts;
  }, [resolvedEdges]);

  const fanOut = useMemo((): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const edge of resolvedEdges) {
      counts[edge.from] = (counts[edge.from] ?? 0) + 1;
    }
    return counts;
  }, [resolvedEdges]);

  const handleSelect = useCallback((next: Selection | null) => {
    setSelection(next);
    setHoverPath(null);
  }, []);

  const requestExplanation = useCallback(
    async (kind: ExplanationSubjectKind, path: string) => {
      const key = `${kind}:${path}`;
      setExplanationBusyKey(key);
      setExplanations((current) => ({
        ...current,
        [key]: {
          explanation: current[key]?.explanation ?? null,
          stale: current[key]?.stale ?? false,
          error: null,
        },
      }));

      try {
        const response = await fetch(`/api/analyses/${analysis.id}/explain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, path }),
        });

        const payload = (await response.json()) as
          | ExplanationResponsePayload
          | { error?: unknown };

        if (!response.ok) {
          const message =
            typeof (payload as { error?: unknown }).error === "string"
              ? (payload as { error: string }).error
              : "Could not explain this subject.";
          throw new Error(message);
        }

        const result = payload as ExplanationResponsePayload;
        setExplanations((current) => ({
          ...current,
          [key]: {
            explanation: result.explanation,
            stale: result.stale,
            error: null,
          },
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not explain this subject.";
        setExplanations((current) => ({
          ...current,
          [key]: {
            explanation: current[key]?.explanation ?? null,
            stale: current[key]?.stale ?? false,
            error: message,
          },
        }));
      } finally {
        setExplanationBusyKey(null);
      }
    },
    [analysis.id],
  );

  const rerunAnalysis = useCallback(async () => {
    setReanalysisNote("Starting re-analysis...");
    try {
      const response = await fetch(`/api/analyses/${analysis.id}/rerun`, { method: "POST" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
        const message =
          typeof payload?.error === "string" ? payload.error : "Could not start re-analysis.";
        setReanalysisNote(message);
        return;
      }
      setReanalysisNote("Re-analysis queued. Reload this page when it finishes.");
    } catch {
      setReanalysisNote("Could not start re-analysis.");
    }
  }, [analysis.id]);

  const selectionKey =
    selection === null
      ? null
      : selection.kind === "row"
        ? `file:${selection.file.path}`
        : `folder:${selection.folderPath}`;
  const currentExplanation = selectionKey === null ? null : explanations[selectionKey] ?? null;

  return (
    <div className="flex h-dvh flex-col bg-ground">
      <CoverageBanner coverage={coverage} />
      <MapShell
        files={parsedFiles}
        repositoryName={project.name}
        filter={filter}
        onFilterChange={setFilter}
        activeMatchPaths={activeMatchPaths}
        rolePaths={rolePaths}
        kindPaths={kindPaths}
        rolesAvailable={rolesAvailable}
        adapter={analysis.adapter ?? "no-framework"}
        onRerun={rerunAnalysis}
        reanalysisNote={reanalysisNote}
        detail={
          <DetailPane
            selection={selection}
            files={parsedFiles}
            edges={resolvedEdges}
            root={fold.root}
            repositoryName={project.name}
            adapter={analysis.adapter ?? "no-framework"}
            conventionRoleByPath={conventionRoleByPath}
            rolesAvailable={rolesAvailable}
            tab={tab}
            onTabChange={setTab}
            hoverPath={hoverPath}
            onHover={setHoverPath}
            onSelectPath={(path) => map.current?.selectPath(path)}
            rolesByPath={rolesByPath}
            explanation={currentExplanation?.explanation ?? null}
            explanationStale={currentExplanation?.stale ?? false}
            explanationBusy={selectionKey !== null && explanationBusyKey === selectionKey}
            explanationError={currentExplanation?.error ?? null}
            tracingEnabled={tracingEnabled}
            paths={paths}
            onExplain={requestExplanation}
            onRerun={rerunAnalysis}
            reanalysisNote={reanalysisNote}
          />
        }
      >
        <DependencyMap
          ref={map}
          files={parsedFiles}
          edges={resolvedEdges}
          fileFanIn={fanIn}
          fileFanOut={fanOut}
          fold={fold}
          activeMatchPaths={activeMatchPaths}
          selection={selection}
          hoverPath={hoverPath}
          onSelect={handleSelect}
          onHover={setHoverPath}
        />
      </MapShell>
    </div>
  );
}

const MODULE_KINDS: ReadonlySet<string> = new Set([
  "typescript",
  "javascript",
  "style",
  "json",
  "markdown",
  "config",
  "asset",
  "other",
]);

const FILE_REACHES: ReadonlySet<string> = new Set(["none", "framework", "entrypoint"]);

const FILE_ROLES: ReadonlySet<string> = new Set([
  "page",
  "layout",
  "route-handler",
  "middleware",
  "action-module",
  "component",
  "hook",
  "config",
  "style",
  "asset",
  "docs",
  "unclassified",
]);

function isModuleKind(value: string): value is ModuleKind {
  return MODULE_KINDS.has(value);
}

function isFileReach(value: string): value is FileReach {
  return FILE_REACHES.has(value);
}

function isFileRole(value: string): value is FileRole {
  return FILE_ROLES.has(value);
}

function toModuleKind(value: string | null, path: string): ModuleKind {
  return value !== null && isModuleKind(value) ? value : kindFromPath(path);
}

function toFileReach(value: string | null): FileReach {
  return value !== null && isFileReach(value) ? value : "none";
}

/** Null for a row stored before roles existed; that is not `unclassified`. */
function toFileRole(value: string | null): FileRole | null {
  return value !== null && isFileRole(value) ? value : null;
}

/**
 * The map is drawn from the files and edges the parser resolved, so a repository
 * it could not fully read produces a partial graph. This names how partial, in one
 * line, and never leaves the screen: a graph that is quietly two-thirds complete
 * must not be able to look complete.
 *
 * The figure is the graph against everything that could have been in it. A file
 * becomes a node, a resolved import becomes a line, so the denominator is every
 * file the walk found plus every import that pointed at something on disk; the
 * numerator is the files that parsed plus the imports that landed. Skips, failed
 * imports and imports aimed at a file that is not a node all pull the figure
 * down, and none of them can hide behind the others. Imports that pointed outside
 * the repository are a package, not a gap, and are not counted.
 *
 * The figure floors rather than rounds, so it can only ever report a graph as
 * more complete than it is by being exactly complete — which is why the exactly
 * complete case is the only one that has nothing to say.
 */
function CoverageBanner({ coverage }: { coverage: Coverage | null }) {
  if (!coverage) return null;

  const filesFound = coverage.filesFound ?? 0;
  const filesParsed = coverage.filesParsed ?? 0;
  const filesSkipped = coverage.filesSkipped ?? 0;
  const internal = coverage.internal ?? 0;
  const unresolved = coverage.unresolved ?? 0;
  const excluded = coverage.excluded ?? 0;

  if (filesParsed === filesFound && unresolved === 0 && excluded === 0) return null;

  const placeable = filesFound + internal + unresolved + excluded;
  const placed = filesParsed + internal;
  const percentage = placeable > 0 ? Math.floor((placed / placeable) * 100) : 100;

  return (
    <div className="shrink-0 border-b border-line bg-surface-2 px-4 py-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-mono text-fg">Coverage: {percentage}%</span>
        <span className="text-fg-muted">
          {filesParsed} of {filesFound} files
        </span>
        {unresolved > 0 && (
          <span className="text-fg-muted">{unresolved} imports unresolved</span>
        )}
        {excluded > 0 && (
          <span className="text-fg-muted">{excluded} imports not a node</span>
        )}
        {filesSkipped > 0 && (
          <span className="text-fg-muted">{filesSkipped} files skipped</span>
        )}
      </div>
    </div>
  );
}