import { Node, SyntaxKind, type SourceFile } from "ts-morph";

import type { FileReach, FileRole, ModuleKind } from "./types.ts";

/**
 * Framework knowledge is an adapter, not a branch. The parser asks the adapter
 * what a file is; anything that needs to know what a Next.js route looks like
 * belongs in an adapter of its own, and never in the walking or the parsing.
 *
 * An adapter that decides a role from syntax is handed the source text and the
 * syntax tree the import extractor already built, so the file is parsed once.
 */

export interface FileDescriptor {
  /** Repository-relative, forward slashes. */
  path: string;
  extension: string;
  /** The source the walk already read. */
  source: string;
  /** The tree the import extractor built, absent for non-code files. */
  sourceFile?: SourceFile;
}

export interface ModuleInfo {
  kind: ModuleKind;
  reach: FileReach;
  role: FileRole;
  serverActionCount: number | null;
}

export interface FrameworkAdapter {
  readonly name: string;
  describe(file: FileDescriptor): ModuleInfo;
}

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
  [".avif", "asset"],
  [".ico", "asset"],
  [".bmp", "asset"],
  [".tiff", "asset"],
  [".woff", "asset"],
  [".woff2", "asset"],
  [".ttf", "asset"],
  [".otf", "asset"],
]);

/**
 * Files the framework loads by name rather than by an import. These are
 * recognised from the path alone, because the path is all the descriptor
 * carries. That is a deliberate limit: a bin entry point named in a
 * package.json looks like an ordinary file here, so it is still reported.
 */
const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

const STYLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
]);

const DOC_EXTENSIONS: ReadonlySet<string> = new Set([".md", ".mdx"]);

const ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
  ".tiff",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

/** The package entry, at the root of the tree that was parsed. */
const ROOT_ENTRY_STEMS: ReadonlySet<string> = new Set(["index"]);

/** Route-segment files that are all one role: the layout of a segment. */
const LAYOUT_STEMS: ReadonlySet<string> = new Set([
  "layout",
  "template",
  "default",
  "loading",
  "error",
  "global-error",
  "not-found",
]);

function basenameOf(filePath: string): string {
  const segments = filePath.split("/");
  return segments[segments.length - 1] ?? "";
}

function stemOf(filePath: string, extension: string): string {
  const basename = basenameOf(filePath);
  return extension.length > 0 && basename.endsWith(extension)
    ? basename.slice(0, basename.length - extension.length)
    : basename;
}

function reachOf(file: FileDescriptor): FileReach {
  const segments = file.path.split("/");
  const basename = segments[segments.length - 1];
  const stem = stemOf(file.path, file.extension);

  // Next 16 renamed the middleware convention to proxy. A root or src proxy or
  // middleware is framework-reached; the same name deeper in the tree is not.
  if (
    CODE_EXTENSIONS.has(file.extension) &&
    (stem === "proxy" || stem === "middleware") &&
    (segments.length === 1 || (segments.length === 2 && segments[0] === "src"))
  ) {
    return "framework";
  }
  if (basename.startsWith("next.config")) {
    return "framework";
  }
  // Only the root entry. A nested index.ts is usually a barrel file, and a
  // barrel nothing imports is worth saying out loud.
  if (segments.length === 1 && ROOT_ENTRY_STEMS.has(stem)) {
    return "entrypoint";
  }
  return "none";
}

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

/**
 * The role a file carries with nothing but its name and extension to go on. No
 * framework convention is claimed here: a file this cannot prove is
 * `unclassified`, never guessed into a stronger bucket.
 */
function roleFromName(file: FileDescriptor): FileRole {
  const basename = basenameOf(file.path);
  if (isConfigBasename(basename)) return "config";
  if (STYLE_EXTENSIONS.has(file.extension)) return "style";
  if (DOC_EXTENSIONS.has(file.extension)) return "docs";
  if (ASSET_EXTENSIONS.has(file.extension)) return "asset";
  return "unclassified";
}

/**
 * The syntax half of a role decision, which is not framework knowledge. A
 * component and a hook are proven by the code itself, so they are recognised
 * even when no framework claims the repository. Name-only roles (config, style,
 * asset, docs) still follow, and a file neither proves stays unclassified.
 */
function roleFromSyntax(file: FileDescriptor): FileRole | null {
  if (file.sourceFile === undefined || !CODE_EXTENSIONS.has(file.extension)) return null;
  const functions = exportedFunctions(file.sourceFile);
  if (hasExportedComponent(functions)) return "component";
  if (hasExportedHook(functions)) return "hook";
  return null;
}

/** The adapter used when nothing else claims the repository. */
export const fallbackAdapter: FrameworkAdapter = {
  name: "no-framework",
  describe(file: FileDescriptor): ModuleInfo {
    let role = roleFromName(file);
    try {
      role = roleFromSyntax(file) ?? role;
    } catch {
      // A syntax decision that failed is no role at all; the name-only role
      // stands. The parse continues either way.
    }
    return {
      kind: EXTENSION_KINDS.get(file.extension) ?? "other",
      reach: reachOf(file),
      role,
      serverActionCount: null,
    };
  },
};

function segmentsOf(filePath: string): string[] {
  return filePath.split("/");
}

/** A file inside `app/` or `src/app/`. */
function isUnderAppTree(filePath: string): boolean {
  const segments = segmentsOf(filePath);
  return segments[0] === "app" || (segments[0] === "src" && segments[1] === "app");
}

/** A file under the pages-router API directory, where every file is a handler. */
function isUnderPagesApi(filePath: string): boolean {
  const segments = segmentsOf(filePath);
  const pages = segments[0] === "pages" ? 0 : segments[0] === "src" && segments[1] === "pages" ? 1 : -1;
  return pages !== -1 && segments[pages + 1] === "api" && segments.length > pages + 2;
}

/** Exactly `proxy.*` or `middleware.*` at the root or under `src/`. */
function isRootMiddleware(filePath: string, extension: string): boolean {
  const stem = stemOf(filePath, extension);
  if (stem !== "proxy" && stem !== "middleware") return false;
  const segments = segmentsOf(filePath);
  return segments.length === 1 || (segments.length === 2 && segments[0] === "src");
}

/** The module-level `"use server"` directive, read from the tree, not a regex. */
function isUseServerDirective(node: Node | undefined): boolean {
  if (node === undefined || !Node.isExpressionStatement(node)) return false;
  const expression = node.getExpression();
  return Node.isStringLiteral(expression) && expression.getLiteralValue() === "use server";
}

function moduleIsActionModule(sourceFile: SourceFile): boolean {
  return isUseServerDirective(sourceFile.getStatements()[0]);
}

function isJsx(node: Node | undefined): boolean {
  if (node === undefined) return false;
  if (Node.isParenthesizedExpression(node)) return isJsx(node.getExpression());
  return (
    Node.isJsxElement(node) ||
    Node.isJsxSelfClosingElement(node) ||
    Node.isJsxFragment(node)
  );
}

/** True when a return belongs to this body rather than a nested function. */
function returnBelongsToBody(statement: Node, body: Node): boolean {
  let parent = statement.getParent();
  while (parent !== undefined && parent !== body) {
    if (Node.isFunctionLikeDeclaration(parent)) return false;
    parent = parent.getParent();
  }
  return parent === body;
}

/** True when the function body returns a JSX element or a fragment. */
function returnsJsx(
  body: Node | undefined,
): boolean {
  if (body === undefined) return false;
  if (!Node.isBlock(body)) return isJsx(body);
  for (const statement of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    if (!Node.isReturnStatement(statement)) continue;
    if (returnBelongsToBody(statement, body) && isJsx(statement.getExpression())) {
      return true;
    }
  }
  return false;
}

/** True when a block's first statement is the `"use server"` directive. */
function bodyStartsWithUseServer(body: Node | undefined): boolean {
  if (body === undefined || !Node.isBlock(body)) return false;
  return isUseServerDirective(body.getStatements()[0]);
}

function isHookName(name: string | undefined): boolean {
  return name !== undefined && /^use[A-Z0-9]/.test(name);
}

interface ExportedFunction {
  name: string | undefined;
  isAsync: boolean;
  returnsJsx: boolean;
  startsWithUseServer: boolean;
}

/** Every exported function declaration and exported const arrow, once. */
function exportedFunctions(sourceFile: SourceFile): ExportedFunction[] {
  const functions: ExportedFunction[] = [];

  for (const declaration of sourceFile.getFunctions()) {
    if (!declaration.isExported()) continue;
    const body = declaration.getBody();
    functions.push({
      name: declaration.getName(),
      isAsync: declaration.isAsync(),
      returnsJsx: returnsJsx(body),
      startsWithUseServer: bodyStartsWithUseServer(body),
    });
  }

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const statement = declaration.getVariableStatement();
    if (statement === undefined || !statement.isExported()) continue;
    const initializer = declaration.getInitializer();
    if (initializer === undefined || !Node.isArrowFunction(initializer)) continue;
    const body = initializer.getBody();
    functions.push({
      name: declaration.getName(),
      isAsync: initializer.isAsync(),
      returnsJsx: returnsJsx(body),
      startsWithUseServer: bodyStartsWithUseServer(body),
    });
  }

  return functions;
}

function hasExportedComponent(functions: readonly ExportedFunction[]): boolean {
  return functions.some((fn) => fn.returnsJsx);
}

function hasExportedHook(functions: readonly ExportedFunction[]): boolean {
  return functions.some((fn) => isHookName(fn.name));
}

/**
 * Inline server actions a page hosts: exported async functions whose body opens
 * with the directive. The page stays a page; hosting actions is a capability the
 * pane reports, never a second rail row.
 */
function countServerActions(functions: readonly ExportedFunction[]): number | null {
  const count = functions.filter(
    (fn) => fn.isAsync && fn.startsWithUseServer,
  ).length;
  return count > 0 ? count : null;
}

interface RoleDecision {
  role: FileRole;
  serverActionCount: number | null;
}

function nextRoleOf(file: FileDescriptor): RoleDecision {
  const { sourceFile, extension } = file;
  const isCode = CODE_EXTENSIONS.has(extension);
  const stem = stemOf(file.path, extension);
  const underApp = isUnderAppTree(file.path);

  // Path-only conventions. These are true without a syntax tree, which is what
  // lets a non-code file still be more than `unclassified`.
  if (isCode && underApp && stem === "route") {
    return { role: "route-handler", serverActionCount: null };
  }
  if (isCode && isUnderPagesApi(file.path)) {
    return { role: "route-handler", serverActionCount: null };
  }
  if (isCode && isRootMiddleware(file.path, extension)) {
    return { role: "middleware", serverActionCount: null };
  }
  if (isCode && underApp && stem === "page") {
    const serverActionCount =
      sourceFile === undefined
        ? null
        : countServerActions(exportedFunctions(sourceFile));
    return { role: "page", serverActionCount };
  }
  if (isCode && underApp && LAYOUT_STEMS.has(stem)) {
    return { role: "layout", serverActionCount: null };
  }

  // Syntax conventions. Without a tree there is nothing to prove them from, so
  // the name-only role takes over.
  if (isCode && sourceFile !== undefined) {
    if (moduleIsActionModule(sourceFile)) {
      return { role: "action-module", serverActionCount: null };
    }

    const functions = exportedFunctions(sourceFile);
    if (hasExportedComponent(functions)) {
      return { role: "component", serverActionCount: null };
    }
    if (hasExportedHook(functions)) {
      return { role: "hook", serverActionCount: null };
    }
  }

  return { role: roleFromName(file), serverActionCount: null };
}

/** Reach the Next adapter writes for the role it proved. */
function nextReachOf(file: FileDescriptor, role: FileRole): FileReach {
  const segments = segmentsOf(file.path);
  // Next loads a root instrumentation file by name, not through an import.
  if (segments.length === 1 && stemOf(file.path, file.extension) === "instrumentation") {
    return "framework";
  }
  switch (role) {
    case "page":
    case "layout":
    case "route-handler":
    case "middleware":
      return "framework";
    case "config":
      // Only a root next.config is framework-loaded. A nested config is not.
      return segmentsOf(file.path).length === 1 &&
        basenameOf(file.path).startsWith("next.config")
        ? "framework"
        : "none";
    default:
      return "none";
  }
}

/**
 * Next's conventions. A role is only claimed here when the path or the syntax
 * proves it; a failed decision falls back to the name-only role rather than
 * failing the parse.
 */
export const nextAdapter: FrameworkAdapter = {
  name: "next",
  describe(file: FileDescriptor): ModuleInfo {
    const kind = EXTENSION_KINDS.get(file.extension) ?? "other";
    let decision: RoleDecision;
    try {
      decision = nextRoleOf(file);
    } catch {
      decision = { role: roleFromName(file), serverActionCount: null };
    }
    return {
      kind,
      reach: nextReachOf(file, decision.role),
      role: decision.role,
      serverActionCount: decision.serverActionCount,
    };
  },
};

/** Whether the walked paths carry a root `next.config.*`. */
function hasRootNextConfig(files: readonly { relativePath: string }[]): boolean {
  return files.some(
    (file) =>
      !file.relativePath.includes("/") &&
      basenameOf(file.relativePath).startsWith("next.config"),
  );
}

/** Whether an `app/` or `src/app/` prefix appears anywhere in the walked paths. */
function hasAppTree(files: readonly { relativePath: string }[]): boolean {
  return files.some(
    (file) =>
      file.relativePath.startsWith("app/") || file.relativePath.startsWith("src/app/"),
  );
}

/**
 * Which adapter claims the repository. A Next config or an app tree is enough;
 * nothing else claims it, so the fallback roles apply.
 */
export function selectAdapter(
  files: readonly { relativePath: string }[],
): FrameworkAdapter {
  return hasRootNextConfig(files) || hasAppTree(files) ? nextAdapter : fallbackAdapter;
}
