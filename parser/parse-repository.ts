import { stat, readFile } from "node:fs/promises";
import path from "node:path";

import { classifyFile, describeModule, type FrameworkAdapter } from "./adapter.ts";
import { extractImports } from "./extract-imports.ts";
import { extractPythonImports } from "./extract-python-imports.ts";
import { flagsOf } from "./flags.ts";
import { countDegree, edgesFromRecords, summariseCoverage } from "./graph.ts";
import { createResolver } from "./resolve.ts";
import { createPythonResolver } from "./resolve-python.ts";
import type {
  ExtractedRoute,
  FileReach,
  ImportRecord,
  ParseResult,
  ParsedFile,
  SkippedFile,
} from "./types.ts";
import { walkRepository, DEFAULT_IGNORED_DIRECTORIES } from "./walk.ts";
import type { WalkOptions, DiscoveredFile } from "./walk.ts";
import {
  SOURCE_EXTENSIONS,
  languageFor,
  entryPoints,
  frontendFor,
  type FileSymbols,
  type LanguageFrontend,
  type FrontendFile,
  type ProjectConfig,
} from "./language/index.ts";
import { TYPESCRIPT_EXTENSIONS } from "./language/ts-reader.ts";
import { PYTHON_EXTENSIONS, PYTHON_EXCLUDED_EXTENSIONS } from "./language/python-reader.ts";
import { detectAdapter } from "./adapters/index.ts";

/**
 * The whole parser: a directory path in, data out. Nothing here imports a web
 * framework, a UI library or a database client, so it runs from a plain script
 * with nothing else started.
 */

export interface ParseOptions {
  root: string;
  adapter?: FrameworkAdapter;
}

const PYTHON_CONFIG_FILE = "pyproject.toml";

export async function parseRepository(options: ParseOptions): Promise<ParseResult> {
  const root = path.resolve(options.root);
  const rootStats = await stat(root);
  if (!rootStats.isDirectory()) {
    throw new Error(`${root} is not a directory`);
  }

  // Python's structural exclusions are named, not discovered.
  const walkOptions: WalkOptions = {
    sourceExtensions: SOURCE_EXTENSIONS,
    excludedExtensions: PYTHON_EXCLUDED_EXTENSIONS,
    ignoredDirectories: new Map([
      ...DEFAULT_IGNORED_DIRECTORIES.entries(),
      ["venv", "python virtual environment"],
      [".venv", "python virtual environment"],
      [".tox", "python test environment"],
      [".mypy_cache", "python type cache"],
      [".pytest_cache", "python test cache"],
      ["site-packages", "installed dependencies, not the repository's own code"],
      ["__pypackages__", "python package directory"],
      ["build", "build output"],
      ["dist", "build output"],
    ]),
    ignoredDirectorySuffixes: new Map([
      [".egg-info", "python package metadata"],
    ]),
  };
  const walk = await walkRepository(root, walkOptions);
  const skipped: SkippedFile[] = [...walk.skipped];

  // Read pyproject.toml directly: it is not a source extension so it is not in
  // the file list, but entry points named in it seed the walk.
  let pyproject: string | null = null;
  try {
    pyproject = await readFile(path.join(root, PYTHON_CONFIG_FILE), "utf8");
  } catch {
    // No pyproject.toml: entry points fall back to the fixed filenames.
  }
  const config: ProjectConfig = { pyproject };

  // Extraction first, for TypeScript/JavaScript files only. ts-morph cannot
  // parse Python, and a Python repository must not change the TS/JS graph.
  const tsFiles = walk.files.filter((file) =>
    TYPESCRIPT_EXTENSIONS.has(file.extension),
  );
  const { imports, failures: importFailures, sourceFiles } = extractImports(tsFiles);
  const failedPaths = new Set<string>();
  for (const failure of importFailures) {
    failedPaths.add(failure.path);
    skipped.push({
      path: failure.path,
      reason: "parse-failed",
      detail: failure.detail,
    });
  }

  // Python imports, read structurally by the Python reader's own lexer. These
  // are resolved against Python's rules below and appended after the TS records,
  // so a TypeScript repository's edge list does not move.
  const pythonFiles = walk.files.filter((file) => PYTHON_EXTENSIONS.has(file.extension));
  const { imports: pythonImports, failures: pythonFailures } =
    extractPythonImports(pythonFiles);
  for (const failure of pythonFailures) {
    failedPaths.add(failure.path);
    skipped.push({
      path: failure.path,
      reason: "parse-failed",
      detail: failure.detail,
    });
  }

  // Group the walked files by the language frontend that owns their extension,
  // then read each group's symbols. Python's reader is structural and reads no
  // imports; the module graph is the next phase.
  const byFrontend = new Map<LanguageFrontend, FrontendFile[]>();
  for (const file of walk.files) {
    const frontend = frontendFor(file.extension);
    if (frontend === null) continue;
    const frontendFile = toFrontendFile(file);
    const group = byFrontend.get(frontend);
    if (group === undefined) {
      byFrontend.set(frontend, [frontendFile]);
    } else {
      group.push(frontendFile);
    }
  }

  const symbols = new Map<string, FileSymbols>();
  for (const [frontend, files] of byFrontend) {
    const { symbols: fileSymbols, failures } = frontend.readSymbols(files);
    for (const failure of failures) {
      failedPaths.add(failure.path);
      skipped.push({
        path: failure.path,
        reason: "parse-failed",
        detail: failure.detail,
      });
    }
    for (const [path, fileSymbols_] of fileSymbols) {
      symbols.set(path, fileSymbols_);
    }
  }

  const parsed = walk.files.filter((file) => !failedPaths.has(file.relativePath));

  // Detection: language considered before framework, first match wins.
  const language = languageFor(parsed);
  const adapter = options.adapter ?? detectAdapter(symbols, language);

  const entryPointPaths = entryPoints(
    parsed.map((file) => file.relativePath),
    config,
  );

  const files: ParsedFile[] = parsed.map((file) => {
    const described = describeModule({
      path: file.relativePath,
      extension: file.extension,
    });
    const sourceFile = sourceFiles.get(file.relativePath);
    const classification = classifyFile(
      {
        path: file.relativePath,
        extension: file.extension,
        ...(sourceFile !== undefined ? { sourceFile } : {}),
      },
      adapter.name === "nextjs",
    );
    let reach: FileReach = classification.reach;
    // Python entry points seed the walk; when none match, whole directories
    // are walked and reach stays "none".
    if (
      PYTHON_EXTENSIONS.has(file.extension) &&
      reach === "none" &&
      entryPointPaths.has(file.relativePath)
    ) {
      reach = "entrypoint";
    }
    return {
      path: file.relativePath,
      folder: file.folder,
      extension: file.extension,
      kind: described.kind,
      reach,
      role: classification.role,
      serverActionCount: classification.serverActionCount,
      lines: file.lines,
      bytes: file.bytes,
      hash: file.hash,
      flags: flagsOf(file.relativePath),
    };
  });

  const known = new Set(files.map((file) => file.path));
  const skippedByPath = new Map(skipped.map((file) => [file.path, file]));

  const resolver = await createResolver(root, known, skippedByPath);
  const pythonResolver = await createPythonResolver({
    known,
    skipped: skippedByPath,
    ignoredDirectories: walkOptions.ignoredDirectories,
    ignoredDirectorySuffixes: walkOptions.ignoredDirectorySuffixes,
  });

  const records: ImportRecord[] = [];
  for (const found of imports) {
    records.push({
      from: found.from,
      specifier: found.specifier,
      kind: found.kind,
      line: found.line,
      resolution: found.unresolvable
        ? { outcome: "unresolved", ...found.unresolvable }
        : await resolver.resolve(found.from, found.specifier),
    });
  }
  for (const found of pythonImports) {
    records.push({
      from: found.from,
      specifier: found.specifier,
      kind: found.kind,
      line: found.line,
      resolution: await pythonResolver.resolve(found),
    });
  }

  const edges = edgesFromRecords(records);

  const routes: ExtractedRoute[] = adapter.routes(symbols);

  return {
    version: 1,
    root,
    generatedAt: new Date().toISOString(),
    adapter: adapter.name,
    frontend: language,
    files,
    edges,
    fanIn: countDegree(files, edges, "to"),
    fanOut: countDegree(files, edges, "from"),
    coverage: summariseCoverage(
      files,
      records,
      edges,
      skipped,
      walk.ignoredDirectories,
    ),
    routes,
  };
}

function toFrontendFile(file: DiscoveredFile): FrontendFile {
  return {
    path: file.relativePath,
    extension: file.extension,
    contents: file.contents,
  };
}
