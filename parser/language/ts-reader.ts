import * as ts from "typescript";

import type {
  CallSymbol,
  ClassSymbol,
  DecoratorSymbol,
  FileSymbols,
  FrontendFile,
  FrontendReadResult,
  FunctionSymbol,
  LanguageFrontend,
  SymbolArg,
} from "./types.ts";

/** Every file extension TypeScript and JavaScript share. */
export const TYPESCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

function lineOf(node: ts.Node, sourceFile: ts.SourceFile): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/** The dotted name written for an expression: `app.get`, `router.post`, `path`. */
function dottedName(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    return `${dottedName(expression.expression, sourceFile)}.${expression.name.text}`;
  }
  return expression.getText(sourceFile);
}

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1).replace(/\\(["'\\nt])/g, (_match, code) => {
        switch (code) {
          case '"':
            return '"';
          case "'":
            return "'";
          case "\\":
            return "\\";
          case "n":
            return "\n";
          case "t":
            return "\t";
        }
        return code;
      });
    }
  }
  return text;
}

function convertArgument(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): SymbolArg {
  switch (node.kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return { kind: "string", value: unquote((node as ts.LiteralLikeNode).text) };
    case ts.SyntaxKind.ArrayLiteralExpression: {
      const array = node as ts.ArrayLiteralExpression;
      const values: string[] = [];
      for (const element of array.elements) {
        const converted = convertArgument(element, sourceFile);
        if (converted.kind !== "string") return { kind: "other" };
        values.push(converted.value);
      }
      return { kind: "strings", values };
    }
    case ts.SyntaxKind.CallExpression: {
      const call = node as ts.CallExpression;
      return {
        kind: "call",
        callee: dottedName(call.expression, sourceFile),
        args: call.arguments.map((argument) => convertArgument(argument, sourceFile)),
        keywords: {},
      };
    }
    default:
      return { kind: "other" };
  }
}

function convertDecorator(
  decorator: ts.Decorator,
  sourceFile: ts.SourceFile,
): DecoratorSymbol {
  const expression = decorator.expression;
  let callee: string;
  let args: SymbolArg[];
  if (ts.isCallExpression(expression)) {
    callee = dottedName(expression.expression, sourceFile);
    args = expression.arguments.map((argument) => convertArgument(argument, sourceFile));
  } else {
    callee = dottedName(expression, sourceFile);
    args = [];
  }
  return {
    name: callee,
    args,
    keywords: {},
    line: lineOf(expression, sourceFile),
  };
}

/** A decorator line immediately above a statement, unchanged. */
function readDecoratorSymbol(
  decorator: ts.Decorator,
  sourceFile: ts.SourceFile,
): DecoratorSymbol {
  return convertDecorator(decorator, sourceFile);
}

function isStringLiteralStatement(statement: ts.Statement): string | null {
  if (!ts.isExpressionStatement(statement)) return null;
  const expression = statement.expression;
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return unquote((expression as ts.LiteralLikeNode).text);
  }
  return null;
}

/** Leading string-literal statements of a block, pushed onto `target`. */
function collectPrologueDirectives(
  statements: readonly ts.Statement[],
  sourceFile: ts.SourceFile,
  target: string[],
): void {
  for (const statement of statements) {
    const directive = isStringLiteralStatement(statement);
    if (directive === null) return;
    target.push(directive);
  }
}

interface WalkContext {
  sourceFile: ts.SourceFile;
  classes: ClassSymbol[];
  functions: FunctionSymbol[];
  decorators: DecoratorSymbol[];
  calls: CallSymbol[];
  currentClass: ClassSymbol | null;
  currentFunction: FunctionSymbol | null;
  directives: string[];
}

function visitNode(
  node: ts.Node,
  context: WalkContext,
): void {
  switch (node.kind) {
    case ts.SyntaxKind.SourceFile:
      collectPrologueDirectives(
        (node as ts.SourceFile).statements,
        context.sourceFile,
        context.directives,
      );
      for (const statement of (node as ts.SourceFile).statements) {
        visitNode(statement, context);
      }
      return;

    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.ClassExpression: {
      const classDeclaration = node as ts.ClassDeclaration | ts.ClassExpression;
      const name = classDeclaration.name?.text ?? "default";
      const exported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
      const decorators = decoratorsOf(node).map((d) =>
        readDecoratorSymbol(d, context.sourceFile),
      );
      const classSymbol: ClassSymbol = {
        name,
        line: lineOf(node, context.sourceFile),
        exported,
        decorators,
        methods: [],
      };
      context.classes.push(classSymbol);
      if (context.currentClass === null) context.currentClass = classSymbol;
      const previousFunction = context.currentFunction;
      context.currentFunction = null;
      const previousDirectives = context.directives;
      context.directives = [];
      const classBody = classDeclaration.members;
      for (const member of classBody) {
        visitNode(member, context);
      }
      context.currentClass = null;
      context.currentFunction = previousFunction;
      context.directives = previousDirectives;
      return;
    }

    case ts.SyntaxKind.MethodDeclaration: {
      const method = node as ts.MethodDeclaration;
      const name = method.name ? method.name.getText(context.sourceFile) : "method";
      const exported = false;
      const decorators = decoratorsOf(node).map((d) =>
        readDecoratorSymbol(d, context.sourceFile),
      );
      const methodSymbol: FunctionSymbol = {
        name,
        line: lineOf(node, context.sourceFile),
        exported,
        decorators,
        directives: [],
      };
      if (context.currentClass !== null) {
        context.currentClass.methods.push(methodSymbol);
      }
      const previousFunction = context.currentFunction;
      context.currentFunction = methodSymbol;
      const previousDirectives = context.directives;
      context.directives = [];
      if (method.body !== undefined) {
        collectPrologueDirectives(
          method.body.statements,
          context.sourceFile,
          context.directives,
        );
        methodSymbol.directives = [...context.directives];
        for (const statement of method.body.statements) visitNode(statement, context);
      }
      context.currentFunction = previousFunction;
      context.directives = previousDirectives;
      return;
    }

    case ts.SyntaxKind.FunctionDeclaration: {
      const func = node as ts.FunctionDeclaration;
      const name = func.name?.text ?? "default";
      const exported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
      const decorators = decoratorsOf(node).map((d) =>
        readDecoratorSymbol(d, context.sourceFile),
      );
      const functionSymbol: FunctionSymbol = {
        name,
        line: lineOf(node, context.sourceFile),
        exported,
        decorators,
        directives: [],
      };
      context.functions.push(functionSymbol);
      const previousFunction = context.currentFunction;
      context.currentFunction = functionSymbol;
      const previousDirectives = context.directives;
      context.directives = [];
      if (func.body !== undefined) {
        collectPrologueDirectives(
          func.body.statements,
          context.sourceFile,
          context.directives,
        );
        functionSymbol.directives = [...context.directives];
        for (const statement of func.body.statements) visitNode(statement, context);
      }
      context.currentFunction = previousFunction;
      context.directives = previousDirectives;
      return;
    }

    case ts.SyntaxKind.VariableStatement: {
      const statement = node as ts.VariableStatement;
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (initializer === undefined) continue;
        const name = declaration.name.getText(context.sourceFile);
        const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);

        if (
          ts.isArrowFunction(initializer) ||
          ts.isFunctionExpression(initializer)
        ) {
          const func = initializer;
          const functionSymbol: FunctionSymbol = {
            name,
            line: lineOf(declaration, context.sourceFile),
            exported,
            decorators: [],
            directives: [],
          };
          context.functions.push(functionSymbol);
          const previousFunction = context.currentFunction;
          context.currentFunction = functionSymbol;
          const previousDirectives = context.directives;
          context.directives = [];
          const body = func.body;
          if (body !== undefined && ts.isBlock(body)) {
            collectPrologueDirectives(
              body.statements,
              context.sourceFile,
              context.directives,
            );
            functionSymbol.directives = [...context.directives];
            for (const statement of body.statements) visitNode(statement, context);
          } else if (body !== undefined) {
            // Expression body: no prologue directives are possible; capture its calls.
            visitCallExpressionsIn(body, context);
          }
          context.currentFunction = previousFunction;
          context.directives = previousDirectives;
          continue;
        }

        if (ts.isClassExpression(initializer)) {
          const classSymbol: ClassSymbol = {
            name,
            line: lineOf(initializer, context.sourceFile),
            exported,
            decorators: [],
            methods: [],
          };
          context.classes.push(classSymbol);
          const previousClass = context.currentClass;
          context.currentClass = classSymbol;
          const previousFunction = context.currentFunction;
          context.currentFunction = null;
          const previousDirectives = context.directives;
          context.directives = [];
          for (const member of initializer.members) visitNode(member, context);
          context.currentClass = previousClass;
          context.currentFunction = previousFunction;
          context.directives = previousDirectives;
          continue;
        }
      }
      for (const declaration of statement.declarationList.declarations) {
        visitCallExpressionsIn(declaration, context);
      }
      return;
    }

    case ts.SyntaxKind.ExportDeclaration: {
      const declaration = node as ts.ExportDeclaration;
      if (
        declaration.exportClause !== undefined &&
        ts.isNamedExportBindings(declaration.exportClause) &&
        ts.isNamedExports(declaration.exportClause)
      ) {
        for (const specifier of declaration.exportClause.elements) {
          visitCallExpressionsIn(specifier, context);
        }
      }
      return;
    }

    case ts.SyntaxKind.ExportAssignment:
    case ts.SyntaxKind.CallExpression:
      visitCallExpressionsIn(node, context);
      return;

    default:
      for (const child of node.getChildren(context.sourceFile)) {
        visitNode(child, context);
      }
  }
}

/** Collect every call expression reachable from a node, in source order. */
function visitCallExpressionsIn(node: ts.Node, context: WalkContext): void {
  const stack: ts.Node[] = [node];
  while (stack.length > 0) {
    const next = stack.pop() as ts.Node;
    if (ts.isCallExpression(next)) {
      context.calls.push({
        callee: dottedName(next.expression, context.sourceFile),
        args: next.arguments.map((argument) => convertArgument(argument, context.sourceFile)),
        keywords: {},
        line: lineOf(next, context.sourceFile),
      });
    }
    // Push children in reverse so they are visited in source order.
    const children = next.getChildren(context.sourceFile);
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return (node as ts.Node & { decorators?: readonly ts.Decorator[] }).decorators ?? [];
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    (node as ts.Node & { modifiers?: readonly ts.Modifier[] }).modifiers ?? []
  ).some((modifier) => modifier.kind === kind);
}

function readFileSymbols(
  file: FrontendFile,
): { symbols: FileSymbols; failures: FrontendReadResult["failures"] } {
  const sourceFile = ts.createSourceFile(
    file.path,
    file.contents,
    ts.ScriptTarget.Latest,
    true,
  );
  const context: WalkContext = {
    sourceFile,
    classes: [],
    functions: [],
    decorators: [],
    calls: [],
    currentClass: null,
    currentFunction: null,
    directives: [],
  };

  try {
    visitNode(sourceFile, context);
  } catch (error) {
    return {
      symbols: {
        path: file.path,
        directives: [],
        classes: [],
        functions: [],
        decorators: [],
        calls: [],
      },
      failures: [
        {
          path: file.path,
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  return {
    symbols: {
      path: file.path,
      directives: context.directives,
      classes: context.classes,
      functions: context.functions,
      decorators: context.decorators,
      calls: context.calls,
    },
    failures: [],
  };
}

export function readTypeScriptSymbols(
  files: readonly FrontendFile[],
): FrontendReadResult {
  const symbols = new Map<string, FileSymbols>();
  const failures: FrontendReadResult["failures"] = [];

  for (const file of files) {
    const { symbols: fileSymbols, failures: fileFailures } = readFileSymbols(file);
    symbols.set(file.path, fileSymbols);
    failures.push(...fileFailures);
  }

  return { symbols, failures };
}

export const typescriptFrontend: LanguageFrontend = {
  name: "typescript",
  sourceExtensions: TYPESCRIPT_EXTENSIONS,
  excludedExtensions: new Set(),
  excludedDirectories: [],
  excludedDirectorySuffixes: [],
  entryPoints: () => new Set<string>(),
  readSymbols: readTypeScriptSymbols,
};
