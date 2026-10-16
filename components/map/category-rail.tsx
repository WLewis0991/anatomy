"use client";

import type { ModuleKind, ParsedFile } from "@/parser/types";
import { KIND_ORDER, kindLabel, SWATCH_CLASS, countFilesByKind } from "@/lib/kinds";

export interface CategoryRailProps {
  files: readonly ParsedFile[];
  repositoryName: string;
  /** The category being shown at full strength, or null when all of them are. */
  activeKind: ModuleKind | null;
  onSelectKind: (kind: ModuleKind | null) => void;
}

export function CategoryRail({ files, repositoryName, activeKind, onSelectKind }: CategoryRailProps) {
  const counts = countFilesByKind(files);
  const totalFiles = files.length;
  const folders = new Set(files.map((f) => f.folder)).size;

  const rows = KIND_ORDER.filter((k) => counts[k] > 0).sort((a, b) => {
    const ca = counts[a];
    const cb = counts[b];
    if (cb !== ca) return cb - ca;
    return KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b);
  });

  return (
    <nav className="w-60 shrink-0 border-r border-line bg-surface flex flex-col overflow-hidden" aria-label="File categories">
      <header className="p-3 border-b border-line bg-surface-2">
        <span className="font-mono text-sm text-fg truncate block">{repositoryName}</span>
        <span className="micro-label mt-1 block text-fg-muted">
          {totalFiles} files · {folders} folders
        </span>
      </header>
      <ul className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {rows.map((kind) => {
          // Choosing a category dims what is not in it. Nothing is removed: the
          // shape of the repository is what makes a dimmed map readable.
          const active = activeKind === kind;
          return (
            <li key={kind}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelectKind(active ? null : kind)}
                className={`flex w-full items-center gap-2 rounded-[3px] px-1.5 py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                  activeKind === null ? "hover:bg-surface-2" : active ? "bg-surface-2" : "opacity-45 hover:opacity-75"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded ${SWATCH_CLASS[kind]} shrink-0`}
                  aria-hidden="true"
                />
                <span className="text-sm text-fg truncate">{kindLabel(kind)}</span>
                <span className="ml-auto tabular-nums text-sm text-fg-muted font-mono">
                  {counts[kind]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}