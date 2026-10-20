"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import { DEFAULT_SELECTED, type DemoFileId } from "./demo-data";

interface DemoSelectionValue {
  selectedId: DemoFileId;
  select: (id: DemoFileId) => void;
}

const DemoSelectionContext = createContext<DemoSelectionValue | null>(null);

export function DemoSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<DemoFileId>(DEFAULT_SELECTED);

  const select = useCallback((id: DemoFileId) => {
    setSelectedId(id);
  }, []);

  return (
    <DemoSelectionContext value={{ selectedId, select }}>
      {children}
    </DemoSelectionContext>
  );
}

export function useDemoSelection(): DemoSelectionValue {
  const value = useContext(DemoSelectionContext);

  if (value === null) {
    throw new Error("useDemoSelection must be used inside DemoSelectionProvider");
  }

  return value;
}
