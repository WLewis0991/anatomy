"use client";

import { useCallback, useRef, useState } from "react";

import { MapShell } from "@/components/map/map-shell";
import { DependencyMap, type DependencyMapHandle } from "@/components/map/dependency-map";
import { DetailPane, type PaneTab } from "@/components/map/detail-pane";
import type { Selection } from "@/lib/graph/types";
import type { FoldResult } from "@/parser/folding";
import type { ParseResult } from "@/parser/types";

export const instant = false;

/**
 * The map and the pane share one selection, one hover and one tab, held here
 * because both halves have to read and write them. Neither the canvas nor the pane
 * owns any of it, so neither can fall out of step with the other.
 */
export interface PreviewClientProps {
  result: ParseResult;
  repositoryName: string;
  fold: FoldResult;
}

export function PreviewClient({ result, repositoryName, fold }: PreviewClientProps) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<PaneTab>("structure");
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const map = useRef<DependencyMapHandle | null>(null);

  const handleSelect = useCallback((next: Selection | null) => {
    setSelection(next);
    // A highlight left over from the previous selection would describe a file the
    // pane is no longer showing.
    setHoverPath(null);
  }, []);

  return (
    <MapShell
      files={result.files}
      repositoryName={repositoryName}
      detail={
        <DetailPane
          selection={selection}
          files={result.files}
          edges={result.edges}
          root={fold.root}
          repositoryName={repositoryName}
          adapter={result.adapter}
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
        files={result.files}
        edges={result.edges}
        fileFanIn={result.fanIn}
        fileFanOut={result.fanOut}
        fold={fold}
        selection={selection}
        hoverPath={hoverPath}
        onSelect={handleSelect}
        onHover={setHoverPath}
      />
    </MapShell>
  );
}