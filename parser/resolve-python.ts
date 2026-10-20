import type { Resolution, SkippedFile } from "./types.ts";

/**
 * Turning a Python import into a file on disk, by Python's own rules. No
 * framework knowledge: nothing here knows what a Django view is.
 *
 * Everything is computed from the set of files the walk already found, so this
 * reads no filesystem. A directory is a package when it holds an `__init__.py`;
 * a module when a matching `.py` file exists; a namespace package when the
 * directory exists without one. A package beats a module when both exist.
 *
 * The output is the shared `Resolution`, so the graph and coverage layers treat
 * a Python import and a TypeScript import the same way once resolved.
 */

export interface PythonImportInput {
  /** Repository-relative, forward slashes. */
  from: string;
  /** Exactly what was written after `import` or `from`. */
  specifier: string;
  /** The names a `from ... import` brings in, aliases dropped, `*` kept. */
  importedNames?: readonly string[];
}

export interface PythonResolver {
  resolve(imported: PythonImportInput): Promise<Resolution>;
}

export interface PythonResolverOptions {
  /** Repository-relative paths that became nodes in the graph. */
  known: ReadonlySet<string>;
  /** Repository-relative paths the walk skipped, mapped to why. */
  skipped: ReadonlyMap<string, SkippedFile>;
  /** Ignored directory names, mapped to the reason each is ignored. */
  ignoredDirectories: ReadonlyMap<string, string>;
  /** Ignored directory-name suffixes, mapped to their reason. */
  ignoredDirectorySuffixes: ReadonlyMap<string, string>;
}

function initPath(directory: string): string {
  return directory.length === 0 ? "__init__.py" : `${directory}/__init__.py`;
}

/** Every ancestor directory of a file path, outermost first. */
function parentDirectories(file: string): string[] {
  const parts = file.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(0, i).join("/"));
  return out;
}

export async function createPythonResolver(
  options: PythonResolverOptions,
): Promise<PythonResolver> {
  const { known, skipped, ignoredDirectories, ignoredDirectorySuffixes } = options;

  // Files present on disk as far as the walk saw them: parsed nodes plus the
  // ones it skipped. A skipped file still makes its directory exist, which is
  // what namespace detection turns on.
  const present = new Set<string>(known);
  for (const path of skipped.keys()) present.add(path);

  const packages = new Set<string>();
  const directories = new Set<string>([""]);
  for (const file of present) {
    if (file === "__init__.py" || file.endsWith("/__init__.py")) {
      packages.add(file.slice(0, file.length - "__init__.py".length).replace(/\/$/, ""));
    }
    for (const directory of parentDirectories(file)) directories.add(directory);
  }

  function isNamespacePackage(directory: string): boolean {
    return directory.length > 0 && directories.has(directory) && !packages.has(directory);
  }

  /** The reason a path sits inside an ignored directory, or undefined. */
  function ignoredReason(relPath: string): string | undefined {
    const segments = relPath.split("/").slice(0, -1);
    for (const segment of segments) {
      const named = ignoredDirectories.get(segment);
      if (named !== undefined) return named;
      for (const [suffix, reason] of ignoredDirectorySuffixes) {
        if (segment.endsWith(suffix)) return reason;
      }
    }
    return undefined;
  }

  function classify(relPath: string): Resolution | undefined {
    const ignored = ignoredReason(relPath);
    if (ignored !== undefined) {
      return {
        outcome: "excluded",
        detail: `${relPath} is inside an ignored directory (${ignored})`,
      };
    }
    if (known.has(relPath)) return { outcome: "internal", to: relPath };
    const skip = skipped.get(relPath);
    if (skip !== undefined) {
      return {
        outcome: "excluded",
        detail: `on disk, but not a node: ${skip.reason}${
          skip.detail.length > 0 ? ` (${skip.detail})` : ""
        }`,
      };
    }
    return undefined;
  }

  /** Resolve a slash path to a package's `__init__.py` or a `.py` module. */
  function resolveModulePath(base: string): Resolution | undefined {
    const asPackage = classify(initPath(base));
    if (asPackage !== undefined) return asPackage;
    if (base.length > 0) {
      const asModule = classify(`${base}.py`);
      if (asModule !== undefined) return asModule;
    }
    return undefined;
  }

  function resolveTarget(
    target: string,
    importedNames: readonly string[] | undefined,
    relative: boolean,
  ): Resolution {
    // `from a.b import x` prefers a real a/b/x module over the a.b package. A
    // `*` names nothing, so it is skipped and the base package is used.
    if (importedNames !== undefined) {
      for (const name of importedNames) {
        if (name === "*") continue;
        const candidate = target.length === 0 ? name : `${target}/${name}`;
        const resolution = resolveModulePath(candidate);
        if (resolution !== undefined) return resolution;
      }
    }

    const direct = resolveModulePath(target);
    if (direct !== undefined) return direct;

    if (isNamespacePackage(target)) {
      return {
        outcome: "unresolved",
        reason: "namespace-package",
        detail: `${target} is a directory with no __init__.py (a namespace package), so there is no file to point at`,
      };
    }

    if (relative) {
      return {
        outcome: "unresolved",
        reason: "file-not-found",
        detail: `no module at ${target.length === 0 ? "the importing package" : target}`,
      };
    }

    return {
      outcome: "external",
      detail: `not in the repository, treated as an external module (${target.replace(/\//g, ".")})`,
    };
  }

  return {
    async resolve(imported): Promise<Resolution> {
      const { specifier } = imported;

      if (specifier.length === 0) {
        return {
          outcome: "unresolved",
          reason: "empty-specifier",
          detail: "an import statement with no specifier",
        };
      }

      const leadingDots = /^\.+/.exec(specifier)?.[0] ?? "";
      if (leadingDots.length > 0) {
        const rest = specifier.slice(leadingDots.length);
        const parts = parentDirectories(imported.from);
        let climb = leadingDots.length - 1;
        while (climb > 0) {
          if (parts.length === 0) {
            return {
              outcome: "unresolved",
              reason: "beyond-root",
              detail: `relative import ${specifier} climbs above the repository root`,
            };
          }
          parts.pop();
          climb -= 1;
        }
        const restParts = rest.length === 0 ? [] : rest.split(".");
        const base = parts.length > 0 ? parts[parts.length - 1] : "";
        const target = [base, ...restParts].filter(Boolean).join("/");
        return resolveTarget(target, imported.importedNames, true);
      }

      const target = specifier.split(".").join("/");
      return resolveTarget(target, imported.importedNames, false);
    },
  };
}
