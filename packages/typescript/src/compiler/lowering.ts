import { CoreTypeIds, mkNumberValue, mkStringValue, type Value } from "@mindcraft-lang/core/brain";
import ts from "typescript";
import type { IrNode } from "./ir.js";
import type { CompileDiagnostic, ExtractedDescriptor } from "./types.js";

const TRUE_VALUE: Value = { t: 2, v: true };
const FALSE_VALUE: Value = { t: 2, v: false };

export interface LoweringResult {
  ir: IrNode[];
  numParams: number;
  numLocals: number;
  diagnostics: CompileDiagnostic[];
}

interface LowerScope {
  paramsSymbol: ts.Symbol | undefined;
  paramLocals: Map<string, number>;
}

export function lowerOnExecute(descriptor: ExtractedDescriptor, checker: ts.TypeChecker): LoweringResult {
  const diagnostics: CompileDiagnostic[] = [];
  const ir: IrNode[] = [];
  const hasParams = descriptor.params.length > 0;
  const funcNode = descriptor.onExecuteNode;

  const paramLocals = new Map<string, number>();
  let nextLocal = hasParams ? 1 : 0;

  let paramsSymbol: ts.Symbol | undefined;
  if (hasParams) {
    const paramsParam = funcNode.parameters.length >= 2 ? funcNode.parameters[1] : undefined;
    if (paramsParam) {
      paramsSymbol = checker.getSymbolAtLocation(paramsParam.name);
    }

    for (let i = 0; i < descriptor.params.length; i++) {
      const param = descriptor.params[i];
      const localIdx = nextLocal++;
      paramLocals.set(param.name, localIdx);

      ir.push({ kind: "LoadLocal", index: 0 });
      ir.push({ kind: "PushConst", value: mkNumberValue(i) });
      ir.push({ kind: "MapGet" });
      ir.push({ kind: "StoreLocal", index: localIdx });
    }
  }

  const scope: LowerScope = { paramsSymbol, paramLocals };

  const body = funcNode.body;
  if (!body || !ts.isBlock(body)) {
    diagnostics.push({ message: "onExecute function has no body" });
    return { ir, numParams: hasParams ? 1 : 0, numLocals: nextLocal, diagnostics };
  }

  lowerBlock(body, scope, checker, ir, diagnostics);

  return {
    ir,
    numParams: hasParams ? 1 : 0,
    numLocals: nextLocal,
    diagnostics,
  };
}

function lowerBlock(
  block: ts.Block,
  scope: LowerScope,
  checker: ts.TypeChecker,
  ir: IrNode[],
  diags: CompileDiagnostic[]
): void {
  for (const stmt of block.statements) {
    lowerStatement(stmt, scope, checker, ir, diags);
  }
}

function lowerStatement(
  stmt: ts.Statement,
  scope: LowerScope,
  checker: ts.TypeChecker,
  ir: IrNode[],
  diags: CompileDiagnostic[]
): void {
  if (ts.isReturnStatement(stmt)) {
    if (stmt.expression) {
      lowerExpression(stmt.expression, scope, checker, ir, diags);
    }
    ir.push({ kind: "Return" });
  } else if (ts.isExpressionStatement(stmt)) {
    lowerExpression(stmt.expression, scope, checker, ir, diags);
    ir.push({ kind: "Pop" });
  } else {
    diags.push(makeDiag(`Unsupported statement: ${ts.SyntaxKind[stmt.kind]}`, stmt));
  }
}

function lowerExpression(
  expr: ts.Expression,
  scope: LowerScope,
  checker: ts.TypeChecker,
  ir: IrNode[],
  diags: CompileDiagnostic[]
): void {
  if (ts.isNumericLiteral(expr)) {
    ir.push({ kind: "PushConst", value: mkNumberValue(Number(expr.text)) });
  } else if (expr.kind === ts.SyntaxKind.TrueKeyword) {
    ir.push({ kind: "PushConst", value: TRUE_VALUE });
  } else if (expr.kind === ts.SyntaxKind.FalseKeyword) {
    ir.push({ kind: "PushConst", value: FALSE_VALUE });
  } else if (ts.isStringLiteral(expr)) {
    ir.push({ kind: "PushConst", value: mkStringValue(expr.text) });
  } else if (ts.isBinaryExpression(expr)) {
    lowerBinaryExpression(expr, scope, checker, ir, diags);
  } else if (ts.isPropertyAccessExpression(expr)) {
    lowerPropertyAccess(expr, scope, checker, ir, diags);
  } else if (ts.isParenthesizedExpression(expr)) {
    lowerExpression(expr.expression, scope, checker, ir, diags);
  } else if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken) {
    if (ts.isNumericLiteral(expr.operand)) {
      ir.push({ kind: "PushConst", value: mkNumberValue(-Number(expr.operand.text)) });
    } else {
      lowerExpression(expr.operand, scope, checker, ir, diags);
      const fnName = `$$op_neg_${CoreTypeIds.Number}_to_${CoreTypeIds.Number}`;
      ir.push({ kind: "HostCallArgs", fnName, argc: 1 });
    }
  } else {
    diags.push(makeDiag(`Unsupported expression: ${ts.SyntaxKind[expr.kind]}`, expr));
  }
}

function lowerBinaryExpression(
  expr: ts.BinaryExpression,
  scope: LowerScope,
  checker: ts.TypeChecker,
  ir: IrNode[],
  diags: CompileDiagnostic[]
): void {
  const opId = tsOperatorToOpId(expr.operatorToken.kind);
  if (!opId) {
    diags.push(makeDiag(`Unsupported operator: ${ts.SyntaxKind[expr.operatorToken.kind]}`, expr.operatorToken));
    return;
  }

  lowerExpression(expr.left, scope, checker, ir, diags);
  lowerExpression(expr.right, scope, checker, ir, diags);

  const lhsType = checker.getTypeAtLocation(expr.left);
  const rhsType = checker.getTypeAtLocation(expr.right);
  const resultType = checker.getTypeAtLocation(expr);

  const lhsTypeId = tsTypeToTypeId(lhsType);
  const rhsTypeId = tsTypeToTypeId(rhsType);
  const resultTypeId = tsTypeToTypeId(resultType);

  if (!lhsTypeId || !rhsTypeId || !resultTypeId) {
    diags.push(makeDiag("Cannot determine types for binary operator", expr));
    return;
  }

  const fnName = `$$op_${opId}_${lhsTypeId}_${rhsTypeId}_to_${resultTypeId}`;
  ir.push({ kind: "HostCallArgs", fnName, argc: 2 });
}

function lowerPropertyAccess(
  expr: ts.PropertyAccessExpression,
  scope: LowerScope,
  checker: ts.TypeChecker,
  ir: IrNode[],
  diags: CompileDiagnostic[]
): void {
  if (ts.isIdentifier(expr.expression) && scope.paramsSymbol) {
    const objSymbol = checker.getSymbolAtLocation(expr.expression);
    if (objSymbol === scope.paramsSymbol) {
      const paramName = expr.name.text;
      const localIdx = scope.paramLocals.get(paramName);
      if (localIdx !== undefined) {
        ir.push({ kind: "LoadLocal", index: localIdx });
        return;
      }
    }
  }
  diags.push(makeDiag("Unsupported property access", expr));
}

function tsOperatorToOpId(kind: ts.SyntaxKind): string | undefined {
  switch (kind) {
    case ts.SyntaxKind.LessThanToken:
      return "lt";
    case ts.SyntaxKind.GreaterThanToken:
      return "gt";
    case ts.SyntaxKind.LessThanEqualsToken:
      return "le";
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return "ge";
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return "eq";
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return "ne";
    case ts.SyntaxKind.PlusToken:
      return "add";
    case ts.SyntaxKind.MinusToken:
      return "sub";
    case ts.SyntaxKind.AsteriskToken:
      return "mul";
    case ts.SyntaxKind.SlashToken:
      return "div";
    default:
      return undefined;
  }
}

function tsTypeToTypeId(type: ts.Type): string | undefined {
  if (type.flags & ts.TypeFlags.NumberLike) {
    return CoreTypeIds.Number;
  }
  if (type.flags & ts.TypeFlags.BooleanLike) {
    return CoreTypeIds.Boolean;
  }
  if (type.flags & ts.TypeFlags.StringLike) {
    return CoreTypeIds.String;
  }
  return undefined;
}

function makeDiag(message: string, node: ts.Node): CompileDiagnostic {
  const sourceFile = node.getSourceFile();
  const diag: CompileDiagnostic = { message };
  if (sourceFile) {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    diag.line = pos.line + 1;
    diag.column = pos.character + 1;
  }
  return diag;
}
