export type DemoNodeRole =
  | "entry"
  | "core"
  | "util"
  | "component"
  | "hook"
  | "config";

export type DemoEdgeKind = "import" | "reexport" | "dynamic" | "type";

export interface DemoFile {
  path: string;
  tag: DemoNodeRole;
  role: DemoNodeRole;
  layer: string;
  summary: string;
  exports: string;
  imports: readonly string[];
  dependents: readonly string[];
}

export const DEMO_FILES = {
  parse: {
    path: "parser/parse-repository.ts",
    tag: "entry",
    role: "entry",
    layer: "parser",
    summary:
      "Walks a repository once, extracts every import, resolves what it can and returns files, edges and a coverage report. It is the only place the whole parse is assembled.",
    exports: "parseRepository",
    imports: [
      "parser/walk.ts",
      "parser/extract-imports.ts",
      "parser/resolve.ts",
      "parser/graph.ts",
      "parser/types.ts",
    ],
    dependents: ["lib/analysis-pipeline.ts"],
  },
  pipeline: {
    path: "lib/analysis-pipeline.ts",
    tag: "core",
    role: "core",
    layer: "pipeline",
    summary:
      "Runs fetch, select, parse and store as named stages. A stage that throws writes the reason and the stage it failed in, so a run never looks like it is still working.",
    exports: "createOrGetAnalysis, runAnalysisPipeline",
    imports: ["lib/fetch-repository.ts", "parser/parse-repository.ts"],
    dependents: ["app/api/analyses/route.ts"],
  },
  graph: {
    path: "parser/graph.ts",
    tag: "util",
    role: "util",
    layer: "parser",
    summary:
      "Builds the edge list from records the parser actually resolved. Nothing here guesses a connection to make the picture look more complete.",
    exports: "buildGraph, countDegree",
    imports: ["parser/types.ts"],
    dependents: ["parser/parse-repository.ts"],
  },
  types: {
    path: "parser/types.ts",
    tag: "config",
    role: "config",
    layer: "parser",
    summary:
      "The vocabulary every other parser module shares: files, edges, roles and the coverage report. Types only, with no behaviour to keep in sync.",
    exports: "ParsedFile, Edge, ParseResult",
    imports: [],
    dependents: [
      "parser/parse-repository.ts",
      "parser/graph.ts",
      "parser/resolve.ts",
      "parser/extract-imports.ts",
      "lib/graph/derive.ts",
      "lib/roles.ts",
    ],
  },
  resolve: {
    path: "parser/resolve.ts",
    tag: "util",
    role: "util",
    layer: "parser",
    summary:
      "Resolves an import specifier to a real file. When it cannot, it returns a reason instead of the nearest-looking path.",
    exports: "createResolver",
    imports: ["parser/types.ts"],
    dependents: ["parser/parse-repository.ts"],
  },
  extract: {
    path: "parser/extract-imports.ts",
    tag: "util",
    role: "util",
    layer: "parser",
    summary:
      "Reads one source file and returns its imports, re-exports and dynamic loads. It never runs the file, so a broken module still produces a usable result or a clear parse error.",
    exports: "extractImports",
    imports: ["parser/types.ts", "parser/walk.ts"],
    dependents: ["parser/parse-repository.ts"],
  },
  derive: {
    path: "lib/graph/derive.ts",
    tag: "util",
    role: "util",
    layer: "graph",
    summary:
      "Turns the stored file and edge lists into the shapes the map renders. Pure functions over data the browser already holds, so selecting a file never waits on a request.",
    exports: "deriveCanvas, rowId, folderNodeId",
    imports: ["parser/types.ts", "parser/folding.ts"],
    dependents: ["components/map/dependency-map.tsx"],
  },
  layout: {
    path: "lib/graph/layout.ts",
    tag: "util",
    role: "util",
    layer: "graph",
    summary:
      "Places the graph with dagre and returns positions the canvas can draw. The same nodes in the same order produce the same layout every run.",
    exports: "layoutCanvas",
    imports: ["lib/graph/types.ts"],
    dependents: ["components/map/dependency-map.tsx"],
  },
  map: {
    path: "components/map/dependency-map.tsx",
    tag: "component",
    role: "component",
    layer: "map",
    summary:
      "Draws the map and owns the selection. It reads the layout and the edge list; it never calculates structure of its own.",
    exports: "DependencyMap",
    imports: [
      "lib/graph/derive.ts",
      "lib/graph/layout.ts",
      "lib/graph/emphasis.ts",
    ],
    dependents: ["app/(app)/analyses/[id]/analysis-client.tsx"],
  },
  roles: {
    path: "lib/roles.ts",
    tag: "config",
    role: "config",
    layer: "roles",
    summary:
      "The fixed role vocabulary and the labels that read it. Convention owns the structural roles; the AI label is a separate axis and never lands here.",
    exports: "ROLE_ORDER, roleLabel",
    imports: ["parser/types.ts"],
    dependents: [
      "components/map/detail-pane.tsx",
      "components/map/category-rail.tsx",
    ],
  },
} as const satisfies Record<string, DemoFile>;

export type DemoFileId = keyof typeof DEMO_FILES;

export interface DemoNode {
  id: DemoFileId;
  x: string;
  y: string;
  secondary?: boolean;
}

export const DEMO_NODES: readonly DemoNode[] = [
  { id: "parse", x: "0%", y: "2%" },
  { id: "pipeline", x: "34%", y: "6%" },
  { id: "types", x: "68%", y: "2%" },
  { id: "graph", x: "0%", y: "30%" },
  { id: "derive", x: "34%", y: "32%" },
  { id: "map", x: "68%", y: "46%", secondary: true },
  { id: "resolve", x: "0%", y: "56%", secondary: true },
  { id: "layout", x: "68%", y: "72%", secondary: true },
  { id: "extract", x: "34%", y: "78%", secondary: true },
  { id: "roles", x: "0%", y: "78%", secondary: true },
];

export interface DemoEdge {
  from: DemoFileId;
  to: DemoFileId;
  kind: DemoEdgeKind;
  path: string;
}

export const DEMO_EDGES = [
  {
    from: "pipeline",
    to: "parse",
    kind: "import",
    path: "M49 12 C40 12, 26 8, 15 8",
  },
  {
    from: "parse",
    to: "extract",
    kind: "import",
    path: "M15 8 C15 40, 15 52, 49 84",
  },
  {
    from: "parse",
    to: "resolve",
    kind: "import",
    path: "M15 8 C12 34, 12 60, 15 62",
  },
  {
    from: "parse",
    to: "graph",
    kind: "import",
    path: "M15 8 C15 18, 15 24, 15 36",
  },
  {
    from: "parse",
    to: "types",
    kind: "type",
    path: "M15 8 C38 8, 60 8, 83 8",
  },
  {
    from: "graph",
    to: "types",
    kind: "type",
    path: "M15 36 C36 30, 62 14, 83 8",
  },
  {
    from: "resolve",
    to: "types",
    kind: "type",
    path: "M15 62 C30 48, 62 24, 83 8",
  },
  {
    from: "extract",
    to: "types",
    kind: "type",
    path: "M49 84 C66 64, 76 30, 83 8",
  },
  {
    from: "derive",
    to: "types",
    kind: "type",
    path: "M49 38 C60 30, 72 16, 83 8",
  },
  {
    from: "map",
    to: "layout",
    kind: "import",
    path: "M83 52 C86 60, 86 70, 83 78",
  },
  {
    from: "map",
    to: "derive",
    kind: "import",
    path: "M83 52 C66 48, 58 42, 49 38",
  },
  {
    from: "roles",
    to: "types",
    kind: "type",
    path: "M15 84 C22 66, 60 34, 83 8",
  },
] as const satisfies readonly DemoEdge[];

export const DEFAULT_SELECTED: DemoFileId = "derive";
