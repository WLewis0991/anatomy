"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ModuleKind, ParsedFile, Edge, Coverage } from "@/parser/types";
import { foldDirectories } from "@/parser/folding";
import type { FoldResult } from "@/parser/folding";
import type { Selection } from "@/lib/graph/types";

import { MapShell } from "@/components/map/map-shell";
import { DependencyMap, type DependencyMapHandle } from "@/components/map/dependency-map";
import { DetailPane, type PaneTab } from "@/components/map/detail-pane";

import type { Database } from "@/lib/database.types";

interface AnalysisClientProps {
  analysis: {
    id: string;
    status: string;
    stage: string;
    stage_message: string | null;
    error_detail: string | null;
    head_sha: string | null;
    coverage_json: Database["public"]["Tables"]["analyses"]["Row"]["coverage_json"];
    project_id: string;
    created_at: string;
  };
  project: {
    id: string;
    name: string;
    url: string;
  };
  files: Array<{ id: string; path: string }>;
  edges: Array<{ id: string; from_file_id: string; to_file_id: string; kind: string; specifier: string }>;
}

export function AnalysisClient({ analysis, project, files: dbFiles, edges: dbEdges }: AnalysisClientProps) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<PaneTab>("structure");
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<ModuleKind | null>(null);
  const map = useRef<DependencyMapHandle | null>(null);

  // Convert database rows to parser types
  const parsedFiles = useMemo((): ParsedFile[] => {
    return dbFiles.map((f) => ({
      path: f.path,
      folder: f.path.includes("/") ? f.path.substring(0, f.path.lastIndexOf("/")) : ".",
      extension: f.path.includes(".") ? f.path.substring(f.path.lastIndexOf(".")) : "",
      kind: inferKindFromPath(f.path),
      reach: "none" as const,
      lines: 0,
      bytes: 0,
      hash: "",
    }));
  }, [dbFiles]);

  // We need a different approach - let's fetch file paths for edges
  // For now, let's create a map of file_id to path
  const fileIdToPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of dbFiles) map.set(f.id, f.path);
    return map;
  }, [dbFiles]);

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

  return (
    <div className="flex h-dvh flex-col bg-ground">
      <CoverageBanner coverage={coverage} />
      <MapShell
        files={parsedFiles}
        repositoryName={project.name}
        activeKind={activeKind}
        onSelectKind={setActiveKind}
        detail={
          <DetailPane
            selection={selection}
            files={parsedFiles}
            edges={resolvedEdges}
            root={fold.root}
            repositoryName={project.name}
            adapter="no-framework"
            tab={tab}
            onTabChange={setTab}
            hoverPath={hoverPath}
            onHover={setHoverPath}
            onSelectPath={(path) => map.current?.selectFile(path)}
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
          activeKind={activeKind}
          selection={selection}
          hoverPath={hoverPath}
          onSelect={handleSelect}
          onHover={setHoverPath}
        />
      </MapShell>
    </div>
  );
}

function inferKindFromPath(path: string): ModuleKind {
  const ext = path.includes(".") ? path.substring(path.lastIndexOf(".")).toLowerCase() : "";
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".css":
    case ".scss":
    case ".sass":
    case ".less":
      return "style";
    case ".json":
      return "json";
    case ".md":
    case ".mdx":
      return "markdown";
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".svg":
    case ".gif":
    case ".webp":
    case ".ico":
      return "asset";
    default:
      return "other";
  }
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