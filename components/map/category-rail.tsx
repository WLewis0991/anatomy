"use client";

import { useMemo } from "react";

import type { FileFlag, ParsedFile } from "@/parser/types";
import { BANDS, categoriesFor, countByRole, isBanded, swatchOf, type RoleCategory } from "@/lib/frameworks";
import { ReanalyzeButton } from "@/components/map/reanalyze-button";

export interface CategoryRailProps {
  files: readonly ParsedFile[];
  /** The analysis the files were read from, which is what a re-run is asked of. */
  analysisId: string;
  repositoryName: string;
  /** The adapter that classified the files. The rail reshapes itself to it. */
  adapter: string;
  /** Each file's role, as the adapter reported it. Never re-derived here. */
  roleByPath: ReadonlyMap<string, string>;
  /** The role being shown at full strength, or null when all of them are. */
  activeRole: string | null;
  onSelectRole: (role: string | null) => void;
  /**
   * The facet being shown, or null. A role and a facet are two different
   * questions about a file, so at most one of them is ever set.
   */
  activeFacet: FileFlag | null;
  onSelectFacet: (facet: FileFlag | null) => void;
}

/** A facet's name. The key is the flag the parser set; this is what it reads as. */
const FACETS: readonly { flag: FileFlag; label: string }[] = [
  { flag: "test", label: "Tests" },
];

interface RailRowProps {
  label: string;
  swatch: string;
  count: number;
  active: boolean;
  /** Whether anything is selected at all, which decides the resting hover state. */
  idle: boolean;
  onClick: () => void;
}

function RailRow({ label, swatch, count, active, idle, onClick }: RailRowProps) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={`flex w-full items-center gap-2 rounded-[3px] px-1.5 py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
          idle ? "hover:bg-surface-2" : active ? "bg-surface-2" : "opacity-45 hover:opacity-75"
        }`}
      >
        <span className={`w-2 h-2 rounded ${swatch} shrink-0`} aria-hidden="true" />
        <span className="text-sm text-fg truncate">{label}</span>
        <span className="ml-auto tabular-nums text-sm text-fg-muted font-mono">{count}</span>
      </button>
    </li>
  );
}

export function CategoryRail({
  files,
  analysisId,
  repositoryName,
  adapter,
  roleByPath,
  activeRole,
  onSelectRole,
  activeFacet,
  onSelectFacet,
}: CategoryRailProps) {
  const categories = categoriesFor(adapter);
  const totalFiles = files.length;
  const folders = useMemo(() => new Set(files.map((f) => f.folder)).size, [files]);

  // Counting runs over every file, and the rail re-renders on every map hover,
  // so both counts are computed only when the inputs that decide them change.
  const counts = useMemo(
    () => countByRole(files.map((file) => roleByPath.get(file.path) ?? file.kind)),
    [files, roleByPath],
  );
  const facetCounts = useMemo(() => {
    const seen: Partial<Record<FileFlag, number>> = {};
    for (const file of files) {
      for (const flag of file.flags) seen[flag] = (seen[flag] ?? 0) + 1;
    }
    return seen;
  }, [files]);

  // A framework's rail is its whole taxonomy in reading order, grouped by band,
  // so it reads as the shape of that framework. The generic fallback has no
  // taxonomy of its own, so it lists the languages actually present, largest
  // first, with no sections.
  const banded = isBanded(categories);
  const rows: RoleCategory[] = banded
    ? categories
    : categories
        .filter((category) => (counts[category.key] ?? 0) > 0)
        .sort((a, b) => (counts[b.key] ?? 0) - (counts[a.key] ?? 0));

  const faceted = FACETS.filter((facet) => (facetCounts[facet.flag] ?? 0) > 0);
  const anySelected = activeRole !== null || activeFacet !== null;

  const renderRow = (category: RoleCategory) => {
    const active = activeRole === category.key;
    return (
      <RailRow
        key={category.key}
        label={category.label}
        swatch={swatchOf(category)}
        count={counts[category.key] ?? 0}
        active={active}
        idle={activeRole === null}
        onClick={() => onSelectRole(active ? null : category.key)}
      />
    );
  };

  return (
    <nav className="w-60 shrink-0 border-r border-line bg-surface flex flex-col overflow-hidden" aria-label="File categories">
      <header className="p-3 border-b border-line bg-surface-2">
        <span className="font-mono text-sm text-fg truncate block">{repositoryName}</span>
        <span className="micro-label mt-1 block text-fg-muted">
          {totalFiles} files · {folders} folders
        </span>
        {/* The rail describes one run of one repository, so the way to ask for a
            new run belongs with the thing it would replace. */}
        <ReanalyzeButton analysisId={analysisId} />
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {banded ? (
          <ul className="space-y-1.5">
            {BANDS.map(({ band, label }) => {
              const inBand = rows.filter((category) => category.band === band);
              if (inBand.length === 0) return null;
              return (
                <li key={band}>
                  <span className="micro-label block px-1.5 pt-2 pb-1">{label}</span>
                  <ul className="space-y-1.5">{inBand.map(renderRow)}</ul>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="space-y-1.5">{rows.map(renderRow)}</ul>
        )}

        {faceted.length > 0 && (
          <div className="mt-2 border-t border-line pt-1">
            <ul className="space-y-1.5">
              {faceted.map((facet) => {
                const active = activeFacet === facet.flag;
                return (
                  <RailRow
                    key={facet.flag}
                    label={facet.label}
                    swatch="bg-accent/50"
                    count={facetCounts[facet.flag] ?? 0}
                    active={active}
                    idle={!anySelected}
                    onClick={() => onSelectFacet(active ? null : facet.flag)}
                  />
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </nav>
  );
}
