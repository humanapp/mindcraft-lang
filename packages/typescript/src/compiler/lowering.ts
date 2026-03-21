import { CoreOpId, CoreTypeIds, mkNumberValue, mkStringValue, type Value } from "@mindcraft-lang/core/brain";
import ts from "typescript";
import type { IrNode } from "./ir.js";
import { ScopeStack } from "./scope.js";
import type { CompileDiagnostic, ExtractedDescriptor } from "./types.js";

const TRUE_VALUE: Value = { t: 2, v: true };
const FALSE_VALUE: Value = { t: 2, v: false };

export interface LoweringResult {
  ir: IrNode[];
  numParams: number;
  numLocals: number;
  diagnostics: CompileDiagnostic[];
}

interface LoopContext {
  continueLabel: number;
  breakLabel: number;
}

interface LowerContext {
  checker: ts.TypeChecker;
  paramsSymbol: ts.Symbol | undefined;
  paramLocals: Map<string, number>;
  scopeStack: ScopeStack;
  ir: IrNode[];
  diagnostics: CompileDiagnostic[];
  loopStack: LoopContext[];
  nextLabelId: number;
  resolveOperator: (opId: string, argTypes: string[]) => string | undefined;
}

function allocLabel(ctx: LowerContext): number {
  return ctx.nextLabelId++;
}

export function lowerOnExecute(
  descriptor: ExtractedDescriptor,
  checker: ts.TypeChecker,
  resolveOperator: (opId: string, argTypes: string[]) => string | undefined
): LoweringResult {
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

  const scopeStack = new ScopeStack(nextLocal);

  const ctx: LowerContext = {
    checker,
    paramsSymbol,
    paramLocals,
    scopeStack,
    ir,
    diagnostics,
    loopStack: [],
    nextLabelId: 0,
    resolveOperator,
  };

  const body = funcNode.body;
  if (!body || !ts.isBlock(body)) {
    diagnostics.push({ message: "onExecute function has no body" });
    return { ir, numParams: hasParams ? 1 : 0, numLocals: scopeStack.nextLocal, diagnostics };
  }

  lowerStatements(body.statements, ctx);

  ir.push({ kind: "Return" });

  return {
    ir,
    numParams: hasParams ? 1 : 0,
    numLocals: scopeStack.nextLocal,
    diagnostics,
  };
}

function lowerStatements(stmts: ts.NodeArray<ts.Statement>, ctx: LowerContext): void {
  for (const stmt of stmts) {
    lowerStatement(stmt, ctx);
  }
}

function lowerStatement(stmt: ts.Statement, ctx: LowerContext): void {
  if (ts.isReturnStatement(stmt)) {
    if (stmt.expression) {
      lowerExpression(stmt.expression, ctx);
    }
    ctx.ir.push({ kind: "Return" });
  } else if (ts.isExpressionStatement(stmt)) {
    lowerExpression(stmt.expression, ctx);
    ctx.ir.push({ kind: "Pop" });
  } else if (ts.isVariableStatement(stmt)) {
    lowerVariableDeclarationList(stmt.declarationList, ctx);
  } else if (ts.isIfStatement(stmt)) {
    lowerIfStatement(stmt, ctx);
  } else if (ts.isWhileStatement(stmt)) {
    lowerWhileStatement(stmt, ctx);
  } else if (ts.isForStatement(stmt)) {
    lowerForStatement(stmt, ctx);
  } else if (ts.isBlock(stmt)) {
    ctx.scopeStack.pushScope();
    lowerStatements(stmt.statements, ctx);
    ctx.scopeStack.popScope();
  } else if (ts.isBreakStatement(stmt)) {
    lowerBreakStatement(stmt, ctx);
  } else if (ts.isContinueStatement(stmt)) {
    lowerContinueStatement(stmt, ctx);
  } else if (stmt.kind === ts.SyntaxKind.EmptyStatement) {
    // no-op
  } else {
    ctx.diagnostics.push(makeDiag(`Unsupported statement: ${ts.SyntaxKind[stmt.kind]}`, stmt));
  }
}

function lowerVariableDeclarationList(declList: ts.VariableDeclarationList, ctx: LowerContext): void {
  for (const decl of declList.declarations) {
    if (!ts.isIdentifier(decl.name)) {
      ctx.diagnostics.push(makeDiag("Destructuring is not supported", decl));
      continue;
    }
    const localIdx = ctx.scopeStack.declareLocal(decl.name.text);
    if (decl.initializer) {
      lowerExpression(decl.initializer, ctx);
      ctx.ir.push({ kind: "StoreLocal", index: localIdx });
    }
  }
}

function lowerIfStatement(stmt: ts.IfStatement, ctx: LowerContext): void {
  lowerExpression(stmt.expression, ctx);

  if (stmt.elseStatement) {
    const elseLabel = allocLabel(ctx);
    const endLabel = allocLabel(ctx);

    ctx.ir.push({ kind: "JumpIfFalse", labelId: elseLabel });
    lowerStatement(stmt.thenStatement, ctx);
    ctx.ir.push({ kind: "Jump", labelId: endLabel });
    ctx.ir.push({ kind: "Label", labelId: elseLabel });
    lowerStatement(stmt.elseStatement, ctx);
    ctx.ir.push({ kind: "Label", labelId: endLabel });
  } else {
    const endLabel = allocLabel(ctx);

    ctx.ir.push({ kind: "JumpIfFalse", labelId: endLabel });
    lowerStatement(stmt.thenStatement, ctx);
    ctx.ir.push({ kind: "Label", labelId: endLabel });
  }
}

function lowerWhileStatement(stmt: ts.WhileStatement, ctx: LowerContext): void {
  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  ctx.loopStack.push({ continueLabel: loopStart, breakLabel: loopEnd });

  ctx.ir.push({ kind: "Label", labelId: loopStart });
  lowerExpression(stmt.expression, ctx);
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });
  lowerStatement(stmt.statement, ctx);
  ctx.ir.push({ kind: "Jump", labelId: loopStart });
  ctx.ir.push({ kind: "Label", labelId: loopEnd });

  ctx.loopStack.pop();
}

function lowerForStatement(stmt: ts.ForStatement, ctx: LowerContext): void {
  ctx.scopeStack.pushScope();

  if (stmt.initializer) {
    if (ts.isVariableDeclarationList(stmt.initializer)) {
      lowerVariableDeclarationList(stmt.initializer, ctx);
    } else {
      lowerExpression(stmt.initializer, ctx);
      ctx.ir.push({ kind: "Pop" });
    }
  }

  const loopStart = allocLabel(ctx);
  const continueTarget = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  ctx.loopStack.push({ continueLabel: continueTarget, breakLabel: loopEnd });

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  if (stmt.condition) {
    lowerExpression(stmt.condition, ctx);
    ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });
  }

  lowerStatement(stmt.statement, ctx);

  ctx.ir.push({ kind: "Label", labelId: continueTarget });

  if (stmt.incrementor) {
    lowerExpression(stmt.incrementor, ctx);
    ctx.ir.push({ kind: "Pop" });
  }

  ctx.ir.push({ kind: "Jump", labelId: loopStart });
  ctx.ir.push({ kind: "Label", labelId: loopEnd });

  ctx.loopStack.pop();
  ctx.scopeStack.popScope();
}

function lowerBreakStatement(stmt: ts.BreakStatement, ctx: LowerContext): void {
  if (ctx.loopStack.length === 0) {
    ctx.diagnostics.push(makeDiag("`break` outside of loop", stmt));
    return;
  }
  const loop = ctx.loopStack[ctx.loopStack.length - 1];
  ctx.ir.push({ kind: "Jump", labelId: loop.breakLabel });
}

function lowerContinueStatement(stmt: ts.ContinueStatement, ctx: LowerContext): void {
  if (ctx.loopStack.length === 0) {
    ctx.diagnostics.push(makeDiag("`continue` outside of loop", stmt));
    return;
  }
  const loop = ctx.loopStack[ctx.loopStack.length - 1];
  ctx.ir.push({ kind: "Jump", labelId: loop.continueLabel });
}

function lowerExpression(expr: ts.Expression, ctx: LowerContext): void {
  if (ts.isNumericLiteral(expr)) {
    ctx.ir.push({ kind: "PushConst", value: mkNumberValue(Number(expr.text)) });
  } else if (expr.kind === ts.SyntaxKind.TrueKeyword) {
    ctx.ir.push({ kind: "PushConst", value: TRUE_VALUE });
  } else if (expr.kind === ts.SyntaxKind.FalseKeyword) {
    ctx.ir.push({ kind: "PushConst", value: FALSE_VALUE });
  } else if (ts.isStringLiteral(expr)) {
    ctx.ir.push({ kind: "PushConst", value: mkStringValue(expr.text) });
  } else if (ts.isBinaryExpression(expr)) {
    if (isAssignmentOperator(expr.operatorToken.kind)) {
      lowerAssignment(expr, ctx);
    } else {
      lowerBinaryExpression(expr, ctx);
    }
  } else if (ts.isPropertyAccessExpression(expr)) {
    lowerPropertyAccess(expr, ctx);
  } else if (ts.isParenthesizedExpression(expr)) {
    lowerExpression(expr.expression, ctx);
  } else if (ts.isPrefixUnaryExpression(expr)) {
    lowerPrefixUnary(expr, ctx);
  } else if (ts.isPostfixUnaryExpression(expr)) {
    lowerPostfixIncDec(expr, ctx);
  } else if (ts.isIdentifier(expr)) {
    const localIdx = ctx.scopeStack.resolveLocal(expr.text);
    if (localIdx !== undefined) {
      ctx.ir.push({ kind: "LoadLocal", index: localIdx });
    } else {
      ctx.diagnostics.push(makeDiag(`Unsupported expression: ${ts.SyntaxKind[expr.kind]}`, expr));
    }
  } else {
    ctx.diagnostics.push(makeDiag(`Unsupported expression: ${ts.SyntaxKind[expr.kind]}`, expr));
  }
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  switch (kind) {
    case ts.SyntaxKind.EqualsToken:
    case ts.SyntaxKind.PlusEqualsToken:
    case ts.SyntaxKind.MinusEqualsToken:
    case ts.SyntaxKind.AsteriskEqualsToken:
    case ts.SyntaxKind.SlashEqualsToken:
      return true;
    default:
      return false;
  }
}

function lowerAssignment(expr: ts.BinaryExpression, ctx: LowerContext): void {
  if (!ts.isIdentifier(expr.left)) {
    ctx.diagnostics.push(makeDiag("Assignment target must be a variable", expr.left));
    return;
  }

  const localIdx = ctx.scopeStack.resolveLocal(expr.left.text);
  if (localIdx === undefined) {
    ctx.diagnostics.push(makeDiag(`Undefined variable: ${expr.left.text}`, expr.left));
    return;
  }

  if (expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    lowerExpression(expr.right, ctx);
  } else {
    ctx.ir.push({ kind: "LoadLocal", index: localIdx });
    lowerExpression(expr.right, ctx);

    const opId = compoundAssignmentToOpId(expr.operatorToken.kind);
    if (!opId) {
      ctx.diagnostics.push(makeDiag("Unsupported compound assignment operator", expr.operatorToken));
      return;
    }

    const lhsType = ctx.checker.getTypeAtLocation(expr.left);
    const rhsType = ctx.checker.getTypeAtLocation(expr.right);
    const lhsTypeId = tsTypeToTypeId(lhsType);
    const rhsTypeId = tsTypeToTypeId(rhsType);

    if (!lhsTypeId || !rhsTypeId) {
      ctx.diagnostics.push(makeDiag("Cannot determine types for compound assignment", expr));
      return;
    }

    const fnName = ctx.resolveOperator(opId, [lhsTypeId, rhsTypeId]);
    if (!fnName) {
      ctx.diagnostics.push(makeDiag(`No operator overload for ${opId}(${lhsTypeId}, ${rhsTypeId})`, expr));
      return;
    }
    ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 2 });
  }

  ctx.ir.push({ kind: "Dup" });
  ctx.ir.push({ kind: "StoreLocal", index: localIdx });
}

function compoundAssignmentToOpId(kind: ts.SyntaxKind): string | undefined {
  switch (kind) {
    case ts.SyntaxKind.PlusEqualsToken:
      return CoreOpId.Add;
    case ts.SyntaxKind.MinusEqualsToken:
      return CoreOpId.Subtract;
    case ts.SyntaxKind.AsteriskEqualsToken:
      return CoreOpId.Multiply;
    case ts.SyntaxKind.SlashEqualsToken:
      return CoreOpId.Divide;
    default:
      return undefined;
  }
}

function lowerPrefixUnary(expr: ts.PrefixUnaryExpression, ctx: LowerContext): void {
  if (expr.operator === ts.SyntaxKind.MinusToken) {
    if (ts.isNumericLiteral(expr.operand)) {
      ctx.ir.push({ kind: "PushConst", value: mkNumberValue(-Number(expr.operand.text)) });
    } else {
      lowerExpression(expr.operand, ctx);
      const fnName = ctx.resolveOperator(CoreOpId.Negate, [CoreTypeIds.Number]);
      if (!fnName) {
        ctx.diagnostics.push(makeDiag("No operator overload for negation", expr));
        return;
      }
      ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 1 });
    }
  } else if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
    lowerPrefixIncDec(expr, ctx);
  } else {
    ctx.diagnostics.push(makeDiag(`Unsupported prefix operator: ${ts.SyntaxKind[expr.operator]}`, expr));
  }
}

function lowerPrefixIncDec(expr: ts.PrefixUnaryExpression, ctx: LowerContext): void {
  if (!ts.isIdentifier(expr.operand)) {
    ctx.diagnostics.push(makeDiag("Increment/decrement target must be a variable", expr.operand));
    return;
  }
  const localIdx = ctx.scopeStack.resolveLocal(expr.operand.text);
  if (localIdx === undefined) {
    ctx.diagnostics.push(makeDiag(`Undefined variable: ${expr.operand.text}`, expr.operand));
    return;
  }

  const opId = expr.operator === ts.SyntaxKind.PlusPlusToken ? CoreOpId.Add : CoreOpId.Subtract;
  const typeId = CoreTypeIds.Number;
  const fnName = ctx.resolveOperator(opId, [typeId, typeId]);
  if (!fnName) {
    ctx.diagnostics.push(makeDiag(`No operator overload for ${opId}(${typeId}, ${typeId})`, expr));
    return;
  }

  ctx.ir.push({ kind: "LoadLocal", index: localIdx });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 2 });
  ctx.ir.push({ kind: "Dup" });
  ctx.ir.push({ kind: "StoreLocal", index: localIdx });
}

function lowerPostfixIncDec(expr: ts.PostfixUnaryExpression, ctx: LowerContext): void {
  if (!ts.isIdentifier(expr.operand)) {
    ctx.diagnostics.push(makeDiag("Increment/decrement target must be a variable", expr.operand));
    return;
  }
  const localIdx = ctx.scopeStack.resolveLocal(expr.operand.text);
  if (localIdx === undefined) {
    ctx.diagnostics.push(makeDiag(`Undefined variable: ${expr.operand.text}`, expr.operand));
    return;
  }

  const opId = expr.operator === ts.SyntaxKind.PlusPlusToken ? CoreOpId.Add : CoreOpId.Subtract;
  const typeId = CoreTypeIds.Number;
  const fnName = ctx.resolveOperator(opId, [typeId, typeId]);
  if (!fnName) {
    ctx.diagnostics.push(makeDiag(`No operator overload for ${opId}(${typeId}, ${typeId})`, expr));
    return;
  }

  ctx.ir.push({ kind: "LoadLocal", index: localIdx });
  ctx.ir.push({ kind: "Dup" });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: localIdx });
}

function lowerBinaryExpression(expr: ts.BinaryExpression, ctx: LowerContext): void {
  const opId = tsOperatorToOpId(expr.operatorToken.kind);
  if (!opId) {
    ctx.diagnostics.push(
      makeDiag(`Unsupported operator: ${ts.SyntaxKind[expr.operatorToken.kind]}`, expr.operatorToken)
    );
    return;
  }

  lowerExpression(expr.left, ctx);
  lowerExpression(expr.right, ctx);

  const lhsType = ctx.checker.getTypeAtLocation(expr.left);
  const rhsType = ctx.checker.getTypeAtLocation(expr.right);

  const lhsTypeId = tsTypeToTypeId(lhsType);
  const rhsTypeId = tsTypeToTypeId(rhsType);

  if (!lhsTypeId || !rhsTypeId) {
    ctx.diagnostics.push(makeDiag("Cannot determine types for binary operator", expr));
    return;
  }

  const fnName = ctx.resolveOperator(opId, [lhsTypeId, rhsTypeId]);
  if (!fnName) {
    ctx.diagnostics.push(makeDiag(`No operator overload for ${opId}(${lhsTypeId}, ${rhsTypeId})`, expr));
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 2 });
}

function lowerPropertyAccess(expr: ts.PropertyAccessExpression, ctx: LowerContext): void {
  if (ts.isIdentifier(expr.expression) && ctx.paramsSymbol) {
    const objSymbol = ctx.checker.getSymbolAtLocation(expr.expression);
    if (objSymbol === ctx.paramsSymbol) {
      const paramName = expr.name.text;
      const localIdx = ctx.paramLocals.get(paramName);
      if (localIdx !== undefined) {
        ctx.ir.push({ kind: "LoadLocal", index: localIdx });
        return;
      }
    }
  }
  ctx.diagnostics.push(makeDiag("Unsupported property access", expr));
}

function tsOperatorToOpId(kind: ts.SyntaxKind): string | undefined {
  switch (kind) {
    case ts.SyntaxKind.LessThanToken:
      return CoreOpId.LessThan;
    case ts.SyntaxKind.GreaterThanToken:
      return CoreOpId.GreaterThan;
    case ts.SyntaxKind.LessThanEqualsToken:
      return CoreOpId.LessThanOrEqualTo;
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return CoreOpId.GreaterThanOrEqualTo;
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return CoreOpId.EqualTo;
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return CoreOpId.NotEqualTo;
    case ts.SyntaxKind.PlusToken:
      return CoreOpId.Add;
    case ts.SyntaxKind.MinusToken:
      return CoreOpId.Subtract;
    case ts.SyntaxKind.AsteriskToken:
      return CoreOpId.Multiply;
    case ts.SyntaxKind.SlashToken:
      return CoreOpId.Divide;
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
