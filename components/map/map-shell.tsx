import type { ReactNode } from "react";
import { CategoryRail, type CategoryRailProps } from "./category-rail";

export interface MapShellProps extends CategoryRailProps {
  /** The set the rail's active filter names, read by the map. */
  activeMatchPaths: ReadonlySet<string> | null;
  children: ReactNode;
  /** Goes in the right-hand column. The column stays where it is either way. */
  detail?: ReactNode;
}

export function MapShell({
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
  children,
  detail,
}: MapShellProps) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-ground">
      <CategoryRail
        files={files}
        repositoryName={repositoryName}
        filter={filter}
        onFilterChange={onFilterChange}
        rolePaths={rolePaths}
        kindPaths={kindPaths}
        rolesAvailable={rolesAvailable}
        adapter={adapter}
        onRerun={onRerun}
        reanalysisNote={reanalysisNote}
      />
      <div className="min-w-0 flex-1 relative bg-ground" aria-label="Dependency map">
        {children}
      </div>
      <aside
        className="w-80 shrink-0 border-l border-line bg-surface flex flex-col"
        aria-label="Detail pane"
      >
        {/* The pane renders its own header — the tab strip — so nothing else owns
            a band above the content. */}
        <div className="min-h-0 flex-1">{detail}</div>
      </aside>
    </div>
  );
}
