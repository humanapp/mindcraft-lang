import ts from "typescript";
import { ValidatorDiagCode } from "./diag-codes.js";
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

  function addDiag(code: ValidatorDiagCode, node: ts.Node, message: string): void {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    diagnostics.push({
      code,
      message,
      line: pos.line + 1,
      column: pos.character + 1,
    });
  }

  function visit(node: ts.Node): void {
    switch (node.kind) {
      case ts.SyntaxKind.ClassDeclaration:
      case ts.SyntaxKind.ClassExpression:
        addDiag(ValidatorDiagCode.ClassesNotSupported, node, "Classes are not supported");
        return;

      case ts.SyntaxKind.EnumDeclaration:
        addDiag(ValidatorDiagCode.EnumsNotSupported, node, "Enums are not supported");
        return;

      case ts.SyntaxKind.ForInStatement:
        addDiag(ValidatorDiagCode.ForInNotSupported, node, "`for...in` is not supported, use `for...of` instead");
        break;

      case ts.SyntaxKind.WithStatement:
        addDiag(ValidatorDiagCode.WithNotSupported, node, "`with` is not supported");
        return;

      case ts.SyntaxKind.SwitchStatement:
        addDiag(ValidatorDiagCode.SwitchNotSupported, node, "`switch` is not supported");
        break;

      case ts.SyntaxKind.YieldExpression:
        addDiag(ValidatorDiagCode.GeneratorsNotSupported, node, "Generators are not supported");
        break;

      case ts.SyntaxKind.ComputedPropertyName: {
        const expr = (node as ts.ComputedPropertyName).expression;
        if (!ts.isStringLiteral(expr) && !ts.isNumericLiteral(expr)) {
          addDiag(
            ValidatorDiagCode.ComputedPropertyNamesNotSupported,
            node,
            "Computed property names are not supported"
          );
        }
        break;
      }

      case ts.SyntaxKind.DebuggerStatement:
        addDiag(ValidatorDiagCode.DebuggerNotSupported, node, "`debugger` is not supported");
        break;

      case ts.SyntaxKind.LabeledStatement:
        addDiag(ValidatorDiagCode.LabeledStatementsNotSupported, node, "Labeled statements are not supported");
        break;

      case ts.SyntaxKind.DeleteExpression:
        addDiag(ValidatorDiagCode.DeleteNotSupported, node, "`delete` is not supported");
        break;

      case ts.SyntaxKind.RegularExpressionLiteral:
        addDiag(ValidatorDiagCode.RegularExpressionsNotSupported, node, "Regular expressions are not supported");
        break;
    }

    if (ts.isVariableDeclarationList(node)) {
      if (!(node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
        addDiag(ValidatorDiagCode.VarNotAllowed, node, "`var` is not allowed, use `let` or `const`");
      }
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      addDiag(ValidatorDiagCode.DynamicImportNotSupported, node, "Dynamic `import()` is not supported");
    }

    if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text)) {
      if (isForbiddenGlobalReference(node)) {
        addDiag(ValidatorDiagCode.ForbiddenGlobalAccess, node, `\`${node.text}\` is not allowed`);
      }
    }

    if (ts.canHaveDecorators(node)) {
      const decorators = ts.getDecorators(node);
      if (decorators && decorators.length > 0) {
        addDiag(ValidatorDiagCode.DecoratorsNotSupported, decorators[0], "Decorators are not supported");
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
