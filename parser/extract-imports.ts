import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";

import type { ImportKind } from "./types.ts";
import type { DiscoveredFile } from "./walk.ts";

/**
 * Reading imports out of a file with a real TypeScript parser. Three things
 * become an edge: a plain import, a re-export, and a dynamic import whose
 * argument is a literal string. `require()` is deliberately not read here.
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

  return { imports, failures };
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