import { Node, Project, SyntaxKind, type CallExpression, type SourceFile } from "ts-morph";

import type { ImportKind } from "./types.ts";
import type { DiscoveredFile } from "./walk.ts";

/**
 * Reading imports out of a file with a real TypeScript parser. Four things
 * become an edge: a plain import, a re-export, a dynamic import whose argument
 * is a literal string, and a `require()` call whose argument is a literal
 * string (or a TypeScript `import x = require("...")`).
 *
 * `require()` records are appended after every static, re-export and dynamic
 * record. That ordering is the whole byte-identity mechanism: for a file that
 * mixes an `import` and a `require()` of the same module, the graph's
 * first-wins dedupe lands on the pre-existing static edge.
 *
 * Resolution is not done here. Which files exist is decided by the walk, so the
 * two happen in that order and a specifier without its file yet is the honest
 * starting point.
 */

export interface ExtractedImport {
  from: string;
  specifier: string;
  kind: ImportKind;
  line: number;
  /** Set when there is no specifier to resolve, with the reason. */
  unresolvable?: { reason: "non-literal-specifier"; detail: string };
}

export interface ExtractResult {
  imports: ExtractedImport[];
  failures: Array<{ path: string; detail: string }>;
}

/** Nothing is type-checked or emitted; these only decide what will parse. */
const COMPILER_OPTIONS = { allowJs: true } as const;

export function extractImports(files: readonly DiscoveredFile[]): ExtractResult {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { ...COMPILER_OPTIONS },
  });

  const imports: ExtractedImport[] = [];
  const failures: ExtractResult["failures"] = [];
  const readable: Array<{ file: DiscoveredFile; sourceFile: SourceFile }> = [];

  for (const file of files) {
    let sourceFile: SourceFile;
    try {
      sourceFile = project.createSourceFile(file.relativePath, file.contents);
    } catch (error) {
      failures.push({
        path: file.relativePath,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    readable.push({ file, sourceFile });

    for (const declaration of sourceFile.getImportDeclarations()) {
      imports.push({
        from: file.relativePath,
        specifier: declaration.getModuleSpecifierValue(),
        kind: "static",
        line: lineOf(sourceFile, declaration),
      });
    }

    for (const declaration of sourceFile.getExportDeclarations()) {
      const literal = declaration.getModuleSpecifier();
      if (!literal || !Node.isStringLiteral(literal)) continue;
      imports.push({
        from: file.relativePath,
        specifier: literal.getLiteralValue(),
        kind: "reexport",
        line: lineOf(sourceFile, declaration),
      });
    }

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
      const argument = call.getArguments()[0];
      const literal = literalSpecifierOf(argument);
      imports.push({
        from: file.relativePath,
        specifier:
          literal ?? (argument ? argument.getText().slice(0, 120) : "(no argument)"),
        kind: "dynamic",
        line: lineOf(sourceFile, call),
        ...(literal !== null
          ? {}
          : {
              unresolvable: {
                reason: "non-literal-specifier" as const,
                detail:
                  "the module is worked out at runtime, so there is nothing on disk to point at",
              },
            }),
      });
    }
  }

  // `require()` support, in a pass of its own so every require record lands
  // after all of the above. Only a call whose callee is exactly `require` is
  // read: `module.require` and `require.resolve` are property accesses and are
  // deliberately not, and a locally-shadowed `require` is not the loader.
  for (const { file, sourceFile } of readable) {
    imports.push(...requireImports(file.relativePath, sourceFile));
  }

  return { imports, failures };
}

/** Every `require()`-shaped import in a file, in source order. */
function requireImports(from: string, sourceFile: SourceFile): ExtractedImport[] {
  const found: Array<{ at: number; record: ExtractedImport }> = [];

  // `import x = require("...")` is a require in TypeScript's own syntax.
  for (const declaration of sourceFile.getDescendantsOfKind(
    SyntaxKind.ImportEqualsDeclaration,
  )) {
    const reference = declaration.getModuleReference();
    if (!Node.isExternalModuleReference(reference)) continue;
    const expression = reference.getExpression();
    const line = lineOf(sourceFile, declaration);
    if (Node.isStringLiteral(expression)) {
      found.push({
        at: declaration.getStart(),
        record: { from, specifier: expression.getLiteralValue(), kind: "require", line },
      });
      continue;
    }
    found.push({
      at: declaration.getStart(),
      record: {
        from,
        specifier: expression ? expression.getText().slice(0, 120) : "(no argument)",
        kind: "require",
        line,
        unresolvable: {
          reason: "non-literal-specifier",
          detail:
            "the module is worked out at runtime, so there is nothing on disk to point at",
        },
      },
    });
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isBareRequireCall(call, sourceFile)) continue;
    const argument = call.getArguments()[0];
    const literal = literalSpecifierOf(argument);
    found.push({
      at: call.getStart(),
      record: {
        from,
        specifier:
          literal ?? (argument ? argument.getText().slice(0, 120) : "(no argument)"),
        kind: "require",
        line: lineOf(sourceFile, call),
        ...(literal !== null
          ? {}
          : {
              unresolvable: {
                reason: "non-literal-specifier" as const,
                detail:
                  "the module is worked out at runtime, so there is nothing on disk to point at",
              },
            }),
      },
    });
  }

  found.sort((a, b) => a.at - b.at);
  return found.map((entry) => entry.record);
}

/**
 * Whether a call is `require(...)` and only that: the callee is the bare
 * identifier `require`, and that identifier is not declared in this file. A
 * shadowed `require` is some other function, so nothing is emitted for it —
 * never a false edge. A global `require` resolves to a symbol whose
 * declarations live outside this file, so the check is declaration-location
 * based, not symbol-existence based.
 */
function isBareRequireCall(call: CallExpression, sourceFile: SourceFile): boolean {
  const expression = call.getExpression();
  if (!Node.isIdentifier(expression)) return false;
  if (expression.getText() !== "require") return false;
  const symbol = expression.getSymbol();
  if (symbol === undefined) return true;
  for (const declaration of symbol.getDeclarations()) {
    if (declaration.getSourceFile() === sourceFile) return false;
  }
  return true;
}

function lineOf(sourceFile: SourceFile, node: Node): number {
  return sourceFile.getLineAndColumnAtPos(node.getStart()).line;
}

/**
 * The module as written, or null when there is no value to take because the
 * argument is worked out at runtime. A literal is unwrapped, because the quotes
 * are syntax and a specifier carrying them resolves to nothing.
 */
function literalSpecifierOf(argument: Node | undefined): string | null {
  if (argument === undefined) return null;
  if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.getLiteralValue();
  }
  return null;
}
