import { List } from "@mindcraft-lang/core";
import {
  CoreOpId,
  CoreTypeIds,
  getBrainServices,
  mkNumberValue,
  mkStringValue,
  NativeType,
  NIL_VALUE,
  type NullableTypeDef,
  runtime,
  type StructTypeDef,
  type UnionTypeDef,
  type Value,
} from "@mindcraft-lang/core/brain";
import ts from "typescript";
import type { IrNode } from "./ir.js";
import { ScopeStack } from "./scope.js";
import type { CompileDiagnostic, ExtractedDescriptor } from "./types.js";

const TRUE_VALUE: Value = { t: 2, v: true };
const FALSE_VALUE: Value = { t: 2, v: false };

export interface FunctionEntry {
  ir: IrNode[];
  numParams: number;
  numLocals: number;
  name: string;
}

export interface ProgramLoweringResult {
  functions: FunctionEntry[];
  entryFuncId: number;
  initFuncId?: number;
  onPageEnteredWrapperId: number;
  numCallsiteVars: number;
  functionTable: Map<string, number>;
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
  callsiteVars: Map<string, number>;
  functionTable: Map<string, number>;
  capturedVars?: Map<string, number>;
  funcIdCounter: { value: number };
  closureFunctions: Map<number, FunctionEntry>;
}

function allocLabel(ctx: LowerContext): number {
  return ctx.nextLabelId++;
}

function resolveOperator(opId: string, argTypes: string[]): string | undefined {
  return getBrainServices().operatorOverloads.resolve(opId, argTypes)?.overload.fnEntry.name;
}

function resolveOperatorWithExpansion(opId: string, argTypes: string[]): string | undefined {
  const direct = resolveOperator(opId, argTypes);
  if (direct) return direct;

  if (argTypes.length === 1) {
    const members = expandTypeIdMembers(argTypes[0]);
    if (members.length === 1 && members[0] === argTypes[0]) return undefined;
    let resolved: string | undefined;
    for (const m of members) {
      const fn = resolveOperator(opId, [m]);
      if (!fn) return undefined;
      if (resolved === undefined) {
        resolved = fn;
      } else if (resolved !== fn) {
        return undefined;
      }
    }
    return resolved;
  }

  if (argTypes.length === 2) {
    const lhsMembers = expandTypeIdMembers(argTypes[0]);
    const rhsMembers = expandTypeIdMembers(argTypes[1]);
    if (
      lhsMembers.length === 1 &&
      lhsMembers[0] === argTypes[0] &&
      rhsMembers.length === 1 &&
      rhsMembers[0] === argTypes[1]
    ) {
      return undefined;
    }
    let resolved: string | undefined;
    for (const l of lhsMembers) {
      for (const r of rhsMembers) {
        const fn = resolveOperator(opId, [l, r]);
        if (!fn) return undefined;
        if (resolved === undefined) {
          resolved = fn;
        } else if (resolved !== fn) {
          return undefined;
        }
      }
    }
    return resolved;
  }

  return undefined;
}

export function lowerProgram(
  sourceFile: ts.SourceFile,
  descriptor: ExtractedDescriptor,
  checker: ts.TypeChecker
): ProgramLoweringResult {
  const diagnostics: CompileDiagnostic[] = [];
  const callsiteVars = new Map<string, number>();
  const functionTable = new Map<string, number>();
  const helperNodes: ts.FunctionDeclaration[] = [];
  const funcIdCounter = { value: 0 };
  const closureFunctions = new Map<number, FunctionEntry>();

  let nextCallsiteVar = 0;

  const entryFuncId = funcIdCounter.value++;

  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      functionTable.set(stmt.name.text, funcIdCounter.value++);
      helperNodes.push(stmt);
    } else if (ts.isVariableStatement(stmt) && !isInsideDescriptor(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          callsiteVars.set(decl.name.text, nextCallsiteVar++);
        }
      }
    }
  }

  let userOnPageEnteredFuncId: number | undefined;
  if (descriptor.onPageEnteredNode) {
    userOnPageEnteredFuncId = funcIdCounter.value++;
  }

  const hasInitializers = hasTopLevelInitializers(sourceFile);
  let initFuncId: number | undefined;
  if (hasInitializers) {
    initFuncId = funcIdCounter.value++;
  }

  const onPageEnteredWrapperId = funcIdCounter.value++;

  const functions: FunctionEntry[] = [];

  const onExecEntry = lowerOnExecuteBody(
    descriptor,
    checker,
    callsiteVars,
    functionTable,
    diagnostics,
    funcIdCounter,
    closureFunctions
  );
  functions.push(onExecEntry);

  for (const helperNode of helperNodes) {
    const entry = lowerHelperFunction(
      helperNode,
      checker,
      callsiteVars,
      functionTable,
      diagnostics,
      funcIdCounter,
      closureFunctions
    );
    functions.push(entry);
  }

  if (descriptor.onPageEnteredNode) {
    const entry = lowerOnPageEnteredBody(
      descriptor,
      checker,
      callsiteVars,
      functionTable,
      diagnostics,
      funcIdCounter,
      closureFunctions
    );
    functions.push(entry);
  }

  if (hasInitializers && initFuncId !== undefined) {
    const initEntry = generateModuleInit(
      sourceFile,
      checker,
      callsiteVars,
      functionTable,
      diagnostics,
      funcIdCounter,
      closureFunctions
    );
    functions.push(initEntry);
  }

  const wrapperEntry = generateOnPageEnteredWrapper(descriptor.name, initFuncId, userOnPageEnteredFuncId);
  functions.push(wrapperEntry);

  const closureEntries = Array.from(closureFunctions.entries())
    .sort(([a], [b]) => a - b)
    .map(([, entry]) => entry);
  functions.push(...closureEntries);

  return {
    functions,
    entryFuncId,
    initFuncId,
    onPageEnteredWrapperId,
    numCallsiteVars: nextCallsiteVar,
    functionTable,
    diagnostics,
  };
}

function lowerOnPageEnteredBody(
  descriptor: ExtractedDescriptor,
  checker: ts.TypeChecker,
  callsiteVars: Map<string, number>,
  functionTable: Map<string, number>,
  sharedDiagnostics: CompileDiagnostic[],
  funcIdCounter: { value: number },
  closureFunctions: Map<number, FunctionEntry>
): FunctionEntry {
  const ir: IrNode[] = [];
  const funcNode = descriptor.onPageEnteredNode!;

  const scopeStack = new ScopeStack(0);

  const ctx: LowerContext = {
    checker,
    paramsSymbol: undefined,
    paramLocals: new Map(),
    scopeStack,
    ir,
    diagnostics: sharedDiagnostics,
    loopStack: [],
    nextLabelId: 0,
    callsiteVars,
    functionTable,
    funcIdCounter,
    closureFunctions,
  };

  const body = funcNode.body;
  if (!body || !ts.isBlock(body)) {
    sharedDiagnostics.push({ message: "onPageEntered function has no body" });
    return {
      ir,
      numParams: 0,
      numLocals: scopeStack.nextLocal,
      name: `${descriptor.name}.onPageEntered`,
    };
  }

  lowerStatements(body.statements, ctx);

  ir.push({ kind: "PushConst", value: NIL_VALUE });
  ir.push({ kind: "Return" });

  return {
    ir,
    numParams: 0,
    numLocals: scopeStack.nextLocal,
    name: `${descriptor.name}.onPageEntered`,
  };
}

function generateOnPageEnteredWrapper(
  name: string,
  initFuncId: number | undefined,
  userOnPageEnteredFuncId: number | undefined
): FunctionEntry {
  const ir: IrNode[] = [];

  if (initFuncId !== undefined) {
    ir.push({ kind: "Call", funcIndex: initFuncId, argc: 0 });
    ir.push({ kind: "Pop" });
  }

  if (userOnPageEnteredFuncId !== undefined) {
    ir.push({ kind: "Call", funcIndex: userOnPageEnteredFuncId, argc: 0 });
    ir.push({ kind: "Pop" });
  }

  ir.push({ kind: "PushConst", value: NIL_VALUE });
  ir.push({ kind: "Return" });

  return {
    ir,
    numParams: 0,
    numLocals: 0,
    name: `${name}.<onPageEntered-wrapper>`,
  };
}

function isInsideDescriptor(stmt: ts.VariableStatement): boolean {
  return stmt.parent !== undefined && !ts.isSourceFile(stmt.parent);
}

function hasTopLevelInitializers(sourceFile: ts.SourceFile): boolean {
  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt) && ts.isSourceFile(stmt.parent)) {
      for (const decl of stmt.declarationList.declarations) {
        if (decl.initializer && ts.isIdentifier(decl.name)) {
          return true;
        }
      }
    }
  }
  return false;
}

function lowerOnExecuteBody(
  descriptor: ExtractedDescriptor,
  checker: ts.TypeChecker,
  callsiteVars: Map<string, number>,
  functionTable: Map<string, number>,
  sharedDiagnostics: CompileDiagnostic[],
  funcIdCounter: { value: number },
  closureFunctions: Map<number, FunctionEntry>
): FunctionEntry {
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
    diagnostics: sharedDiagnostics,
    loopStack: [],
    nextLabelId: 0,
    callsiteVars,
    functionTable,
    funcIdCounter,
    closureFunctions,
  };

  const body = funcNode.body;
  if (!body || !ts.isBlock(body)) {
    sharedDiagnostics.push({ message: "onExecute function has no body" });
    return {
      ir,
      numParams: hasParams ? 1 : 0,
      numLocals: scopeStack.nextLocal,
      name: `${descriptor.name}.onExecute`,
    };
  }

  lowerStatements(body.statements, ctx);

  ir.push({ kind: "PushConst", value: NIL_VALUE });
  ir.push({ kind: "Return" });

  return {
    ir,
    numParams: hasParams ? 1 : 0,
    numLocals: scopeStack.nextLocal,
    name: `${descriptor.name}.onExecute`,
  };
}

function lowerHelperFunction(
  funcNode: ts.FunctionDeclaration,
  checker: ts.TypeChecker,
  callsiteVars: Map<string, number>,
  functionTable: Map<string, number>,
  sharedDiagnostics: CompileDiagnostic[],
  funcIdCounter: { value: number },
  closureFunctions: Map<number, FunctionEntry>
): FunctionEntry {
  const ir: IrNode[] = [];
  const paramLocals = new Map<string, number>();
  const numParams = funcNode.parameters.length;

  for (let i = 0; i < numParams; i++) {
    const p = funcNode.parameters[i];
    if (ts.isIdentifier(p.name)) {
      paramLocals.set(p.name.text, i);
    }
  }

  const scopeStack = new ScopeStack(numParams);

  const ctx: LowerContext = {
    checker,
    paramsSymbol: undefined,
    paramLocals,
    scopeStack,
    ir,
    diagnostics: sharedDiagnostics,
    loopStack: [],
    nextLabelId: 0,
    callsiteVars,
    functionTable,
    funcIdCounter,
    closureFunctions,
  };

  const body = funcNode.body;
  if (!body) {
    sharedDiagnostics.push(makeDiag("Function has no body", funcNode));
    return { ir, numParams, numLocals: scopeStack.nextLocal, name: funcNode.name?.text ?? "<anonymous>" };
  }

  lowerStatements(body.statements, ctx);

  ir.push({ kind: "PushConst", value: NIL_VALUE });
  ir.push({ kind: "Return" });

  return {
    ir,
    numParams,
    numLocals: scopeStack.nextLocal,
    name: funcNode.name?.text ?? "<anonymous>",
  };
}

function generateModuleInit(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  callsiteVars: Map<string, number>,
  functionTable: Map<string, number>,
  sharedDiagnostics: CompileDiagnostic[],
  funcIdCounter: { value: number },
  closureFunctions: Map<number, FunctionEntry>
): FunctionEntry {
  const ir: IrNode[] = [];
  const scopeStack = new ScopeStack(0);

  const ctx: LowerContext = {
    checker,
    paramsSymbol: undefined,
    paramLocals: new Map(),
    scopeStack,
    ir,
    diagnostics: sharedDiagnostics,
    loopStack: [],
    nextLabelId: 0,
    callsiteVars,
    functionTable,
    funcIdCounter,
    closureFunctions,
  };

  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt) && ts.isSourceFile(stmt.parent)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const varIdx = callsiteVars.get(decl.name.text);
          if (varIdx !== undefined) {
            lowerExpression(decl.initializer, ctx);
            ir.push({ kind: "StoreCallsiteVar", index: varIdx });
          }
        }
      }
    }
  }

  ir.push({ kind: "PushConst", value: NIL_VALUE });
  ir.push({ kind: "Return" });

  return {
    ir,
    numParams: 0,
    numLocals: scopeStack.nextLocal,
    name: "<module-init>",
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
  } else if (expr.kind === ts.SyntaxKind.NullKeyword) {
    ctx.ir.push({ kind: "PushConst", value: NIL_VALUE });
  } else if (ts.isStringLiteral(expr)) {
    ctx.ir.push({ kind: "PushConst", value: mkStringValue(expr.text) });
  } else if (ts.isNoSubstitutionTemplateLiteral(expr)) {
    ctx.ir.push({ kind: "PushConst", value: mkStringValue(expr.text) });
  } else if (ts.isTemplateExpression(expr)) {
    lowerTemplateLiteral(expr, ctx);
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
  } else if (ts.isCallExpression(expr)) {
    lowerCallExpression(expr, ctx);
  } else if (ts.isIdentifier(expr)) {
    lowerIdentifier(expr, ctx);
  } else if (ts.isObjectLiteralExpression(expr)) {
    lowerObjectLiteral(expr, ctx);
  } else if (ts.isArrayLiteralExpression(expr)) {
    lowerArrayLiteral(expr, ctx);
  } else if (ts.isArrowFunction(expr)) {
    lowerClosureExpression(expr, ctx);
  } else if (ts.isFunctionExpression(expr)) {
    lowerClosureExpression(expr, ctx);
  } else {
    ctx.diagnostics.push(makeDiag(`Unsupported expression: ${ts.SyntaxKind[expr.kind]}`, expr));
  }
}

function lowerIdentifier(expr: ts.Identifier, ctx: LowerContext): void {
  if (expr.text === "undefined") {
    ctx.ir.push({ kind: "PushConst", value: NIL_VALUE });
    return;
  }

  const paramLocal = ctx.paramLocals.get(expr.text);
  if (paramLocal !== undefined) {
    ctx.ir.push({ kind: "LoadLocal", index: paramLocal });
    return;
  }

  const localIdx = ctx.scopeStack.resolveLocal(expr.text);
  if (localIdx !== undefined) {
    ctx.ir.push({ kind: "LoadLocal", index: localIdx });
    return;
  }

  if (ctx.capturedVars) {
    const captureIdx = ctx.capturedVars.get(expr.text);
    if (captureIdx !== undefined) {
      ctx.ir.push({ kind: "LoadCapture", index: captureIdx });
      return;
    }
  }

  const csvIdx = ctx.callsiteVars.get(expr.text);
  if (csvIdx !== undefined) {
    ctx.ir.push({ kind: "LoadCallsiteVar", index: csvIdx });
    return;
  }

  if (ctx.functionTable.has(expr.text)) {
    ctx.ir.push({ kind: "PushFunctionRef", funcName: expr.text });
    return;
  }

  ctx.diagnostics.push(makeDiag(`Undefined variable: ${expr.text}`, expr));
}

function lowerCallExpression(expr: ts.CallExpression, ctx: LowerContext): void {
  if (ts.isIdentifier(expr.expression)) {
    const funcId = ctx.functionTable.get(expr.expression.text);
    if (funcId !== undefined) {
      for (const arg of expr.arguments) {
        lowerExpression(arg, ctx);
      }
      ctx.ir.push({ kind: "Call", funcIndex: funcId, argc: expr.arguments.length });
      return;
    }
  }

  const calleeSym = ctx.checker.getSymbolAtLocation(expr.expression);
  const calleeType = ctx.checker.getTypeAtLocation(expr.expression);
  if (calleeType.getCallSignatures().length > 0 || (calleeSym && calleeSym.flags & ts.SymbolFlags.Function)) {
    const irLenBefore = ctx.ir.length;
    lowerExpression(expr.expression, ctx);
    if (ctx.ir.length === irLenBefore) {
      return;
    }
    for (const arg of expr.arguments) {
      lowerExpression(arg, ctx);
    }
    ctx.ir.push({ kind: "CallIndirect", argc: expr.arguments.length });
    return;
  }

  ctx.diagnostics.push(makeDiag("Unsupported function call", expr));
}

interface CaptureInfo {
  name: string;
  source: "paramLocal" | "local" | "capture";
  index: number;
}

function isIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  if (ts.isFunctionExpression(parent) && parent.name === node) return false;
  return true;
}

function isDescendantOf(node: ts.Node, ancestor: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function findCapturedVariables(
  closureNode: ts.ArrowFunction | ts.FunctionExpression,
  closureParamNames: Set<string>,
  ctx: LowerContext
): CaptureInfo[] {
  const captures: CaptureInfo[] = [];
  const seen = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && isIdentifierReference(node)) {
      const name = node.text;
      if (seen.has(name) || closureParamNames.has(name) || name === "undefined") return;

      const sym = ctx.checker.getSymbolAtLocation(node);
      if (sym) {
        const decls = sym.getDeclarations();
        if (decls && decls.length > 0) {
          if (isDescendantOf(decls[0], closureNode)) return;
        }
      }

      const paramIdx = ctx.paramLocals.get(name);
      if (paramIdx !== undefined) {
        seen.add(name);
        captures.push({ name, source: "paramLocal", index: paramIdx });
        return;
      }

      const localIdx = ctx.scopeStack.resolveLocal(name);
      if (localIdx !== undefined) {
        seen.add(name);
        captures.push({ name, source: "local", index: localIdx });
        return;
      }

      if (ctx.capturedVars) {
        const captureIdx = ctx.capturedVars.get(name);
        if (captureIdx !== undefined) {
          seen.add(name);
          captures.push({ name, source: "capture", index: captureIdx });
          return;
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(closureNode.body);
  return captures;
}

function lowerClosureExpression(expr: ts.ArrowFunction | ts.FunctionExpression, ctx: LowerContext): void {
  const numParams = expr.parameters.length;
  const closureParamNames = new Set<string>();
  const closureParamLocals = new Map<string, number>();

  for (let i = 0; i < numParams; i++) {
    const p = expr.parameters[i];
    if (ts.isIdentifier(p.name)) {
      closureParamNames.add(p.name.text);
      closureParamLocals.set(p.name.text, i);
    }
  }

  const captureInfos = findCapturedVariables(expr, closureParamNames, ctx);

  const capturedVars = new Map<string, number>();
  for (let i = 0; i < captureInfos.length; i++) {
    capturedVars.set(captureInfos[i].name, i);
  }

  for (const info of captureInfos) {
    switch (info.source) {
      case "paramLocal":
      case "local":
        ctx.ir.push({ kind: "LoadLocal", index: info.index });
        break;
      case "capture":
        ctx.ir.push({ kind: "LoadCapture", index: info.index });
        break;
    }
  }

  const closureFuncId = ctx.funcIdCounter.value++;
  const closureName = `<closure#${closureFuncId}>`;
  ctx.functionTable.set(closureName, closureFuncId);

  if (captureInfos.length > 0) {
    ctx.ir.push({ kind: "MakeClosure", funcName: closureName, captureCount: captureInfos.length });
  } else {
    ctx.ir.push({ kind: "PushFunctionRef", funcName: closureName });
  }

  const closureIr: IrNode[] = [];
  const closureScopeStack = new ScopeStack(numParams);

  const closureCtx: LowerContext = {
    checker: ctx.checker,
    paramsSymbol: undefined,
    paramLocals: closureParamLocals,
    scopeStack: closureScopeStack,
    ir: closureIr,
    diagnostics: ctx.diagnostics,
    loopStack: [],
    nextLabelId: 0,
    callsiteVars: ctx.callsiteVars,
    functionTable: ctx.functionTable,
    capturedVars: capturedVars.size > 0 ? capturedVars : undefined,
    funcIdCounter: ctx.funcIdCounter,
    closureFunctions: ctx.closureFunctions,
  };

  if (ts.isBlock(expr.body)) {
    lowerStatements(expr.body.statements, closureCtx);
    closureIr.push({ kind: "PushConst", value: NIL_VALUE });
    closureIr.push({ kind: "Return" });
  } else {
    lowerExpression(expr.body, closureCtx);
    closureIr.push({ kind: "Return" });
  }

  ctx.closureFunctions.set(closureFuncId, {
    ir: closureIr,
    numParams,
    numLocals: closureScopeStack.nextLocal,
    name: closureName,
  });
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

function resolveVarTarget(
  name: string,
  ctx: LowerContext
): { kind: "local"; index: number } | { kind: "callsiteVar"; index: number } | undefined {
  const paramLocal = ctx.paramLocals.get(name);
  if (paramLocal !== undefined) return { kind: "local", index: paramLocal };

  const localIdx = ctx.scopeStack.resolveLocal(name);
  if (localIdx !== undefined) return { kind: "local", index: localIdx };

  const csvIdx = ctx.callsiteVars.get(name);
  if (csvIdx !== undefined) return { kind: "callsiteVar", index: csvIdx };

  return undefined;
}

function emitLoad(
  target: { kind: "local"; index: number } | { kind: "callsiteVar"; index: number },
  ctx: LowerContext
): void {
  if (target.kind === "local") {
    ctx.ir.push({ kind: "LoadLocal", index: target.index });
  } else {
    ctx.ir.push({ kind: "LoadCallsiteVar", index: target.index });
  }
}

function emitStore(
  target: { kind: "local"; index: number } | { kind: "callsiteVar"; index: number },
  ctx: LowerContext
): void {
  if (target.kind === "local") {
    ctx.ir.push({ kind: "StoreLocal", index: target.index });
  } else {
    ctx.ir.push({ kind: "StoreCallsiteVar", index: target.index });
  }
}

function lowerAssignment(expr: ts.BinaryExpression, ctx: LowerContext): void {
  if (!ts.isIdentifier(expr.left)) {
    ctx.diagnostics.push(makeDiag("Assignment target must be a variable", expr.left));
    return;
  }

  const target = resolveVarTarget(expr.left.text, ctx);
  if (!target) {
    ctx.diagnostics.push(makeDiag(`Undefined variable: ${expr.left.text}`, expr.left));
    return;
  }

  if (expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    lowerExpression(expr.right, ctx);
  } else {
    emitLoad(target, ctx);
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

    const fnName = resolveOperatorWithExpansion(opId, [lhsTypeId, rhsTypeId]);
    if (!fnName) {
      ctx.diagnostics.push(makeDiag(`No operator overload for ${opId}(${lhsTypeId}, ${rhsTypeId})`, expr));
      return;
    }
    ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 2 });
  }

  ctx.ir.push({ kind: "Dup" });
  emitStore(target, ctx);
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
      const fnName = resolveOperator(CoreOpId.Negate, [CoreTypeIds.Number]);
      if (!fnName) {
        ctx.diagnostics.push(makeDiag("No operator overload for negation", expr));
        return;
      }
      ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 1 });
    }
  } else if (expr.operator === ts.SyntaxKind.ExclamationToken) {
    lowerExpression(expr.operand, ctx);
    const operandType = ctx.checker.getTypeAtLocation(expr.operand);
    const operandTypeId = tsTypeToTypeId(operandType);
    if (!operandTypeId) {
      ctx.diagnostics.push(makeDiag("Cannot determine type for `!` operand", expr));
      return;
    }
    const fnName = resolveOperatorWithExpansion(CoreOpId.Not, [operandTypeId]);
    if (!fnName) {
      ctx.diagnostics.push(makeDiag(`No operator overload for !(${operandTypeId})`, expr));
      return;
    }
    ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 1 });
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
  const target = resolveVarTarget(expr.operand.text, ctx);
  if (!target) {
    ctx.diagnostics.push(makeDiag(`Undefined variable: ${expr.operand.text}`, expr.operand));
    return;
  }

  const opId = expr.operator === ts.SyntaxKind.PlusPlusToken ? CoreOpId.Add : CoreOpId.Subtract;
  const typeId = CoreTypeIds.Number;
  const fnName = resolveOperator(opId, [typeId, typeId]);
  if (!fnName) {
    ctx.diagnostics.push(makeDiag(`No operator overload for ${opId}(${typeId}, ${typeId})`, expr));
    return;
  }

  emitLoad(target, ctx);
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 2 });
  ctx.ir.push({ kind: "Dup" });
  emitStore(target, ctx);
}

function lowerPostfixIncDec(expr: ts.PostfixUnaryExpression, ctx: LowerContext): void {
  if (!ts.isIdentifier(expr.operand)) {
    ctx.diagnostics.push(makeDiag("Increment/decrement target must be a variable", expr.operand));
    return;
  }
  const target = resolveVarTarget(expr.operand.text, ctx);
  if (!target) {
    ctx.diagnostics.push(makeDiag(`Undefined variable: ${expr.operand.text}`, expr.operand));
    return;
  }

  const opId = expr.operator === ts.SyntaxKind.PlusPlusToken ? CoreOpId.Add : CoreOpId.Subtract;
  const typeId = CoreTypeIds.Number;
  const fnName = resolveOperator(opId, [typeId, typeId]);
  if (!fnName) {
    ctx.diagnostics.push(makeDiag(`No operator overload for ${opId}(${typeId}, ${typeId})`, expr));
    return;
  }

  emitLoad(target, ctx);
  ctx.ir.push({ kind: "Dup" });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 2 });
  emitStore(target, ctx);
}

function lowerShortCircuit(expr: ts.BinaryExpression, ctx: LowerContext): void {
  const endLabel = allocLabel(ctx);
  lowerExpression(expr.left, ctx);
  ctx.ir.push({ kind: "Dup" });
  if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    ctx.ir.push({ kind: "JumpIfFalse", labelId: endLabel });
  } else {
    ctx.ir.push({ kind: "JumpIfTrue", labelId: endLabel });
  }
  ctx.ir.push({ kind: "Pop" });
  lowerExpression(expr.right, ctx);
  ctx.ir.push({ kind: "Label", labelId: endLabel });
}

function emitToStringIfNeeded(exprNode: ts.Expression, ctx: LowerContext): void {
  const exprType = ctx.checker.getTypeAtLocation(exprNode);
  const typeId = tsTypeToTypeId(exprType);
  if (!typeId) {
    ctx.diagnostics.push(makeDiag("Cannot convert expression to string: unable to determine type", exprNode));
    return;
  }
  if (typeId !== CoreTypeIds.String) {
    const fnName = runtime.conversionFnName(typeId, CoreTypeIds.String);
    if (!getBrainServices().functions.get(fnName)) {
      ctx.diagnostics.push(makeDiag(`No conversion from ${typeId} to string`, exprNode));
      return;
    }
    ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 1 });
  }
}

function lowerTemplateLiteral(expr: ts.TemplateExpression, ctx: LowerContext): void {
  const addFnName = resolveOperator(CoreOpId.Add, [CoreTypeIds.String, CoreTypeIds.String]);
  if (!addFnName) {
    ctx.diagnostics.push(makeDiag("No operator overload for string concatenation", expr));
    return;
  }

  let hasAccumulator = false;
  const headText = expr.head.text;

  if (headText !== "") {
    ctx.ir.push({ kind: "PushConst", value: mkStringValue(headText) });
    hasAccumulator = true;
  }

  for (const span of expr.templateSpans) {
    lowerExpression(span.expression, ctx);
    emitToStringIfNeeded(span.expression, ctx);

    if (hasAccumulator) {
      ctx.ir.push({ kind: "HostCallArgs", fnName: addFnName, argc: 2 });
    }
    hasAccumulator = true;

    const literalText = span.literal.text;
    if (literalText !== "") {
      ctx.ir.push({ kind: "PushConst", value: mkStringValue(literalText) });
      ctx.ir.push({ kind: "HostCallArgs", fnName: addFnName, argc: 2 });
    }
  }

  if (!hasAccumulator) {
    ctx.ir.push({ kind: "PushConst", value: mkStringValue("") });
  }
}

function typeofStringToNativeType(s: string): number | undefined {
  switch (s) {
    case "number":
      return NativeType.Number;
    case "string":
      return NativeType.String;
    case "boolean":
      return NativeType.Boolean;
    case "undefined":
      return NativeType.Nil;
    case "function":
      return NativeType.Function;
    default:
      return undefined;
  }
}

function lowerTypeofComparison(expr: ts.BinaryExpression, ctx: LowerContext): boolean {
  const op = expr.operatorToken.kind;
  if (
    op !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    op !== ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    op !== ts.SyntaxKind.EqualsEqualsToken &&
    op !== ts.SyntaxKind.ExclamationEqualsToken
  ) {
    return false;
  }

  let typeofExpr: ts.TypeOfExpression | undefined;
  let literalValue: string | undefined;

  if (ts.isTypeOfExpression(expr.left) && ts.isStringLiteral(expr.right)) {
    typeofExpr = expr.left;
    literalValue = expr.right.text;
  } else if (ts.isStringLiteral(expr.left) && ts.isTypeOfExpression(expr.right)) {
    typeofExpr = expr.right;
    literalValue = expr.left.text;
  }

  if (!typeofExpr || literalValue === undefined) {
    return false;
  }

  const nativeType = typeofStringToNativeType(literalValue);
  if (nativeType === undefined) {
    ctx.diagnostics.push(
      makeDiag(
        `Unsupported typeof comparison: "${literalValue}" (supported: "number", "string", "boolean", "undefined")`,
        expr
      )
    );
    return true;
  }

  lowerExpression(typeofExpr.expression, ctx);
  ctx.ir.push({ kind: "TypeCheck", nativeType });

  if (op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) {
    const operandTypeId = CoreTypeIds.Boolean;
    const fnName = resolveOperator(CoreOpId.Not, [operandTypeId]);
    if (!fnName) {
      ctx.diagnostics.push(makeDiag("No operator overload for !(boolean)", expr));
      return true;
    }
    ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 1 });
  }

  return true;
}

function lowerBinaryExpression(expr: ts.BinaryExpression, ctx: LowerContext): void {
  if (
    expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    expr.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    lowerShortCircuit(expr, ctx);
    return;
  }

  if (lowerTypeofComparison(expr, ctx)) {
    return;
  }

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

  const fnName = resolveOperator(opId, [lhsTypeId, rhsTypeId]);
  if (!fnName) {
    const fallbackFn = resolveOperatorWithExpansion(opId, [lhsTypeId, rhsTypeId]);
    if (fallbackFn) {
      ctx.ir.push({ kind: "HostCallArgs", fnName: fallbackFn, argc: 2 });
      return;
    }
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
  if (expr.name.text === "length") {
    const objType = ctx.checker.getTypeAtLocation(expr.expression);
    const listTypeId = resolveListTypeId(objType, ctx);
    if (listTypeId) {
      lowerExpression(expr.expression, ctx);
      ctx.ir.push({ kind: "ListLen" });
      return;
    }
  }
  ctx.diagnostics.push(makeDiag("Unsupported property access", expr));
}

function resolveStructType(type: ts.Type): StructTypeDef | undefined {
  const registry = getBrainServices().types;
  if (type.isUnion()) {
    const nonNullish = type.types.filter((t) => !(t.flags & ts.TypeFlags.Null) && !(t.flags & ts.TypeFlags.Undefined));
    if (nonNullish.length === 1) {
      return resolveStructType(nonNullish[0]);
    }
    return undefined;
  }
  const sym = type.getSymbol() ?? type.aliasSymbol;
  if (!sym) return undefined;
  const name = sym.getName();
  const typeId = registry.resolveByName(name);
  if (!typeId) return undefined;
  const def = registry.get(typeId);
  if (!def || def.coreType !== NativeType.Struct) return undefined;
  return def as StructTypeDef;
}

function isNativeBackedStruct(def: StructTypeDef): boolean {
  return def.fieldGetter !== undefined || def.fieldSetter !== undefined || def.snapshotNative !== undefined;
}

function lowerObjectLiteral(expr: ts.ObjectLiteralExpression, ctx: LowerContext): void {
  const contextualType = ctx.checker.getContextualType(expr);
  if (!contextualType) {
    ctx.diagnostics.push(makeDiag("Cannot determine struct type for object literal (add a type annotation)", expr));
    return;
  }

  const structDef = resolveStructType(contextualType);
  if (!structDef) {
    ctx.diagnostics.push(makeDiag("Object literal type does not resolve to a known struct type", expr));
    return;
  }

  if (isNativeBackedStruct(structDef)) {
    ctx.diagnostics.push(makeDiag(`Cannot create instances of native-backed struct type '${structDef.name}'`, expr));
    return;
  }

  ctx.ir.push({ kind: "StructNew", typeId: structDef.typeId });

  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      ctx.diagnostics.push(makeDiag("Only simple property assignments are supported in object literals", prop));
      return;
    }
    let fieldName: string;
    if (ts.isIdentifier(prop.name)) {
      fieldName = prop.name.text;
    } else if (ts.isStringLiteral(prop.name)) {
      fieldName = prop.name.text;
    } else {
      ctx.diagnostics.push(makeDiag("Unsupported property name in object literal", prop));
      return;
    }
    ctx.ir.push({ kind: "PushConst", value: mkStringValue(fieldName) });
    lowerExpression(prop.initializer, ctx);
    ctx.ir.push({ kind: "StructSet" });
  }
}

function resolveListTypeId(arrayType: ts.Type, ctx: LowerContext): string | undefined {
  const registry = getBrainServices().types;

  const sym = arrayType.aliasSymbol ?? arrayType.getSymbol();
  if (sym) {
    const name = sym.getName();
    const typeId = registry.resolveByName(name);
    if (typeId) {
      const def = registry.get(typeId);
      if (def && def.coreType === NativeType.List) return def.typeId;
    }
  }

  const checker = ctx.checker;
  const typeArgs =
    (arrayType as ts.TypeReference).typeArguments ?? checker.getTypeArguments(arrayType as ts.TypeReference);
  if (!typeArgs || typeArgs.length === 0) return undefined;

  const elementType = typeArgs[0];
  const elementTypeId = tsTypeToTypeId(elementType);
  if (!elementTypeId) return undefined;

  return registry.instantiate("List", List.from([elementTypeId]));
}

function lowerArrayLiteral(expr: ts.ArrayLiteralExpression, ctx: LowerContext): void {
  const contextualType = ctx.checker.getContextualType(expr);
  const resolvedType = contextualType ?? ctx.checker.getTypeAtLocation(expr);

  const listTypeId = resolveListTypeId(resolvedType, ctx);
  if (!listTypeId) {
    ctx.diagnostics.push(
      makeDiag(
        "Cannot determine list type for array literal (add a type annotation or ensure the list type is registered)",
        expr
      )
    );
    return;
  }

  ctx.ir.push({ kind: "ListNew", typeId: listTypeId });

  for (const element of expr.elements) {
    lowerExpression(element, ctx);
    ctx.ir.push({ kind: "ListPush" });
  }
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

function expandTypeIdMembers(typeId: string): string[] {
  const registry = getBrainServices().types;
  const def = registry.get(typeId);
  if (!def) return [typeId];
  if (def.coreType === NativeType.Union) {
    const members: string[] = [];
    (def as UnionTypeDef).memberTypeIds.forEach((mid: string) => {
      members.push(mid);
    });
    return members;
  }
  if (def.nullable) {
    return [(def as NullableTypeDef).baseTypeId];
  }
  return [typeId];
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
  if (type.flags & ts.TypeFlags.Null || type.flags & ts.TypeFlags.Undefined) {
    return CoreTypeIds.Nil;
  }
  if (type.getCallSignatures().length > 0) {
    return CoreTypeIds.Function;
  }
  if (type.isUnion()) {
    const nonNullish = type.types.filter((t) => !(t.flags & ts.TypeFlags.Null) && !(t.flags & ts.TypeFlags.Undefined));
    const hasNullish = nonNullish.length < type.types.length;
    if (nonNullish.length === 1) {
      const baseTypeId = tsTypeToTypeId(nonNullish[0]);
      if (!baseTypeId) return undefined;
      if (hasNullish) {
        return getBrainServices().types.addNullableType(baseTypeId);
      }
      return baseTypeId;
    }
    if (nonNullish.length >= 2) {
      const memberIds = new List<string>();
      for (const t of nonNullish) {
        const id = tsTypeToTypeId(t);
        if (!id) return CoreTypeIds.Any;
        memberIds.push(id);
      }
      if (hasNullish) {
        memberIds.push(CoreTypeIds.Nil);
      }
      const deduped = new Set<string>();
      memberIds.forEach((id) => {
        deduped.add(id);
      });
      if (deduped.size >= 2) {
        return getBrainServices().types.getOrCreateUnionType(List.from([...deduped]));
      }
      if (deduped.size === 1) {
        return [...deduped][0];
      }
    }
  }
  const sym = type.getSymbol() ?? type.aliasSymbol;
  if (sym) {
    const registry = getBrainServices().types;
    const typeId = registry.resolveByName(sym.getName());
    if (typeId) return typeId;
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
