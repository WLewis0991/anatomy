import type { PositionedNode } from "@/lib/graph/layout";

/** The real folder a node came from, for tooltips and the detail pane. */
export function pathOf(node: PositionedNode): string {
  return node.file?.path ?? node.folderPath;
}

/** The repository-relative folder, with the root spelled out. */
export function folderLabel(folderPath: string): string {
  return folderPath === "" ? "." : folderPath;
}