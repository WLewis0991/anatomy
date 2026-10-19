/**
 * Facts about a file that are true alongside its kind and its role rather than
 * instead of them, decided from the path alone.
 *
 * This is not a framework's business and not a language's: `foo.test.ts`,
 * `test_foo.py` and a `__tests__/` directory are the same fact written three
 * ways, and a repository with no framework at all still has tests. So it lives
 * here, in one pass over every file, rather than in each adapter or each
 * language reader. Where a fact below is only a naming convention, that is the
 * whole truth of it and the name says so.
 */

import type { FileFlag } from "./types.ts";

/** A path a project puts its tests under, whatever the language. */
const TEST_DIRECTORIES: ReadonlySet<string> = new Set([
  "__tests__",
  "test",
  "tests",
  "spec",
]);

/** `foo.test.ts`, `foo.spec.tsx`, `foo.test.py` — a test by its own name. */
const TEST_BASENAME = /\.(?:test|spec)\.[^./]+$/;

/** Python's two spellings, `test_foo.py` and `foo_test.py`. */
const PY_TEST_BASENAME = /^(?:test_.*|.*_test)\.py$/;

/** A fixture or harness, not a test, even when it sits among them. */
const TEST_CONFIG_BASENAME: ReadonlySet<string> = new Set(["conftest.py"]);

function basenameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

function isUnderTestDirectory(path: string): boolean {
  const parts = path.split("/");
  // The file's own name is not a directory, so the last part is dropped.
  return parts.slice(0, -1).some((part) => TEST_DIRECTORIES.has(part));
}

/** Every flag true of a file, from its path alone. */
export function flagsOf(path: string): FileFlag[] {
  const basename = basenameOf(path);
  if (TEST_CONFIG_BASENAME.has(basename)) return [];
  if (
    isUnderTestDirectory(path) ||
    TEST_BASENAME.test(basename) ||
    PY_TEST_BASENAME.test(basename)
  ) {
    return ["test"];
  }
  return [];
}
