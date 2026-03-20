import ts from "typescript";
import type { CompileDiagnostic } from "./types.js";

const FORBIDDEN_GLOBALS = new Set([
  "eval",
  "Function",
  "Proxy",
  "Reflect",
  "globalThis",
  "window",
  "document",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "WeakMap",
  "WeakSet",
  "Symbol",
  "Promise",
  "arguments",
]);

export function validateAst(sourceFile: ts.SourceFile): CompileDiagnostic[] {
  const diagnostics: CompileDiagnostic[] = [];

  function addDiag(node: ts.Node, message: string): void {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    diagnostics.push({
      message,
      line: pos.line + 1,
      column: pos.character + 1,
    });
  }

  function visit(node: ts.Node): void {
    switch (node.kind) {
      case ts.SyntaxKind.ClassDeclaration:
      case ts.SyntaxKind.ClassExpression:
        addDiag(node, "Classes are not supported");
        return;

      case ts.SyntaxKind.EnumDeclaration:
        addDiag(node, "Enums are not supported");
        return;

      case ts.SyntaxKind.ForInStatement:
        addDiag(node, "`for...in` is not supported, use `for...of` instead");
        break;

      case ts.SyntaxKind.WithStatement:
        addDiag(node, "`with` is not supported");
        return;

      case ts.SyntaxKind.SwitchStatement:
        addDiag(node, "`switch` is not supported");
        break;

      case ts.SyntaxKind.YieldExpression:
        addDiag(node, "Generators are not supported");
        break;

      case ts.SyntaxKind.ComputedPropertyName: {
        const expr = (node as ts.ComputedPropertyName).expression;
        if (!ts.isStringLiteral(expr) && !ts.isNumericLiteral(expr)) {
          addDiag(node, "Computed property names are not supported");
        }
        break;
      }

      case ts.SyntaxKind.DebuggerStatement:
        addDiag(node, "`debugger` is not supported");
        break;

      case ts.SyntaxKind.LabeledStatement:
        addDiag(node, "Labeled statements are not supported");
        break;

      case ts.SyntaxKind.DeleteExpression:
        addDiag(node, "`delete` is not supported");
        break;

      case ts.SyntaxKind.RegularExpressionLiteral:
        addDiag(node, "Regular expressions are not supported");
        break;
    }

    if (ts.isVariableDeclarationList(node)) {
      if (!(node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
        addDiag(node, "`var` is not allowed, use `let` or `const`");
      }
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      addDiag(node, "Dynamic `import()` is not supported");
    }

    if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text)) {
      if (isForbiddenGlobalReference(node)) {
        addDiag(node, `\`${node.text}\` is not allowed`);
      }
    }

    if (ts.canHaveDecorators(node)) {
      const decorators = ts.getDecorators(node);
      if (decorators && decorators.length > 0) {
        addDiag(decorators[0], "Decorators are not supported");
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return diagnostics;
}

function isForbiddenGlobalReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;

  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent)) return false;
  if (ts.isExportSpecifier(parent)) return false;
  if (ts.isTypeReferenceNode(parent)) return false;
  if (ts.isInterfaceDeclaration(parent) && parent.name === node) return false;
  if (ts.isTypeAliasDeclaration(parent) && parent.name === node) return false;

  return true;
}
