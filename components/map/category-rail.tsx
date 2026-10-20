"use client";

import { useId, useState } from "react";

import type { FileRole, ModuleKind, ParsedFile } from "@/parser/types";
import { KIND_ORDER, kindLabel, SWATCH_CLASS } from "@/lib/kinds";
import {
  ROLE_ORDER,
  STRUCTURAL_ROLES,
  roleLabel,
  type FilterFacet,
  type MapFilter,
} from "@/lib/roles";

export interface CategoryRailProps {
  files: readonly ParsedFile[];
  repositoryName: string;
  /** The one active filter: a role or a file type, never both. */
  filter: MapFilter | null;
  onFilterChange: (filter: MapFilter | null) => void;
  /** The role-to-path set every role count is read from. */
  rolePaths: ReadonlyMap<FileRole, ReadonlySet<string>>;
  /** The kind-to-path set every file-type count is read from. */
  kindPaths: ReadonlyMap<ModuleKind, ReadonlySet<string>>;
  rolesAvailable: boolean;
  adapter: string | null;
  onRerun: () => void;
  reanalysisNote: string | null;
}

/** The category the rail is highlighting, for one row. */
function isActive(filter: MapFilter | null, facet: FilterFacet, value: string): boolean {
  return filter !== null && filter.facet === facet && filter.value === value;
}

export function CategoryRail({
  files,
  repositoryName,
  filter,
  onFilterChange,
  rolePaths,
  kindPaths,
  rolesAvailable,
  adapter,
  onRerun,
  reanalysisNote,
}: CategoryRailProps) {
  const baseId = useId();
  const roleListId = `${baseId}-roles`;
  const kindListId = `${baseId}-kinds`;
  // Role is the primary facet and never collapses. File type starts closed.
  const [kindCollapsed, setKindCollapsed] = useState(true);

  const totalFiles = files.length;
  const folders = new Set(files.map((f) => f.folder)).size;

  // The active file-type facet is forced open; its header cannot close it out of
  // sight. The role facet has no collapse state at all.
  const kindOpen = !kindCollapsed || filter?.facet === "kind";

  const toggleKind = () => {
    if (filter?.facet === "kind") return;
    setKindCollapsed((current) => !current);
  };

  const roleCount = (role: FileRole): number => rolePaths.get(role)?.size ?? 0;
  const kindCount = (kind: ModuleKind): number => kindPaths.get(kind)?.size ?? 0;

  // Structural zeros are information in a Next repository; every other zero row
  // is hidden. `unclassified` is always visible, even at zero.
  const roleRows = ROLE_ORDER.filter((role) => {
    const count = roleCount(role);
    if (count > 0) return true;
    if (role === "unclassified") return true;
    return STRUCTURAL_ROLES.has(role) && adapter === "next";
  });

  // Every kind that exists, plus an active kind even if its count is zero.
  const kindRows = KIND_ORDER.filter(
    (kind) => kindCount(kind) > 0 || isActive(filter, "kind", kind),
  );

  return (
    <nav
      className="w-60 shrink-0 border-r border-line bg-surface flex flex-col overflow-hidden"
      aria-label="File categories"
    >
      <header className="p-3 border-b border-line bg-surface-2">
        <span className="font-mono text-sm text-fg truncate block">{repositoryName}</span>
        <span className="micro-label mt-1 block text-fg-muted">
          {totalFiles} files · {folders} folders
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-2">
        <section>
          <h2 className="micro-label px-1.5 py-1">Roles</h2>

          <div id={roleListId}>
            {rolesAvailable ? (
              <ul className="mt-1 space-y-0.5">
                {roleRows.map((role) => {
                  const count = roleCount(role);
                  const active = isActive(filter, "role", role);
                  const disabled = count === 0;
                  const dimmed = disabled || (filter !== null && !active);
                  return (
                    <li key={role}>
                      <button
                        type="button"
                        aria-pressed={active}
                        aria-disabled={disabled ? "true" : undefined}
                        disabled={disabled}
                        onClick={() => {
                          if (disabled) return;
                          onFilterChange(
                            active ? null : { facet: "role", value: role },
                          );
                        }}
                        className={`flex w-full items-center gap-2 rounded-[3px] px-1.5 py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed ${
                          active
                            ? "bg-surface-2"
                            : dimmed
                              ? "opacity-45"
                              : "hover:bg-surface-2"
                        }`}
                      >
                        <span className="truncate text-sm text-fg">{roleLabel(role)}</span>
                        <span className="ml-auto shrink-0 font-mono text-sm tabular-nums text-fg-muted">
                          {count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-1 space-y-1.5 px-1.5 py-1">
                <p className="text-xs text-fg-muted">Roles unavailable</p>
                <button
                  type="button"
                  onClick={onRerun}
                  className="w-full rounded-[3px] border border-line bg-surface px-2 py-1 text-left text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  Re-analyse repository
                </button>
                {reanalysisNote !== null && (
                  <p className="text-xs text-fg-muted">{reanalysisNote}</p>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="mt-2 border-t border-line pt-2">
          <button
            type="button"
            aria-expanded={kindOpen}
            aria-controls={kindListId}
            onClick={toggleKind}
            className="micro-label flex w-full items-center justify-between rounded-[3px] px-1.5 py-1 text-left hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            <span>File type</span>
            <span aria-hidden="true" className="font-mono text-xs">
              {kindOpen ? "−" : "+"}
            </span>
          </button>

          <div id={kindListId} hidden={!kindOpen}>
            <ul className="mt-1 space-y-0.5">
              {kindRows.map((kind) => {
                const count = kindCount(kind);
                const active = isActive(filter, "kind", kind);
                const dimmed = filter !== null && !active;
                return (
                  <li key={kind}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        onFilterChange(active ? null : { facet: "kind", value: kind })
                      }
                      className={`flex w-full items-center gap-2 rounded-[3px] px-1.5 py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                        active
                          ? "bg-surface-2"
                          : dimmed
                            ? "opacity-45"
                            : "hover:bg-surface-2"
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded ${SWATCH_CLASS[kind]} shrink-0`}
                        aria-hidden="true"
                      />
                      <span className="truncate text-sm text-fg">{kindLabel(kind)}</span>
                      <span className="ml-auto shrink-0 font-mono text-sm tabular-nums text-fg-muted">
                        {count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>
    </nav>
  );
}
