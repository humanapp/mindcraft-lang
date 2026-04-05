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

const UNSUPPORTED_TYPES = new Set([
  "Object",
  "Function",
  "CallableFunction",
  "NewableFunction",
  "IArguments",
  "RegExp",
]);

export function validateAst(sourceFile: ts.SourceFile): CompileDiagnostic[] {
  const diagnostics: CompileDiagnostic[] = [];

  function addDiag(code: ValidatorDiagCode, node: ts.Node, message: string): void {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    diagnostics.push({
      code,
      message,
      severity: "error",
      line: start.line + 1,
      column: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
    });
  }

  function visit(node: ts.Node): void {
    switch (node.kind) {
      case ts.SyntaxKind.ClassExpression:
        addDiag(ValidatorDiagCode.ClassExpressionsNotSupported, node, "Class expressions are not supported");
        return;

      case ts.SyntaxKind.ClassDeclaration:
        validateClassDeclaration(node as ts.ClassDeclaration);
        return;

      case ts.SyntaxKind.WithStatement:
        addDiag(ValidatorDiagCode.WithNotSupported, node, "`with` is not supported");
        return;

      case ts.SyntaxKind.YieldExpression:
        addDiag(ValidatorDiagCode.GeneratorsNotSupported, node, "Generators are not supported");
        break;

      case ts.SyntaxKind.ComputedPropertyName: {
        const expr = (node as ts.ComputedPropertyName).expression;
        const inDestructuring = node.parent && ts.isBindingElement(node.parent);
        if (!inDestructuring && !ts.isStringLiteral(expr) && !ts.isNumericLiteral(expr)) {
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

    if (ts.isImportDeclaration(node)) {
      return;
    }

    if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text)) {
      if (isForbiddenGlobalReference(node)) {
        addDiag(ValidatorDiagCode.ForbiddenGlobalAccess, node, `\`${node.text}\` is not allowed`);
      }
    }

    if (ts.isIdentifier(node) && UNSUPPORTED_TYPES.has(node.text)) {
      if (isUnsupportedTypeReference(node)) {
        addDiag(
          ValidatorDiagCode.UnsupportedTypeReference,
          node,
          `\`${node.text}\` is not supported in the Mindcraft Runtime`
        );
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

  function validateClassDeclaration(node: ts.ClassDeclaration): void {
    if (!node.name) {
      addDiag(ValidatorDiagCode.ClassMustBeNamed, node, "Class declarations must have a name");
    }

    for (const clause of node.heritageClauses ?? []) {
      if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
        addDiag(ValidatorDiagCode.ClassInheritanceNotSupported, clause, "Class inheritance is not supported");
      }
    }

    for (const member of node.members) {
      if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
        addDiag(ValidatorDiagCode.ClassGettersSettersNotSupported, member, "Class getters/setters are not supported");
      }

      if (ts.canHaveModifiers(member)) {
        const modifiers = ts.getModifiers(member);
        if (modifiers) {
          for (const mod of modifiers) {
            if (mod.kind === ts.SyntaxKind.StaticKeyword) {
              addDiag(ValidatorDiagCode.StaticMembersNotSupported, member, "Static class members are not supported");
            }
          }
        }
      }

      if (ts.isPropertyDeclaration(member) || ts.isMethodDeclaration(member)) {
        if (ts.isPrivateIdentifier(member.name)) {
          addDiag(ValidatorDiagCode.PrivateFieldsNotSupported, member, "Private fields (#name) are not supported");
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return diagnostics;
}

function isUnsupportedTypeReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isTypeReferenceNode(parent) && parent.typeName === node) return true;
  if (ts.isExpressionWithTypeArguments(parent) && parent.expression === node) return true;
  return false;
}

// An identifier matching a forbidden global is only actually forbidden when it
// appears as a standalone reference (e.g. `eval(...)` or `const x = Promise`).
// The same name is allowed in non-reference positions like property names,
// parameter names, type references, import specifiers, etc.
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
