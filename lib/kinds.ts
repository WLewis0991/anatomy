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

/**
 * A display-only kind for analyses stored before phase 11, when the kind column
 * was added. It fills the file-type facet and the map's swatches; it never
 * decides a role.
 */
const EXTENSION_KINDS: ReadonlyMap<string, ModuleKind> = new Map([
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".css", "style"],
  [".scss", "style"],
  [".sass", "style"],
  [".less", "style"],
  [".json", "json"],
  [".md", "markdown"],
  [".mdx", "markdown"],
  [".png", "asset"],
  [".jpg", "asset"],
  [".jpeg", "asset"],
  [".svg", "asset"],
  [".gif", "asset"],
  [".webp", "asset"],
  [".ico", "asset"],
  [".avif", "asset"],
  [".bmp", "asset"],
  [".tiff", "asset"],
  [".woff", "asset"],
  [".woff2", "asset"],
  [".ttf", "asset"],
  [".otf", "asset"],
]);

function isConfigBasename(basename: string): boolean {
  const lower = basename.toLowerCase();
  return (
    lower.startsWith("next.config") ||
    lower.startsWith("tsconfig") ||
    lower.startsWith(".eslintrc") ||
    lower.startsWith("eslint.config") ||
    lower.startsWith(".prettierrc") ||
    lower.startsWith("prettier.config") ||
    lower.startsWith("postcss.config") ||
    lower.startsWith(".postcssrc") ||
    lower.startsWith("tailwind.config") ||
    lower === "package.json" ||
    lower === "pnpm-lock.yaml" ||
    lower === "package-lock.json" ||
    lower === "npm-shrinkwrap.json" ||
    lower === "yarn.lock" ||
    lower === "bun.lockb"
  );
}

/** The kind a path implies when no stored kind exists. Config names win over extension. */
export function kindFromPath(path: string): ModuleKind {
  const basename = path.split("/").pop() ?? path;
  if (isConfigBasename(basename)) return "config";
  const dot = basename.lastIndexOf(".");
  if (dot === -1) return "other";
  return EXTENSION_KINDS.get(basename.slice(dot).toLowerCase()) ?? "other";
}