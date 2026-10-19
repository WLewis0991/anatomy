import type { ExtractedImport } from "./extract-imports.ts";
import { logicalLines } from "./language/python-reader.ts";
import type { DiscoveredFile } from "./walk.ts";

/**
 * Reading imports out of Python source. No third-party or framework knowledge:
 * `import a`, `import a.b as x`, `import a, b`, `from a.b import x, y`,
 * `from . import x`, `from ..pkg import y` and `from a import *` are the whole
 * grammar read here. An import inside `try/except ImportError` is a real import
 * like any other, so it is read too.
 *
 * Lines are split by the Python reader's own logical-line lexer, reused rather
 * than re-implemented, so `from a import (x, y)` spanning a bracket is one line.
 *
 * The record extends the TypeScript extractor's shape with the names a `from`
 * import brings in. It carries no resolver-facing detail beyond that; which file
 * a specifier points at is the resolver's business.
 */

export interface PythonExtractedImport extends ExtractedImport {
  /**
   * The names a `from ... import` brings in, with aliases dropped and `*` kept
   * as-is. Absent for a plain `import`, which names no separate names.
   */
  importedNames?: string[];
}

export interface PythonExtractResult {
  imports: PythonExtractedImport[];
  failures: Array<{ path: string; detail: string }>;
}

const FROM_IMPORT = /^from\s+([.\w]+)\s+import\s+(.+)$/;
const PLAIN_IMPORT = /^import\s+(.+)$/;

export function extractPythonImports(files: readonly DiscoveredFile[]): PythonExtractResult {
  const imports: PythonExtractedImport[] = [];
  const failures: PythonExtractResult["failures"] = [];

  for (const file of files) {
    let lines: Array<{ text: string; startLine: number }>;
    try {
      lines = logicalLines(file.contents);
    } catch (error) {
      failures.push({
        path: file.relativePath,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const { text, startLine } of lines) {
      const from = FROM_IMPORT.exec(text);
      if (from !== null) {
        imports.push({
          from: file.relativePath,
          specifier: from[1],
          kind: "static",
          line: startLine,
          importedNames: parseNames(from[2]),
        });
        continue;
      }

      const plain = PLAIN_IMPORT.exec(text);
      if (plain === null) continue;
      for (const importedModule of parseImportedModules(plain[1])) {
        imports.push({
          from: file.relativePath,
          specifier: importedModule,
          kind: "static",
          line: startLine,
        });
      }
    }
  }

  return { imports, failures };
}

/**
 * The dotted module names of a plain `import` clause, excluding aliases. One
 * clause can name several: `import a.b as c, d` is two modules.
 */
function parseImportedModules(clause: string): string[] {
  const out: string[] = [];
  for (const part of clause.split(",")) {
    const name = part.trim().replace(/\s+as\s+.*$/, "").trim();
    if (name.length > 0) out.push(name);
  }
  return out;
}

/**
 * The names of a `from ... import` clause. A single wrapping paren pair is
 * stripped, aliases are dropped, and an empty trailing entry from a trailing
 * comma disappears. `*` is kept: it is what the statement names.
 */
function parseNames(clause: string): string[] {
  let text = clause.trim();
  if (text.startsWith("(") && text.endsWith(")")) text = text.slice(1, -1);
  const out: string[] = [];
  for (const part of text.split(",")) {
    const name = part.trim().replace(/\s+as\s+.*$/, "").trim();
    if (name.length > 0) out.push(name);
  }
  return out;
}
