import {
  compiler,
  type FunctionBytecode,
  type IFunctionRegistry,
  mkFunctionValue,
  NIL_VALUE,
  type TypeId,
} from "@mindcraft-lang/core/brain";
import { EmitDiagCode } from "./diag-codes.js";
import type { IrNode, IrSourceSpan } from "./ir.js";
import type { LocalMetadata, ScopeMetadata } from "./scope.js";
import type { CallSiteInfo, CompileDiagnostic, DebugSpan, LocalInfo, ScopeInfo, SuspendSiteInfo } from "./types.js";

interface EmittableIrNode {
  node: IrNode;
  originalIndex: number | undefined;
}

/** Result of {@link emitFunction}: bytecode plus debug-span and per-PC metadata. */
export interface EmitResult {
  bytecode: FunctionBytecode;
  diagnostics: CompileDiagnostic[];
  spans: DebugSpan[];
  pcToSpanIndex: number[];
  scopes: ScopeInfo[];
  locals: LocalInfo[];
  callSites: CallSiteInfo[];
  suspendSites: SuspendSiteInfo[];
}

/**
 * Emit bytecode for one function from its IR, resolving labels, host function
 * names, and call/suspend site metadata. Records source spans and PC mappings
 * for debug inspection.
 */
export function emitFunction(
  ir: readonly IrNode[],
  numParams: number,
  numLocals: number,
  name: string,
  pool: compiler.ConstantPool,
  functionTable: Map<string, number> | undefined,
  injectCtxTypeId: TypeId | undefined,
  scopeMetadata: readonly ScopeMetadata[] | undefined,
  localMetadata: readonly LocalMetadata[] | undefined,
  hostFunctions: IFunctionRegistry
): EmitResult {
  const emitter = new compiler.BytecodeEmitter();
  const diagnostics: CompileDiagnostic[] = [];
  const labelMap = new Map<number, number>();
  const fns = hostFunctions;

  const spans: DebugSpan[] = [];
  const pcToSpanIndex: number[] = [];
  const spanMap = new Map<string, number>();
  let currentSpanIndex = -1;
  let nextSpanId = 0;

  const callSites: CallSiteInfo[] = [];
  const suspendSites: SuspendSiteInfo[] = [];
  let nextCallSiteId = 0;
  const emittableIr = normalizeHostCallArgBuffers(ir);

  function getOrCreateSpanIndex(irSpan: IrSourceSpan, isStatementBoundary: boolean): number {
    const key = `${irSpan.startLine}:${irSpan.startColumn}:${irSpan.endLine}:${irSpan.endColumn}:${isStatementBoundary ? 1 : 0}`;
    let idx = spanMap.get(key);
    if (idx !== undefined) return idx;
    idx = spans.length;
    spans.push({
      spanId: nextSpanId++,
      startLine: irSpan.startLine,
      startColumn: irSpan.startColumn,
      endLine: irSpan.endLine,
      endColumn: irSpan.endColumn,
      isStatementBoundary,
    });
    spanMap.set(key, idx);
    return idx;
  }

  function getOrAllocLabel(irLabelId: number): number {
    let emitterLabelId = labelMap.get(irLabelId);
    if (emitterLabelId === undefined) {
      emitterLabelId = emitter.label();
      labelMap.set(irLabelId, emitterLabelId);
    }
    return emitterLabelId;
  }

  function emitNil(): void {
    const ref = pool.addValue(NIL_VALUE);
    if (ref.kind === "number") {
      emitter.pushConstNum(ref.idx);
    } else if (ref.kind === "string") {
      emitter.pushConstStr(ref.idx);
    } else {
      emitter.pushConst(ref.idx);
    }
  }

  const irIndexToPc: number[] = [];

  for (let emittableIdx = 0; emittableIdx < emittableIr.length; emittableIdx++) {
    const { node, originalIndex } = emittableIr[emittableIdx]!;
    if (node.span) {
      currentSpanIndex = getOrCreateSpanIndex(node.span, node.isStatementBoundary ?? false);
    }
    const pcBefore = emitter.pos();
    if (originalIndex !== undefined) {
      irIndexToPc[originalIndex] = pcBefore;
    }

    switch (node.kind) {
      case "PushConst": {
        const ref = pool.addValue(node.value);
        if (ref.kind === "number") {
          emitter.pushConstNum(ref.idx);
        } else if (ref.kind === "string") {
          emitter.pushConstStr(ref.idx);
        } else {
          emitter.pushConst(ref.idx);
        }
        break;
      }
      case "LoadLocal":
        emitter.loadLocal(node.index);
        break;
      case "StoreLocal":
        emitter.storeLocal(node.index);
        break;
      case "LoadCallsiteVar":
        emitter.loadCallsiteVar(node.index);
        break;
      case "StoreCallsiteVar":
        emitter.storeCallsiteVar(node.index);
        break;
      case "Return":
        emitter.ret();
        break;
      case "Pop":
        emitter.pop();
        break;
      case "Dup":
        emitter.dup();
        break;
      case "Swap":
        emitter.swap();
        break;
      case "Call":
        emitter.call(node.funcIndex, node.argc);
        break;
      case "HostCall": {
        const fnEntry = fns.get(node.fnName);
        if (fnEntry === undefined) {
          diagnostics.push({
            code: EmitDiagCode.CannotResolveHostFunction,
            message: `Cannot resolve host function: ${node.fnName}`,
            severity: "error",
          });
          return {
            bytecode: makeEmptyBytecode(numParams, numLocals, name),
            diagnostics,
            spans: [],
            pcToSpanIndex: [],
            scopes: [],
            locals: [],
            callSites: [],
            suspendSites: [],
          };
        }
        const csId = nextCallSiteId++;
        const callPc = emitter.pos();
        emitter.hostCall(fnEntry.id, node.argc, csId);
        callSites.push({ pc: callPc, callSiteId: csId, targetDebugFunctionId: null, isAsync: false });
        break;
      }
      case "HostCallAsync": {
        const fnEntry = fns.get(node.fnName);
        if (fnEntry === undefined) {
          diagnostics.push({
            code: EmitDiagCode.CannotResolveHostFunction,
            message: `Cannot resolve host function: ${node.fnName}`,
            severity: "error",
          });
          return {
            bytecode: makeEmptyBytecode(numParams, numLocals, name),
            diagnostics,
            spans: [],
            pcToSpanIndex: [],
            scopes: [],
            locals: [],
            callSites: [],
            suspendSites: [],
          };
        }
        const csId = nextCallSiteId++;
        const callPc = emitter.pos();
        emitter.hostCallAsync(fnEntry.id, node.argc, csId);
        callSites.push({ pc: callPc, callSiteId: csId, targetDebugFunctionId: null, isAsync: true });
        break;
      }
      case "StackSetRel":
        emitter.stackSetRel(node.d);
        break;
      case "Await": {
        emitter.await();
        if (node.span) {
          const spanIdx = getOrCreateSpanIndex(node.span, false);
          suspendSites.push({
            awaitPc: pcBefore,
            resumePc: pcBefore + 1,
            sourceSpan: spans[spanIdx],
          });
        }
        break;
      }
      case "MapGet":
        emitter.mapGet();
        break;
      case "MapNew": {
        const typeIdIdx = pool.addString(node.typeId);
        emitter.mapNew(typeIdIdx);
        break;
      }
      case "MapSet":
        emitter.mapSet();
        break;
      case "MapHas":
        emitter.mapHas();
        break;
      case "MapDelete":
        emitter.mapDelete();
        break;
      case "StructNew": {
        const typeIdIdx = pool.addString(node.typeId);
        emitter.structNew(typeIdIdx);
        break;
      }
      case "StructSet":
        emitter.structSet();
        break;
      case "StructCopyExcept": {
        const typeIdIdx = pool.addString(node.typeId);
        emitter.structCopyExcept(node.numExclude, typeIdIdx);
        break;
      }
      case "ListNew": {
        const typeIdIdx = pool.addString(node.typeId);
        emitter.listNew(typeIdIdx);
        break;
      }
      case "ListPush":
        emitter.listPush();
        break;
      case "ListGet":
        emitter.listGet();
        break;
      case "ListSet":
        emitter.listSet();
        break;
      case "ListLen":
        emitter.listLen();
        break;
      case "ListPop":
        emitter.listPop();
        break;
      case "ListShift":
        emitter.listShift();
        break;
      case "ListRemove":
        emitter.listRemove();
        break;
      case "ListInsert":
        emitter.listInsert();
        break;
      case "ListSwap":
        emitter.listSwap();
        break;
      case "GetField": {
        const fieldIdx = pool.addString(node.fieldName);
        emitter.pushConstStr(fieldIdx);
        emitter.getField();
        break;
      }
      case "GetFieldDynamic":
        emitter.getField();
        break;
      case "SetField":
        emitter.setField();
        break;
      case "TypeCheck":
        emitter.typeCheck(node.nativeType);
        break;
      case "InstanceOf": {
        const typeIdIdx = pool.addString(node.typeId);
        emitter.instanceOf(typeIdIdx);
        break;
      }
      case "CallIndirect":
        emitter.callIndirect(node.argc);
        break;
      case "CallIndirectArgs":
        emitter.callIndirectArgs(node.argc);
        break;
      case "PushFunctionRef": {
        const funcId = functionTable?.get(node.funcName);
        if (funcId === undefined) {
          diagnostics.push({
            code: EmitDiagCode.CannotResolveFunction,
            message: `Cannot resolve function: ${node.funcName}`,
            severity: "error",
          });
          return {
            bytecode: makeEmptyBytecode(numParams, numLocals, name),
            diagnostics,
            spans: [],
            pcToSpanIndex: [],
            scopes: [],
            locals: [],
            callSites: [],
            suspendSites: [],
          };
        }
        const idx = pool.addOther(mkFunctionValue(funcId));
        emitter.pushConst(idx);
        break;
      }
      case "MakeClosure": {
        const closureFuncId = functionTable?.get(node.funcName);
        if (closureFuncId === undefined) {
          diagnostics.push({
            code: EmitDiagCode.CannotResolveClosureFunction,
            message: `Cannot resolve closure function: ${node.funcName}`,
            severity: "error",
          });
          return {
            bytecode: makeEmptyBytecode(numParams, numLocals, name),
            diagnostics,
            spans: [],
            pcToSpanIndex: [],
            scopes: [],
            locals: [],
            callSites: [],
            suspendSites: [],
          };
        }
        emitter.makeClosure(closureFuncId, node.captureCount);
        break;
      }
      case "LoadCapture":
        emitter.loadCapture(node.index);
        break;
      case "Label":
        emitter.mark(getOrAllocLabel(node.labelId));
        break;
      case "Jump":
        emitter.jmp(getOrAllocLabel(node.labelId));
        break;
      case "JumpIfFalse":
        emitter.jmpIfFalse(getOrAllocLabel(node.labelId));
        break;
      case "JumpIfTrue":
        emitter.jmpIfTrue(getOrAllocLabel(node.labelId));
        break;
    }

    const pcAfter = emitter.pos();
    for (let pc = pcBefore; pc < pcAfter; pc++) {
      pcToSpanIndex[pc] = currentSpanIndex >= 0 ? currentSpanIndex : 0;
    }
  }

  const finalPc = emitter.pos();
  irIndexToPc[ir.length] = finalPc;

  if (spans.length === 0) {
    spans.push({
      spanId: 0,
      startLine: 0,
      startColumn: 0,
      endLine: 0,
      endColumn: 0,
      isStatementBoundary: false,
    });
  }

  const scopes = mapScopeMetadata(scopeMetadata, irIndexToPc, finalPc);
  const locals = mapLocalMetadata(localMetadata, scopeMetadata, irIndexToPc, finalPc);

  const code = emitter.finalize();
  return {
    bytecode: { code, numParams, numLocals, name, injectCtxTypeId },
    diagnostics,
    spans,
    pcToSpanIndex,
    scopes,
    locals,
    callSites,
    suspendSites,
  };
}

function mapScopeMetadata(
  scopeMetadata: readonly ScopeMetadata[] | undefined,
  irIndexToPc: number[],
  finalPc: number
): ScopeInfo[] {
  if (!scopeMetadata || scopeMetadata.length === 0) return [];
  return scopeMetadata.map((s) => ({
    scopeId: s.scopeId,
    kind: s.kind,
    parentScopeId: s.parentScopeId,
    startPc: irIndexToPc[s.irStartIndex] ?? 0,
    endPc: s.irEndIndex >= 0 ? (irIndexToPc[s.irEndIndex] ?? finalPc) : finalPc,
    name: s.name,
  }));
}

function mapLocalMetadata(
  localMetadata: readonly LocalMetadata[] | undefined,
  scopeMetadata: readonly ScopeMetadata[] | undefined,
  irIndexToPc: number[],
  finalPc: number
): LocalInfo[] {
  if (!localMetadata || localMetadata.length === 0) return [];

  const scopeEndMap = new Map<number, number>();
  if (scopeMetadata) {
    for (const s of scopeMetadata) {
      const endPc = s.irEndIndex >= 0 ? (irIndexToPc[s.irEndIndex] ?? finalPc) : finalPc;
      scopeEndMap.set(s.scopeId, endPc);
    }
  }

  return localMetadata.map((l) => ({
    name: l.name,
    slotIndex: l.slotIndex,
    storageKind: l.storageKind,
    scopeId: l.scopeId,
    lifetimeStartPc: l.irStartIndex >= 0 ? (irIndexToPc[l.irStartIndex] ?? 0) : 0,
    lifetimeEndPc: scopeEndMap.get(l.scopeId) ?? finalPc,
    typeHint: l.typeHint,
  }));
}

function normalizeHostCallArgBuffers(ir: readonly IrNode[]): EmittableIrNode[] {
  const output: EmittableIrNode[] = [];

  for (let i = 0; i < ir.length; i++) {
    const node = ir[i]!;
    if (node.kind !== "HostCall" && node.kind !== "HostCallAsync") {
      output.push({ node, originalIndex: i });
      continue;
    }

    if (!node.argSlotIds) {
      output.push({ node, originalIndex: i });
      continue;
    }

    const rawArgc = node.argSlotIds?.length ?? node.argc;
    const argSlices: EmittableIrNode[][] = [];
    for (let argIdx = rawArgc - 1; argIdx >= 0; argIdx--) {
      argSlices[argIdx] = takeLastValueProducingSlice(output, node.kind);
    }

    for (let slotIdx = 0; slotIdx < node.argc; slotIdx++) {
      output.push({ node: { kind: "PushConst", value: NIL_VALUE, span: node.span }, originalIndex: undefined });
    }

    for (let argIdx = 0; argIdx < rawArgc; argIdx++) {
      const slotId = node.argSlotIds ? node.argSlotIds[argIdx]! : argIdx;
      output.push(...argSlices[argIdx]!);
      output.push({
        node: { kind: "StackSetRel", d: node.argc - 1 - slotId, span: node.span },
        originalIndex: undefined,
      });
    }

    output.push({ node, originalIndex: i });
  }

  return output;
}

function takeLastValueProducingSlice(
  nodes: EmittableIrNode[],
  callKind: "HostCall" | "HostCallAsync"
): EmittableIrNode[] {
  let neededValues = 1;

  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!.node;
    if (isControlFlowBoundary(node)) {
      throw new Error(`${callKind}: unable to rewrite non-linear argument producer for stack-only arg-buffer emission`);
    }
    const effect = stackEffect(node);
    neededValues = Math.max(0, neededValues - effect.pushes) + effect.pops;
    if (neededValues === 0) {
      const slice = nodes.slice(i);
      if (netStackDelta(slice) !== 1) {
        throw new Error(
          `${callKind}: argument producer must leave exactly one value for stack-only arg-buffer emission`
        );
      }
      return nodes.splice(i);
    }
  }

  const tail = nodes
    .slice(-12)
    .map(({ node }) => node.kind)
    .join(", ");
  throw new Error(
    `${callKind}: unable to identify argument producer for stack-only arg-buffer emission after [${tail}]`
  );
}

function netStackDelta(nodes: readonly EmittableIrNode[]): number {
  let net = 0;
  for (const { node } of nodes) {
    const effect = stackEffect(node);
    net += effect.pushes - effect.pops;
  }
  return net;
}

function isControlFlowBoundary(node: IrNode): boolean {
  switch (node.kind) {
    case "Label":
    case "Jump":
    case "JumpIfFalse":
    case "JumpIfTrue":
    case "Return":
      return true;
    default:
      return false;
  }
}

function stackEffect(node: IrNode): { pops: number; pushes: number } {
  switch (node.kind) {
    case "PushConst":
    case "LoadLocal":
    case "LoadCallsiteVar":
    case "PushFunctionRef":
    case "LoadCapture":
    case "MapNew":
    case "StructNew":
    case "ListNew":
      return { pops: 0, pushes: 1 };

    case "StoreLocal":
    case "StoreCallsiteVar":
    case "Pop":
    case "JumpIfFalse":
    case "JumpIfTrue":
      return { pops: 1, pushes: 0 };

    case "Dup":
      return { pops: 1, pushes: 2 };

    case "Swap":
      return { pops: 2, pushes: 2 };

    case "Call":
    case "HostCall":
    case "HostCallAsync":
      return { pops: node.argc, pushes: 1 };

    case "CallIndirect":
    case "CallIndirectArgs":
      return { pops: node.argc + 1, pushes: 1 };

    case "MakeClosure":
      return { pops: node.captureCount, pushes: 1 };

    case "StackSetRel":
      return { pops: 1, pushes: 0 };

    case "Await":
    case "TypeCheck":
    case "InstanceOf":
    case "GetField":
    case "ListLen":
    case "ListPop":
    case "ListShift":
      return { pops: 1, pushes: 1 };

    case "GetFieldDynamic":
    case "MapGet":
    case "MapHas":
    case "MapDelete":
    case "ListPush":
    case "ListGet":
    case "ListRemove":
      return { pops: 2, pushes: 1 };

    case "SetField":
    case "MapSet":
    case "StructSet":
    case "ListSet":
      return { pops: 3, pushes: 1 };

    case "ListInsert":
    case "ListSwap":
      return { pops: 3, pushes: 0 };

    case "StructCopyExcept":
      return { pops: node.numExclude + 1, pushes: 1 };

    case "Return":
      return { pops: 1, pushes: 0 };

    case "Label":
    case "Jump":
      return { pops: 0, pushes: 0 };
  }
}

function makeEmptyBytecode(numParams: number, numLocals: number, name: string): FunctionBytecode {
  const emitter = new compiler.BytecodeEmitter();
  return { code: emitter.finalize(), numParams, numLocals, name };
}
