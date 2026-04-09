import { List } from "@mindcraft-lang/core";
import {
  type BrainServices,
  ContextTypeIds,
  CoreOpId,
  CoreTypeIds,
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
import { CompileDiagCode, LoweringDiagCode } from "./diag-codes.js";
import type { IrNode, IrSourceSpan } from "./ir.js";
import { type LocalMetadata, type ScopeMetadata, ScopeStack } from "./scope.js";
import type { CompileDiagnostic, ExtractedDescriptor } from "./types.js";

const TRUE_VALUE: Value = { t: 2, v: true };
const FALSE_VALUE: Value = { t: 2, v: false };

export interface FunctionEntry {
  ir: IrNode[];
  numParams: number;
  numLocals: number;
  name: string;
  injectCtxTypeId?: TypeId;
  scopeMetadata?: ScopeMetadata[];
  localMetadata?: LocalMetadata[];
  isGenerated?: boolean;
  parentName?: string;
  sourceFileName?: string;
  functionSpan?: IrSourceSpan;
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

export interface ImportedClass {
  node: ts.ClassDeclaration;
  name: string;
  sourceFile: ts.SourceFile;
}

export interface ImportedEnum {
  node: ts.EnumDeclaration;
  name: string;
  sourceFile: ts.SourceFile;
}

export interface ImportedInterface {
  node: ts.InterfaceDeclaration;
  name: string;
  sourceFile: ts.SourceFile;
}

export interface ImportedTypeAlias {
  node: ts.TypeAliasDeclaration;
  name: string;
  sourceFile: ts.SourceFile;
}

interface ClassInfo {
  node: ts.ClassDeclaration;
  name: string;
  sourceFile: ts.SourceFile;
  constructorFuncId: number;
  methodFuncIds: Map<string, number>;
}

interface InterfaceInfo {
  node: ts.InterfaceDeclaration;
  name: string;
  sourceFile: ts.SourceFile;
}

interface TypeAliasInfo {
  node: ts.TypeAliasDeclaration;
  name: string;
  sourceFile: ts.SourceFile;
}

export function qualifiedClassName(fileName: string, className: string): string {
  return `${fileName}::${className}`;
}

function resolveAliasedSymbol(symbol: ts.Symbol | undefined, checker?: ts.TypeChecker): ts.Symbol | undefined {
  if (!symbol || !checker || !(symbol.flags & ts.SymbolFlags.Alias)) {
    return symbol;
  }
  return checker.getAliasedSymbol(symbol);
}

function isUserSourceDecl(decl: ts.Declaration): boolean {
  const sf = decl.getSourceFile();
  return !sf.fileName.endsWith(".d.ts");
}

export interface ProgramLoweringResult {
  functions: FunctionEntry[];
  entryFuncId: number;
  activationFuncId?: number;
  numStateSlots: number;
  functionTable: Map<string, number>;
  diagnostics: CompileDiagnostic[];
}

interface LoopContext {
  continueLabel: number;
  breakLabel: number;
}

interface LowerContext {
  services: BrainServices;
  checker: ts.TypeChecker;
  paramsSymbol: ts.Symbol | undefined;
  paramLocals: Map<string, number>;
  scopeStack: ScopeStack;
  ir: IrNode[];
  diagnostics: CompileDiagnostic[];
  loopStack: LoopContext[];
  breakStack: number[];
  nextLabelId: number;
  callsiteVars: Map<string, number>;
  functionTable: Map<string, number>;
  capturedVars?: Map<string, number>;
  funcIdCounter: { value: number };
  closureFunctions: Map<number, FunctionEntry>;
  thisLocalIndex?: number;
  currentFunctionName: string;
  currentReturnTypeId?: TypeId;
}

function allocLabel(ctx: LowerContext): number {
  return ctx.nextLabelId++;
}

function pushLoopContext(continueLabel: number, breakLabel: number, ctx: LowerContext): void {
  ctx.loopStack.push({ continueLabel, breakLabel });
  ctx.breakStack.push(breakLabel);
}

function popLoopContext(ctx: LowerContext): void {
  ctx.loopStack.pop();
  ctx.breakStack.pop();
}

function resolveOperator(opId: string, argTypes: string[], services: BrainServices): string | undefined {
  return services.operatorOverloads.resolve(opId, argTypes)?.overload.fnEntry.name;
}

// Operator resolution with type expansion: if a direct overload lookup fails,
// expand union/struct types into their constituent members and check whether
// ALL members map to the same operator function. This allows e.g. (A | B) + Number
// to resolve when both A + Number and B + Number use the same underlying function.
function resolveOperatorWithExpansion(opId: string, argTypes: string[], services: BrainServices): string | undefined {
  const direct = resolveOperator(opId, argTypes, services);
  if (direct) return direct;

  if (argTypes.length === 1) {
    const members = expandTypeIdMembers(argTypes[0], services);
    if (members.length === 1 && members[0] === argTypes[0]) return undefined;
    let resolved: string | undefined;
    for (const m of members) {
      const fn = resolveOperator(opId, [m], services);
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
    const lhsMembers = expandTypeIdMembers(argTypes[0], services);
    const rhsMembers = expandTypeIdMembers(argTypes[1], services);
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
        const fn = resolveOperator(opId, [l, r], services);
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

interface SingleStepConversionResolution {
  fromTypeId: string;
  toTypeId: string;
  fnName: string;
}

interface BinaryOperatorResolution {
  operatorFnName: string;
  conversion?: SingleStepConversionResolution & { operand: "left" | "right" };
}

type TargetTypedConversionResolution =
  | { kind: "none" }
  | { kind: "convert"; conversion: SingleStepConversionResolution }
  | { kind: "missing" }
  | { kind: "ambiguous" };

function resolveRegisteredEnumTypeIdFromSymbol(
  sym: ts.Symbol,
  services: BrainServices,
  checker?: ts.TypeChecker
): string | undefined {
  const resolvedSym = resolveAliasedSymbol(sym, checker);
  if (!resolvedSym) return undefined;

  const registry = services.types;
  const typeId = registry.resolveByName(resolveRegistryName(resolvedSym, services, checker));
  if (!typeId) return undefined;

  const typeDef = registry.get(typeId);
  if (!typeDef || typeDef.coreType !== NativeType.Enum) {
    return undefined;
  }

  return typeId;
}

function resolveRegisteredEnumTypeId(
  type: ts.Type,
  services: BrainServices,
  checker?: ts.TypeChecker
): string | undefined {
  const sym = type.getSymbol() ?? type.aliasSymbol;
  if (!sym) return undefined;
  return resolveRegisteredEnumTypeIdFromSymbol(sym, services, checker);
}

function unwrapTypeResolutionExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression;
  }
  return current;
}

function resolveDeclaredEnumTypeId(exprNode: ts.Expression, ctx: LowerContext): string | undefined {
  const targetExpr = unwrapTypeResolutionExpression(exprNode);
  if (!ts.isIdentifier(targetExpr)) {
    return undefined;
  }

  const symbol = ctx.checker.getSymbolAtLocation(targetExpr);
  const declaration = symbol?.valueDeclaration;
  if (!symbol || !declaration) {
    return undefined;
  }

  const declaredType = ctx.checker.getTypeOfSymbolAtLocation(symbol, declaration);
  return resolveRegisteredEnumTypeId(declaredType, ctx.services, ctx.checker);
}

function resolveExpressionTypeId(exprNode: ts.Expression, ctx: LowerContext): string | undefined {
  if (ts.isStringLiteral(exprNode)) {
    const enumValue = tryResolveEnumValue(exprNode, ctx);
    if (enumValue && enumValue.t === NativeType.Enum) {
      return enumValue.typeId;
    }
  }

  if (ts.isPropertyAccessExpression(exprNode)) {
    const enumAccess = resolveEnumPropertyAccess(exprNode, ctx);
    if (enumAccess?.kind === "member" && enumAccess.value.t === NativeType.Enum) {
      return enumAccess.value.typeId;
    }
  }

  const declaredEnumTypeId = resolveDeclaredEnumTypeId(exprNode, ctx);
  if (declaredEnumTypeId) {
    return declaredEnumTypeId;
  }

  const exprType = ctx.checker.getTypeAtLocation(exprNode);
  return tsTypeToTypeId(exprType, ctx.checker, ctx.services);
}

function resolveSingleStepConversion(
  fromTypeId: string,
  toTypeId: string,
  services: BrainServices
): SingleStepConversionResolution | undefined {
  if (fromTypeId === toTypeId) {
    return undefined;
  }

  const conversionPath = services.conversions.findBestPath(fromTypeId, toTypeId, 1);
  const conversion = conversionPath?.get(0);
  if (!conversion) {
    return undefined;
  }

  return {
    fromTypeId: conversion.fromType,
    toTypeId: conversion.toType,
    fnName: runtime.conversionFnName(conversion.fromType, conversion.toType),
  };
}

function emitSingleStepConversion(fnName: string, ctx: LowerContext): void {
  ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 1 });
}

function resolveExpandedTargetTypeIds(expectedTypeId: TypeId, services: BrainServices): TypeId[] {
  const registry = services.types;
  const typeDef = registry.get(expectedTypeId);
  if (!typeDef) {
    return [expectedTypeId];
  }

  if (typeDef.nullable) {
    return [(typeDef as NullableTypeDef).baseTypeId, CoreTypeIds.Nil];
  }

  if (typeDef.coreType === NativeType.Union) {
    const memberTypeIds: TypeId[] = [];
    (typeDef as UnionTypeDef).memberTypeIds.forEach((memberTypeId) => {
      memberTypeIds.push(memberTypeId);
    });
    return memberTypeIds;
  }

  return [expectedTypeId];
}

function isSatisfiedWithoutTargetTypeConversion(
  sourceTypeId: TypeId,
  expectedTypeId: TypeId,
  services: BrainServices
): boolean {
  if (sourceTypeId === expectedTypeId || expectedTypeId === CoreTypeIds.Any || sourceTypeId === CoreTypeIds.Any) {
    return true;
  }

  const registry = services.types;
  const sourceDef = registry.get(sourceTypeId);
  const expectedDef = registry.get(expectedTypeId);
  if (!sourceDef || !expectedDef) {
    return false;
  }

  if (sourceDef.coreType === NativeType.Struct && expectedDef.coreType === NativeType.Struct) {
    return registry.isStructurallyCompatible(sourceTypeId, expectedTypeId);
  }

  if (sourceDef.coreType === NativeType.List && expectedDef.coreType === NativeType.List) {
    return true;
  }

  if (sourceDef.coreType === NativeType.Map && expectedDef.coreType === NativeType.Map) {
    return true;
  }

  if (sourceDef.coreType === NativeType.Function && expectedDef.coreType === NativeType.Function) {
    return true;
  }

  return false;
}

function resolveTargetTypedConversion(
  sourceTypeId: TypeId,
  expectedTypeId: TypeId,
  services: BrainServices
): TargetTypedConversionResolution {
  if (isSatisfiedWithoutTargetTypeConversion(sourceTypeId, expectedTypeId, services)) {
    return { kind: "none" };
  }

  const candidateTypeIds = resolveExpandedTargetTypeIds(expectedTypeId, services);
  for (const candidateTypeId of candidateTypeIds) {
    if (isSatisfiedWithoutTargetTypeConversion(sourceTypeId, candidateTypeId, services)) {
      return { kind: "none" };
    }
  }

  const candidateConversions: SingleStepConversionResolution[] = [];
  for (const candidateTypeId of candidateTypeIds) {
    const conversion = resolveSingleStepConversion(sourceTypeId, candidateTypeId, services);
    if (conversion) {
      candidateConversions.push(conversion);
    }
  }

  if (candidateConversions.length === 1) {
    return { kind: "convert", conversion: candidateConversions[0] };
  }

  if (candidateConversions.length > 1) {
    return { kind: "ambiguous" };
  }

  return { kind: "missing" };
}

function emitTargetTypeConversionDiagnostic(
  sourceTypeId: TypeId,
  expectedTypeId: TypeId,
  siteDescription: string,
  isAmbiguous: boolean,
  diagNode: ts.Node,
  ctx: LowerContext
): void {
  const message = isAmbiguous
    ? `No unique conversion from ${sourceTypeId} to expected type ${expectedTypeId} for ${siteDescription}`
    : `No conversion from ${sourceTypeId} to expected type ${expectedTypeId} for ${siteDescription}`;
  ctx.diagnostics.push(makeDiag(LoweringDiagCode.NoConversionToTargetType, message, diagNode));
}

function lowerExpressionWithExpectedType(
  exprNode: ts.Expression,
  expectedTypeId: TypeId | undefined,
  siteDescription: string,
  diagNode: ts.Node,
  ctx: LowerContext
): void {
  lowerExpression(exprNode, ctx);

  if (!expectedTypeId) {
    return;
  }

  const sourceTypeId = resolveExpressionTypeId(exprNode, ctx);
  if (!sourceTypeId) {
    return;
  }

  const resolution = resolveTargetTypedConversion(sourceTypeId, expectedTypeId, ctx.services);
  if (resolution.kind === "none") {
    return;
  }

  if (resolution.kind === "convert") {
    emitSingleStepConversion(resolution.conversion.fnName, ctx);
    return;
  }

  emitTargetTypeConversionDiagnostic(
    sourceTypeId,
    expectedTypeId,
    siteDescription,
    resolution.kind === "ambiguous",
    diagNode,
    ctx
  );
}

function resolveSignatureReturnTypeId(
  signatureDecl: ts.SignatureDeclarationBase,
  checker: ts.TypeChecker,
  services: BrainServices
): TypeId | undefined {
  const signature = checker.getSignatureFromDeclaration(signatureDecl as ts.SignatureDeclaration);
  if (!signature) {
    return undefined;
  }

  return tsTypeToTypeId(checker.getReturnTypeOfSignature(signature), checker, services);
}

function resolveVariableDeclarationTargetTypeId(decl: ts.VariableDeclaration, ctx: LowerContext): TypeId | undefined {
  const targetType = ctx.checker.getTypeAtLocation(decl.name);
  return tsTypeToTypeId(targetType, ctx.checker, ctx.services);
}

function resolveCallArgumentTargetTypeId(
  callExpr: ts.CallExpression,
  argIndex: number,
  ctx: LowerContext
): TypeId | undefined {
  const signature = ctx.checker.getResolvedSignature(callExpr);
  if (!signature) {
    return undefined;
  }

  const parameters = signature.getParameters();
  if (parameters.length === 0) {
    return undefined;
  }

  let parameterIndex = argIndex;
  if (parameterIndex >= parameters.length) {
    const lastParam = parameters[parameters.length - 1];
    const lastDeclaration = lastParam.valueDeclaration ?? lastParam.declarations?.[0];
    if (!lastDeclaration || !ts.isParameter(lastDeclaration) || !lastDeclaration.dotDotDotToken) {
      return undefined;
    }
    parameterIndex = parameters.length - 1;
  }

  const parameter = parameters[parameterIndex];
  const parameterLocation = parameter.valueDeclaration ?? parameter.declarations?.[0] ?? callExpr.expression;
  const parameterType = ctx.checker.getTypeOfSymbolAtLocation(parameter, parameterLocation);
  return tsTypeToTypeId(parameterType, ctx.checker, ctx.services);
}

interface RestParamInfo {
  restIndex: number;
  listTypeId: string;
}

function resolveRestParamInfo(callExpr: ts.CallExpression, ctx: LowerContext): RestParamInfo | undefined {
  const signature = ctx.checker.getResolvedSignature(callExpr);
  if (!signature) return undefined;

  const parameters = signature.getParameters();
  if (parameters.length === 0) return undefined;

  const lastParam = parameters[parameters.length - 1];
  const lastDeclaration = lastParam.valueDeclaration ?? lastParam.declarations?.[0];
  if (!lastDeclaration || !ts.isParameter(lastDeclaration) || !lastDeclaration.dotDotDotToken) {
    return undefined;
  }

  const paramType = ctx.checker.getTypeOfSymbolAtLocation(lastParam, lastDeclaration);
  const listTypeId = resolveListTypeId(paramType, ctx);
  if (!listTypeId) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveRestParamListType, "Cannot resolve list type for rest parameter", callExpr)
    );
    return undefined;
  }

  return { restIndex: parameters.length - 1, listTypeId };
}

function lowerCallArgumentsWithTargetTypes(callExpr: ts.CallExpression, ctx: LowerContext): number {
  const restInfo = resolveRestParamInfo(callExpr, ctx);

  const spreadIndex = callExpr.arguments.findIndex((arg) => ts.isSpreadElement(arg));

  if (spreadIndex >= 0) {
    if (spreadIndex < callExpr.arguments.length - 1) {
      ctx.diagnostics.push(
        makeDiag(
          LoweringDiagCode.SpreadMustBeLastArgument,
          "Spread argument must be the last argument",
          callExpr.arguments[spreadIndex]
        )
      );
      return callExpr.arguments.length;
    }

    if (!restInfo) {
      ctx.diagnostics.push(
        makeDiag(
          LoweringDiagCode.SpreadRequiresRestTarget,
          "Spread in function call requires target to have a rest parameter",
          callExpr.arguments[spreadIndex]
        )
      );
      return callExpr.arguments.length;
    }

    const spreadElement = callExpr.arguments[spreadIndex] as ts.SpreadElement;

    for (let argIndex = 0; argIndex < Math.min(restInfo.restIndex, spreadIndex); argIndex++) {
      const argument = callExpr.arguments[argIndex];
      const expectedTypeId = resolveCallArgumentTargetTypeId(callExpr, argIndex, ctx);
      lowerExpressionWithExpectedType(argument, expectedTypeId, `function argument ${argIndex + 1}`, argument, ctx);
    }

    if (spreadIndex === restInfo.restIndex) {
      lowerExpression(spreadElement.expression, ctx);
    } else {
      const restListLocal = ctx.scopeStack.allocLocal();
      ctx.ir.push({ kind: "ListNew", typeId: restInfo.listTypeId });
      ctx.ir.push({ kind: "StoreLocal", index: restListLocal });

      for (let argIndex = restInfo.restIndex; argIndex < spreadIndex; argIndex++) {
        ctx.ir.push({ kind: "LoadLocal", index: restListLocal });
        lowerExpression(callExpr.arguments[argIndex], ctx);
        ctx.ir.push({ kind: "ListPush" });
        ctx.ir.push({ kind: "StoreLocal", index: restListLocal });
      }

      emitPushAllFromList(spreadElement.expression, restListLocal, ctx, callExpr);
      ctx.ir.push({ kind: "LoadLocal", index: restListLocal });
    }

    return restInfo.restIndex + 1;
  }

  if (!restInfo || callExpr.arguments.length <= restInfo.restIndex) {
    for (let argIndex = 0; argIndex < callExpr.arguments.length; argIndex++) {
      const argument = callExpr.arguments[argIndex];
      const expectedTypeId = resolveCallArgumentTargetTypeId(callExpr, argIndex, ctx);
      lowerExpressionWithExpectedType(argument, expectedTypeId, `function argument ${argIndex + 1}`, argument, ctx);
    }
    if (restInfo && callExpr.arguments.length === restInfo.restIndex) {
      ctx.ir.push({ kind: "ListNew", typeId: restInfo.listTypeId });
      return restInfo.restIndex + 1;
    }
    return callExpr.arguments.length;
  }

  for (let argIndex = 0; argIndex < restInfo.restIndex; argIndex++) {
    const argument = callExpr.arguments[argIndex];
    const expectedTypeId = resolveCallArgumentTargetTypeId(callExpr, argIndex, ctx);
    lowerExpressionWithExpectedType(argument, expectedTypeId, `function argument ${argIndex + 1}`, argument, ctx);
  }

  ctx.ir.push({ kind: "ListNew", typeId: restInfo.listTypeId });
  for (let argIndex = restInfo.restIndex; argIndex < callExpr.arguments.length; argIndex++) {
    const argument = callExpr.arguments[argIndex];
    lowerExpression(argument, ctx);
    ctx.ir.push({ kind: "ListPush" });
  }

  return restInfo.restIndex + 1;
}

function emitOperandConversion(
  conversion: SingleStepConversionResolution & { operand: "left" | "right" },
  ctx: LowerContext
): void {
  if (conversion.operand === "left") {
    ctx.ir.push({ kind: "Swap" });
    emitSingleStepConversion(conversion.fnName, ctx);
    ctx.ir.push({ kind: "Swap" });
    return;
  }

  emitSingleStepConversion(conversion.fnName, ctx);
}

function resolveBinaryOperatorCandidate(
  opId: string,
  leftTypeId: string,
  rightTypeId: string,
  operand: "left" | "right",
  services: BrainServices
): BinaryOperatorResolution | undefined {
  const sourceTypeId = operand === "left" ? leftTypeId : rightTypeId;
  const targetTypeId = operand === "left" ? rightTypeId : leftTypeId;
  const conversion = resolveSingleStepConversion(sourceTypeId, targetTypeId, services);
  if (!conversion) {
    return undefined;
  }

  const operatorFnName = resolveOperatorWithExpansion(opId, [targetTypeId, targetTypeId], services);
  if (!operatorFnName) {
    return undefined;
  }

  return {
    operatorFnName,
    conversion: {
      ...conversion,
      operand,
    },
  };
}

function describeBinaryOperatorCandidate(candidate: BinaryOperatorResolution): string {
  if (!candidate.conversion) {
    return "direct overload";
  }

  return `${candidate.conversion.operand} operand ${candidate.conversion.fromTypeId} -> ${candidate.conversion.toTypeId}`;
}

function emitBinaryOperatorForNodes(
  opId: string,
  leftNode: ts.Expression,
  rightNode: ts.Expression,
  diagNode: ts.Node,
  ctx: LowerContext
): boolean {
  const lhsTypeId = resolveExpressionTypeId(leftNode, ctx);
  const rhsTypeId = resolveExpressionTypeId(rightNode, ctx);

  if (!lhsTypeId || !rhsTypeId) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotDetermineTypesForBinaryOp, "Cannot determine types for binary operator", diagNode)
    );
    return false;
  }

  const directResolution = resolveOperatorWithExpansion(opId, [lhsTypeId, rhsTypeId], ctx.services);
  if (directResolution) {
    ctx.ir.push({ kind: "HostCallArgs", fnName: directResolution, argc: 2 });
    return true;
  }

  const rightCandidate = resolveBinaryOperatorCandidate(opId, lhsTypeId, rhsTypeId, "right", ctx.services);
  const leftCandidate = resolveBinaryOperatorCandidate(opId, lhsTypeId, rhsTypeId, "left", ctx.services);

  if (rightCandidate && leftCandidate) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.AmbiguousImplicitBinaryConversion,
        `Ambiguous implicit conversion for ${opId}(${lhsTypeId}, ${rhsTypeId}): ${describeBinaryOperatorCandidate(rightCandidate)} or ${describeBinaryOperatorCandidate(leftCandidate)}`,
        diagNode
      )
    );
    return false;
  }

  const resolved = rightCandidate ?? leftCandidate;
  if (!resolved) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.NoOperatorOverload,
        `No operator overload for ${opId}(${lhsTypeId}, ${rhsTypeId})`,
        diagNode
      )
    );
    return false;
  }

  if (resolved.conversion) {
    emitOperandConversion(resolved.conversion, ctx);
  }

  ctx.ir.push({ kind: "HostCallArgs", fnName: resolved.operatorFnName, argc: 2 });
  return true;
}

export function lowerProgram(
  sourceFile: ts.SourceFile,
  descriptor: ExtractedDescriptor,
  checker: ts.TypeChecker,
  services: BrainServices,
  importedFunctions?: ImportedFunction[],
  importedVariables?: ImportedVariable[],
  moduleInitOrder?: string[],
  importedClasses?: ImportedClass[],
  importedEnums?: ImportedEnum[],
  importedInterfaces?: ImportedInterface[],
  importedTypeAliases?: ImportedTypeAlias[]
): ProgramLoweringResult {
  const diagnostics: CompileDiagnostic[] = [];
  const callsiteVars = new Map<string, number>();
  const functionTable = new Map<string, number>();
  const helperNodes: ts.FunctionDeclaration[] = [];
  const classInfos: ClassInfo[] = [];
  const interfaceInfos: InterfaceInfo[] = [];
  const typeAliasInfos: TypeAliasInfo[] = [];
  const localEnumNodes: ts.EnumDeclaration[] = [];
  const funcIdCounter = { value: 0 };
  const closureFunctions = new Map<number, FunctionEntry>();

  // Module-level variables (outside the descriptor's default export) are stored
  // as "callsite variables" -- a separate namespace from function-local variables.
  // Callsite vars are distinct per user tile instance, persist across invocations.
  let nextCallsiteVar = 0;

  const entryFuncId = funcIdCounter.value++;

  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      functionTable.set(stmt.name.text, funcIdCounter.value++);
      helperNodes.push(stmt);
    } else if (ts.isEnumDeclaration(stmt)) {
      localEnumNodes.push(stmt);
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      const className = stmt.name.text;
      const constructorFuncId = funcIdCounter.value++;
      functionTable.set(`${className}$new`, constructorFuncId);
      const methodFuncIds = new Map<string, number>();
      for (const member of stmt.members) {
        if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
          const methodName = member.name.text;
          const methodFuncId = funcIdCounter.value++;
          functionTable.set(`${className}.${methodName}`, methodFuncId);
          methodFuncIds.set(methodName, methodFuncId);
        }
      }
      classInfos.push({ node: stmt, name: className, sourceFile, constructorFuncId, methodFuncIds });
    } else if (ts.isInterfaceDeclaration(stmt) && stmt.name) {
      interfaceInfos.push({ node: stmt, name: stmt.name.text, sourceFile });
    } else if (ts.isTypeAliasDeclaration(stmt) && stmt.name) {
      typeAliasInfos.push({ node: stmt, name: stmt.name.text, sourceFile });
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

  if (importedClasses) {
    for (const ic of importedClasses) {
      const className = ic.name;
      if (functionTable.has(`${className}$new`)) continue;

      const constructorFuncId = funcIdCounter.value++;
      functionTable.set(`${className}$new`, constructorFuncId);
      const methodFuncIds = new Map<string, number>();
      for (const member of ic.node.members) {
        if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
          const methodName = member.name.text;
          const methodFuncId = funcIdCounter.value++;
          functionTable.set(`${className}.${methodName}`, methodFuncId);
          methodFuncIds.set(methodName, methodFuncId);
        }
      }
      classInfos.push({
        node: ic.node,
        name: className,
        sourceFile: ic.sourceFile,
        constructorFuncId,
        methodFuncIds,
      });
    }
  }

  if (importedInterfaces) {
    for (const ii of importedInterfaces) {
      if (!interfaceInfos.some((existing) => existing.name === ii.name)) {
        interfaceInfos.push({ node: ii.node, name: ii.name, sourceFile: ii.sourceFile });
      }
    }
  }

  if (importedTypeAliases) {
    for (const ita of importedTypeAliases) {
      if (!typeAliasInfos.some((existing) => existing.name === ita.name)) {
        typeAliasInfos.push({ node: ita.node, name: ita.name, sourceFile: ita.sourceFile });
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

  const needsActivation = initFuncId !== undefined || userOnPageEnteredFuncId !== undefined;
  let activationFuncId: number | undefined;
  if (needsActivation) {
    activationFuncId = funcIdCounter.value++;
  }

  const functions: FunctionEntry[] = [];

  registerUserEnumTypes(localEnumNodes, importedEnums ?? [], checker, diagnostics, services);

  for (const ci of classInfos) {
    registerClassStructType(ci, checker, diagnostics, services);
  }

  const reservedInterfaces: { info: InterfaceInfo; typeId: string }[] = [];
  for (const ii of interfaceInfos) {
    const typeId = reserveInterfaceStructType(ii, checker, diagnostics, services);
    if (typeId) reservedInterfaces.push({ info: ii, typeId });
  }

  const reservedTypeAliases: { info: TypeAliasInfo; typeId: string }[] = [];
  for (const tai of typeAliasInfos) {
    const typeId = reserveTypeAliasStructType(tai, checker, diagnostics, services);
    if (typeId) reservedTypeAliases.push({ info: tai, typeId });
  }

  for (const { info, typeId } of reservedInterfaces) {
    finalizeInterfaceStructType(info, typeId, checker, diagnostics, services);
  }

  for (const { info, typeId } of reservedTypeAliases) {
    finalizeTypeAliasStructType(info, typeId, checker, diagnostics, services);
  }

  const onExecEntry = lowerOnExecuteBody(
    descriptor,
    checker,
    callsiteVars,
    functionTable,
    diagnostics,
    funcIdCounter,
    closureFunctions,
    services
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
      closureFunctions,
      services
    );
    functions.push(entry);
  }

  for (const ci of classInfos) {
    const classEntries = lowerClassDeclaration(
      ci,
      checker,
      callsiteVars,
      functionTable,
      diagnostics,
      funcIdCounter,
      closureFunctions,
      services
    );
    functions.push(...classEntries);
  }

  if (descriptor.onPageEnteredNode) {
    const entry = lowerOnPageEnteredBody(
      descriptor,
      checker,
      callsiteVars,
      functionTable,
      diagnostics,
      funcIdCounter,
      closureFunctions,
      services
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
      moduleInitOrder ?? [],
      services
    );
    functions.push(initEntry);
  }

  if (activationFuncId !== undefined) {
    const activationEntry = generateActivationFunction(descriptor.name, initFuncId, userOnPageEnteredFuncId);
    functions.push(activationEntry);
  }

  const closureEntries = Array.from(closureFunctions.entries())
    .sort(([a], [b]) => a - b)
    .map(([, entry]) => entry);
  functions.push(...closureEntries);

  return {
    functions,
    entryFuncId,
    activationFuncId,
    numStateSlots: nextCallsiteVar,
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
  closureFunctions: Map<number, FunctionEntry>,
  services: BrainServices
): FunctionEntry {
  const ir: IrNode[] = [];
  const funcNode = descriptor.onPageEnteredNode!;

  const paramLocals = new Map<string, number>();
  const ctxParam = funcNode.parameters[0];
  if (ctxParam && ts.isIdentifier(ctxParam.name)) {
    paramLocals.set(ctxParam.name.text, 0);
  }

  const scopeStack = new ScopeStack(1);
  const funcScopeId = scopeStack.initFunctionScope(0, `${descriptor.name}.onPageEntered`);

  if (ctxParam && ts.isIdentifier(ctxParam.name)) {
    scopeStack.addParameterMetadata(ctxParam.name.text, 0, funcScopeId);
  }

  const ctx: LowerContext = {
    services,
    checker,
    paramsSymbol: undefined,
    paramLocals,
    scopeStack,
    ir,
    diagnostics: sharedDiagnostics,
    loopStack: [],
    breakStack: [],
    nextLabelId: 0,
    callsiteVars,
    functionTable,
    funcIdCounter,
    closureFunctions,
    currentFunctionName: `${descriptor.name}.onPageEntered`,
    currentReturnTypeId: resolveSignatureReturnTypeId(funcNode, checker, services),
  };

  const body = funcNode.body;
  if (!body || !ts.isBlock(body)) {
    sharedDiagnostics.push({
      code: LoweringDiagCode.OnPageEnteredHasNoBody,
      message: "onPageEntered function has no body",
      severity: "error",
    });
    scopeStack.finalizeFunctionScope(ir.length);
    return {
      ir,
      numParams: 1,
      numLocals: scopeStack.nextLocal,
      name: `${descriptor.name}.onPageEntered`,
      scopeMetadata: [...scopeStack.scopeMetadata],
      localMetadata: [...scopeStack.localMetadata],
      isGenerated: false,
      sourceFileName: funcNode.getSourceFile()?.fileName,
      functionSpan: spanFromNode(funcNode),
    };
  }

  lowerStatements(body.statements, ctx);

  ir.push({ kind: "PushConst", value: NIL_VALUE });
  ir.push({ kind: "Return" });

  scopeStack.finalizeFunctionScope(ir.length);
  return {
    ir,
    numParams: 1,
    numLocals: scopeStack.nextLocal,
    name: `${descriptor.name}.onPageEntered`,
    scopeMetadata: [...scopeStack.scopeMetadata],
    localMetadata: [...scopeStack.localMetadata],
    isGenerated: false,
    sourceFileName: funcNode.getSourceFile()?.fileName,
    functionSpan: spanFromNode(funcNode),
  };
}

function generateActivationFunction(
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
    name: `${name}.<activation>`,
    injectCtxTypeId: ContextTypeIds.Context,
    isGenerated: true,
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
  closureFunctions: Map<number, FunctionEntry>,
  services: BrainServices
): FunctionEntry {
  const ir: IrNode[] = [];
  const hasParams = descriptor.params.length > 0;
  const funcNode = descriptor.onExecuteNode;

  const paramLocals = new Map<string, number>();

  for (const param of funcNode.parameters) {
    if (!ts.isIdentifier(param.name)) {
      sharedDiagnostics.push(
        makeDiag(
          LoweringDiagCode.DestructuringInOnExecuteNotSupported,
          "Destructuring in onExecute parameters is not supported",
          param
        )
      );
    }
  }

  // Local 0 is always the injected context struct. When the tile has parameters,
  // local 1 holds the params as a Map<number, Value> (integer-keyed by param index).
  // The loop below unpacks each param into its own local so user code can reference
  // params by name via normal LoadLocal instructions.
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
  const funcScopeId = scopeStack.initFunctionScope(0, `${descriptor.name}.onExecute`);

  if (ctxParam && ts.isIdentifier(ctxParam.name)) {
    scopeStack.addParameterMetadata(ctxParam.name.text, 0, funcScopeId);
  }
  if (hasParams) {
    for (let i = 0; i < descriptor.params.length; i++) {
      const param = descriptor.params[i];
      const idx = paramLocals.get(param.name);
      if (idx !== undefined) {
        scopeStack.addParameterMetadata(param.name, idx, funcScopeId);
      }
    }
  }

  const ctx: LowerContext = {
    services,
    checker,
    paramsSymbol,
    paramLocals,
    scopeStack,
    ir,
    diagnostics: sharedDiagnostics,
    loopStack: [],
    breakStack: [],
    nextLabelId: 0,
    callsiteVars,
    functionTable,
    funcIdCounter,
    closureFunctions,
    currentFunctionName: `${descriptor.name}.onExecute`,
    currentReturnTypeId: resolveSignatureReturnTypeId(funcNode, checker, services),
  };

  const body = funcNode.body;
  if (!body || !ts.isBlock(body)) {
    sharedDiagnostics.push({
      code: LoweringDiagCode.OnExecuteHasNoBody,
      message: "onExecute function has no body",
      severity: "error",
    });
    scopeStack.finalizeFunctionScope(ir.length);
    return {
      ir,
      numParams: hasParams ? 2 : 1,
      numLocals: scopeStack.nextLocal,
      name: `${descriptor.name}.onExecute`,
      injectCtxTypeId: ContextTypeIds.Context,
      scopeMetadata: [...scopeStack.scopeMetadata],
      localMetadata: [...scopeStack.localMetadata],
      isGenerated: false,
      sourceFileName: funcNode.getSourceFile()?.fileName,
      functionSpan: spanFromNode(funcNode),
    };
  }

  lowerStatements(body.statements, ctx);

  ir.push({ kind: "PushConst", value: NIL_VALUE });
  ir.push({ kind: "Return" });

  scopeStack.finalizeFunctionScope(ir.length);
  return {
    ir,
    numParams: hasParams ? 2 : 1,
    numLocals: scopeStack.nextLocal,
    name: `${descriptor.name}.onExecute`,
    injectCtxTypeId: ContextTypeIds.Context,
    scopeMetadata: [...scopeStack.scopeMetadata],
    localMetadata: [...scopeStack.localMetadata],
    isGenerated: false,
    sourceFileName: funcNode.getSourceFile()?.fileName,
    functionSpan: spanFromNode(funcNode),
  };
}

function lowerHelperFunction(
  funcNode: ts.FunctionDeclaration,
  checker: ts.TypeChecker,
  callsiteVars: Map<string, number>,
  functionTable: Map<string, number>,
  sharedDiagnostics: CompileDiagnostic[],
  funcIdCounter: { value: number },
  closureFunctions: Map<number, FunctionEntry>,
  services: BrainServices
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

  const funcName = funcNode.name?.text ?? "<anonymous>";
  const scopeStack = new ScopeStack(numParams);
  const funcScopeId = scopeStack.initFunctionScope(0, funcName);

  for (let i = 0; i < numParams; i++) {
    const p = funcNode.parameters[i];
    if (ts.isIdentifier(p.name)) {
      scopeStack.addParameterMetadata(p.name.text, i, funcScopeId);
    }
  }

  const ctx: LowerContext = {
    services,
    checker,
    paramsSymbol: undefined,
    paramLocals,
    scopeStack,
    ir,
    diagnostics: sharedDiagnostics,
    loopStack: [],
    breakStack: [],
    nextLabelId: 0,
    callsiteVars,
    functionTable,
    funcIdCounter,
    closureFunctions,
    currentFunctionName: funcName,
    currentReturnTypeId: resolveSignatureReturnTypeId(funcNode, checker, services),
  };

  for (let i = 0; i < numParams; i++) {
    const p = funcNode.parameters[i];
    if (ts.isObjectBindingPattern(p.name)) {
      lowerObjectBindingPattern(p.name, i, ctx);
    } else if (ts.isArrayBindingPattern(p.name)) {
      lowerArrayBindingPattern(p.name, i, ctx);
    }
  }

  const body = funcNode.body;
  if (!body) {
    sharedDiagnostics.push(makeDiag(LoweringDiagCode.FunctionHasNoBody, "Function has no body", funcNode));
    scopeStack.finalizeFunctionScope(ir.length);
    return {
      ir,
      numParams,
      numLocals: scopeStack.nextLocal,
      name: funcName,
      scopeMetadata: [...scopeStack.scopeMetadata],
      localMetadata: [...scopeStack.localMetadata],
      isGenerated: false,
      sourceFileName: funcNode.getSourceFile()?.fileName,
      functionSpan: spanFromNode(funcNode),
    };
  }

  lowerStatements(body.statements, ctx);

  ir.push({ kind: "PushConst", value: NIL_VALUE });
  ir.push({ kind: "Return" });

  scopeStack.finalizeFunctionScope(ir.length);
  return {
    ir,
    numParams,
    numLocals: scopeStack.nextLocal,
    name: funcName,
    scopeMetadata: [...scopeStack.scopeMetadata],
    localMetadata: [...scopeStack.localMetadata],
    isGenerated: false,
    sourceFileName: funcNode.getSourceFile()?.fileName,
    functionSpan: spanFromNode(funcNode),
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
  moduleInitOrder: string[],
  services: BrainServices
): FunctionEntry {
  const ir: IrNode[] = [];
  const scopeStack = new ScopeStack(0);
  scopeStack.initFunctionScope(0, "<module-init>");

  const ctx: LowerContext = {
    services,
    checker,
    paramsSymbol: undefined,
    paramLocals: new Map(),
    scopeStack,
    ir,
    diagnostics: sharedDiagnostics,
    loopStack: [],
    breakStack: [],
    nextLabelId: 0,
    callsiteVars,
    functionTable,
    funcIdCounter,
    closureFunctions,
    currentFunctionName: "<module-init>",
  };

  for (const moduleName of moduleInitOrder) {
    for (const iv of importedVariables) {
      if (iv.sourceModule === moduleName && iv.initializer) {
        const varIdx = callsiteVars.get(iv.name);
        if (varIdx !== undefined) {
          const decl = ts.isVariableDeclaration(iv.initializer.parent) ? iv.initializer.parent : undefined;
          const expectedTypeId = decl ? resolveVariableDeclarationTargetTypeId(decl, ctx) : undefined;
          lowerExpressionWithExpectedType(
            iv.initializer,
            expectedTypeId,
            `variable initializer for '${iv.name}'`,
            iv.initializer,
            ctx
          );
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
            lowerExpressionWithExpectedType(
              decl.initializer,
              resolveVariableDeclarationTargetTypeId(decl, ctx),
              `variable initializer for '${decl.name.text}'`,
              decl.initializer,
              ctx
            );
            ir.push({ kind: "StoreCallsiteVar", index: varIdx });
          }
        }
      }
    }
  }

  ir.push({ kind: "PushConst", value: NIL_VALUE });
  ir.push({ kind: "Return" });

  scopeStack.finalizeFunctionScope(ir.length);
  return {
    ir,
    numParams: 0,
    numLocals: scopeStack.nextLocal,
    name: "<module-init>",
    scopeMetadata: [...scopeStack.scopeMetadata],
    localMetadata: [...scopeStack.localMetadata],
    isGenerated: true,
    sourceFileName: sourceFile.fileName,
  };
}

function lowerStatements(stmts: ts.NodeArray<ts.Statement>, ctx: LowerContext): void {
  for (const stmt of stmts) {
    lowerStatement(stmt, ctx);
  }
}

function lowerStatement(stmt: ts.Statement, ctx: LowerContext): void {
  const irStart = ctx.ir.length;

  if (ts.isReturnStatement(stmt)) {
    if (stmt.expression) {
      lowerExpressionWithExpectedType(
        stmt.expression,
        ctx.currentReturnTypeId,
        "return statement",
        stmt.expression,
        ctx
      );
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
  } else if (ts.isForInStatement(stmt)) {
    lowerForInStatement(stmt, ctx);
  } else if (ts.isForOfStatement(stmt)) {
    lowerForOfStatement(stmt, ctx);
  } else if (ts.isSwitchStatement(stmt)) {
    lowerSwitchStatement(stmt, ctx);
  } else if (ts.isBlock(stmt)) {
    ctx.scopeStack.pushScope(ctx.ir.length);
    lowerStatements(stmt.statements, ctx);
    ctx.scopeStack.popScope(ctx.ir.length);
  } else if (ts.isBreakStatement(stmt)) {
    lowerBreakStatement(stmt, ctx);
  } else if (ts.isContinueStatement(stmt)) {
    lowerContinueStatement(stmt, ctx);
  } else if (stmt.kind === ts.SyntaxKind.EmptyStatement) {
    // no-op
  } else if (ts.isClassDeclaration(stmt)) {
    // no-op: class declarations are pre-processed in lowerProgram
  } else if (ts.isInterfaceDeclaration(stmt)) {
    // no-op: interface declarations are pre-processed in lowerProgram
  } else if (ts.isTypeAliasDeclaration(stmt)) {
    // no-op: type alias declarations are pre-processed in lowerProgram
  } else {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.UnsupportedStatement, `Unsupported statement: ${ts.SyntaxKind[stmt.kind]}`, stmt)
    );
  }

  if (
    !ts.isBlock(stmt) &&
    stmt.kind !== ts.SyntaxKind.EmptyStatement &&
    !ts.isClassDeclaration(stmt) &&
    !ts.isInterfaceDeclaration(stmt) &&
    !ts.isTypeAliasDeclaration(stmt)
  ) {
    annotateFirstNode(ctx.ir, irStart, stmt, true);
  }
}

function lowerVariableDeclarationList(declList: ts.VariableDeclarationList, ctx: LowerContext): void {
  for (const decl of declList.declarations) {
    if (ts.isIdentifier(decl.name)) {
      const localIdx = ctx.scopeStack.declareLocal(decl.name.text);
      if (decl.initializer) {
        lowerExpressionWithExpectedType(
          decl.initializer,
          resolveVariableDeclarationTargetTypeId(decl, ctx),
          `variable initializer for '${decl.name.text}'`,
          decl.initializer,
          ctx
        );
        checkStructAssignmentCompat(decl.name, decl.initializer, decl, ctx);
        ctx.ir.push({ kind: "StoreLocal", index: localIdx });
        ctx.scopeStack.setLocalIrStart(localIdx, ctx.ir.length);
      } else {
        ctx.scopeStack.setLocalIrStart(localIdx, ctx.ir.length);
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

function collectBindingNames(pattern: ts.BindingPattern): string[] {
  const names: string[] = [];
  for (const element of pattern.elements) {
    if (ts.isOmittedExpression(element)) continue;
    if (ts.isIdentifier(element.name)) {
      names.push(element.name.text);
    } else if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
      names.push(...collectBindingNames(element.name));
    }
  }
  return names;
}

function lowerDestructuringDefault(element: ts.BindingElement, localIdx: number, ctx: LowerContext): void {
  if (!element.initializer) return;
  const keepLabel = allocLabel(ctx);
  const endLabel = allocLabel(ctx);
  ctx.ir.push({ kind: "LoadLocal", index: localIdx });
  // TypeCheck(Nil) matches only nil/undefined -- not false or 0 -- matching JS
  // semantics where defaults only apply when the value is absent, not just falsy.
  ctx.ir.push({ kind: "TypeCheck", nativeType: NativeType.Nil });
  // If value is NOT nil, jump past the default. Both labels land at the same
  // instruction: keepLabel skips the default-assignment, endLabel jumps past it
  // after assigning. They coincide because there is no extra code after the store.
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
  lowerObjectBindingPattern(pattern, srcLocal, ctx);
}

function lowerObjectBindingPattern(pattern: ts.ObjectBindingPattern, srcLocal: number, ctx: LowerContext): void {
  const hasRest = pattern.elements.some((e) => e.dotDotDotToken);
  const computedKeyLocals = new Map<ts.BindingElement, number>();
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) {
      if (element !== pattern.elements[pattern.elements.length - 1]) {
        ctx.diagnostics.push(
          makeDiag(LoweringDiagCode.RestElementMustBeLast, "Rest element must be last in object destructuring", element)
        );
        continue;
      }
      lowerObjectRestElement(element, pattern, srcLocal, computedKeyLocals, ctx);
      continue;
    }

    const isComputed = element.propertyName && ts.isComputedPropertyName(element.propertyName);

    if (isComputed) {
      let keyLocal: number | undefined;
      if (hasRest) {
        keyLocal = ctx.scopeStack.allocLocal();
        lowerExpression(element.propertyName!.expression, ctx);
        ctx.ir.push({ kind: "StoreLocal", index: keyLocal });
        computedKeyLocals.set(element, keyLocal);
      }

      if (ts.isIdentifier(element.name)) {
        const localIdx = ctx.scopeStack.declareLocal(element.name.text);
        ctx.ir.push({ kind: "LoadLocal", index: srcLocal });
        if (keyLocal !== undefined) {
          ctx.ir.push({ kind: "LoadLocal", index: keyLocal });
        } else {
          lowerExpression(element.propertyName!.expression, ctx);
        }
        ctx.ir.push({ kind: "GetFieldDynamic" });
        ctx.ir.push({ kind: "StoreLocal", index: localIdx });
        lowerDestructuringDefault(element, localIdx, ctx);
      } else if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
        const tempLocal = ctx.scopeStack.allocLocal();
        ctx.ir.push({ kind: "LoadLocal", index: srcLocal });
        if (keyLocal !== undefined) {
          ctx.ir.push({ kind: "LoadLocal", index: keyLocal });
        } else {
          lowerExpression(element.propertyName!.expression, ctx);
        }
        ctx.ir.push({ kind: "GetFieldDynamic" });
        ctx.ir.push({ kind: "StoreLocal", index: tempLocal });
        lowerDestructuringDefault(element, tempLocal, ctx);
        if (ts.isObjectBindingPattern(element.name)) {
          lowerObjectBindingPattern(element.name, tempLocal, ctx);
        } else {
          lowerArrayBindingPattern(element.name, tempLocal, ctx);
        }
      }
      continue;
    }

    let propertyName: string;
    if (element.propertyName) {
      if (!ts.isIdentifier(element.propertyName)) {
        ctx.diagnostics.push(
          makeDiag(LoweringDiagCode.UnsupportedBindingPattern, "Unsupported binding pattern", element)
        );
        continue;
      }
      propertyName = element.propertyName.text;
    } else if (ts.isIdentifier(element.name)) {
      propertyName = element.name.text;
    } else {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.UnsupportedBindingPattern, "Unsupported binding pattern", element)
      );
      continue;
    }

    if (ts.isIdentifier(element.name)) {
      const localIdx = ctx.scopeStack.declareLocal(element.name.text);
      ctx.ir.push({ kind: "LoadLocal", index: srcLocal });
      ctx.ir.push({ kind: "GetField", fieldName: propertyName });
      ctx.ir.push({ kind: "StoreLocal", index: localIdx });
      lowerDestructuringDefault(element, localIdx, ctx);
    } else if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
      const tempLocal = ctx.scopeStack.allocLocal();
      ctx.ir.push({ kind: "LoadLocal", index: srcLocal });
      ctx.ir.push({ kind: "GetField", fieldName: propertyName });
      ctx.ir.push({ kind: "StoreLocal", index: tempLocal });
      lowerDestructuringDefault(element, tempLocal, ctx);
      if (ts.isObjectBindingPattern(element.name)) {
        lowerObjectBindingPattern(element.name, tempLocal, ctx);
      } else {
        lowerArrayBindingPattern(element.name, tempLocal, ctx);
      }
    }
  }
}

function lowerObjectRestElement(
  element: ts.BindingElement,
  pattern: ts.ObjectBindingPattern,
  srcLocal: number,
  computedKeyLocals: Map<ts.BindingElement, number>,
  ctx: LowerContext
): void {
  const restType = ctx.checker.getTypeAtLocation(element.name);
  const typeId = tsTypeToTypeId(restType, ctx.checker, ctx.services) ?? "struct:<anonymous>";

  ctx.ir.push({ kind: "LoadLocal", index: srcLocal });

  let numExclude = 0;
  for (const other of pattern.elements) {
    if (other === element) continue;
    const computedKeyLocal = computedKeyLocals.get(other);
    if (computedKeyLocal !== undefined) {
      ctx.ir.push({ kind: "LoadLocal", index: computedKeyLocal });
      numExclude++;
    } else if (other.propertyName && ts.isIdentifier(other.propertyName)) {
      ctx.ir.push({ kind: "PushConst", value: mkStringValue(other.propertyName.text) });
      numExclude++;
    } else if (ts.isIdentifier(other.name)) {
      ctx.ir.push({ kind: "PushConst", value: mkStringValue(other.name.text) });
      numExclude++;
    }
  }
  ctx.ir.push({ kind: "StructCopyExcept", numExclude, typeId });

  if (ts.isIdentifier(element.name)) {
    const localIdx = ctx.scopeStack.declareLocal(element.name.text);
    ctx.ir.push({ kind: "StoreLocal", index: localIdx });
  } else if (ts.isObjectBindingPattern(element.name)) {
    const tempLocal = ctx.scopeStack.allocLocal();
    ctx.ir.push({ kind: "StoreLocal", index: tempLocal });
    lowerObjectBindingPattern(element.name, tempLocal, ctx);
  } else if (ts.isArrayBindingPattern(element.name)) {
    const tempLocal = ctx.scopeStack.allocLocal();
    ctx.ir.push({ kind: "StoreLocal", index: tempLocal });
    lowerArrayBindingPattern(element.name, tempLocal, ctx);
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
  lowerArrayBindingPattern(pattern, srcLocal, ctx);
}

function lowerArrayBindingPattern(pattern: ts.ArrayBindingPattern, srcLocal: number, ctx: LowerContext): void {
  for (let i = 0; i < pattern.elements.length; i++) {
    const element = pattern.elements[i];
    if (ts.isOmittedExpression(element)) continue;
    if (element.dotDotDotToken) {
      if (i !== pattern.elements.length - 1) {
        ctx.diagnostics.push(
          makeDiag(LoweringDiagCode.RestElementMustBeLast, "Rest element must be last in array destructuring", element)
        );
        continue;
      }
      lowerArrayRestElement(element, i, srcLocal, ctx);
      continue;
    }

    if (ts.isIdentifier(element.name)) {
      const localIdx = ctx.scopeStack.declareLocal(element.name.text);
      ctx.ir.push({ kind: "LoadLocal", index: srcLocal });
      ctx.ir.push({ kind: "PushConst", value: mkNumberValue(i) });
      ctx.ir.push({ kind: "ListGet" });
      ctx.ir.push({ kind: "StoreLocal", index: localIdx });
      lowerDestructuringDefault(element, localIdx, ctx);
    } else if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
      const tempLocal = ctx.scopeStack.allocLocal();
      ctx.ir.push({ kind: "LoadLocal", index: srcLocal });
      ctx.ir.push({ kind: "PushConst", value: mkNumberValue(i) });
      ctx.ir.push({ kind: "ListGet" });
      ctx.ir.push({ kind: "StoreLocal", index: tempLocal });
      lowerDestructuringDefault(element, tempLocal, ctx);
      if (ts.isObjectBindingPattern(element.name)) {
        lowerObjectBindingPattern(element.name, tempLocal, ctx);
      } else {
        lowerArrayBindingPattern(element.name, tempLocal, ctx);
      }
    }
  }
}

function lowerArrayRestElement(
  element: ts.BindingElement,
  restIndex: number,
  srcLocal: number,
  ctx: LowerContext
): void {
  const restType = ctx.checker.getTypeAtLocation(element.name);
  let listTypeId = tsTypeToTypeId(restType, ctx.checker, ctx.services);
  if (!listTypeId) {
    const srcType = ctx.checker.getTypeAtLocation(element.parent);
    listTypeId = tsTypeToTypeId(srcType, ctx.checker, ctx.services) ?? "list:any";
  }

  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForOfCannotResolveOperator, "Cannot resolve < operator for rest pattern", element)
    );
    return;
  }
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForOfCannotResolveOperator, "Cannot resolve + operator for rest pattern", element)
    );
    return;
  }

  const resultLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const endLocal = ctx.scopeStack.allocLocal();
  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  ctx.ir.push({ kind: "ListNew", typeId: listTypeId });
  ctx.ir.push({ kind: "StoreLocal", index: resultLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(restIndex) });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  ctx.ir.push({ kind: "LoadLocal", index: srcLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: endLocal });

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: endLocal });
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
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });

  if (ts.isIdentifier(element.name)) {
    const localIdx = ctx.scopeStack.declareLocal(element.name.text);
    ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
    ctx.ir.push({ kind: "StoreLocal", index: localIdx });
  } else if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
    if (ts.isObjectBindingPattern(element.name)) {
      lowerObjectBindingPattern(element.name, resultLocal, ctx);
    } else {
      lowerArrayBindingPattern(element.name, resultLocal, ctx);
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

  pushLoopContext(loopStart, loopEnd, ctx);

  ctx.ir.push({ kind: "Label", labelId: loopStart });
  const condStart = ctx.ir.length;
  lowerExpression(stmt.expression, ctx);
  annotateFirstNode(ctx.ir, condStart, stmt.expression, true);
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });
  lowerStatement(stmt.statement, ctx);
  ctx.ir.push({ kind: "Jump", labelId: loopStart });
  ctx.ir.push({ kind: "Label", labelId: loopEnd });

  popLoopContext(ctx);
}

function lowerForStatement(stmt: ts.ForStatement, ctx: LowerContext): void {
  ctx.scopeStack.pushScope(ctx.ir.length);

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

  pushLoopContext(continueTarget, loopEnd, ctx);

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  if (stmt.condition) {
    const condStart = ctx.ir.length;
    lowerExpression(stmt.condition, ctx);
    annotateFirstNode(ctx.ir, condStart, stmt.condition, true);
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

  popLoopContext(ctx);
  ctx.scopeStack.popScope(ctx.ir.length);
}

function lowerForInStatement(stmt: ts.ForInStatement, ctx: LowerContext): void {
  ctx.scopeStack.pushScope(ctx.ir.length);

  if (!ts.isVariableDeclarationList(stmt.initializer)) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.ForInRequiresVariableDeclaration,
        "`for...in` requires a variable declaration (e.g. `const key in obj`)",
        stmt
      )
    );
    ctx.scopeStack.popScope(ctx.ir.length);
    return;
  }

  const decls = stmt.initializer.declarations;
  if (decls.length !== 1 || !ts.isIdentifier(decls[0].name)) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForInRequiresSingleIdentifier, "`for...in` requires a single identifier binding", stmt)
    );
    ctx.scopeStack.popScope(ctx.ir.length);
    return;
  }

  const bindingName = decls[0].name.text;
  const iteratedType = ctx.checker.getTypeAtLocation(stmt.expression);

  if (resolveListTypeId(iteratedType, ctx)) {
    lowerForInOverList(stmt, bindingName, ctx);
    ctx.scopeStack.popScope(ctx.ir.length);
    return;
  }

  if (resolveMapTypeId(iteratedType, ctx)) {
    lowerForInOverKeyList(
      stmt,
      bindingName,
      () => {
        lowerExpression(stmt.expression, ctx);
        ctx.ir.push({ kind: "HostCallArgs", fnName: "$$map_keys", argc: 1 });
      },
      ctx
    );
    ctx.scopeStack.popScope(ctx.ir.length);
    return;
  }

  const structDef = resolveStructType(iteratedType, ctx.services);
  if (structDef) {
    lowerForInOverKeyList(
      stmt,
      bindingName,
      () => {
        const keyListTypeId = ctx.services.types.instantiate("List", List.from([CoreTypeIds.String]));
        ctx.ir.push({ kind: "ListNew", typeId: keyListTypeId });
        for (const field of structDef.fields.toArray()) {
          ctx.ir.push({ kind: "PushConst", value: mkStringValue(field.name) });
          ctx.ir.push({ kind: "ListPush" });
        }
      },
      ctx
    );
    ctx.scopeStack.popScope(ctx.ir.length);
    return;
  }

  ctx.diagnostics.push(
    makeDiag(
      LoweringDiagCode.ForInOnUnsupportedType,
      "`for...in` is only supported on list, map, and registered struct values",
      stmt.expression
    )
  );
  ctx.scopeStack.popScope(ctx.ir.length);
}

function lowerForInOverList(stmt: ts.ForInStatement, bindingName: string, ctx: LowerContext): void {
  const listLocal = ctx.scopeStack.allocLocal();
  const indexLocal = ctx.scopeStack.allocLocal();
  const bindingLocal = ctx.scopeStack.declareLocal(bindingName);

  lowerExpression(stmt.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: listLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: indexLocal });

  const loopStart = allocLabel(ctx);
  const continueTarget = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  pushLoopContext(continueTarget, loopEnd, ctx);

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: indexLocal });
  ctx.ir.push({ kind: "LoadLocal", index: listLocal });
  ctx.ir.push({ kind: "ListLen" });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForInCannotResolveOperator, "Cannot resolve < operator for `for...in`", stmt)
    );
    popLoopContext(ctx);
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: indexLocal });
  ctx.ir.push({
    kind: "HostCallArgs",
    fnName: runtime.conversionFnName(CoreTypeIds.Number, CoreTypeIds.String),
    argc: 1,
  });
  ctx.ir.push({ kind: "StoreLocal", index: bindingLocal });
  ctx.scopeStack.setLocalIrStart(bindingLocal, ctx.ir.length);

  lowerStatement(stmt.statement, ctx);

  ctx.ir.push({ kind: "Label", labelId: continueTarget });

  ctx.ir.push({ kind: "LoadLocal", index: indexLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForInCannotResolveOperator, "Cannot resolve + operator for `for...in`", stmt)
    );
    popLoopContext(ctx);
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: indexLocal });

  ctx.ir.push({ kind: "Jump", labelId: loopStart });
  ctx.ir.push({ kind: "Label", labelId: loopEnd });

  popLoopContext(ctx);
}

function lowerForInOverKeyList(
  stmt: ts.ForInStatement,
  bindingName: string,
  emitKeyList: () => void,
  ctx: LowerContext
): void {
  const keyListLocal = ctx.scopeStack.allocLocal();
  const indexLocal = ctx.scopeStack.allocLocal();
  const bindingLocal = ctx.scopeStack.declareLocal(bindingName);

  emitKeyList();
  ctx.ir.push({ kind: "StoreLocal", index: keyListLocal });

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: indexLocal });

  const loopStart = allocLabel(ctx);
  const continueTarget = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  pushLoopContext(continueTarget, loopEnd, ctx);

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: indexLocal });
  ctx.ir.push({ kind: "LoadLocal", index: keyListLocal });
  ctx.ir.push({ kind: "ListLen" });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForInCannotResolveOperator, "Cannot resolve < operator for `for...in`", stmt)
    );
    popLoopContext(ctx);
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: keyListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: indexLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "StoreLocal", index: bindingLocal });
  ctx.scopeStack.setLocalIrStart(bindingLocal, ctx.ir.length);

  lowerStatement(stmt.statement, ctx);

  ctx.ir.push({ kind: "Label", labelId: continueTarget });

  ctx.ir.push({ kind: "LoadLocal", index: indexLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForInCannotResolveOperator, "Cannot resolve + operator for `for...in`", stmt)
    );
    popLoopContext(ctx);
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: indexLocal });

  ctx.ir.push({ kind: "Jump", labelId: loopStart });
  ctx.ir.push({ kind: "Label", labelId: loopEnd });

  popLoopContext(ctx);
}

function lowerForOfStatement(stmt: ts.ForOfStatement, ctx: LowerContext): void {
  ctx.scopeStack.pushScope(ctx.ir.length);

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
    ctx.scopeStack.popScope(ctx.ir.length);
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
    ctx.scopeStack.popScope(ctx.ir.length);
    return;
  }

  const decls = stmt.initializer.declarations;
  if (decls.length !== 1 || !ts.isIdentifier(decls[0].name)) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForOfRequiresSingleIdentifier, "`for...of` requires a single identifier binding", stmt)
    );
    ctx.scopeStack.popScope(ctx.ir.length);
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

  pushLoopContext(continueTarget, loopEnd, ctx);

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: indexLocal });
  ctx.ir.push({ kind: "LoadLocal", index: listLocal });
  ctx.ir.push({ kind: "ListLen" });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForOfCannotResolveOperator, "Cannot resolve < operator for `for...of`", stmt)
    );
    popLoopContext(ctx);
    ctx.scopeStack.popScope(ctx.ir.length);
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: listLocal });
  ctx.ir.push({ kind: "LoadLocal", index: indexLocal });
  ctx.ir.push({ kind: "ListGet" });
  const itemLocal = ctx.scopeStack.declareLocal(decls[0].name.text);
  ctx.ir.push({ kind: "StoreLocal", index: itemLocal });
  ctx.scopeStack.setLocalIrStart(itemLocal, ctx.ir.length);

  lowerStatement(stmt.statement, ctx);

  ctx.ir.push({ kind: "Label", labelId: continueTarget });

  ctx.ir.push({ kind: "LoadLocal", index: indexLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ForOfCannotResolveOperator, "Cannot resolve + operator for `for...of`", stmt)
    );
    popLoopContext(ctx);
    ctx.scopeStack.popScope(ctx.ir.length);
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: indexLocal });

  ctx.ir.push({ kind: "Jump", labelId: loopStart });
  ctx.ir.push({ kind: "Label", labelId: loopEnd });

  popLoopContext(ctx);
  ctx.scopeStack.popScope(ctx.ir.length);
}

function lowerSwitchStatement(stmt: ts.SwitchStatement, ctx: LowerContext): void {
  ctx.scopeStack.pushScope(ctx.ir.length);

  const discriminantLocal = ctx.scopeStack.allocLocal();
  const endLabel = allocLabel(ctx);
  const clauseLabels = stmt.caseBlock.clauses.map(() => allocLabel(ctx));
  let defaultClauseIndex = -1;

  const discriminantStart = ctx.ir.length;
  lowerExpression(stmt.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: discriminantLocal });
  annotateFirstNode(ctx.ir, discriminantStart, stmt.expression, true);

  ctx.breakStack.push(endLabel);

  for (let i = 0; i < stmt.caseBlock.clauses.length; i++) {
    const clause = stmt.caseBlock.clauses[i];
    if (ts.isDefaultClause(clause)) {
      defaultClauseIndex = i;
      continue;
    }

    ctx.ir.push({ kind: "LoadLocal", index: discriminantLocal });
    lowerExpression(clause.expression, ctx);

    if (!emitBinaryOperatorForNodes(CoreOpId.EqualTo, stmt.expression, clause.expression, clause.expression, ctx)) {
      ctx.breakStack.pop();
      ctx.scopeStack.popScope(ctx.ir.length);
      return;
    }

    ctx.ir.push({ kind: "JumpIfTrue", labelId: clauseLabels[i] });
  }

  if (defaultClauseIndex >= 0) {
    ctx.ir.push({ kind: "Jump", labelId: clauseLabels[defaultClauseIndex] });
  } else {
    ctx.ir.push({ kind: "Jump", labelId: endLabel });
  }

  for (let i = 0; i < stmt.caseBlock.clauses.length; i++) {
    const clause = stmt.caseBlock.clauses[i];
    ctx.ir.push({ kind: "Label", labelId: clauseLabels[i] });
    lowerStatements(clause.statements, ctx);
  }

  ctx.ir.push({ kind: "Label", labelId: endLabel });

  ctx.breakStack.pop();
  ctx.scopeStack.popScope(ctx.ir.length);
}

function lowerBreakStatement(stmt: ts.BreakStatement, ctx: LowerContext): void {
  if (ctx.breakStack.length === 0) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.BreakOutsideLoop, "`break` outside of loop or switch", stmt));
    return;
  }
  const breakLabel = ctx.breakStack[ctx.breakStack.length - 1];
  ctx.ir.push({ kind: "Jump", labelId: breakLabel });
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
  const irStart = ctx.ir.length;

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
  } else if (expr.kind === ts.SyntaxKind.ThisKeyword) {
    if (ctx.thisLocalIndex === undefined) {
      ctx.diagnostics.push(
        makeDiag(
          LoweringDiagCode.ThisOutsideClassContext,
          "'this' can only be used inside a class constructor or method",
          expr
        )
      );
      return;
    }
    ctx.ir.push({ kind: "LoadLocal", index: ctx.thisLocalIndex });
  } else if (ts.isNewExpression(expr)) {
    lowerNewExpression(expr, ctx);
  } else {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.UnsupportedExpression, `Unsupported expression: ${ts.SyntaxKind[expr.kind]}`, expr)
    );
  }

  annotateFirstNode(ctx.ir, irStart, expr, false);
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

  const enumSymbol = resolveAliasedSymbol(ctx.checker.getSymbolAtLocation(expr), ctx.checker);
  if (enumSymbol && resolveEnumDeclaration(enumSymbol, ctx.checker)) {
    const typeId = resolveRegisteredEnumTypeIdFromSymbol(enumSymbol, ctx.services, ctx.checker);
    if (typeId) {
      ctx.diagnostics.push(
        makeDiag(
          LoweringDiagCode.EnumObjectUsageNotSupported,
          "Enum objects are not supported at runtime; use direct member access like Direction.Up",
          expr
        )
      );
      return;
    }
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
  ctx.ir.push({ kind: "Await", span: spanFromNode(expr), isStatementBoundary: true });
}

function lowerNewExpression(expr: ts.NewExpression, ctx: LowerContext): void {
  if (!ts.isIdentifier(expr.expression)) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.NewExpressionNotIdentifier,
        "new expression target must be an identifier",
        expr.expression
      )
    );
    return;
  }

  const className = expr.expression.text;
  const ctorKey = `${className}$new`;
  const funcId = ctx.functionTable.get(ctorKey);
  if (funcId === undefined) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.NewExpressionUnknownClass, `Unknown class '${className}'`, expr.expression)
    );
    return;
  }

  const args = expr.arguments ?? [];
  for (const arg of args) {
    lowerExpression(arg, ctx);
  }
  ctx.ir.push({ kind: "Call", funcIndex: funcId, argc: args.length });
}

function lowerCallExpression(expr: ts.CallExpression, ctx: LowerContext): void {
  if (ts.isIdentifier(expr.expression)) {
    const funcId = ctx.functionTable.get(expr.expression.text);
    if (funcId !== undefined) {
      const argc = lowerCallArgumentsWithTargetTypes(expr, ctx);
      ctx.ir.push({ kind: "Call", funcIndex: funcId, argc });
      return;
    }
  }

  if (ts.isPropertyAccessExpression(expr.expression)) {
    if (lowerArrayFromCall(expr, expr.expression, ctx)) {
      return;
    }
    if (lowerMathCall(expr, expr.expression, ctx)) {
      return;
    }
    if (lowerStringMethodCall(expr, expr.expression, ctx)) {
      return;
    }
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
    const argc = lowerCallArgumentsWithTargetTypes(expr, ctx);
    ctx.ir.push({ kind: "CallIndirect", argc });
    return;
  }

  ctx.diagnostics.push(makeDiag(LoweringDiagCode.UnsupportedFunctionCall, "Unsupported function call", expr));
}

function bareClassName(qualOrBareName: string): string {
  const sep = qualOrBareName.indexOf("::");
  if (sep >= 0) return qualOrBareName.slice(sep + 2);
  return qualOrBareName;
}

function lowerStructMethodCall(
  expr: ts.CallExpression,
  propAccess: ts.PropertyAccessExpression,
  ctx: LowerContext
): boolean {
  const receiverType = ctx.checker.getTypeAtLocation(propAccess.expression);
  const structDef = resolveStructType(receiverType, ctx.services);
  if (!structDef) return false;

  const methodName = propAccess.name.text;
  let found = false;
  structDef.methods?.forEach((m) => {
    if (m.name === methodName) found = true;
  });
  if (!found) return false;

  const bareName = bareClassName(structDef.name);
  const fnName = `${bareName}.${methodName}`;

  const userFuncId = ctx.functionTable.get(fnName);
  if (userFuncId !== undefined) {
    lowerExpression(propAccess.expression, ctx);
    const argc = lowerCallArgumentsWithTargetTypes(expr, ctx) + 1;
    ctx.ir.push({ kind: "Call", funcIndex: userFuncId, argc });
    return true;
  }

  const fnEntry = ctx.services.functions.get(fnName);
  if (!fnEntry) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.UnknownStructMethod, `Unknown struct method: '${bareName}.${methodName}'`, propAccess)
    );
    return true;
  }

  lowerExpression(propAccess.expression, ctx);
  const argc = lowerCallArgumentsWithTargetTypes(expr, ctx) + 1;
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
  closureNode: ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration,
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

  if (closureNode.body) {
    visit(closureNode.body);
  }
  return captures;
}

function lowerClosureExpression(
  expr: ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration,
  ctx: LowerContext
): void {
  const numParams = expr.parameters.length;
  const closureParamNames = new Set<string>();
  const closureParamLocals = new Map<string, number>();

  for (let i = 0; i < numParams; i++) {
    const p = expr.parameters[i];
    if (ts.isIdentifier(p.name)) {
      closureParamNames.add(p.name.text);
      closureParamLocals.set(p.name.text, i);
    } else if (ts.isObjectBindingPattern(p.name) || ts.isArrayBindingPattern(p.name)) {
      for (const name of collectBindingNames(p.name)) {
        closureParamNames.add(name);
      }
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
  const closureFuncScopeId = closureScopeStack.initFunctionScope(0, closureName);

  for (let i = 0; i < numParams; i++) {
    const p = expr.parameters[i];
    if (ts.isIdentifier(p.name)) {
      closureScopeStack.addParameterMetadata(p.name.text, i, closureFuncScopeId);
    }
  }
  for (const info of captureInfos) {
    closureScopeStack.addCaptureMetadata(info.name, capturedVars.get(info.name)!, closureFuncScopeId);
  }

  const closureCtx: LowerContext = {
    services: ctx.services,
    checker: ctx.checker,
    paramsSymbol: undefined,
    paramLocals: closureParamLocals,
    scopeStack: closureScopeStack,
    ir: closureIr,
    diagnostics: ctx.diagnostics,
    loopStack: [],
    breakStack: [],
    nextLabelId: 0,
    callsiteVars: ctx.callsiteVars,
    functionTable: ctx.functionTable,
    capturedVars: capturedVars.size > 0 ? capturedVars : undefined,
    funcIdCounter: ctx.funcIdCounter,
    closureFunctions: ctx.closureFunctions,
    currentFunctionName: closureName,
    currentReturnTypeId: resolveSignatureReturnTypeId(expr, ctx.checker, ctx.services),
  };

  for (let i = 0; i < numParams; i++) {
    const p = expr.parameters[i];
    if (ts.isObjectBindingPattern(p.name)) {
      lowerObjectBindingPattern(p.name, i, closureCtx);
    } else if (ts.isArrayBindingPattern(p.name)) {
      lowerArrayBindingPattern(p.name, i, closureCtx);
    }
  }

  const body = expr.body;
  if (!body) {
    closureIr.push({ kind: "PushConst", value: NIL_VALUE });
    closureIr.push({ kind: "Return" });
  } else if (ts.isBlock(body)) {
    lowerStatements(body.statements, closureCtx);
    closureIr.push({ kind: "PushConst", value: NIL_VALUE });
    closureIr.push({ kind: "Return" });
  } else {
    lowerExpressionWithExpectedType(body, closureCtx.currentReturnTypeId, "return statement", body, closureCtx);
    closureIr.push({ kind: "Return" });
  }

  closureScopeStack.finalizeFunctionScope(closureIr.length);
  ctx.closureFunctions.set(closureFuncId, {
    ir: closureIr,
    numParams,
    numLocals: closureScopeStack.nextLocal,
    name: closureName,
    scopeMetadata: [...closureScopeStack.scopeMetadata],
    localMetadata: [...closureScopeStack.localMetadata],
    isGenerated: false,
    parentName: ctx.currentFunctionName,
    sourceFileName: expr.getSourceFile()?.fileName,
    functionSpan: spanFromNode(expr),
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
  const registry = ctx.services.types;
  const lhsType = ctx.checker.getTypeAtLocation(lhsNode);
  const rhsType = ctx.checker.getTypeAtLocation(rhsNode);
  const lhsTypeId = tsTypeToTypeId(lhsType, ctx.checker, ctx.services);
  const rhsTypeId = tsTypeToTypeId(rhsType, ctx.checker, ctx.services);
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

  if (ts.isPropertyAccessExpression(expr.left) && expr.left.expression.kind === ts.SyntaxKind.ThisKeyword) {
    lowerThisFieldAssignment(expr, ctx);
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
    lowerExpressionWithExpectedType(
      expr.right,
      resolveExpressionTypeId(expr.left, ctx),
      `assignment to '${expr.left.text}'`,
      expr.right,
      ctx
    );
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
    const lhsTypeId = tsTypeToTypeId(lhsType, ctx.checker, ctx.services);
    const rhsTypeId = tsTypeToTypeId(rhsType, ctx.checker, ctx.services);

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

    const fnName = resolveOperatorWithExpansion(opId, [lhsTypeId, rhsTypeId], ctx.services);
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

function lowerThisFieldAssignment(expr: ts.BinaryExpression, ctx: LowerContext): void {
  const propAccess = expr.left as ts.PropertyAccessExpression;
  const fieldName = propAccess.name.text;

  if (ctx.thisLocalIndex === undefined) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.ThisOutsideClassContext,
        "'this' can only be used inside a class constructor or method",
        propAccess.expression
      )
    );
    return;
  }

  if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
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
    const lhsTypeId = tsTypeToTypeId(lhsType, ctx.checker, ctx.services);
    const rhsTypeId = tsTypeToTypeId(rhsType, ctx.checker, ctx.services);

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

    const fnName = resolveOperatorWithExpansion(opId, [lhsTypeId, rhsTypeId], ctx.services);
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

    ctx.ir.push({ kind: "LoadLocal", index: ctx.thisLocalIndex });
    ctx.ir.push({ kind: "PushConst", value: mkStringValue(fieldName) });
    ctx.ir.push({ kind: "LoadLocal", index: ctx.thisLocalIndex });
    ctx.ir.push({ kind: "GetField", fieldName });
    lowerExpression(expr.right, ctx);
    ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 2 });
    ctx.ir.push({ kind: "StructSet" });
    ctx.ir.push({ kind: "Dup" });
    ctx.ir.push({ kind: "StoreLocal", index: ctx.thisLocalIndex });
    return;
  }

  ctx.ir.push({ kind: "LoadLocal", index: ctx.thisLocalIndex });
  ctx.ir.push({ kind: "PushConst", value: mkStringValue(fieldName) });
  lowerExpression(expr.right, ctx);
  ctx.ir.push({ kind: "StructSet" });
  ctx.ir.push({ kind: "Dup" });
  ctx.ir.push({ kind: "StoreLocal", index: ctx.thisLocalIndex });
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
      const fnName = resolveOperator(CoreOpId.Negate, [CoreTypeIds.Number], ctx.services);
      if (!fnName) {
        ctx.diagnostics.push(makeDiag(LoweringDiagCode.NoOperatorOverload, "No operator overload for negation", expr));
        return;
      }
      ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 1 });
    }
  } else if (expr.operator === ts.SyntaxKind.ExclamationToken) {
    lowerExpression(expr.operand, ctx);
    const operandType = ctx.checker.getTypeAtLocation(expr.operand);
    const operandTypeId = tsTypeToTypeId(operandType, ctx.checker, ctx.services);
    if (!operandTypeId) {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.CannotDetermineTypeForNotOperand, "Cannot determine type for `!` operand", expr)
      );
      return;
    }
    const fnName = resolveOperatorWithExpansion(CoreOpId.Not, [operandTypeId], ctx.services);
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
  const fnName = resolveOperator(opId, [typeId, typeId], ctx.services);
  if (!fnName) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.NoOperatorOverload, `No operator overload for ${opId}(${typeId}, ${typeId})`, expr)
    );
    return;
  }

  emitLoad(target, ctx);
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 2 });
  // Dup after arithmetic: leaves the new value on the stack as the expression result.
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
  const fnName = resolveOperator(opId, [typeId, typeId], ctx.services);
  if (!fnName) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.NoOperatorOverload, `No operator overload for ${opId}(${typeId}, ${typeId})`, expr)
    );
    return;
  }

  emitLoad(target, ctx);
  // Dup before arithmetic: the old value copy stays on the stack as the expression
  // result while the new value is computed and stored over it.
  ctx.ir.push({ kind: "Dup" });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName, argc: 2 });
  emitStore(target, ctx);
}

function lowerShortCircuit(expr: ts.BinaryExpression, ctx: LowerContext): void {
  const endLabel = allocLabel(ctx);
  lowerExpression(expr.left, ctx);
  // Dup before JumpIfFalse/JumpIfTrue because the conditional jump consumes the
  // value it tests. The duplicate is what remains on the stack as the result when
  // the short-circuit branch is taken (the left-hand value is the overall result).
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
  // Dup the left value before testing so the original stays on the stack if it
  // is non-nil (TypeCheck consumes its operand).
  ctx.ir.push({ kind: "Dup" });
  // TypeCheck(Nil) is nil-only -- not a general falsy check -- matching ?? semantics
  // where false, 0, and "" are NOT replaced by the right operand.
  ctx.ir.push({ kind: "TypeCheck", nativeType: NativeType.Nil });
  // keepLabel and endLabel occupy the same instruction position: keepLabel is the
  // target when the jump is NOT taken (value was non-nil, keep it); endLabel is
  // the target of the unconditional jump after assigning the right-hand value.
  ctx.ir.push({ kind: "JumpIfFalse", labelId: keepLabel });
  ctx.ir.push({ kind: "Pop" });
  lowerExpression(expr.right, ctx);
  ctx.ir.push({ kind: "Jump", labelId: endLabel });
  ctx.ir.push({ kind: "Label", labelId: keepLabel });
  ctx.ir.push({ kind: "Label", labelId: endLabel });
}

function emitToStringIfNeeded(exprNode: ts.Expression, ctx: LowerContext): void {
  const typeId = resolveExpressionTypeId(exprNode, ctx);
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
    const conversion = resolveSingleStepConversion(typeId, CoreTypeIds.String, ctx.services);
    if (!conversion) {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.NoConversionToString, `No conversion from ${typeId} to string`, exprNode)
      );
      return;
    }
    emitSingleStepConversion(conversion.fnName, ctx);
  }
}

function lowerTemplateLiteral(expr: ts.TemplateExpression, ctx: LowerContext): void {
  const addFnName = resolveOperator(CoreOpId.Add, [CoreTypeIds.String, CoreTypeIds.String], ctx.services);
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
  // The VM has no general typeof instruction. `typeof x === "T"` is recognized
  // as a pattern at lowering time and compiled directly to a TypeCheck opcode.
  // Unsupported type strings (e.g. "object", "function") produce a diagnostic
  // above rather than falling through to the generic binary-op path.
  ctx.ir.push({ kind: "TypeCheck", nativeType });

  if (op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) {
    const operandTypeId = CoreTypeIds.Boolean;
    const fnName = resolveOperator(CoreOpId.Not, [operandTypeId], ctx.services);
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
  if (isStringType(objType)) {
    lowerExpression(expr.expression, ctx);
    lowerExpression(expr.argumentExpression, ctx);
    ctx.ir.push({ kind: "HostCallArgs", fnName: "$$str_get_js", argc: 2 });
    return;
  }
  if (resolveMapTypeId(objType, ctx)) {
    lowerExpression(expr.expression, ctx);
    lowerExpression(expr.argumentExpression, ctx);
    ctx.ir.push({ kind: "MapGet" });
    return;
  }
  if (resolveStructType(objType, ctx.services)) {
    lowerExpression(expr.expression, ctx);
    lowerExpression(expr.argumentExpression, ctx);
    emitToStringIfNeeded(expr.argumentExpression, ctx);
    ctx.ir.push({ kind: "GetFieldDynamic" });
    return;
  }
  if (!resolveListTypeId(objType, ctx)) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.ElementAccessOnNonListType,
        "Element access is only supported on list, map, struct, and string types",
        expr
      )
    );
    return;
  }
  lowerExpression(expr.expression, ctx);
  lowerExpression(expr.argumentExpression, ctx);
  ctx.ir.push({ kind: "HostCallArgs", fnName: "$$list_get_js", argc: 2 });
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

function isStringType(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.StringLike) !== 0;
}

function lowerStringMethodCall(
  expr: ts.CallExpression,
  propAccess: ts.PropertyAccessExpression,
  ctx: LowerContext
): boolean {
  const objType = ctx.checker.getTypeAtLocation(propAccess.expression);
  if (!isStringType(objType)) return false;

  const methodName = propAccess.name.text;

  switch (methodName) {
    case "charAt": {
      if (expr.arguments.length !== 1) {
        ctx.diagnostics.push(
          makeDiag(LoweringDiagCode.StringMethodWrongArgCount, ".charAt() requires exactly 1 argument", expr)
        );
        return true;
      }
      lowerExpression(propAccess.expression, ctx);
      lowerExpression(expr.arguments[0], ctx);
      ctx.ir.push({ kind: "HostCallArgs", fnName: "$$str_charAt", argc: 2 });
      return true;
    }
    case "charCodeAt": {
      if (expr.arguments.length !== 1) {
        ctx.diagnostics.push(
          makeDiag(LoweringDiagCode.StringMethodWrongArgCount, ".charCodeAt() requires exactly 1 argument", expr)
        );
        return true;
      }
      lowerExpression(propAccess.expression, ctx);
      lowerExpression(expr.arguments[0], ctx);
      ctx.ir.push({ kind: "HostCallArgs", fnName: "$$str_charCodeAt", argc: 2 });
      return true;
    }
    case "indexOf": {
      if (expr.arguments.length < 1 || expr.arguments.length > 2) {
        ctx.diagnostics.push(
          makeDiag(LoweringDiagCode.StringMethodWrongArgCount, ".indexOf() requires 1 or 2 arguments", expr)
        );
        return true;
      }
      lowerExpression(propAccess.expression, ctx);
      lowerExpression(expr.arguments[0], ctx);
      if (expr.arguments.length === 2) {
        lowerExpression(expr.arguments[1], ctx);
      } else {
        ctx.ir.push({ kind: "PushConst", value: NIL_VALUE });
      }
      ctx.ir.push({ kind: "HostCallArgs", fnName: "$$str_indexOf", argc: 3 });
      return true;
    }
    case "lastIndexOf": {
      if (expr.arguments.length < 1 || expr.arguments.length > 2) {
        ctx.diagnostics.push(
          makeDiag(LoweringDiagCode.StringMethodWrongArgCount, ".lastIndexOf() requires 1 or 2 arguments", expr)
        );
        return true;
      }
      lowerExpression(propAccess.expression, ctx);
      lowerExpression(expr.arguments[0], ctx);
      if (expr.arguments.length === 2) {
        lowerExpression(expr.arguments[1], ctx);
      } else {
        ctx.ir.push({ kind: "PushConst", value: NIL_VALUE });
      }
      ctx.ir.push({ kind: "HostCallArgs", fnName: "$$str_lastIndexOf", argc: 3 });
      return true;
    }
    case "slice": {
      if (expr.arguments.length > 2) {
        ctx.diagnostics.push(
          makeDiag(LoweringDiagCode.StringMethodWrongArgCount, ".slice() takes at most 2 arguments", expr)
        );
        return true;
      }
      lowerExpression(propAccess.expression, ctx);
      if (expr.arguments.length >= 1) {
        lowerExpression(expr.arguments[0], ctx);
      } else {
        ctx.ir.push({ kind: "PushConst", value: NIL_VALUE });
      }
      if (expr.arguments.length >= 2) {
        lowerExpression(expr.arguments[1], ctx);
      } else {
        ctx.ir.push({ kind: "PushConst", value: NIL_VALUE });
      }
      ctx.ir.push({ kind: "HostCallArgs", fnName: "$$str_slice", argc: 3 });
      return true;
    }
    case "substring": {
      if (expr.arguments.length < 1 || expr.arguments.length > 2) {
        ctx.diagnostics.push(
          makeDiag(LoweringDiagCode.StringMethodWrongArgCount, ".substring() requires 1 or 2 arguments", expr)
        );
        return true;
      }
      lowerExpression(propAccess.expression, ctx);
      lowerExpression(expr.arguments[0], ctx);
      if (expr.arguments.length === 2) {
        lowerExpression(expr.arguments[1], ctx);
      } else {
        ctx.ir.push({ kind: "PushConst", value: NIL_VALUE });
      }
      ctx.ir.push({ kind: "HostCallArgs", fnName: "$$str_substring", argc: 3 });
      return true;
    }
    case "toLowerCase": {
      if (expr.arguments.length !== 0) {
        ctx.diagnostics.push(
          makeDiag(LoweringDiagCode.StringMethodWrongArgCount, ".toLowerCase() takes no arguments", expr)
        );
        return true;
      }
      lowerExpression(propAccess.expression, ctx);
      ctx.ir.push({ kind: "HostCallArgs", fnName: "$$str_toLowerCase", argc: 1 });
      return true;
    }
    case "toUpperCase": {
      if (expr.arguments.length !== 0) {
        ctx.diagnostics.push(
          makeDiag(LoweringDiagCode.StringMethodWrongArgCount, ".toUpperCase() takes no arguments", expr)
        );
        return true;
      }
      lowerExpression(propAccess.expression, ctx);
      ctx.ir.push({ kind: "HostCallArgs", fnName: "$$str_toUpperCase", argc: 1 });
      return true;
    }
    case "trim": {
      if (expr.arguments.length !== 0) {
        ctx.diagnostics.push(makeDiag(LoweringDiagCode.StringMethodWrongArgCount, ".trim() takes no arguments", expr));
        return true;
      }
      lowerExpression(propAccess.expression, ctx);
      ctx.ir.push({ kind: "HostCallArgs", fnName: "$$str_trim", argc: 1 });
      return true;
    }
    case "split": {
      if (expr.arguments.length < 1 || expr.arguments.length > 2) {
        ctx.diagnostics.push(
          makeDiag(LoweringDiagCode.StringMethodWrongArgCount, ".split() requires 1 or 2 arguments", expr)
        );
        return true;
      }
      lowerExpression(propAccess.expression, ctx);
      lowerExpression(expr.arguments[0], ctx);
      if (expr.arguments.length === 2) {
        lowerExpression(expr.arguments[1], ctx);
      } else {
        ctx.ir.push({ kind: "PushConst", value: NIL_VALUE });
      }
      ctx.ir.push({ kind: "HostCallArgs", fnName: "$$str_split", argc: 3 });
      return true;
    }
    case "concat": {
      if (expr.arguments.length === 0) {
        lowerExpression(propAccess.expression, ctx);
        return true;
      }
      lowerExpression(propAccess.expression, ctx);
      for (const arg of expr.arguments) {
        lowerExpression(arg, ctx);
      }
      ctx.ir.push({ kind: "HostCallArgs", fnName: "$$str_concat", argc: expr.arguments.length + 1 });
      return true;
    }
    case "toString":
    case "valueOf": {
      if (expr.arguments.length !== 0) {
        ctx.diagnostics.push(
          makeDiag(LoweringDiagCode.StringMethodWrongArgCount, `.${methodName}() takes no arguments`, expr)
        );
        return true;
      }
      lowerExpression(propAccess.expression, ctx);
      return true;
    }
    default:
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.UnsupportedStringMethod, `Unsupported string method: .${methodName}()`, expr)
      );
      return true;
  }
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
    case "lastIndexOf":
      lowerListLastIndexOf(expr, propAccess, ctx);
      return true;
    case "findIndex":
      lowerListFindIndex(expr, propAccess, ctx);
      return true;
    case "reduce":
      lowerListReduce(expr, propAccess, ctx);
      return true;
    case "toString":
      lowerListToString(expr, propAccess, ctx);
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
    const subFn = resolveOperator(CoreOpId.Subtract, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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

  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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

  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .sort()", expr)
    );
    return;
  }
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .sort()", expr)
    );
    return;
  }
  const subFn = resolveOperator(CoreOpId.Subtract, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!subFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve - operator for .sort()", expr)
    );
    return;
  }
  const leFn = resolveOperator(CoreOpId.LessThanOrEqualTo, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  const searchTypeId = tsTypeToTypeId(searchType, ctx.checker, ctx.services);
  const eqFn = searchTypeId ? resolveOperator(CoreOpId.EqualTo, [searchTypeId, searchTypeId], ctx.services) : undefined;
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
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "CallIndirectArgs", argc: 2 });

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
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "CallIndirectArgs", argc: 2 });

  ctx.ir.push({ kind: "LoadLocal", index: resultListLocal });
  ctx.ir.push({ kind: "Swap" });
  ctx.ir.push({ kind: "ListPush" });
  ctx.ir.push({ kind: "StoreLocal", index: resultListLocal });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "CallIndirectArgs", argc: 2 });
  ctx.ir.push({ kind: "Pop" });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  const searchTypeId = tsTypeToTypeId(searchType, ctx.checker, ctx.services);
  const eqFn = searchTypeId ? resolveOperator(CoreOpId.EqualTo, [searchTypeId, searchTypeId], ctx.services) : undefined;
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
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "CallIndirectArgs", argc: 2 });
  ctx.ir.push({ kind: "JumpIfTrue", labelId: foundLabel });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "CallIndirectArgs", argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: failLabel });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "CallIndirectArgs", argc: 2 });
  ctx.ir.push({ kind: "JumpIfTrue", labelId: foundLabel });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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
  if (expr.arguments.length > 1) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.JoinTakesAtMostOneArg, ".join() takes at most 1 argument", expr));
    return;
  }

  const sepExpr = expr.arguments.length === 1 ? expr.arguments[0] : undefined;
  lowerListJoinWithSeparator(propAccess.expression, sepExpr, ctx, expr);
}

function lowerListJoinWithSeparator(
  listExpr: ts.Expression,
  sepExpr: ts.Expression | undefined,
  ctx: LowerContext,
  diagNode: ts.Node
): void {
  const addFnName = resolveOperator(CoreOpId.Add, [CoreTypeIds.String, CoreTypeIds.String], ctx.services);
  if (!addFnName) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.NoOverloadForStringConcat, "Cannot resolve string concatenation for .join()", diagNode)
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

  lowerExpression(listExpr, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcListLocal });

  if (sepExpr) {
    lowerExpression(sepExpr, ctx);
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

  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .join()", diagNode)
    );
    return;
  }

  const eqFn = resolveOperator(CoreOpId.EqualTo, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!eqFn) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.CannotResolveOperatorForArrayMethod,
        "Cannot resolve === operator for .join()",
        diagNode
      )
    );
    return;
  }

  const addNumFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!addNumFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .join()", diagNode)
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

  emitToStringForJoinElement(ctx, diagNode);

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
  const conversion = resolveSingleStepConversion(CoreTypeIds.Number, CoreTypeIds.String, ctx.services);
  if (!conversion) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.CannotConvertListElementToString,
        "Cannot convert list element to string for .join()",
        diagNode
      )
    );
    return;
  }
  emitSingleStepConversion(conversion.fnName, ctx);
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
  const subFn = resolveOperator(CoreOpId.Subtract, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!subFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve - operator for .reverse()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: subFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  const geqFn = resolveOperator(CoreOpId.GreaterThanOrEqualTo, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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

  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .slice()", expr)
    );
    return;
  }

  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
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

function lowerListLastIndexOf(
  expr: ts.CallExpression,
  propAccess: ts.PropertyAccessExpression,
  ctx: LowerContext
): void {
  if (expr.arguments.length !== 1) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.LastIndexOfRequiresOneArg, ".lastIndexOf() requires exactly 1 argument", expr)
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

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: listLocal });
  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "StoreLocal", index: searchLocal });

  ctx.ir.push({ kind: "LoadLocal", index: listLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const subFn = resolveOperator(CoreOpId.Subtract, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!subFn) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.CannotResolveOperatorForArrayMethod,
        "Cannot resolve - operator for .lastIndexOf()",
        expr
      )
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: subFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  const geFn = resolveOperator(CoreOpId.GreaterThanOrEqualTo, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!geFn) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.CannotResolveOperatorForArrayMethod,
        "Cannot resolve >= operator for .lastIndexOf()",
        expr
      )
    );
    return;
  }

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: geFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: listLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "LoadLocal", index: searchLocal });

  const searchType = ctx.checker.getTypeAtLocation(expr.arguments[0]);
  const searchTypeId = tsTypeToTypeId(searchType, ctx.checker, ctx.services);
  const eqFn = searchTypeId ? resolveOperator(CoreOpId.EqualTo, [searchTypeId, searchTypeId], ctx.services) : undefined;
  if (!eqFn) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.CannotResolveOperatorForArrayMethod,
        "Cannot resolve === operator for .lastIndexOf()",
        expr
      )
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: eqFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfTrue", labelId: foundLabel });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: subFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: foundLabel });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: doneLabel });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(-1) });

  ctx.ir.push({ kind: "Label", labelId: doneLabel });
}

function lowerListFindIndex(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  if (expr.arguments.length !== 1) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.FindIndexRequiresOneArg, ".findIndex() requires exactly 1 argument", expr)
    );
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
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .findIndex()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: callbackLocal });
  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "CallIndirectArgs", argc: 2 });
  ctx.ir.push({ kind: "JumpIfTrue", labelId: foundLabel });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .findIndex()", expr)
    );
    return;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: foundLabel });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: doneLabel });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(-1) });

  ctx.ir.push({ kind: "Label", labelId: doneLabel });
}

function lowerListReduce(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  if (expr.arguments.length < 1 || expr.arguments.length > 2) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ReduceRequiresOneOrTwoArgs, ".reduce() requires 1 or 2 arguments", expr)
    );
    return;
  }

  const hasInitialValue = expr.arguments.length === 2;

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  const srcListLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const lenLocal = ctx.scopeStack.allocLocal();
  const callbackLocal = ctx.scopeStack.allocLocal();
  const accLocal = ctx.scopeStack.allocLocal();

  lowerExpression(propAccess.expression, ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcListLocal });

  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "StoreLocal", index: callbackLocal });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: lenLocal });

  if (hasInitialValue) {
    lowerExpression(expr.arguments[1], ctx);
    ctx.ir.push({ kind: "StoreLocal", index: accLocal });
    ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
    ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  } else {
    ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
    ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
    ctx.ir.push({ kind: "ListGet" });
    ctx.ir.push({ kind: "StoreLocal", index: accLocal });
    ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
    ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  }

  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for .reduce()", expr)
    );
    return;
  }

  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for .reduce()", expr)
    );
    return;
  }

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: lenLocal });
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  ctx.ir.push({ kind: "LoadLocal", index: callbackLocal });
  ctx.ir.push({ kind: "LoadLocal", index: accLocal });
  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "ListGet" });
  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "CallIndirectArgs", argc: 3 });
  ctx.ir.push({ kind: "StoreLocal", index: accLocal });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "LoadLocal", index: accLocal });
}

function lowerListToString(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): void {
  if (expr.arguments.length !== 0) {
    ctx.diagnostics.push(makeDiag(LoweringDiagCode.ArrayToStringTakesNoArgs, ".toString() takes no arguments", expr));
    return;
  }

  lowerListJoinWithSeparator(propAccess.expression, undefined, ctx, expr);
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

  emitBinaryOperatorForNodes(opId, expr.left, expr.right, expr, ctx);
}

const MATH_CONSTANTS = new Map<string, number>([
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: compile-time constant
  ["E", 2.718281828459045],
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: compile-time constant
  ["LN10", 2.302585092994046],
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: compile-time constant
  ["LN2", 0.6931471805599453],
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: compile-time constant
  ["LOG2E", 1.4426950408889634],
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: compile-time constant
  ["LOG10E", 0.4342944819032518],
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: compile-time constant
  ["PI", 3.141592653589793],
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: compile-time constant
  ["SQRT1_2", 0.7071067811865476],
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: compile-time constant
  ["SQRT2", 1.4142135623730951],
]);

const MATH_UNARY_METHODS = new Map<string, string>([
  ["abs", "$$math_abs"],
  ["acos", "$$math_acos"],
  ["asin", "$$math_asin"],
  ["atan", "$$math_atan"],
  ["ceil", "$$math_ceil"],
  ["cos", "$$math_cos"],
  ["exp", "$$math_exp"],
  ["floor", "$$math_floor"],
  ["log", "$$math_log"],
  ["round", "$$math_round"],
  ["sin", "$$math_sin"],
  ["sqrt", "$$math_sqrt"],
  ["tan", "$$math_tan"],
]);

const MATH_BINARY_METHODS = new Map<string, string>([
  ["atan2", "$$math_atan2"],
  ["max", "$$math_max"],
  ["min", "$$math_min"],
  ["pow", "$$math_pow"],
]);

function isMathGlobal(expr: ts.Expression, ctx: LowerContext): boolean {
  if (!ts.isIdentifier(expr) || expr.text !== "Math") return false;
  const sym = ctx.checker.getSymbolAtLocation(expr);
  if (!sym) return false;
  const decls = sym.getDeclarations();
  if (!decls || decls.length === 0) return false;
  for (const d of decls) {
    if (ts.isVariableDeclaration(d) || ts.isInterfaceDeclaration(d)) {
      const sf = d.getSourceFile();
      if (sf.isDeclarationFile || sf.fileName.includes("lib.")) return true;
    }
  }
  return false;
}

function isArrayGlobal(expr: ts.Expression, ctx: LowerContext): boolean {
  if (!ts.isIdentifier(expr) || expr.text !== "Array") return false;
  const sym = ctx.checker.getSymbolAtLocation(expr);
  if (!sym) return false;
  const decls = sym.getDeclarations();
  if (!decls || decls.length === 0) return false;
  for (const d of decls) {
    if (ts.isVariableDeclaration(d) || ts.isInterfaceDeclaration(d)) {
      const sf = d.getSourceFile();
      if (sf.isDeclarationFile || sf.fileName.includes("lib.")) return true;
    }
  }
  return false;
}

function lowerArrayFromCall(
  expr: ts.CallExpression,
  propAccess: ts.PropertyAccessExpression,
  ctx: LowerContext
): boolean {
  if (!isArrayGlobal(propAccess.expression, ctx)) return false;
  if (propAccess.name.text !== "from") return false;

  if (expr.arguments.length < 1 || expr.arguments.length > 2) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.ArrayFromRequiresOneOrTwoArgs, "Array.from() requires 1 or 2 arguments", expr)
    );
    return true;
  }

  const sourceType = ctx.checker.getTypeAtLocation(expr.arguments[0]);
  const sourceListTypeId = resolveListTypeId(sourceType, ctx);
  if (!sourceListTypeId) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.ArrayFromNonListSource,
        "Array.from() source must be an array/list type",
        expr.arguments[0]
      )
    );
    return true;
  }

  const returnType = ctx.checker.getTypeAtLocation(expr);
  const resultListTypeId = resolveListTypeId(returnType, ctx);
  if (!resultListTypeId) {
    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.CannotDetermineArrayFromResultListType,
        "Cannot determine result list type for Array.from() (add a type annotation)",
        expr
      )
    );
    return true;
  }

  const hasMapFn = expr.arguments.length === 2;

  const loopStart = allocLabel(ctx);
  const loopEnd = allocLabel(ctx);

  const srcListLocal = ctx.scopeStack.allocLocal();
  const resultListLocal = ctx.scopeStack.allocLocal();
  const idxLocal = ctx.scopeStack.allocLocal();
  const lenLocal = ctx.scopeStack.allocLocal();

  lowerExpression(expr.arguments[0], ctx);
  ctx.ir.push({ kind: "StoreLocal", index: srcListLocal });

  ctx.ir.push({ kind: "ListNew", typeId: resultListTypeId });
  ctx.ir.push({ kind: "StoreLocal", index: resultListLocal });

  let callbackLocal: number | undefined;
  if (hasMapFn) {
    callbackLocal = ctx.scopeStack.allocLocal();
    lowerExpression(expr.arguments[1], ctx);
    ctx.ir.push({ kind: "StoreLocal", index: callbackLocal });
  }

  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(0) });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });

  ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
  ctx.ir.push({ kind: "ListLen" });
  ctx.ir.push({ kind: "StoreLocal", index: lenLocal });

  ctx.ir.push({ kind: "Label", labelId: loopStart });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "LoadLocal", index: lenLocal });
  const ltFn = resolveOperator(CoreOpId.LessThan, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!ltFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve < operator for Array.from()", expr)
    );
    return true;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: ltFn, argc: 2 });
  ctx.ir.push({ kind: "JumpIfFalse", labelId: loopEnd });

  if (hasMapFn) {
    ctx.ir.push({ kind: "LoadLocal", index: callbackLocal! });
    ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
    ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
    ctx.ir.push({ kind: "ListGet" });
    ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
    ctx.ir.push({ kind: "CallIndirectArgs", argc: 2 });
  } else {
    ctx.ir.push({ kind: "LoadLocal", index: srcListLocal });
    ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
    ctx.ir.push({ kind: "ListGet" });
  }

  ctx.ir.push({ kind: "LoadLocal", index: resultListLocal });
  ctx.ir.push({ kind: "Swap" });
  ctx.ir.push({ kind: "ListPush" });
  ctx.ir.push({ kind: "StoreLocal", index: resultListLocal });

  ctx.ir.push({ kind: "LoadLocal", index: idxLocal });
  ctx.ir.push({ kind: "PushConst", value: mkNumberValue(1) });
  const addFn = resolveOperator(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number], ctx.services);
  if (!addFn) {
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.CannotResolveOperatorForArrayMethod, "Cannot resolve + operator for Array.from()", expr)
    );
    return true;
  }
  ctx.ir.push({ kind: "HostCallArgs", fnName: addFn, argc: 2 });
  ctx.ir.push({ kind: "StoreLocal", index: idxLocal });
  ctx.ir.push({ kind: "Jump", labelId: loopStart });

  ctx.ir.push({ kind: "Label", labelId: loopEnd });
  ctx.ir.push({ kind: "LoadLocal", index: resultListLocal });
  return true;
}

function lowerMathCall(expr: ts.CallExpression, propAccess: ts.PropertyAccessExpression, ctx: LowerContext): boolean {
  if (!isMathGlobal(propAccess.expression, ctx)) return false;

  const methodName = propAccess.name.text;

  if (methodName === "random") {
    if (expr.arguments.length !== 0) {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.MathMethodWrongArgCount, "Math.random() takes no arguments", expr)
      );
      return true;
    }
    ctx.ir.push({ kind: "HostCallArgs", fnName: "$$math_random", argc: 0 });
    return true;
  }

  const unaryFn = MATH_UNARY_METHODS.get(methodName);
  if (unaryFn) {
    if (expr.arguments.length !== 1) {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.MathMethodWrongArgCount, `Math.${methodName}() requires exactly 1 argument`, expr)
      );
      return true;
    }
    lowerExpression(expr.arguments[0], ctx);
    ctx.ir.push({ kind: "HostCallArgs", fnName: unaryFn, argc: 1 });
    return true;
  }

  const binaryFn = MATH_BINARY_METHODS.get(methodName);
  if (binaryFn) {
    if (expr.arguments.length !== 2) {
      ctx.diagnostics.push(
        makeDiag(LoweringDiagCode.MathMinMaxRequiresTwoArgs, `Math.${methodName}() requires exactly 2 arguments`, expr)
      );
      return true;
    }
    lowerExpression(expr.arguments[0], ctx);
    lowerExpression(expr.arguments[1], ctx);
    ctx.ir.push({ kind: "HostCallArgs", fnName: binaryFn, argc: 2 });
    return true;
  }

  ctx.diagnostics.push(makeDiag(LoweringDiagCode.UnsupportedMathMethod, `Math.${methodName}() is not supported`, expr));
  return true;
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

  if (isMathGlobal(expr.expression, ctx)) {
    const constVal = MATH_CONSTANTS.get(expr.name.text);
    if (constVal !== undefined) {
      ctx.ir.push({ kind: "PushConst", value: mkNumberValue(constVal) });
      return;
    }
    ctx.diagnostics.push(
      makeDiag(LoweringDiagCode.UnsupportedPropertyAccess, `Math.${expr.name.text} is not a known constant`, expr)
    );
    return;
  }

  const enumAccess = resolveEnumPropertyAccess(expr, ctx);
  if (enumAccess) {
    if (enumAccess.kind === "member") {
      ctx.ir.push({ kind: "PushConst", value: enumAccess.value });
      return;
    }

    ctx.diagnostics.push(
      makeDiag(
        LoweringDiagCode.EnumObjectUsageNotSupported,
        "Enum objects are not supported at runtime; only direct member access like Direction.Up is supported",
        expr
      )
    );
    return;
  }

  if (expr.name.text === "length") {
    const objType = ctx.checker.getTypeAtLocation(expr.expression);
    if (isStringType(objType)) {
      lowerExpression(expr.expression, ctx);
      ctx.ir.push({ kind: "HostCallArgs", fnName: "$$str_length", argc: 1 });
      return;
    }
    const listTypeId = resolveListTypeId(objType, ctx);
    if (listTypeId) {
      lowerExpression(expr.expression, ctx);
      ctx.ir.push({ kind: "ListLen" });
      return;
    }
  }

  const objType = ctx.checker.getTypeAtLocation(expr.expression);
  const structDef = resolveStructType(objType, ctx.services);
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

  const fieldName = expr.name.text;
  const tsProps = objType.getProperties();
  if (tsProps.length > 0 && tsProps.some((p) => p.getName() === fieldName)) {
    lowerExpression(expr.expression, ctx);
    ctx.ir.push({ kind: "GetField", fieldName });
    return;
  }

  ctx.diagnostics.push(makeDiag(LoweringDiagCode.UnsupportedPropertyAccess, "Unsupported property access", expr));
}

function resolveRegistryName(sym: ts.Symbol, services: BrainServices, checker?: ts.TypeChecker): string {
  const resolvedSym = resolveAliasedSymbol(sym, checker) ?? sym;
  const name = resolvedSym.getName();
  const decls = resolvedSym.getDeclarations();
  if (decls && decls.length > 0 && isUserSourceDecl(decls[0])) {
    const qualName = qualifiedClassName(decls[0].getSourceFile().fileName, name);
    if (services.types.resolveByName(qualName)) {
      return qualName;
    }
  }
  return name;
}

function resolveStructType(type: ts.Type, services: BrainServices): StructTypeDef | undefined {
  const registry = services.types;
  if (type.isUnion()) {
    const nonNullish = type.types.filter((t) => !(t.flags & ts.TypeFlags.Null) && !(t.flags & ts.TypeFlags.Undefined));
    if (nonNullish.length === 1) {
      return resolveStructType(nonNullish[0], services);
    }
    return undefined;
  }
  const sym = type.aliasSymbol ?? type.getSymbol();
  if (!sym) return undefined;
  const resolvedName = resolveRegistryName(sym, services);
  const typeId = registry.resolveByName(resolvedName);
  if (!typeId) return undefined;
  const def = registry.get(typeId);
  if (!def || def.coreType !== NativeType.Struct) return undefined;
  return def as StructTypeDef;
}

function resolveEnumDeclaration(sym: ts.Symbol, checker?: ts.TypeChecker): ts.EnumDeclaration | undefined {
  const resolvedSym = resolveAliasedSymbol(sym, checker);
  const declarations = resolvedSym?.getDeclarations();
  if (!declarations) {
    return undefined;
  }
  return declarations.find(ts.isEnumDeclaration);
}

function getEnumMemberKey(member: ts.EnumMember): string | undefined {
  if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name)) {
    return member.name.text;
  }
  return undefined;
}

function registerUserEnumTypes(
  localEnumNodes: ts.EnumDeclaration[],
  importedEnums: ImportedEnum[],
  checker: ts.TypeChecker,
  diagnostics: CompileDiagnostic[],
  services: BrainServices
): void {
  const seenNames = new Set<string>();

  for (const enumNode of localEnumNodes) {
    const qualifiedName = qualifiedClassName(enumNode.getSourceFile().fileName, enumNode.name.text);
    if (seenNames.has(qualifiedName)) {
      continue;
    }
    seenNames.add(qualifiedName);
    registerUserEnumType(enumNode, checker, diagnostics, services);
  }

  for (const importedEnum of importedEnums) {
    const qualifiedName = qualifiedClassName(importedEnum.sourceFile.fileName, importedEnum.name);
    if (seenNames.has(qualifiedName)) {
      continue;
    }
    seenNames.add(qualifiedName);
    registerUserEnumType(importedEnum.node, checker, diagnostics, services);
  }
}

function registerUserEnumType(
  enumNode: ts.EnumDeclaration,
  checker: ts.TypeChecker,
  diagnostics: CompileDiagnostic[],
  services: BrainServices
): void {
  const registry = services.types;
  const qualifiedName = qualifiedClassName(enumNode.getSourceFile().fileName, enumNode.name.text);
  if (registry.resolveByName(qualifiedName)) {
    return;
  }

  const symbols = new List<{ key: string; label: string; value: string | number }>();
  let valueKind: "string" | "number" | undefined;

  for (const member of enumNode.members) {
    const key = getEnumMemberKey(member);
    if (!key) {
      diagnostics.push(
        makeCompileDiag(
          CompileDiagCode.InvalidEnumDeclaration,
          `Enum member '${enumNode.name.text}' must use an identifier or literal name`,
          member
        )
      );
      return;
    }

    const constantValue = checker.getConstantValue(member);
    if (constantValue === undefined || (typeof constantValue !== "string" && typeof constantValue !== "number")) {
      diagnostics.push(
        makeCompileDiag(
          CompileDiagCode.InvalidEnumDeclaration,
          `Enum member '${enumNode.name.text}.${key}' must have a compile-time string or number value`,
          member
        )
      );
      return;
    }

    const currentKind: "string" | "number" = typeof constantValue === "string" ? "string" : "number";
    if (valueKind && valueKind !== currentKind) {
      diagnostics.push(
        makeCompileDiag(
          CompileDiagCode.InvalidEnumDeclaration,
          `Heterogeneous enum '${enumNode.name.text}' is not supported`,
          enumNode
        )
      );
      return;
    }

    valueKind = currentKind;
    symbols.push({ key, label: key, value: constantValue });
  }

  try {
    if (symbols.isEmpty()) {
      registry.addEnumType(qualifiedName, { symbols });
      return;
    }

    registry.addEnumType(qualifiedName, {
      symbols,
      defaultKey: symbols.get(0).key,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : `Invalid enum declaration '${enumNode.name.text}'`;
    diagnostics.push(makeCompileDiag(CompileDiagCode.InvalidEnumDeclaration, message, enumNode));
  }
}

type EnumPropertyAccessResolution = { kind: "member"; value: Value } | { kind: "unsupported" };

function resolveEnumPropertyAccess(
  expr: ts.PropertyAccessExpression,
  ctx: LowerContext
): EnumPropertyAccessResolution | undefined {
  const enumSymbol = resolveAliasedSymbol(ctx.checker.getSymbolAtLocation(expr.expression), ctx.checker);
  if (!enumSymbol) {
    return undefined;
  }

  const enumDecl = resolveEnumDeclaration(enumSymbol, ctx.checker);
  if (!enumDecl) {
    return undefined;
  }

  const typeId = resolveRegisteredEnumTypeIdFromSymbol(enumSymbol, ctx.services, ctx.checker);
  if (!typeId) {
    return undefined;
  }

  const memberSymbol = resolveAliasedSymbol(ctx.checker.getSymbolAtLocation(expr.name), ctx.checker);
  const memberDecl = memberSymbol?.getDeclarations()?.find(ts.isEnumMember);
  if (!memberDecl || memberDecl.parent !== enumDecl) {
    return { kind: "unsupported" };
  }

  const key = getEnumMemberKey(memberDecl);
  if (!key || !ctx.services.types.getEnumSymbol(typeId, key)) {
    return { kind: "unsupported" };
  }

  return {
    kind: "member",
    value: { t: NativeType.Enum, typeId, v: key },
  };
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

  const structDef = resolveStructType(contextualType, ctx.services);
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
    if (ts.isMethodDeclaration(prop)) {
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
      lowerClosureExpression(prop, ctx);
      ctx.ir.push({ kind: "StructSet" });
      continue;
    }
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
  const registry = ctx.services.types;

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
    const valueTypeId = tsTypeToTypeId(indexType, ctx.checker, ctx.services);
    if (valueTypeId) {
      return registry.instantiate("Map", List.from([valueTypeId]));
    }
  }

  return undefined;
}

function resolveListTypeId(arrayType: ts.Type, ctx: LowerContext): string | undefined {
  const registry = ctx.services.types;

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
  const elementTypeId = tsTypeToTypeId(elementType, ctx.checker, ctx.services);
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

  const hasSpread = expr.elements.some(ts.isSpreadElement);

  if (!hasSpread) {
    ctx.ir.push({ kind: "ListNew", typeId: listTypeId });
    for (const element of expr.elements) {
      lowerExpression(element, ctx);
      ctx.ir.push({ kind: "ListPush" });
    }
    return;
  }

  const resultLocal = ctx.scopeStack.allocLocal();
  ctx.ir.push({ kind: "ListNew", typeId: listTypeId });
  ctx.ir.push({ kind: "StoreLocal", index: resultLocal });

  for (const element of expr.elements) {
    if (ts.isSpreadElement(element)) {
      emitPushAllFromList(element.expression, resultLocal, ctx, expr);
    } else {
      ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
      lowerExpression(element, ctx);
      ctx.ir.push({ kind: "ListPush" });
      ctx.ir.push({ kind: "StoreLocal", index: resultLocal });
    }
  }

  ctx.ir.push({ kind: "LoadLocal", index: resultLocal });
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

function expandTypeIdMembers(typeId: string, services: BrainServices): string[] {
  const registry = services.types;
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
  const typeId = resolveRegisteredEnumTypeId(contextualType, ctx.services, ctx.checker);
  if (!typeId) return undefined;
  const registry = ctx.services.types;
  const typeDef = registry.get(typeId);
  if (!typeDef || typeDef.coreType !== NativeType.Enum) return undefined;
  return { t: NativeType.Enum, typeId, v: expr.text };
}

function tsTypeToTypeId(
  type: ts.Type,
  checker: ts.TypeChecker | undefined,
  services: BrainServices
): string | undefined {
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
  if (type.flags & ts.TypeFlags.TypeParameter) {
    if (checker) {
      const constraint = checker.getBaseConstraintOfType(type);
      if (constraint) {
        return tsTypeToTypeId(constraint, checker, services);
      }
    }
    return CoreTypeIds.Any;
  }
  const enumTypeId = resolveRegisteredEnumTypeId(type, services, checker);
  if (enumTypeId) {
    return enumTypeId;
  }
  const callSigs = type.getCallSignatures();
  if (callSigs.length > 0 && checker) {
    const sig = callSigs[0];
    const paramTypeIds = new List<string>();
    let allResolved = true;
    for (const param of sig.parameters) {
      const paramType = checker.getTypeOfSymbol(param);
      const paramTid = tsTypeToTypeId(paramType, checker, services);
      if (!paramTid) {
        allResolved = false;
        break;
      }
      paramTypeIds.push(paramTid);
    }
    if (allResolved) {
      const retType = sig.getReturnType();
      const retTid = tsTypeToTypeId(retType, checker, services);
      if (retTid) {
        return services.types.getOrCreateFunctionType({
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
      const baseTypeId = tsTypeToTypeId(nonNullish[0], checker, services);
      if (!baseTypeId) return undefined;
      if (hasNullish) {
        return services.types.addNullableType(baseTypeId);
      }
      return baseTypeId;
    }
    if (nonNullish.length >= 2) {
      const memberIds = new List<string>();
      for (const t of nonNullish) {
        const id = tsTypeToTypeId(t, checker, services);
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
        return services.types.getOrCreateUnionType(List.from([...deduped]));
      }
      if (deduped.size === 1) {
        return [...deduped][0];
      }
    }
  }
  const sym = type.aliasSymbol ?? type.getSymbol();
  if (sym) {
    const registry = services.types;
    const symName = sym.getName();

    if (symName === "Array" && checker) {
      const typeArgs = (type as ts.TypeReference).typeArguments ?? checker.getTypeArguments(type as ts.TypeReference);
      if (typeArgs && typeArgs.length > 0) {
        const elementTypeId = tsTypeToTypeId(typeArgs[0], checker, services);
        if (elementTypeId) {
          return registry.instantiate("List", List.from([elementTypeId]));
        }
      }
    }

    if (symName === "Map" && checker) {
      const typeArgs = (type as ts.TypeReference).typeArguments ?? checker.getTypeArguments(type as ts.TypeReference);
      if (typeArgs && typeArgs.length >= 2) {
        const valueTypeId = tsTypeToTypeId(typeArgs[1], checker, services);
        if (valueTypeId) {
          return registry.instantiate("Map", List.from([valueTypeId]));
        }
      }
    }

    const typeId = registry.resolveByName(resolveRegistryName(sym, services));
    if (typeId) return typeId;
  }

  if (checker) {
    const indexType = type.getStringIndexType();
    if (indexType) {
      const valueTypeId = tsTypeToTypeId(indexType, checker, services);
      if (valueTypeId) {
        return services.types.instantiate("Map", List.from([valueTypeId]));
      }
    }
  }

  return undefined;
}

function extractClassFields(
  classNode: ts.ClassDeclaration,
  checker: ts.TypeChecker,
  diagnostics: CompileDiagnostic[],
  services: BrainServices
): List<{ name: string; typeId: TypeId }> | undefined {
  const fields = new List<{ name: string; typeId: TypeId }>();
  const seen = new Set<string>();

  for (const member of classNode.members) {
    if (!ts.isPropertyDeclaration(member)) continue;
    if (!ts.isIdentifier(member.name)) continue;
    const fieldName = member.name.text;
    if (seen.has(fieldName)) continue;
    seen.add(fieldName);

    const memberType = checker.getTypeAtLocation(member);
    const fieldTypeId = tsTypeToTypeId(memberType, checker, services);
    if (!fieldTypeId) {
      diagnostics.push(
        makeDiag(
          LoweringDiagCode.UnresolvableClassFieldType,
          `Cannot resolve type of class field '${fieldName}'`,
          member
        )
      );
      return undefined;
    }
    fields.push({ name: fieldName, typeId: fieldTypeId });
  }

  const ctor = classNode.members.find(ts.isConstructorDeclaration);
  if (ctor?.body) {
    for (const stmt of ctor.body.statements) {
      if (!ts.isExpressionStatement(stmt)) continue;
      const expr = stmt.expression;
      if (!ts.isBinaryExpression(expr)) continue;
      if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
      if (!ts.isPropertyAccessExpression(expr.left)) continue;
      if (expr.left.expression.kind !== ts.SyntaxKind.ThisKeyword) continue;

      const fieldName = expr.left.name.text;
      if (seen.has(fieldName)) continue;
      seen.add(fieldName);

      const assignType = checker.getTypeAtLocation(expr.left);
      const fieldTypeId = tsTypeToTypeId(assignType, checker, services);
      if (!fieldTypeId) {
        diagnostics.push(
          makeDiag(
            LoweringDiagCode.UnresolvableClassFieldType,
            `Cannot resolve type of class field '${fieldName}'`,
            expr.left
          )
        );
        return undefined;
      }
      fields.push({ name: fieldName, typeId: fieldTypeId });
    }
  }

  return fields;
}

function extractClassMethodDecls(
  classNode: ts.ClassDeclaration,
  checker: ts.TypeChecker,
  services: BrainServices
): List<{ name: string; params: List<{ name: string; typeId: TypeId }>; returnTypeId: TypeId }> {
  const methods = new List<{
    name: string;
    params: List<{ name: string; typeId: TypeId }>;
    returnTypeId: TypeId;
  }>();

  for (const member of classNode.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    if (!ts.isIdentifier(member.name)) continue;

    const sig = checker.getSignatureFromDeclaration(member);
    if (!sig) continue;

    const params = new List<{ name: string; typeId: TypeId }>();
    for (const param of sig.parameters) {
      const paramType = checker.getTypeOfSymbol(param);
      const paramTypeId = tsTypeToTypeId(paramType, checker, services) ?? CoreTypeIds.Any;
      params.push({ name: param.getName(), typeId: paramTypeId });
    }

    const retType = sig.getReturnType();
    const returnTypeId = tsTypeToTypeId(retType, checker, services) ?? CoreTypeIds.Void;

    methods.push({ name: member.name.text, params, returnTypeId });
  }

  return methods;
}

function registerClassStructType(
  ci: ClassInfo,
  checker: ts.TypeChecker,
  diagnostics: CompileDiagnostic[],
  services: BrainServices
): void {
  const registry = services.types;
  const qualName = qualifiedClassName(ci.sourceFile.fileName, ci.name);
  const existing = registry.resolveByName(qualName);
  if (existing) return;

  const fields = extractClassFields(ci.node, checker, diagnostics, services);
  if (!fields) return;

  const methods = extractClassMethodDecls(ci.node, checker, services);

  registry.addStructType(qualName, { fields, methods });
}

function reserveInterfaceStructType(
  ii: InterfaceInfo,
  checker: ts.TypeChecker,
  diagnostics: CompileDiagnostic[],
  services: BrainServices
): string | undefined {
  const registry = services.types;
  const qualName = qualifiedClassName(ii.sourceFile.fileName, ii.name);

  if (registry.resolveByName(ii.name)) {
    diagnostics.push(
      makeDiag(
        LoweringDiagCode.InterfaceCollidesWithAmbientType,
        `Interface '${ii.name}' collides with an ambient (runtime-registered) type`,
        ii.node
      )
    );
    return undefined;
  }

  // TS merges multiple interface declarations with the same name. The checker
  // already returns the merged type, so the first declaration we process
  // registers the full field set. Subsequent declarations are safe to skip.
  const existing = registry.resolveByName(qualName);
  if (existing) return undefined;

  if (ii.node.typeParameters && ii.node.typeParameters.length > 0) {
    diagnostics.push(
      makeDiag(
        LoweringDiagCode.GenericInterfaceNotSupported,
        `Generic interfaces are not supported: '${ii.name}'`,
        ii.node
      )
    );
    return undefined;
  }

  return registry.reserveStructType(qualName);
}

function finalizeInterfaceStructType(
  ii: InterfaceInfo,
  typeId: string,
  checker: ts.TypeChecker,
  diagnostics: CompileDiagnostic[],
  services: BrainServices
): void {
  const type = checker.getTypeAtLocation(ii.node);
  const fields = extractInterfaceFields(type, ii.node, checker, diagnostics, services);
  if (!fields) return;

  services.types.finalizeStructType(typeId, { fields });
}

function reserveTypeAliasStructType(
  tai: TypeAliasInfo,
  checker: ts.TypeChecker,
  diagnostics: CompileDiagnostic[],
  services: BrainServices
): string | undefined {
  const registry = services.types;
  const qualName = qualifiedClassName(tai.sourceFile.fileName, tai.name);

  if (registry.resolveByName(tai.name)) {
    diagnostics.push(
      makeDiag(
        LoweringDiagCode.TypeAliasCollidesWithAmbientType,
        `Type alias '${tai.name}' collides with an ambient (runtime-registered) type`,
        tai.node
      )
    );
    return undefined;
  }

  const existing = registry.resolveByName(qualName);
  if (existing) return undefined;

  if (tai.node.typeParameters && tai.node.typeParameters.length > 0) {
    diagnostics.push(
      makeDiag(
        LoweringDiagCode.GenericTypeAliasNotSupported,
        `Generic type aliases are not supported: '${tai.name}'`,
        tai.node
      )
    );
    return undefined;
  }

  if (!ts.isTypeLiteralNode(tai.node.type)) return undefined;

  return registry.reserveStructType(qualName);
}

function finalizeTypeAliasStructType(
  tai: TypeAliasInfo,
  typeId: string,
  checker: ts.TypeChecker,
  diagnostics: CompileDiagnostic[],
  services: BrainServices
): void {
  const type = checker.getTypeAtLocation(tai.node);
  const fields = extractInterfaceFields(type, tai.node, checker, diagnostics, services);
  if (!fields) return;

  services.types.finalizeStructType(typeId, { fields });
}

function extractInterfaceFields(
  type: ts.Type,
  node: ts.Node,
  checker: ts.TypeChecker,
  diagnostics: CompileDiagnostic[],
  services: BrainServices
): List<{ name: string; typeId: TypeId }> | undefined {
  const fields = new List<{ name: string; typeId: TypeId }>();

  const indexInfo = checker.getIndexInfosOfType(type);
  if (indexInfo.length > 0) {
    diagnostics.push(
      makeDiag(LoweringDiagCode.UnsupportedInterfaceMember, "Index signatures are not supported in interfaces", node)
    );
    return undefined;
  }

  const callSigs = type.getCallSignatures();
  if (callSigs.length > 0) {
    diagnostics.push(
      makeDiag(LoweringDiagCode.UnsupportedInterfaceMember, "Call signatures are not supported in interfaces", node)
    );
    return undefined;
  }

  const constructSigs = type.getConstructSignatures();
  if (constructSigs.length > 0) {
    diagnostics.push(
      makeDiag(
        LoweringDiagCode.UnsupportedInterfaceMember,
        "Construct signatures are not supported in interfaces",
        node
      )
    );
    return undefined;
  }

  const properties = type.getProperties();
  for (const prop of properties) {
    const propType = checker.getTypeOfSymbol(prop);
    const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;

    let fieldTypeId = tsTypeToTypeId(propType, checker, services);
    if (!fieldTypeId) {
      diagnostics.push(
        makeDiag(
          LoweringDiagCode.UnresolvableInterfaceFieldType,
          `Cannot resolve type of interface field '${prop.name}'`,
          prop.valueDeclaration ?? node
        )
      );
      return undefined;
    }

    if (isOptional && fieldTypeId !== CoreTypeIds.Nil) {
      fieldTypeId = services.types.addNullableType(fieldTypeId);
    }

    fields.push({ name: prop.name, typeId: fieldTypeId });
  }

  return fields;
}

function lowerClassDeclaration(
  ci: ClassInfo,
  checker: ts.TypeChecker,
  callsiteVars: Map<string, number>,
  functionTable: Map<string, number>,
  diagnostics: CompileDiagnostic[],
  funcIdCounter: { value: number },
  closureFunctions: Map<number, FunctionEntry>,
  services: BrainServices
): FunctionEntry[] {
  const entries: FunctionEntry[] = [];

  const registry = services.types;
  const qualName = qualifiedClassName(ci.sourceFile.fileName, ci.name);
  const typeId = registry.resolveByName(qualName);

  const ctor = ci.node.members.find(ts.isConstructorDeclaration);
  const ctorParamCount = ctor ? ctor.parameters.length : 0;

  const ctorIr: IrNode[] = [];
  const ctorParamLocals = new Map<string, number>();

  for (let i = 0; i < ctorParamCount; i++) {
    const p = ctor!.parameters[i];
    if (ts.isIdentifier(p.name)) {
      ctorParamLocals.set(p.name.text, i);
    }
  }

  const ctorScope = new ScopeStack(ctorParamCount);
  const ctorFuncScopeId = ctorScope.initFunctionScope(0, `${ci.name}$new`);
  const thisLocal = ctorScope.allocLocal();

  for (let i = 0; i < ctorParamCount; i++) {
    const p = ctor!.parameters[i];
    if (ts.isIdentifier(p.name)) {
      ctorScope.addParameterMetadata(p.name.text, i, ctorFuncScopeId);
    }
  }

  const ctorCtx: LowerContext = {
    services,
    checker,
    paramsSymbol: undefined,
    paramLocals: ctorParamLocals,
    scopeStack: ctorScope,
    ir: ctorIr,
    diagnostics,
    loopStack: [],
    breakStack: [],
    nextLabelId: 0,
    callsiteVars,
    functionTable,
    funcIdCounter,
    closureFunctions,
    thisLocalIndex: thisLocal,
    currentFunctionName: `${ci.name}$new`,
    currentReturnTypeId: ctor ? resolveSignatureReturnTypeId(ctor, checker, services) : undefined,
  };

  if (typeId) {
    ctorIr.push({ kind: "StructNew", typeId });
  } else {
    ctorIr.push({ kind: "PushConst", value: NIL_VALUE });
  }
  ctorIr.push({ kind: "StoreLocal", index: thisLocal });

  for (const member of ci.node.members) {
    if (!ts.isPropertyDeclaration(member)) continue;
    if (!ts.isIdentifier(member.name)) continue;
    if (!member.initializer) continue;

    const fieldName = member.name.text;
    ctorIr.push({ kind: "LoadLocal", index: thisLocal });
    ctorIr.push({ kind: "PushConst", value: mkStringValue(fieldName) });
    lowerExpression(member.initializer, ctorCtx);
    ctorIr.push({ kind: "StructSet" });
    ctorIr.push({ kind: "StoreLocal", index: thisLocal });
  }

  if (ctor?.body) {
    lowerStatements(ctor.body.statements, ctorCtx);
  }

  ctorIr.push({ kind: "LoadLocal", index: thisLocal });
  ctorIr.push({ kind: "Return" });

  ctorScope.finalizeFunctionScope(ctorIr.length);
  entries.push({
    ir: ctorIr,
    numParams: ctorParamCount,
    numLocals: ctorScope.nextLocal,
    name: `${ci.name}$new`,
    scopeMetadata: [...ctorScope.scopeMetadata],
    localMetadata: [...ctorScope.localMetadata],
    isGenerated: false,
    sourceFileName: ci.sourceFile.fileName,
    functionSpan: ctor ? spanFromNode(ctor) : spanFromNode(ci.node),
  });

  for (const member of ci.node.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    if (!ts.isIdentifier(member.name)) continue;

    const methodName = member.name.text;
    const userParamCount = member.parameters.length;
    const totalParamCount = userParamCount + 1;

    const methodIr: IrNode[] = [];
    const methodParamLocals = new Map<string, number>();

    for (let i = 0; i < userParamCount; i++) {
      const p = member.parameters[i];
      if (ts.isIdentifier(p.name)) {
        methodParamLocals.set(p.name.text, i + 1);
      }
    }

    const methodScope = new ScopeStack(totalParamCount);
    const methodFuncScopeId = methodScope.initFunctionScope(0, `${ci.name}.${methodName}`);

    methodScope.addParameterMetadata("this", 0, methodFuncScopeId);
    for (let i = 0; i < userParamCount; i++) {
      const p = member.parameters[i];
      if (ts.isIdentifier(p.name)) {
        methodScope.addParameterMetadata(p.name.text, i + 1, methodFuncScopeId);
      }
    }

    const methodCtx: LowerContext = {
      services,
      checker,
      paramsSymbol: undefined,
      paramLocals: methodParamLocals,
      scopeStack: methodScope,
      ir: methodIr,
      diagnostics,
      loopStack: [],
      breakStack: [],
      nextLabelId: 0,
      callsiteVars,
      functionTable,
      funcIdCounter,
      closureFunctions,
      thisLocalIndex: 0,
      currentFunctionName: `${ci.name}.${methodName}`,
      currentReturnTypeId: resolveSignatureReturnTypeId(member, checker, services),
    };

    for (let i = 0; i < userParamCount; i++) {
      const p = member.parameters[i];
      if (ts.isObjectBindingPattern(p.name)) {
        lowerObjectBindingPattern(p.name, i + 1, methodCtx);
      } else if (ts.isArrayBindingPattern(p.name)) {
        lowerArrayBindingPattern(p.name, i + 1, methodCtx);
      }
    }

    if (member.body) {
      lowerStatements(member.body.statements, methodCtx);
    }

    methodIr.push({ kind: "PushConst", value: NIL_VALUE });
    methodIr.push({ kind: "Return" });

    methodScope.finalizeFunctionScope(methodIr.length);
    entries.push({
      ir: methodIr,
      numParams: totalParamCount,
      numLocals: methodScope.nextLocal,
      name: `${ci.name}.${methodName}`,
      scopeMetadata: [...methodScope.scopeMetadata],
      localMetadata: [...methodScope.localMetadata],
      isGenerated: false,
      sourceFileName: ci.sourceFile.fileName,
      functionSpan: spanFromNode(member),
    });
  }

  return entries;
}

function makeDiag(code: LoweringDiagCode, message: string, node: ts.Node): CompileDiagnostic {
  const sourceFile = node.getSourceFile();
  const diag: CompileDiagnostic = { code, message, severity: "error" };
  if (sourceFile) {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    diag.line = start.line + 1;
    diag.column = start.character + 1;
    diag.endLine = end.line + 1;
    diag.endColumn = end.character + 1;
  }
  return diag;
}

function makeCompileDiag(code: CompileDiagCode, message: string, node: ts.Node): CompileDiagnostic {
  const sourceFile = node.getSourceFile();
  const diag: CompileDiagnostic = { code, message, severity: "error" };
  if (sourceFile) {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    diag.line = start.line + 1;
    diag.column = start.character + 1;
    diag.endLine = end.line + 1;
    diag.endColumn = end.character + 1;
  }
  return diag;
}

function spanFromNode(node: ts.Node): IrSourceSpan | undefined {
  const sf = node.getSourceFile();
  if (!sf) return undefined;
  const start = sf.getLineAndCharacterOfPosition(node.getStart());
  const end = sf.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function annotateFirstNode(ir: IrNode[], irStart: number, node: ts.Node, isStatementBoundary: boolean): void {
  if (ir.length <= irStart) return;
  const first = ir[irStart];
  if (first.kind === "Label" && ir.length > irStart + 1) {
    const next = ir[irStart + 1];
    if (!next.span) {
      next.span = spanFromNode(node);
      if (isStatementBoundary) next.isStatementBoundary = true;
    } else if (isStatementBoundary) {
      next.isStatementBoundary = true;
    }
    return;
  }
  if (!first.span) {
    first.span = spanFromNode(node);
    if (isStatementBoundary) first.isStatementBoundary = true;
  } else if (isStatementBoundary) {
    first.isStatementBoundary = true;
  }
}
