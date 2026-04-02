import {
  compiler,
  type FunctionBytecode,
  getBrainServices,
  mkFunctionValue,
  mkStringValue,
  type TypeId,
} from "@mindcraft-lang/core/brain";
import { EmitDiagCode } from "./diag-codes.js";
import type { IrNode, IrSourceSpan } from "./ir.js";
import type { CompileDiagnostic, DebugSpan } from "./types.js";

export interface EmitResult {
  bytecode: FunctionBytecode;
  diagnostics: CompileDiagnostic[];
  spans: DebugSpan[];
  pcToSpanIndex: number[];
}

export function emitFunction(
  ir: readonly IrNode[],
  numParams: number,
  numLocals: number,
  name: string,
  pool: compiler.ConstantPool,
  functionTable?: Map<string, number>,
  injectCtxTypeId?: TypeId
): EmitResult {
  const emitter = new compiler.BytecodeEmitter();
  const diagnostics: CompileDiagnostic[] = [];
  const labelMap = new Map<number, number>();

  const spans: DebugSpan[] = [];
  const pcToSpanIndex: number[] = [];
  const spanMap = new Map<string, number>();
  let currentSpanIndex = -1;
  let nextSpanId = 0;

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

  for (const node of ir) {
    if (node.span) {
      currentSpanIndex = getOrCreateSpanIndex(node.span, node.isStatementBoundary ?? false);
    }
    const pcBefore = emitter.pos();

    switch (node.kind) {
      case "PushConst": {
        const idx = pool.add(node.value);
        emitter.pushConst(idx);
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
      case "HostCallArgs": {
        const fnId = getBrainServices().functions.get(node.fnName)?.id;
        if (fnId === undefined) {
          diagnostics.push({
            code: EmitDiagCode.CannotResolveHostFunction,
            message: `Cannot resolve host function: ${node.fnName}`,
            severity: "error",
          });
          return { bytecode: makeEmptyBytecode(numParams, numLocals, name), diagnostics, spans: [], pcToSpanIndex: [] };
        }
        emitter.hostCallArgs(fnId, node.argc, 0);
        break;
      }
      case "HostCallArgsAsync": {
        const fnId = getBrainServices().functions.get(node.fnName)?.id;
        if (fnId === undefined) {
          diagnostics.push({
            code: EmitDiagCode.CannotResolveHostFunction,
            message: `Cannot resolve host function: ${node.fnName}`,
            severity: "error",
          });
          return { bytecode: makeEmptyBytecode(numParams, numLocals, name), diagnostics, spans: [], pcToSpanIndex: [] };
        }
        emitter.hostCallArgsAsync(fnId, node.argc, 0);
        break;
      }
      case "Await":
        emitter.await();
        break;
      case "MapGet":
        emitter.mapGet();
        break;
      case "MapNew": {
        const typeIdIdx = pool.add(mkStringValue(node.typeId));
        emitter.mapNew(typeIdIdx);
        break;
      }
      case "MapSet":
        emitter.mapSet();
        break;
      case "StructNew": {
        const typeIdIdx = pool.add(mkStringValue(node.typeId));
        emitter.structNew(typeIdIdx);
        break;
      }
      case "StructSet":
        emitter.structSet();
        break;
      case "StructCopyExcept": {
        const typeIdIdx = pool.add(mkStringValue(node.typeId));
        emitter.structCopyExcept(node.numExclude, typeIdIdx);
        break;
      }
      case "ListNew": {
        const typeIdIdx = pool.add(mkStringValue(node.typeId));
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
        const fieldIdx = pool.add(mkStringValue(node.fieldName));
        emitter.pushConst(fieldIdx);
        emitter.getField();
        break;
      }
      case "GetFieldDynamic":
        emitter.getField();
        break;
      case "TypeCheck":
        emitter.typeCheck(node.nativeType);
        break;
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
          return { bytecode: makeEmptyBytecode(numParams, numLocals, name), diagnostics, spans: [], pcToSpanIndex: [] };
        }
        const idx = pool.add(mkFunctionValue(funcId));
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
          return { bytecode: makeEmptyBytecode(numParams, numLocals, name), diagnostics, spans: [], pcToSpanIndex: [] };
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

  const code = emitter.finalize();
  return {
    bytecode: { code, numParams, numLocals, name, injectCtxTypeId },
    diagnostics,
    spans,
    pcToSpanIndex,
  };
}

function makeEmptyBytecode(numParams: number, numLocals: number, name: string): FunctionBytecode {
  const emitter = new compiler.BytecodeEmitter();
  return { code: emitter.finalize(), numParams, numLocals, name };
}
