import { List } from "@mindcraft-lang/core";
import {
  ContextTypeIds,
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
  type TypeId,
  type UnionTypeDef,
  type Value,
} from "@mindcraft-lang/core/brain";
import ts from "typescript";
import { LoweringDiagCode } from "./diag-codes.js";
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
  injectCtxTypeId?: TypeId;
}

export interface ImportedFunction {
  localName: string;
  node: ts.FunctionDeclaration;
}

export interface ImportedVariable {
  name: string;
  initializer: ts.Expression | undefined;
  sourceModule: string;
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
  checker: ts.TypeChecker,
  importedFunctions?: ImportedFunction[],
  importedVariables?: ImportedVariable[],
  moduleInitOrder?: string[]
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

  if (importedVariables) {
    for (const iv of importedVariables) {
      if (!callsiteVars.has(iv.name)) {
        callsiteVars.set(iv.name, nextCallsiteVar++);
      }
    }
  }

  if (importedFunctions) {
    for (const imp of importedFunctions) {
      const declaredName = imp.node.name?.text;
      if (!declaredName) continue;
      if (!functionTable.has(declaredName)) {
        functionTable.set(declaredName, funcIdCounter.value++);
        helperNodes.push(imp.node);
      }
      if (imp.localName !== declaredName && !functionTable.has(imp.localName)) {
        functionTable.set(imp.localName, functionTable.get(declaredName)!);
      }
    }
  }

  let userOnPageEnteredFuncId: number | undefined;
  if (descriptor.onPageEnteredNode) {
    userOnPageEnteredFuncId = funcIdCounter.value++;
  }

  const hasInitializers = hasTopLevelInitializers(sourceFile);
  const hasImportedInitializers = importedVariables?.some((iv) => iv.initializer) ?? false;
  let initFuncId: number | undefined;
  if (hasInitializers || hasImportedInitializers) {
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

  if (initFuncId !== undefined) {
    const initEntry = generateModuleInitWithImports(
      sourceFile,
      checker,
      callsiteVars,
      functionTable,
      diagnostics,
      funcIdCounter,
      closureFunctions,
      importedVariables ?? [],
      moduleInitOrder ?? []
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

  const paramLocals = new Map<string, number>();
  const ctxParam = funcNode.parameters[0];
  if (ctxParam && ts.isIdentifier(ctxParam.name)) {
    paramLocals.set(ctxParam.name.text, 0);
  }

  const scopeStack = new ScopeStack(1);

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
  if (!body || !ts.isBlock(body)) {
    sharedDiagnostics.push({
      code: LoweringDiagCode.OnPageEnteredHasNoBody,
      message: "onPageEntered function has no body",
    });
    return {
      ir,
      numParams: 1,
      numLocals: scopeStack.nextLocal,
      name: `${descriptor.name}.onPageEntered`,
    };
  }

  lowerStatements(body.statements, ctx);

  ir.push({ kind: "PushConst", value: NIL_VALUE });
  ir.push({ kind: "Return" });

  return {
    ir,
    numParams: 1,
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
    ir.push({ kind: "LoadLocal", index: 0 });
    ir.push({ kind: "Call", funcIndex: userOnPageEnteredFuncId, argc: 1 });
    ir.push({ kind: "Pop" });
  }

  ir.push({ kind: "PushConst", value: NIL_VALUE });
  ir.push({ kind: "Return" });

  return {
    ir,
    numParams: 1,
    numLocals: 1,
    name: `${name}.<onPageEntered-wrapper>`,
    injectCtxTypeId: ContextTypeIds.Context,
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
  let nextLocal = hasParams ? 2 : 1;

  const ctxParam = funcNode.parameters[0];
  if (ctxParam && ts.isIdentifier(ctxParam.name)) {
    paramLocals.set(ctxParam.name.text, 0);
  }

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

      ir.push({ kind: "LoadLocal", index: 1 });
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
    sharedDiagnostics.push({ code: LoweringDiagCode.OnExecuteHasNoBody, message: "onExecute function has no body" });
    return {
      ir,
      numParams: hasParams ? 2 : 1,
      numLocals: scopeStack.nextLocal,
      name: `${descriptor.name}.onExecute`,
      injectCtxTypeId: ContextTypeIds.Context,
    };
  }

  lowerStatements(body.statements, ctx);

  ir.push({ kind: "PushConst", value: NIL_VALUE });
  ir.push({ kind: "Return" });

  return {
    ir,
    numParams: hasParams ? 2 : 1,
    numLocals: scopeStack.nextLocal,
    name: `${descriptor.name}.onExecute`,
    injectCtxTypeId: ContextTypeIds.Context,
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
    sharedDiagnostics.push(makeDiag(LoweringDiagCode.FunctionHasNoBody, "Function has no body", funcNode));
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

function generateModuleInitWithImports(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  callsiteVars: Map<string, number>,
  functionTable: Map<string, number>,
  sharedDiagnostics: CompileDiagnostic[],
  funcIdCounter: { value: number },
  closureFunctions: Map<number, FunctionEntry>,
  importedVariables: ImportedVariable[],
  moduleInitOrder: string[]
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

  for (const moduleName of moduleInitOrder) {
    for (const iv of importedVariables) {
      if (iv.sourceModule === moduleName && iv.initializer) {
        const varIdx = callsiteVars.get(iv.name);
        if (varIdx !== undefined) {
          lowerExpression(iv.initializer, ctx);
          ir.push({ kind: "StoreCallsiteVar", index: varIdx });
        }
      }
    }
  }

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
  } else if (ts.isForOfStatement(stmt)) {
    lowerForOfStatement(stmt, ctx);
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
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.UnsupportedStatement, `Unsupported statement: ${ts.SyntaxKind[stmt.kind]}`, stmt)
    );
  }
}

function lowerVariableDeclarationList(declList: ts.VariableDeclarationList, ctx: LowerContext): void {
  for (const decl of declList.declarations) {
    if (ts.isIdentifier(decl.name)) {
      const localIdx = ctx.scopeStack.declareLocal(decl.name.text);
      if (decl.initializer) {
        lowerExpression(decl.initializer, ctx);
        checkStructAssignmentCompat(decl.name, decl.initializer, decl, ctx);
        ctx.ir.push({ kind: "StoreLocal", index: localIdx });
      }
    } else if (ts.isObjectBindingPattern(decl.name)) {
      lowerObjectDestructuring(decl.name, decl, ctx);
    } else if (ts.isArrayBindingPattern(decl.name)) {
      lowerArrayDestructuring(decl.name, decl, ctx);
    } else {
      ctx.diagnostics.push(makeDiag(LoweringDiagCode.UnsupportedBindingPattern, "Unsupported binding pattern", decl));
    }
  }
}

function lowerDestructuringDefault(element: ts.BindingElement, localIdx: number, ctx: LowerContext): void {
  if (!element.initializer) return;
  const keepLabel = allocLabel(ctx);
  const endLabel = allocLabel(ctx);
  ctx.ir.push({ kind: "LoadLocal", index: localIdx });
  ctx.ir.push({ kind: "TypeCheck", nativeType: NativeType.Nil });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: keepLabel });
  lowerExpression(element.initializer, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: localIdx });
  ctx.ir.push({ kind: "Jump", labelId: endLabel });
  ctx.ir.push({ kind: "Label", labelId: keepLabel });
  ctx.ir.push({ kind: "Label", labelId: endLabel });
}

function lowerObjectDestructuring(
  pattern: ts.ObjectBindingPattern,
  decl: ts.VariableDeclaration,
  ctx: LowerContext
): void {
  if (!decl.initializer) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.DestructuringMissingInitializer,
        "Destructuring declaration must have an initializer",
        decl
      )
    );
    return;
  }
  const srcLocal = ctx.scopeStack.allocLocal();
  lowerExpression(decl.initializer, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcLocal });

  for (const element of pattern.elements) {
    if (element.dotDotDotToken) {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.RestPatternsNotSupported, "Rest patterns in destructuring are not supported", element)
      );
      continue;
    }
    if (!ts.isIdentifier(element.name)) {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.NestedDestructuringNotSupported, "Nested destructuring is not supported", element)
      );
      continue;
    }
    let propertyName: string;
    if (element.propertyName) {
      if (!ts.isIdentifier(element.propertyName)) {
        ctx.diagnostics.push(
          makeDiag(
            LoweringDiagCode.ComputedDestructuringKeyNotSupported,
            "Computed property names in destructuring are not supported",
            element
          )
        );
        continue;
      }
      propertyName = element.propertyName.text;
    } else {
      propertyName = element.name.text;
    }

    const localIdx = ctx.scopeStack.declareLocal(element.name.text);
    ctx.ir.push({ kind: "LoadLocal", index: srcLocal });
    ctx.ir.push({ kind: "GetField", fieldName: propertyName });
    ctx.ir.push({ kind: "StoreLocal", index: localIdx });
    lowerDestructuringDefault(element, localIdx, ctx);
  }
}

function lowerArrayDestructuring(
  pattern: ts.ArrayBindingPattern,
  decl: ts.VariableDeclaration,
  ctx: LowerContext
): void {
  if (!decl.initializer) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.DestructuringMissingInitializer,
        "Destructuring declaration must have an initializer",
        decl
      )
    );
    return;
  }
  const srcLocal = ctx.scopeStack.allocLocal();
  lowerExpression(decl.initializer, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcLocal });

  for (let i = 0; i < pattern.elements.length; i++) {
    const element = pattern.elements[i];
    if (ts.isOmittedExpression(element)) continue;
    if (element.dotDotDotToken) {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.RestPatternsNotSupported, "Rest patterns in destructuring are not supported", element)
      );
      continue;
    }
    if (!ts.isIdentifier(element.name)) {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.NestedDestructuringNotSupported, "Nested destructuring is not supported", element)
      );
      continue;
    }
    const localIdx = ctx.scopeStack.declareLocal(element.name.text);
    ctx.ir.push({ kind: "LoadLocal", index: srcLocal });
    ctx.ir.push({ kind: "PushConst", value: mkNumberValue(i) });
    ctx.ir.push({ kind: "ListGet" });
    ctx.ir.push({ kind: "StoreLocal", index: localIdx });
    lowerDestructuringDefault(element, localIdx, ctx);
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

function lowerForOfStatement(stmt: ts.ForOfStatement, ctx: LowerContext): void {
  ctx.scopeStack.pushScope();

  const iterableType = ctx.checker.getTypeAtLocation(stmt.expression);
  const listTypeId = resolveListTypeId(iterableType, ctx);
  if (!listTypeId) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.ForOfOnNonListType,
        "`for...of` is only supported on list-typed values",
        stmt.expression
      )
    );
    ctx.scopeStack.popScope();
    return;
  }

  if (!ts.isVariableDeclarationList(stmt.initializer)) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.ForOfRequiresVariableDeclaration,
        "`for...of` requires a variable declaration (e.g. `const x of list`)",
        stmt
      )
    );
    ctx.scopeStack.popScope();
    return;
  }

  const decls = stmt.initializer.declarations;
  if (decls.length !== 1 || !ts.isIdentifier(decls[0].name)) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForOfRequiresSingleIdentifier, "`for...of` requires a single identifier binding", stmt)
    );
    ctx.scopeStack.popScope();
    return;
  }

  const listLocal = ctx.scopeStack.allocLocal();
  const indexLocal = ctx.scopeStack.allocLocal();

  lowerExpression(stmt.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: listLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: indexLocal });

  const loopStart = allocLabel(ctx);
  const continueTarget = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  ctx.loopStack.push({ continueLabel: continueTarget, breakLabel: loopEnd });

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: indexLocal });
  ctx.ir.push({ kind: "LoadLocal", index: listLocal });
  ctx.ir.push({ kind: "ListLen" });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForOfCannotResolveOperator, "Cannot resolve < operator for `for...of`", stmt)
    );
    ctx.loopStack.pop();
    ctx.scopeStack.popScope();
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: listLocal });
  ctx.ir.push({ kind: "LoadLocal", index: indexLocal });
  ctx.ir.push({ kind: "ListGet" });
  const itemLocal = ctx.scopeStack.declareLocal(decls[0].name.text);
  ctx.ir.push({ kind: "StoreLocal", index: itemLocal });

  lowerStatement(stmt.statement, ctx);

  ctx.ir.push({ kind: "Label", labelId: continueTarget });

  ctx.ir.push({ kind: "LoadLocal", index: indexLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForOfCannotResolveOperator, "Cannot resolve + operator for `for...of`", stmt)
    );
    ctx.loopStack.pop();
    ctx.scopeStack.popScope();
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: indexLocal });

  ctx.ir.push({ kind: "Jump", labelId: loopStart });
  ctx.ir.push({ kind: "Label", labelId: loopEnd });

  ctx.loopStack.pop();
  ctx.scopeStack.popScope();
}

function lowerBreakStatement(stmt: ts.BreakStatement, ctx: LowerContext): void {
  if (ctx.loopStack.length === 0) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.BreakOutsideLoop, "`break` outside of loop", stmt));
    return;
  }
  const loop = ctx.loopStack[ctx.loopStack.length - 1];
  ctx.ir.push({ kind: "Jump", labelId: loop.breakLabel });
}

function lowerContinueStatement(stmt: ts.ContinueStatement, ctx: LowerContext): void {
  if (ctx.loopStack.length === 0) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.ContinueOutsideLoop, "`continue` outside of loop", stmt));
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
    const enumValue = tryResolveEnumValue(expr, ctx);
    ctx.ir.push({ kind: "PushConst", value: enumValue ?? mkStringValue(expr.text) });
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
  } else if (ts.isElementAccessExpression(expr)) {
    lowerElementAccess(expr, ctx);
  } else if (ts.isArrowFunction(expr)) {
    lowerClosureExpression(expr, ctx);
  } else if (ts.isFunctionExpression(expr)) {
    lowerClosureExpression(expr, ctx);
  } else if (ts.isConditionalExpression(expr)) {
    lowerConditionalExpression(expr, ctx);
  } else if (ts.isNonNullExpression(expr)) {
    lowerExpression(expr.expression, ctx);
  } else if (ts.isAsExpression(expr)) {
    lowerExpression(expr.expression, ctx);
  } else if (ts.isAwaitExpression(expr)) {
    lowerAwaitExpression(expr, ctx);
  } else {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.UnsupportedExpression, `Unsupported expression: ${ts.SyntaxKind[expr.kind]}`, expr)
    );
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

  ctx.diagnostics.push(makeDiag(LoweringDiagCode.UndefinedVariable, `Undefined variable: ${expr.text}`, expr));
}

function lowerAwaitExpression(expr: ts.AwaitExpression, ctx: LowerContext): void {
  const irLenBefore = ctx.ir.length;
  lowerExpression(expr.expression, ctx);
  const lastNode = ctx.ir.length > irLenBefore ? ctx.ir[ctx.ir.length - 1] : undefined;
  if (!lastNode || lastNode.kind !== "HostCallArgsAsync") {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.AwaitOnNonAsyncHostCall, "`await` is only supported on async host function calls", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "Await" });
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

  if (ts.isPropertyAccessExpression(expr.expression)) {
    if (lowerStructMethodCall(expr, expr.expression, ctx)) {
      return;
    }
    if (lowerListMethodCall(expr, expr.expression, ctx)) {
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

  ctx.diagnostics.push(makeDiag(LoweringDiagCode.UnsupportedFunctionCall, "Unsupported function call", expr));
}

function lowerStructMethodCall(
  expr: ts.CallExpression,
  propAccess: ts.PropertyAccessExpression,
  ctx: LowerContext
): boolean {
  const receiverType = ctx.checker.getTypeAtLocation(propAccess.expression);
  const structDef = resolveStructType(receiverType);
  if (!structDef) return false;

  const methodName = propAccess.name.text;
  let found = false;
  structDef.methods?.forEach((m) => {
    if (m.name === methodName) found = true;
  });
  if (!found) return false;

  const fnName = `${structDef.name}.${methodName}`;
  const fnEntry = getBrainServices().functions.get(fnName);
  if (!fnEntry) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.UnknownStructMethod,
        `Unknown struct method: '${structDef.name}.${methodName}'`,
        propAccess
      )
    );
    return true;
  }

  lowerExpression(propAccess.expression, ctx);
  for (const arg of expr.arguments) {
    lowerExpression(arg, ctx);
  }
  const argc = expr.arguments.length + 1;
  if (fnEntry.isAsync) {
    ctx.ir.push({ kind: "HostCallArgsAsync", fnName, argc });
  } else {
    ctx.ir.push({ kind: "HostCallArgs", fnName, argc });
  }
  return true;
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

function checkStructAssignmentCompat(lhsNode: ts.Node, rhsNode: ts.Node, diagNode: ts.Node, ctx: LowerContext): void {
  const registry = getBrainServices().types;
  const lhsType = ctx.checker.getTypeAtLocation(lhsNode);
  const rhsType = ctx.checker.getTypeAtLocation(rhsNode);
  const lhsTypeId = tsTypeToTypeId(lhsType, ctx.checker);
  const rhsTypeId = tsTypeToTypeId(rhsType, ctx.checker);
  if (!lhsTypeId || !rhsTypeId || lhsTypeId === rhsTypeId) return;

  const lhsDef = registry.get(lhsTypeId);
  const rhsDef = registry.get(rhsTypeId);
  if (!lhsDef || !rhsDef) return;
  if (lhsDef.coreType !== NativeType.Struct || rhsDef.coreType !== NativeType.Struct) return;

  if (!registry.isStructurallyCompatible(rhsTypeId, lhsTypeId)) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.StructurallyIncompatibleTypes,
        `Type '${rhsDef.name}' is not structurally compatible with '${lhsDef.name}'`,
        diagNode
      )
    );
  }
}

function lowerAssignment(expr: ts.BinaryExpression, ctx: LowerContext): void {
  if (ts.isElementAccessExpression(expr.left)) {
    lowerElementAccessAssignment(expr, ctx);
    return;
  }

  if (!ts.isIdentifier(expr.left)) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.AssignmentTargetNotVariable, "Assignment target must be a variable", expr.left)
    );
    return;
  }

  const target = resolveVarTarget(expr.left.text, ctx);
  if (!target) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.UndefinedVariable, `Undefined variable: ${expr.left.text}`, expr.left)
    );
    return;
  }

  if (expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    lowerExpression(expr.right, ctx);
    checkStructAssignmentCompat(expr.left, expr.right, expr, ctx);
  } else {
    emitLoad(target, ctx);
    lowerExpression(expr.right, ctx);

    const opId = compoundAssignmentToOpId(expr.operatorToken.kind);
    if (!opId) {
      ctx.diagnostics.push(
        makeDiag(
          LoweringDiagCode.UnsupportedCompoundAssignOperator,
          "Unsupported compound assignment operator",
          expr.operatorToken
        )
      );
      return;
    }

    const lhsType = ctx.checker.getTypeAtLocation(expr.left);
    const rhsType = ctx.checker.getTypeAtLocation(expr.right);
    const lhsTypeId = tsTypeToTypeId(lhsType, ctx.checker);
    const rhsTypeId = tsTypeToTypeId(rhsType, ctx.checker);

    if (!lhsTypeId || !rhsTypeId) {
      ctx.diagnostics.push(
        makeDiag(
          LoweringDiagCode.CannotDetermineTypesForCompoundAssign,
          "Cannot determine types for compound assignment",
          expr
        )
      );
      return;
    }

    const fnName = resolveOperatorWithExpansion(opId, [lhsTypeId, rhsTypeId]);
    if (!fnName) {
      ctx.diagnostics.push(
        makeDiag(
          LoweringDiagCode.NoOperatorOverload,
          `No operator overload for ${opId}(${lhsTypeId}, ${rhsTypeId})`,
          expr
        )
      );
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
        ctx.diagnostics.push(makeDiag(LoweringDiagCode.NoOperatorOverload, "No operator overload for negation", expr));
        return;
      }
      ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 1 });
    }
  } else if (expr.operator === ts.SyntaxKind.ExclamationToken) {
    lowerExpression(expr.operand, ctx);
    const operandType = ctx.checker.getTypeAtLocation(expr.operand);
    const operandTypeId = tsTypeToTypeId(operandType, ctx.checker);
    if (!operandTypeId) {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.CannotDetermineTypeForNotOperand, "Cannot determine type for `!` operand", expr)
      );
      return;
    }
    const fnName = resolveOperatorWithExpansion(CoreOpId.Not, [operandTypeId]);
    if (!fnName) {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.NoOperatorOverload, `No operator overload for !(${operandTypeId})`, expr)
      );
      return;
    }
    ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 1 });
  } else if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
    lowerPrefixIncDec(expr, ctx);
  } else {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.UnsupportedPrefixOperator,
        `Unsupported prefix operator: ${ts.SyntaxKind[expr.operator]}`,
        expr
      )
    );
  }
}

function lowerPrefixIncDec(expr: ts.PrefixUnaryExpression, ctx: LowerContext): void {
  if (!ts.isIdentifier(expr.operand)) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.IncrDecrTargetNotVariable,
        "Increment/decrement target must be a variable",
        expr.operand
      )
    );
    return;
  }
  const target = resolveVarTarget(expr.operand.text, ctx);
  if (!target) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.UndefinedVariable, `Undefined variable: ${expr.operand.text}`, expr.operand)
    );
    return;
  }

  const opId = expr.operator === ts.SyntaxKind.PlusPlusToken ? CoreOpId.Add : CoreOpId.Subtract;
  const typeId = CoreTypeIds.Number;
  const fnName = resolveOperator(opId, [typeId, typeId]);
  if (!fnName) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.NoOperatorOverload, `No operator overload for ${opId}(${typeId}, ${typeId})`, expr)
    );
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
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.IncrDecrTargetNotVariable,
        "Increment/decrement target must be a variable",
        expr.operand
      )
    );
    return;
  }
  const target = resolveVarTarget(expr.operand.text, ctx);
  if (!target) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.UndefinedVariable, `Undefined variable: ${expr.operand.text}`, expr.operand)
    );
    return;
  }

  const opId = expr.operator === ts.SyntaxKind.PlusPlusToken ? CoreOpId.Add : CoreOpId.Subtract;
  const typeId = CoreTypeIds.Number;
  const fnName = resolveOperator(opId, [typeId, typeId]);
  if (!fnName) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.NoOperatorOverload, `No operator overload for ${opId}(${typeId}, ${typeId})`, expr)
    );
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

function lowerConditionalExpression(expr: ts.ConditionalExpression, ctx: LowerContext): void {
  const elseLabel = allocLabel(ctx);
  const endLabel = allocLabel(ctx);
  lowerExpression(expr.condition, ctx);
  ctx.ir.push({ kind: "JumpIfFalse", labelId: elseLabel });
  lowerExpression(expr.whenTrue, ctx);
  ctx.ir.push({ kind: "Jump", labelId: endLabel });
  ctx.ir.push({ kind: "Label", labelId: elseLabel });
  lowerExpression(expr.whenFalse, ctx);
  ctx.ir.push({ kind: "Label", labelId: endLabel });
}

function lowerNullishCoalescing(expr: ts.BinaryExpression, ctx: LowerContext): void {
  const keepLabel = allocLabel(ctx);
  const endLabel = allocLabel(ctx);

  lowerExpression(expr.left, ctx);
  ctx.ir.push({ kind: "Dup" });
  ctx.ir.push({ kind: "TypeCheck", nativeType: NativeType.Nil });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: keepLabel });
  ctx.ir.push({ kind: "Pop" });
  lowerExpression(expr.right, ctx);
  ctx.ir.push({ kind: "Jump", labelId: endLabel });
  ctx.ir.push({ kind: "Label", labelId: keepLabel });
  ctx.ir.push({ kind: "Label", labelId: endLabel });
}

function emitToStringIfNeeded(exprNode: ts.Expression, ctx: LowerContext): void {
  const exprType = ctx.checker.getTypeAtLocation(exprNode);
  const typeId = tsTypeToTypeId(exprType, ctx.checker);
  if (!typeId) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.CannotConvertToString,
        "Cannot convert expression to string: unable to determine type",
        exprNode
      )
    );
    return;
  }
  if (typeId !== CoreTypeIds.String) {
    const fnName = runtime.conversionFnName(typeId, CoreTypeIds.String);
    if (!getBrainServices().functions.get(fnName)) {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.NoConversionToString, `No conversion from ${typeId} to string`, exprNode)
      );
      return;
    }
    ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 1 });
  }
}

function lowerTemplateLiteral(expr: ts.TemplateExpression, ctx: LowerContext): void {
  const addFnName = resolveOperator(CoreOpId.Add, [CoreTypeIds.String, CoreTypeIds.String]);
  if (!addFnName) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.NoOverloadForStringConcat, "No operator overload for string concatenation", expr)
    );
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
        LoweringDiagCode.UnsupportedTypeofComparison,
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
      ctx.diagnostics.push(makeDiag(LoweringDiagCode.NoOperatorOverload, "No operator overload for !(boolean)", expr));
      return true;
    }
    ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 1 });
  }

  return true;
}

function lowerElementAccess(expr: ts.ElementAccessExpression, ctx: LowerContext): void {
  const objType = ctx.checker.getTypeAtLocation(expr.expression);
  const listTypeId = resolveListTypeId(objType, ctx);
  if (!listTypeId) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ElementAccessOnNonListType, "Element access is only supported on list types", expr)
    );
    return;
  }
  lowerExpression(expr.expression, ctx);
  lowerExpression(expr.argumentExpression, ctx);
  ctx.ir.push({ kind: "ListGet" });
}

function lowerElementAccessAssignment(expr: ts.BinaryExpression, ctx: LowerContext): void {
  const elemAccess = expr.left as ts.ElementAccessExpression;
  const objType = ctx.checker.getTypeAtLocation(elemAccess.expression);
  const listTypeId = resolveListTypeId(objType, ctx);
  if (!listTypeId) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.ElementAccessAssignOnNonListType,
        "Element access assignment is only supported on list types",
        expr.left
      )
    );
    return;
  }
  lowerExpression(elemAccess.expression, ctx);
  lowerExpression(elemAccess.argumentExpression, ctx);
  lowerExpression(expr.right, ctx);
  ctx.ir.push({ kind: "ListSet" });
}

function lowerListMethodCall(
  expr: ts.CallExpression,
  propAccess: ts.PropertyAccessExpression,
  ctx: LowerContext
): boolean {
  const objType = ctx.checker.getTypeAtLocation(propAccess.expression);
  const listTypeId = resolveListTypeId(objType, ctx);
  if (!listTypeId) return false;

  const methodName = propAccess.name.text;

  switch (methodName) {
    case "push":
      lowerListPush(expr, propAccess, ctx);
      return true;
    case "indexOf":
      lowerListIndexOf(expr, propAccess, ctx);
      return true;
    case "includes":
      lowerListIncludes(expr, propAccess, ctx);
      return true;
    case "filter":
      lowerListFilter(expr, propAccess, listTypeId, ctx);
      return true;
    case "map":
      lowerListMap(expr, propAccess, ctx);
      return true;
    case "forEach":
      lowerListForEach(expr, propAccess, ctx);
      return true;
    case "some":
      lowerListSome(expr, propAccess, ctx);
      return true;
    case "every":
      lowerListEvery(expr, propAccess, ctx);
      return true;
    case "find":
      lowerListFind(expr, propAccess, ctx);
      return true;
    case "concat":
      lowerListConcat(expr, propAccess, listTypeId, ctx);
      return true;
    case "join":
      lowerListJoin(expr, propAccess, ctx);
      return true;
    case "reverse":
      lowerListReverse(expr, propAccess, listTypeId, ctx);
      return true;
    case "slice":
      lowerListSlice(expr, propAccess, listTypeId, ctx);
      return true;
    case "pop":
      lowerListPop(expr, propAccess, ctx);
      return true;
    case "shift":
      lowerListShift(expr, propAccess, ctx);
      return true;
    case "unshift":
      lowerListUnshift(expr, propAccess, ctx);
      return true;
    case "splice":
      lowerListSplice(expr, propAccess, listTypeId, ctx);
      return true;
    case "sort":
      lowerListSort(expr, propAccess, ctx);
      return true;
    case "fill":
    case "copyWithin":
      ctx.diagnostics.push(
        makeDiag(
          LoweringDiagCode.ArrayMethodNotSupported,
          `Array.${methodName}() is not supported (requires VM-level list mutation ops)`,
          expr
        )
      );
      return true;
    default:
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.UnsupportedArrayMethod, `Unsupported array method: .${methodName}()`, expr)
      );
      return true;
  }
}

function lowerListPush(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  if (expr.arguments.length !== 1) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.PushRequiresOneArg, ".push() requires exactly 1 argument", expr));
    return;
  }
  lowerExpression(propAccess.expression, ctx);
  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "ListPush" });
}

function lowerListPop(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  if (expr.arguments.length !== 0) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.PopTakesNoArgs, ".pop() takes no arguments", expr));
    return;
  }
  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "ListPop" });
}

function lowerListShift(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  if (expr.arguments.length !== 0) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.ShiftTakesNoArgs, ".shift() takes no arguments", expr));
    return;
  }
  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "ListShift" });
}

function lowerListUnshift(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  if (expr.arguments.length !== 1) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.UnshiftRequiresOneArg, ".unshift() requires exactly 1 argument", expr)
    );
    return;
  }
  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "ListInsert" });
  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "ListLen" });
}

function lowerListSplice(
  expr: ts.CallExpression,
  propAccess: ts.PropertyAccessExpression,
  listTypeId: string,
  ctx: LowerContext
): void {
  /**
   * Equivalent TS:
   * @example
   *   const removed: T[] = [];
   *   for (let i = 0; i < deleteCount; i++) {
   *     removed.push(arr.splice(start, 1)[0]);
   *   }
   *   for (const item of insertItems) {
   *     arr.splice(start, 0, item); start++;
   *   }
   *   return removed;
   */

  if (expr.arguments.length < 1) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.SpliceRequiresAtLeastOneArg, ".splice() requires at least 1 argument (start)", expr)
    );
    return;
  }

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  const startLocal = ctx.scopeStack.allocLocal();
  const countLocal = ctx.scopeStack.allocLocal();
  const resultLocal = ctx.scopeStack.allocLocal();
  const iLocal = ctx.scopeStack.allocLocal();

  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "StoreLocal", index: startLocal });

  if (expr.arguments.length >= 2) {
    lowerExpression(expr.arguments[1], ctx);
  } else {
    lowerExpression(propAccess.expression, ctx);
    ctx.ir.push({ kind: "ListLen" });
    ctx.ir.push({ kind: "LoadLocal", index: startLocal });
    const subFn = resolveOperator(CoreOpId.Subtract, [CoreTypeIds.Number, CoreTypeIds.Number]);
    if (!subFn) {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve - operator for .splice()", expr)
      );
      return;
    }
    ctx.ir.push({ kind: "HostCallArgs", fnName: subFn, argc: 2 });
  }
  ctx.ir.push({ kind: "StoreLocal", index: countLocal });

  ctx.ir.push({ kind: "ListNew", typeId: listTypeId });
  ctx.ir.push({ kind: "StoreLocal", index: resultLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: iLocal });

  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .splice()", expr)
    );
    return;
  }

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: iLocal });
  ctx.ir.push({ kind: "LoadLocal", index: countLocal });
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "LoadLocal", index: startLocal });
  ctx.ir.push({ kind: "ListRemove" });
  ctx.ir.push({ kind: "ListPush" });
  ctx.ir.push({ kind: "StoreLocal", index: resultLocal });

  ctx.ir.push({ kind: "LoadLocal", index: iLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .splice()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: iLocal });

  ctx.ir.push({ kind: "Jump", labelId: loopStart });
  ctx.ir.push({ kind: "Label", labelId: loopEnd });

  for (let argIdx = 2; argIdx < expr.arguments.length; argIdx++) {
    lowerExpression(propAccess.expression, ctx);
    ctx.ir.push({ kind: "LoadLocal", index: startLocal });
    lowerExpression(expr.arguments[argIdx], ctx);
    ctx.ir.push({ kind: "ListInsert" });

    ctx.ir.push({ kind: "LoadLocal", index: startLocal });
    ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
    ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
    ctx.ir.push({ kind: "StoreLocal", index: startLocal });
  }

  ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
}

function lowerListSort(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  /**
   * Equivalent TS:
   * @example
   *   for (let i = 1; i < arr.length; i++) {
   *     let j = i;
   *     while (j > 0 && compareFn(arr[j - 1], arr[j]) > 0) {
   *       [arr[j - 1], arr[j]] = [arr[j], arr[j - 1]];
   *       j--;
   *     }
   *   }
   *   return arr;
   */

  if (expr.arguments.length !== 1) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.SortRequiresComparatorFn, ".sort() requires a comparator function", expr)
    );
    return;
  }

  const loopOuter = allocLabel(ctx);
  const loopOuterEnd = allocLabel(ctx);
  const loopInner = allocLabel(ctx);
  const loopInnerEnd = allocLabel(ctx);

  const srcListLocal = ctx.scopeStack.allocLocal();
  const callbackLocal = ctx.scopeStack.allocLocal();
  const lenLocal = ctx.scopeStack.allocLocal();
  const iLocal = ctx.scopeStack.allocLocal();
  const jLocal = ctx.scopeStack.allocLocal();

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcListLocal });

  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "StoreLocal", index: callbackLocal });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: lenLocal });

  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .sort()", expr)
    );
    return;
  }
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .sort()", expr)
    );
    return;
  }
  const subFn = resolveOperator(CoreOpId.Subtract, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!subFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve - operator for .sort()", expr)
    );
    return;
  }
  const leFn = resolveOperator(CoreOpId.LessThanOrEqualTo, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!leFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve <= operator for .sort()", expr)
    );
    return;
  }

  // i = 1
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "StoreLocal", index: iLocal });

  // LOOP_OUTER:
  ctx.ir.push({ kind: "Label", labelId: loopOuter });

  // if (!(i < len)) goto END
  ctx.ir.push({ kind: "LoadLocal", index: iLocal });
  ctx.ir.push({ kind: "LoadLocal", index: lenLocal });
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopOuterEnd });

  // j = i
  ctx.ir.push({ kind: "LoadLocal", index: iLocal });
  ctx.ir.push({ kind: "StoreLocal", index: jLocal });

  // LOOP_INNER:
  ctx.ir.push({ kind: "Label", labelId: loopInner });

  // if (j <= 0) goto INNER_END
  ctx.ir.push({ kind: "LoadLocal", index: jLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: leFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfTrue", labelId: loopInnerEnd });

  // cmp = callback(arr[j-1], arr[j])
  // CallIndirect expects stack bottom-to-top: [callback, arg0, arg1]
  ctx.ir.push({ kind: "LoadLocal", index: callbackLocal });

  // arg0: arr[j - 1]
  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: jLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: subFn, argc: 2 });
  ctx.ir.push({ kind: "ListGet" });

  // arg1: arr[j]
  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: jLocal });
  ctx.ir.push({ kind: "ListGet" });

  ctx.ir.push({ kind: "CallIndirect", argc: 2 });

  // if (cmp <= 0) goto INNER_END
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: leFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfTrue", labelId: loopInnerEnd });

  // LIST_SWAP(arr, j - 1, j)
  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: jLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: subFn, argc: 2 });
  ctx.ir.push({ kind: "LoadLocal", index: jLocal });
  ctx.ir.push({ kind: "ListSwap" });

  // j = j - 1
  ctx.ir.push({ kind: "LoadLocal", index: jLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: subFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: jLocal });

  ctx.ir.push({ kind: "Jump", labelId: loopInner });

  // INNER_END:
  ctx.ir.push({ kind: "Label", labelId: loopInnerEnd });

  // i = i + 1
  ctx.ir.push({ kind: "LoadLocal", index: iLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: iLocal });

  ctx.ir.push({ kind: "Jump", labelId: loopOuter });

  // END:
  ctx.ir.push({ kind: "Label", labelId: loopOuterEnd });

  // sort returns the same array
  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
}

function lowerListIndexOf(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  /**
   * Equivalent TS:
   * @example
   *   let idx = 0;
   *   while (idx < arr.length) {
   *     if (arr[idx] === search) return idx; idx++;
   *   }
   *   return -1;
   */
  if (expr.arguments.length !== 1) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.IndexOfRequiresOneArg, ".indexOf() requires exactly 1 argument", expr)
    );
    return;
  }

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);
  const foundLabel = allocLabel(ctx);

  const listLocal = ctx.scopeStack.allocLocal();
  const searchLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const lenLocal = ctx.scopeStack.allocLocal();

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: listLocal });
  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "StoreLocal", index: searchLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  ctx.ir.push({ kind: "LoadLocal", index: listLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: lenLocal });

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: lenLocal });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .indexOf()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: listLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "LoadLocal", index: searchLocal });

  const searchType = ctx.checker.getTypeAtLocation(expr.arguments[0]);
  const searchTypeId = tsTypeToTypeId(searchType, ctx.checker);
  const eqFn = searchTypeId ? resolveOperator(CoreOpId.EqualTo, [searchTypeId, searchTypeId]) : undefined;
  if (!eqFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve === operator for .indexOf()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: eqFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfTrue", labelId: foundLabel });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .indexOf()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: foundLabel });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: allocLabel(ctx) });
  const doneLabel = ctx.nextLabelId - 1;

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(-1) });

  ctx.ir.push({ kind: "Label", labelId: doneLabel });
}

function lowerListFilter(
  expr: ts.CallExpression,
  propAccess: ts.PropertyAccessExpression,
  listTypeId: string,
  ctx: LowerContext
): void {
  /**
   * Equivalent TS:
   * @example
   *   const result: T[] = [];
   *   for (let i = 0; i < arr.length; i++) {
   *     const elem = arr[i]; if (callback(elem)) result.push(elem);
   *   }
   *   return result;
   */
  if (expr.arguments.length !== 1) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.FilterRequiresOneArg, ".filter() requires exactly 1 argument", expr)
    );
    return;
  }

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);
  const skipLabel = allocLabel(ctx);

  const srcListLocal = ctx.scopeStack.allocLocal();
  const resultListLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const lenLocal = ctx.scopeStack.allocLocal();
  const callbackLocal = ctx.scopeStack.allocLocal();

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcListLocal });

  ctx.ir.push({ kind: "ListNew", typeId: listTypeId });
  ctx.ir.push({ kind: "StoreLocal", index: resultListLocal });

  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "StoreLocal", index: callbackLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: lenLocal });

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: lenLocal });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .filter()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });

  ctx.ir.push({ kind: "Dup" });

  ctx.ir.push({ kind: "LoadLocal", index: callbackLocal });
  ctx.ir.push({ kind: "Swap" });
  ctx.ir.push({ kind: "CallIndirect", argc: 1 });

  ctx.ir.push({ kind: "JumpIfFalse", labelId: skipLabel });

  ctx.ir.push({ kind: "LoadLocal", index: resultListLocal });
  ctx.ir.push({ kind: "Swap" });
  ctx.ir.push({ kind: "ListPush" });
  ctx.ir.push({ kind: "StoreLocal", index: resultListLocal });
  const afterPushLabel = allocLabel(ctx);
  ctx.ir.push({ kind: "Jump", labelId: afterPushLabel });

  ctx.ir.push({ kind: "Label", labelId: skipLabel });
  ctx.ir.push({ kind: "Pop" });

  ctx.ir.push({ kind: "Label", labelId: afterPushLabel });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .filter()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "LoadLocal", index: resultListLocal });
}

function lowerListMap(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  /**
   * Equivalent TS:
   * @example
   *   const result: U[] = [];
   *   for (let i = 0; i < arr.length; i++) result.push(callback(arr[i]));
   *   return result;
   */
  if (expr.arguments.length !== 1) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.MapRequiresOneArg, ".map() requires exactly 1 argument", expr));
    return;
  }

  const returnType = ctx.checker.getTypeAtLocation(expr);
  const resultListTypeId = resolveListTypeId(returnType, ctx);
  if (!resultListTypeId) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.CannotDetermineMapResultListType,
        "Cannot determine result list type for .map() (add a type annotation)",
        expr
      )
    );
    return;
  }

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  const srcListLocal = ctx.scopeStack.allocLocal();
  const resultListLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const lenLocal = ctx.scopeStack.allocLocal();
  const callbackLocal = ctx.scopeStack.allocLocal();

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcListLocal });

  ctx.ir.push({ kind: "ListNew", typeId: resultListTypeId });
  ctx.ir.push({ kind: "StoreLocal", index: resultListLocal });

  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "StoreLocal", index: callbackLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: lenLocal });

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: lenLocal });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .map()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: callbackLocal });
  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "CallIndirect", argc: 1 });

  ctx.ir.push({ kind: "LoadLocal", index: resultListLocal });
  ctx.ir.push({ kind: "Swap" });
  ctx.ir.push({ kind: "ListPush" });
  ctx.ir.push({ kind: "StoreLocal", index: resultListLocal });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .map()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "LoadLocal", index: resultListLocal });
}

function lowerListForEach(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  /**
   * Equivalent TS:
   * @example
   *   for (let i = 0; i < arr.length; i++) callback(arr[i]);
   */
  if (expr.arguments.length !== 1) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForEachRequiresOneArg, ".forEach() requires exactly 1 argument", expr)
    );
    return;
  }

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  const srcListLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const lenLocal = ctx.scopeStack.allocLocal();
  const callbackLocal = ctx.scopeStack.allocLocal();

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcListLocal });

  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "StoreLocal", index: callbackLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: lenLocal });

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: lenLocal });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .forEach()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: callbackLocal });
  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "CallIndirect", argc: 1 });
  ctx.ir.push({ kind: "Pop" });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .forEach()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "PushConst", value: NIL_VALUE });
}

function lowerListIncludes(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  /**
   * Equivalent TS:
   * @example
   *   for (let i = 0; i < arr.length; i++) { if (arr[i] === search) return true; }
   *   return false;
   */
  if (expr.arguments.length !== 1) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.IncludesRequiresOneArg, ".includes() requires exactly 1 argument", expr)
    );
    return;
  }

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);
  const foundLabel = allocLabel(ctx);
  const doneLabel = allocLabel(ctx);

  const listLocal = ctx.scopeStack.allocLocal();
  const searchLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const lenLocal = ctx.scopeStack.allocLocal();

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: listLocal });
  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "StoreLocal", index: searchLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  ctx.ir.push({ kind: "LoadLocal", index: listLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: lenLocal });

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: lenLocal });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .includes()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: listLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "LoadLocal", index: searchLocal });

  const searchType = ctx.checker.getTypeAtLocation(expr.arguments[0]);
  const searchTypeId = tsTypeToTypeId(searchType, ctx.checker);
  const eqFn = searchTypeId ? resolveOperator(CoreOpId.EqualTo, [searchTypeId, searchTypeId]) : undefined;
  if (!eqFn) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.CannotResolveOperatorForArrayMethod,
        "Cannot resolve === operator for .includes()",
        expr
      )
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: eqFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfTrue", labelId: foundLabel });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .includes()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: foundLabel });
  ctx.ir.push({ kind: "PushConst", value: TRUE_VALUE });
  ctx.ir.push({ kind: "Jump", labelId: doneLabel });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "PushConst", value: FALSE_VALUE });

  ctx.ir.push({ kind: "Label", labelId: doneLabel });
}

function lowerListSome(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  /**
   * Equivalent TS:
   * @example
   *   for (let i = 0; i < arr.length; i++) { if (callback(arr[i])) return true; }
   *   return false;
   */
  if (expr.arguments.length !== 1) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.SomeRequiresOneArg, ".some() requires exactly 1 argument", expr));
    return;
  }

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);
  const foundLabel = allocLabel(ctx);
  const doneLabel = allocLabel(ctx);

  const srcListLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const lenLocal = ctx.scopeStack.allocLocal();
  const callbackLocal = ctx.scopeStack.allocLocal();

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcListLocal });

  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "StoreLocal", index: callbackLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: lenLocal });

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: lenLocal });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .some()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: callbackLocal });
  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "CallIndirect", argc: 1 });
  ctx.ir.push({ kind: "JumpIfTrue", labelId: foundLabel });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .some()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: foundLabel });
  ctx.ir.push({ kind: "PushConst", value: TRUE_VALUE });
  ctx.ir.push({ kind: "Jump", labelId: doneLabel });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "PushConst", value: FALSE_VALUE });

  ctx.ir.push({ kind: "Label", labelId: doneLabel });
}

function lowerListEvery(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  /**
   * Equivalent TS:
   * @example
   *   for (let i = 0; i < arr.length; i++) { if (!callback(arr[i])) return false; }
   *   return true;
   */
  if (expr.arguments.length !== 1) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.EveryRequiresOneArg, ".every() requires exactly 1 argument", expr));
    return;
  }

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);
  const failLabel = allocLabel(ctx);
  const doneLabel = allocLabel(ctx);

  const srcListLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const lenLocal = ctx.scopeStack.allocLocal();
  const callbackLocal = ctx.scopeStack.allocLocal();

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcListLocal });

  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "StoreLocal", index: callbackLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: lenLocal });

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: lenLocal });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .every()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: callbackLocal });
  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "CallIndirect", argc: 1 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: failLabel });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .every()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "PushConst", value: TRUE_VALUE });
  ctx.ir.push({ kind: "Jump", labelId: doneLabel });

  ctx.ir.push({ kind: "Label", labelId: failLabel });
  ctx.ir.push({ kind: "PushConst", value: FALSE_VALUE });

  ctx.ir.push({ kind: "Label", labelId: doneLabel });
}

function lowerListFind(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  /**
   * Equivalent TS:
   * @example
   *   for (let i = 0; i < arr.length; i++) {
   *     const elem = arr[i]; if (callback(elem)) return elem;
   *   }
   *   return undefined;
   */
  if (expr.arguments.length !== 1) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.FindRequiresOneArg, ".find() requires exactly 1 argument", expr));
    return;
  }

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);
  const foundLabel = allocLabel(ctx);
  const doneLabel = allocLabel(ctx);

  const srcListLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const lenLocal = ctx.scopeStack.allocLocal();
  const callbackLocal = ctx.scopeStack.allocLocal();
  const elemLocal = ctx.scopeStack.allocLocal();

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcListLocal });

  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "StoreLocal", index: callbackLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: lenLocal });

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: lenLocal });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .find()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "StoreLocal", index: elemLocal });

  ctx.ir.push({ kind: "LoadLocal", index: callbackLocal });
  ctx.ir.push({ kind: "LoadLocal", index: elemLocal });
  ctx.ir.push({ kind: "CallIndirect", argc: 1 });
  ctx.ir.push({ kind: "JumpIfTrue", labelId: foundLabel });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .find()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: foundLabel });
  ctx.ir.push({ kind: "LoadLocal", index: elemLocal });
  ctx.ir.push({ kind: "Jump", labelId: doneLabel });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "PushConst", value: NIL_VALUE });

  ctx.ir.push({ kind: "Label", labelId: doneLabel });
}

function lowerListConcat(
  expr: ts.CallExpression,
  propAccess: ts.PropertyAccessExpression,
  listTypeId: string,
  ctx: LowerContext
): void {
  /**
   * Equivalent TS:
   * @example
   *   const result: T[] = [...arr, ...args[0], ...args[1], ...];
   *   return result;
   */
  const resultLocal = ctx.scopeStack.allocLocal();

  ctx.ir.push({ kind: "ListNew", typeId: listTypeId });
  ctx.ir.push({ kind: "StoreLocal", index: resultLocal });

  emitPushAllFromList(propAccess.expression, resultLocal, ctx, expr);

  for (const arg of expr.arguments) {
    emitPushAllFromList(arg, resultLocal, ctx, expr);
  }

  ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
}

function emitPushAllFromList(srcExpr: ts.Expression, resultLocal: number, ctx: LowerContext, diagNode: ts.Node): void {
  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  const srcLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const lenLocal = ctx.scopeStack.allocLocal();

  lowerExpression(srcExpr, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  ctx.ir.push({ kind: "LoadLocal", index: srcLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: lenLocal });

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: lenLocal });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.CannotResolveOperatorForArrayMethod,
        "Cannot resolve < operator for .concat()",
        diagNode
      )
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
  ctx.ir.push({ kind: "LoadLocal", index: srcLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "ListPush" });
  ctx.ir.push({ kind: "StoreLocal", index: resultLocal });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.CannotResolveOperatorForArrayMethod,
        "Cannot resolve + operator for .concat()",
        diagNode
      )
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
}

function lowerListJoin(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  /**
   * Equivalent TS:
   * @example
   *   let result = "";
   *   for (let i = 0; i < arr.length; i++) {
   *     if (i !== 0) result += sep;
   *     result += String(arr[i]);
   *   }
   *   return result;
   */
  if (expr.arguments.length > 1) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.JoinTakesAtMostOneArg, ".join() takes at most 1 argument", expr));
    return;
  }

  const addFnName = resolveOperator(CoreOpId.Add, [CoreTypeIds.String, CoreTypeIds.String]);
  if (!addFnName) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.NoOverloadForStringConcat, "Cannot resolve string concatenation for .join()", expr)
    );
    return;
  }

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);
  const skipSepLabel = allocLabel(ctx);

  const srcListLocal = ctx.scopeStack.allocLocal();
  const sepLocal = ctx.scopeStack.allocLocal();
  const resultLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const lenLocal = ctx.scopeStack.allocLocal();

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcListLocal });

  if (expr.arguments.length === 1) {
    lowerExpression(expr.arguments[0], ctx);
  } else {
    ctx.ir.push({ kind: "PushConst", value: mkStringValue(",") });
  }
  ctx.ir.push({ kind: "StoreLocal", index: sepLocal });

  ctx.ir.push({ kind: "PushConst", value: mkStringValue("") });
  ctx.ir.push({ kind: "StoreLocal", index: resultLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: lenLocal });

  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .join()", expr)
    );
    return;
  }

  const eqFn = resolveOperator(CoreOpId.EqualTo, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!eqFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve === operator for .join()", expr)
    );
    return;
  }

  const addNumFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addNumFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .join()", expr)
    );
    return;
  }

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: lenLocal });
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: eqFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfTrue", labelId: skipSepLabel });

  ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
  ctx.ir.push({ kind: "LoadLocal", index: sepLocal });
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFnName, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: resultLocal });

  ctx.ir.push({ kind: "Label", labelId: skipSepLabel });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });

  emitToStringForJoinElement(ctx, expr);

  ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
  ctx.ir.push({ kind: "Swap" });
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFnName, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: resultLocal });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: addNumFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
}

function emitToStringForJoinElement(ctx: LowerContext, diagNode: ts.Node): void {
  const fnName = runtime.conversionFnName(CoreTypeIds.Number, CoreTypeIds.String);
  if (!getBrainServices().functions.get(fnName)) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.CannotConvertListElementToString,
        "Cannot convert list element to string for .join()",
        diagNode
      )
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 1 });
}

function lowerListReverse(
  expr: ts.CallExpression,
  propAccess: ts.PropertyAccessExpression,
  listTypeId: string,
  ctx: LowerContext
): void {
  /**
   * Equivalent TS:
   * @example
   *   const result: T[] = [];
   *   for (let i = arr.length - 1; i >= 0; i--) result.push(arr[i]);
   *   return result;
   */
  if (expr.arguments.length !== 0) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.ReverseTakesNoArgs, ".reverse() takes no arguments", expr));
    return;
  }

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  const srcListLocal = ctx.scopeStack.allocLocal();
  const resultLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcListLocal });

  ctx.ir.push({ kind: "ListNew", typeId: listTypeId });
  ctx.ir.push({ kind: "StoreLocal", index: resultLocal });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const subFn = resolveOperator(CoreOpId.Subtract, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!subFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve - operator for .reverse()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: subFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  const geqFn = resolveOperator(CoreOpId.GreaterThanOrEqualTo, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!geqFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve >= operator for .reverse()", expr)
    );
    return;
  }

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: geqFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "ListPush" });
  ctx.ir.push({ kind: "StoreLocal", index: resultLocal });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: subFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
}

function lowerListSlice(
  expr: ts.CallExpression,
  propAccess: ts.PropertyAccessExpression,
  listTypeId: string,
  ctx: LowerContext
): void {
  /**
   * Equivalent TS:
   * @example
   *   const result: T[] = [];
   *   for (let i = start ?? 0; i < (end ?? arr.length); i++) result.push(arr[i]);
   *   return result;
   */
  if (expr.arguments.length > 2) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.SliceTakesAtMostTwoArgs, ".slice() takes at most 2 arguments", expr)
    );
    return;
  }

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  const srcListLocal = ctx.scopeStack.allocLocal();
  const resultLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const endLocal = ctx.scopeStack.allocLocal();

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcListLocal });

  ctx.ir.push({ kind: "ListNew", typeId: listTypeId });
  ctx.ir.push({ kind: "StoreLocal", index: resultLocal });

  if (expr.arguments.length >= 1) {
    lowerExpression(expr.arguments[0], ctx);
  } else {
    ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  }
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  if (expr.arguments.length >= 2) {
    lowerExpression(expr.arguments[1], ctx);
  } else {
    ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
    ctx.ir.push({ kind: "ListLen" });
  }
  ctx.ir.push({ kind: "StoreLocal", index: endLocal });

  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .slice()", expr)
    );
    return;
  }

  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .slice()", expr)
    );
    return;
  }

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: endLocal });
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "ListPush" });
  ctx.ir.push({ kind: "StoreLocal", index: resultLocal });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
}

function lowerBinaryExpression(expr: ts.BinaryExpression, ctx: LowerContext): void {
  if (
    expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    expr.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    lowerShortCircuit(expr, ctx);
    return;
  }

  if (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    lowerNullishCoalescing(expr, ctx);
    return;
  }

  if (lowerTypeofComparison(expr, ctx)) {
    return;
  }

  const opId = tsOperatorToOpId(expr.operatorToken.kind);
  if (!opId) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.UnsupportedOperator,
        `Unsupported operator: ${ts.SyntaxKind[expr.operatorToken.kind]}`,
        expr.operatorToken
      )
    );
    return;
  }

  lowerExpression(expr.left, ctx);
  lowerExpression(expr.right, ctx);

  const lhsType = ctx.checker.getTypeAtLocation(expr.left);
  const rhsType = ctx.checker.getTypeAtLocation(expr.right);

  const lhsTypeId = tsTypeToTypeId(lhsType, ctx.checker);
  const rhsTypeId = tsTypeToTypeId(rhsType, ctx.checker);

  if (!lhsTypeId || !rhsTypeId) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotDetermineTypesForBinaryOp, "Cannot determine types for binary operator", expr)
    );
    return;
  }

  const fnName = resolveOperator(opId, [lhsTypeId, rhsTypeId]);
  if (!fnName) {
    const fallbackFn = resolveOperatorWithExpansion(opId, [lhsTypeId, rhsTypeId]);
    if (fallbackFn) {
      ctx.ir.push({ kind: "HostCallArgs", fnName: fallbackFn, argc: 2 });
      return;
    }
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.NoOperatorOverload,
        `No operator overload for ${opId}(${lhsTypeId}, ${rhsTypeId})`,
        expr
      )
    );
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

  const objType = ctx.checker.getTypeAtLocation(expr.expression);
  const structDef = resolveStructType(objType);
  if (structDef) {
    const fieldName = expr.name.text;
    const hasField = structDef.fields.toArray().some((f) => f.name === fieldName);
    if (!hasField) {
      ctx.diagnostics.push(
        makeDiag(
          LoweringDiagCode.PropertyNotOnStruct,
          `Property '${fieldName}' does not exist on struct '${structDef.name}'`,
          expr
        )
      );
      return;
    }
    lowerExpression(expr.expression, ctx);
    ctx.ir.push({ kind: "GetField", fieldName });
    return;
  }

  ctx.diagnostics.push(makeDiag(LoweringDiagCode.UnsupportedPropertyAccess, "Unsupported property access", expr));
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
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.CannotDetermineTypeForObjectLiteral,
        "Cannot determine type for object literal (add a type annotation)",
        expr
      )
    );
    return;
  }

  const structDef = resolveStructType(contextualType);
  if (structDef) {
    if (isNativeBackedStruct(structDef)) {
      ctx.diagnostics.push(
        makeDiag(
          LoweringDiagCode.CannotInstantiateNativeBackedStruct,
          `Cannot create instances of native-backed struct type '${structDef.name}'`,
          expr
        )
      );
      return;
    }
    lowerObjectLiteralAsStruct(expr, structDef, ctx);
    return;
  }

  const mapTypeId = resolveMapTypeId(contextualType, ctx);
  if (mapTypeId) {
    lowerObjectLiteralAsMap(expr, mapTypeId, ctx);
    return;
  }

  ctx.diagnostics.push(
    makeDiag(
      LoweringDiagCode.ObjectLiteralTypeUnresolvable,
      "Object literal type does not resolve to a known struct or map type",
      expr
    )
  );
}

function lowerObjectLiteralAsStruct(
  expr: ts.ObjectLiteralExpression,
  structDef: StructTypeDef,
  ctx: LowerContext
): void {
  ctx.ir.push({ kind: "StructNew", typeId: structDef.typeId });

  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      ctx.diagnostics.push(
        makeDiag(
          LoweringDiagCode.UnsupportedPropertyInObjectLiteral,
          "Only simple property assignments are supported in object literals",
          prop
        )
      );
      return;
    }
    let fieldName: string;
    if (ts.isIdentifier(prop.name)) {
      fieldName = prop.name.text;
    } else if (ts.isStringLiteral(prop.name)) {
      fieldName = prop.name.text;
    } else {
      ctx.diagnostics.push(
        makeDiag(
          LoweringDiagCode.UnsupportedPropertyNameInObjectLiteral,
          "Unsupported property name in object literal",
          prop
        )
      );
      return;
    }
    ctx.ir.push({ kind: "PushConst", value: mkStringValue(fieldName) });
    lowerExpression(prop.initializer, ctx);
    ctx.ir.push({ kind: "StructSet" });
  }
}

function lowerObjectLiteralAsMap(expr: ts.ObjectLiteralExpression, mapTypeId: string, ctx: LowerContext): void {
  ctx.ir.push({ kind: "MapNew", typeId: mapTypeId });

  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      ctx.diagnostics.push(
        makeDiag(
          LoweringDiagCode.UnsupportedPropertyInMapLiteral,
          "Only simple property assignments are supported in map literals",
          prop
        )
      );
      return;
    }
    let keyName: string;
    if (ts.isIdentifier(prop.name)) {
      keyName = prop.name.text;
    } else if (ts.isStringLiteral(prop.name)) {
      keyName = prop.name.text;
    } else {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.UnsupportedPropertyNameInMapLiteral, "Unsupported property name in map literal", prop)
      );
      return;
    }
    ctx.ir.push({ kind: "PushConst", value: mkStringValue(keyName) });
    lowerExpression(prop.initializer, ctx);
    ctx.ir.push({ kind: "MapSet" });
  }
}

function resolveMapTypeId(type: ts.Type, ctx: LowerContext): string | undefined {
  const registry = getBrainServices().types;

  if (type.isUnion()) {
    const nonNullish = type.types.filter((t) => !(t.flags & ts.TypeFlags.Null) && !(t.flags & ts.TypeFlags.Undefined));
    if (nonNullish.length === 1) {
      return resolveMapTypeId(nonNullish[0], ctx);
    }
    return undefined;
  }

  const sym = type.aliasSymbol ?? type.getSymbol();
  if (sym) {
    const name = sym.getName();
    const typeId = registry.resolveByName(name);
    if (typeId) {
      const def = registry.get(typeId);
      if (def && def.coreType === NativeType.Map) return def.typeId;
    }
  }

  const indexType = type.getStringIndexType();
  if (indexType) {
    const valueTypeId = tsTypeToTypeId(indexType, ctx.checker);
    if (valueTypeId) {
      return registry.instantiate("Map", List.from([valueTypeId]));
    }
  }

  return undefined;
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
  const elementTypeId = tsTypeToTypeId(elementType, ctx.checker);
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
        LoweringDiagCode.CannotDetermineListType,
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

function tryResolveEnumValue(expr: ts.StringLiteral, ctx: LowerContext): Value | undefined {
  const contextualType = ctx.checker.getContextualType(expr);
  if (!contextualType) return undefined;
  const sym = contextualType.getSymbol() ?? contextualType.aliasSymbol;
  if (!sym) return undefined;
  const registry = getBrainServices().types;
  const typeId = registry.resolveByName(sym.getName());
  if (!typeId) return undefined;
  const typeDef = registry.get(typeId);
  if (!typeDef || typeDef.coreType !== NativeType.Enum) return undefined;
  return { t: NativeType.Enum, typeId, v: expr.text };
}

function tsTypeToTypeId(type: ts.Type, checker?: ts.TypeChecker): string | undefined {
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
  if (type.flags & ts.TypeFlags.Void) {
    return CoreTypeIds.Void;
  }
  const callSigs = type.getCallSignatures();
  if (callSigs.length > 0 && checker) {
    const sig = callSigs[0];
    const paramTypeIds = new List<string>();
    let allResolved = true;
    for (const param of sig.parameters) {
      const paramType = checker.getTypeOfSymbol(param);
      const paramTid = tsTypeToTypeId(paramType, checker);
      if (!paramTid) {
        allResolved = false;
        break;
      }
      paramTypeIds.push(paramTid);
    }
    if (allResolved) {
      const retType = sig.getReturnType();
      const retTid = tsTypeToTypeId(retType, checker);
      if (retTid) {
        return getBrainServices().types.getOrCreateFunctionType({
          paramTypeIds,
          returnTypeId: retTid,
        });
      }
    }
    return CoreTypeIds.Function;
  }
  if (callSigs.length > 0) {
    return CoreTypeIds.Function;
  }
  if (type.isUnion()) {
    const nonNullish = type.types.filter((t) => !(t.flags & ts.TypeFlags.Null) && !(t.flags & ts.TypeFlags.Undefined));
    const hasNullish = nonNullish.length < type.types.length;
    if (nonNullish.length === 1) {
      const baseTypeId = tsTypeToTypeId(nonNullish[0], checker);
      if (!baseTypeId) return undefined;
      if (hasNullish) {
        return getBrainServices().types.addNullableType(baseTypeId);
      }
      return baseTypeId;
    }
    if (nonNullish.length >= 2) {
      const memberIds = new List<string>();
      for (const t of nonNullish) {
        const id = tsTypeToTypeId(t, checker);
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

function makeDiag(code: LoweringDiagCode, message: string, node: ts.Node): CompileDiagnostic {
  const sourceFile = node.getSourceFile();
  const diag: CompileDiagnostic = { code, message };
  if (sourceFile) {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    diag.line = pos.line + 1;
    diag.column = pos.character + 1;
  }
  return diag;
}
