import type { FileSymbols } from "../language/types.ts";
import type { ExtractedRoute } from "../types.ts";
import type { FrameworkAdapter } from "../adapter.ts";
import { describeModule } from "../adapter.ts";
import { httpMethod, isHttpMethod } from "./helpers.ts";

const FRAMEWORK_BASENAMES: ReadonlySet<string> = new Set([
  "page",
  "layout",
  "route",
  "template",
  "default",
  "loading",
  "error",
  "global-error",
  "not-found",
  "middleware",
  "instrumentation",
]);

function basenameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

function stemOf(path: string): string {
  const basename = basenameOf(path);
  const dot = basename.lastIndexOf(".");
  return dot === -1 ? basename : basename.slice(0, dot);
}

function extensionOf(path: string): string {
  const dot = basenameOf(path).lastIndexOf(".");
  return dot === -1 ? "" : basenameOf(path).slice(dot);
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "." : path.slice(0, slash);
}

function hasServerAction(symbols: FileSymbols): boolean {
  if (symbols.directives.includes("use server")) return true;
  for (const func of symbols.functions) {
    if (func.directives.includes("use server")) return true;
  }
  return false;
}

/**
 * A module whose exports are all hooks, and at least one of them. "Starts with
 * use" alone is not enough: a component file that happens to define a local
 * `useContainerSize` helper is a component, and calling it a hook would put the
 * file in the wrong band. Naming every export as a hook is the signal.
 */
function isHookModule(symbols: FileSymbols): boolean {
  let hooks = 0;
  for (const func of symbols.functions) {
    if (!func.exported) continue;
    if (!func.name.startsWith("use")) return false;
    hooks += 1;
  }
  return hooks > 0;
}

/**
 * The App Router roots in the repository: a directory named `app` that holds a
 * `layout` file at its top. Next.js requires a root layout, so its presence is
 * the signal that this is the directory the conventions apply inside.
 *
 * The conventions are true only there. A `layout.ts` under `lib/` is a layout
 * algorithm, not a page layout, and reading it as one would put a file in the
 * rail under a name that is simply wrong. Nothing is assigned when no root is
 * found: absent beats approximate.
 */
function appRoots(paths: Iterable<string>): ReadonlySet<string> {
  const roots = new Set<string>();
  for (const path of paths) {
    if (stemOf(path) !== "layout") continue;
    const folder = path.split("/").slice(0, -1);
    if (folder[folder.length - 1] !== "app") continue;
    roots.add(folder.join("/"));
  }
  return roots;
}

function underAnyRoot(path: string, roots: ReadonlySet<string>): boolean {
  for (const root of roots) {
    if (path.startsWith(`${root}/`)) return true;
  }
  return false;
}

/**
 * The proxy file sits at the project root or under `src`, never in `app`.
 * Next.js 16 deprecated the `middleware` name in favour of `proxy`; both are
 * still read here, because a repository on either version has the same thing.
 */
function isMiddlewarePath(path: string): boolean {
  const stem = stemOf(path);
  if (stem !== "middleware" && stem !== "proxy") return false;
  const folder = folderOf(path);
  return folder === "." || folder === "src";
}

export const pageAdapter: FrameworkAdapter = {
  name: "nextjs",
  language: "typescript",
  describe(file) {
    return describeModule(file);
  },
  detect(symbols: ReadonlyMap<string, FileSymbols>): boolean {
    for (const path of symbols.keys()) {
      const stem = stemOf(path);
      if (FRAMEWORK_BASENAMES.has(stem)) return true;
      if (basenameOf(path).startsWith("next.config")) return true;
    }
    return false;
  },
  roles(symbols: ReadonlyMap<string, FileSymbols>): Map<string, string> {
    const roots = appRoots(symbols.keys());
    const out = new Map<string, string>();
    for (const [path, symbols_] of symbols) {
      out.set(path, roleOf(path, symbols_, roots));
    }
    return out;
  },
  routes(symbols: ReadonlyMap<string, FileSymbols>): ExtractedRoute[] {
    const roots = appRoots(symbols.keys());
    const routes: ExtractedRoute[] = [];
    for (const [path, symbols_] of symbols) {
      if (stemOf(path) !== "route" || !underAnyRoot(path, roots)) continue;
      const folder = folderOf(path);
      for (const func of symbols_.functions) {
        if (isHttpMethod(func.name)) {
          routes.push({ path: folder, method: httpMethod(func.name) });
        }
      }
    }
    return routes;
  },
};

function roleOf(path: string, symbols: FileSymbols, roots: ReadonlySet<string>): string {
  const stem = stemOf(path);
  // The basenames Next.js reserves are mutually exclusive within the App
  // Router, so these are a partition, not a precedence between rules that could
  // both apply — and they are read only inside an app root.
  if (underAnyRoot(path, roots)) {
    if (stem === "page") return "page";
    if (stem === "layout") return "layout";
    if (stem === "route") return "api";
  }
  if (isMiddlewarePath(path)) return "middleware";
  if (hasServerAction(symbols)) return "server-action";
  if (isHookModule(symbols)) return "hook";
  const extension = extensionOf(path);
  if (extension === ".tsx" || extension === ".jsx") return "component";
  return "other";
}
