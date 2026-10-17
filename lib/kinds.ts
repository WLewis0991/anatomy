import type { ModuleKind } from "../parser/types.ts";

export const KIND_ORDER: readonly ModuleKind[] = [
  "typescript",
  "javascript",
  "style",
  "json",
  "markdown",
  "config",
  "asset",
  "other",
] as const;

export function kindLabel(kind: ModuleKind): string {
  return kind;
}

export const SWATCH_CLASS: Record<ModuleKind, string> = {
  typescript: "bg-kind-typescript",
  javascript: "bg-kind-javascript",
  python: "bg-kind-other",
  style: "bg-kind-style",
  json: "bg-kind-json",
  markdown: "bg-kind-other",
  config: "bg-kind-other",
  asset: "bg-kind-other",
  other: "bg-kind-other",
};

export function countFilesByKind(
  files: readonly { kind: ModuleKind }[],
): Record<ModuleKind, number> {
  const counts: Record<ModuleKind, number> = {} as Record<ModuleKind, number>;
  for (const kind of KIND_ORDER) counts[kind] = 0;
  for (const file of files) counts[file.kind] += 1;
  return counts;
}