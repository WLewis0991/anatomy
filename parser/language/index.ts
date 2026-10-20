/**
 * The language frontends the parser knows how to read, and the helpers that turn
 * a file list into the set of files each frontend owns.
 *
 * A frontend is a language, not a framework: it knows extensions, exclusions,
 * and how to read symbols. No framework's name appears here; recognising one is
 * an adapter's job, and adapters live apart from this file.
 */

import type { LanguageFrontend, ProjectConfig } from "./types.ts";

export type {
  FileSymbols,
  LanguageFrontend,
  FrontendFile,
  ProjectConfig,
} from "./types.ts";
import { pythonFrontend } from "./python-reader.ts";
import { typescriptFrontend } from "./ts-reader.ts";

/** Every frontend, in detection order: language considered before framework. */
export const FRONTENDS: readonly LanguageFrontend[] = [
  typescriptFrontend,
  pythonFrontend,
];

/** The extensions every frontend reads, unioned, so the walk selects them all. */
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(
  [...FRONTENDS].flatMap((frontend) => [...frontend.sourceExtensions]),
);

/** The extensions every frontend excludes, unioned. */
export const EXCLUDED_EXTENSIONS: ReadonlySet<string> = new Set(
  [...FRONTENDS].flatMap((frontend) => [...frontend.excludedExtensions]),
);

/** Directory names every frontend excludes, unioned. */
export const EXCLUDED_DIRECTORIES: readonly string[] = [
  ...new Set([...FRONTENDS].flatMap((frontend) => [...frontend.excludedDirectories])),
];

/** Directory-name suffixes every frontend excludes, unioned. */
export const EXCLUDED_DIRECTORY_SUFFIXES: readonly string[] = [
  ...new Set([...FRONTENDS].flatMap((frontend) => [...frontend.excludedDirectorySuffixes])),
];

/** The frontend that owns a given extension, or null when none does. */
export function frontendFor(extension: string): LanguageFrontend | null {
  for (const frontend of FRONTENDS) {
    if (frontend.sourceExtensions.has(extension)) return frontend;
  }
  return null;
}

/** The language this repository is written in, by the extensions present. */
export function languageFor(
  files: readonly { extension: string }[],
): "typescript" | "python" {
  for (const frontend of FRONTENDS) {
    for (const file of files) {
      if (frontend.sourceExtensions.has(file.extension))
        return frontend.name as "typescript" | "python";
    }
  }
  return "typescript";
}

/** Entry points for seeding a walk, across every frontend. */
export function entryPoints(
  paths: readonly string[],
  config: ProjectConfig,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const frontend of FRONTENDS) {
    for (const path of frontend.entryPoints(paths, config)) out.add(path);
  }
  return out;
}
