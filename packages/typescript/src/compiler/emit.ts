import {
  compiler,
  type FunctionBytecode,
  getBrainServices,
  mkFunctionValue,
  mkStringValue,
} from "@mindcraft-lang/core/brain";
import type { IrNode } from "./ir.js";
import type { CompileDiagnostic } from "./types.js";

export interface EmitResult {
  bytecode: FunctionBytecode;
  diagnostics: CompileDiagnostic[];
}

export function emitFunction(
  ir: readonly IrNode[],
  numParams: number,
  numLocals: number,
  name: string,
  pool: compiler.ConstantPool,
  functionTable?: Map<string, number>
): EmitResult {
  const emitter = new compiler.BytecodeEmitter();
  const diagnostics: CompileDiagnostic[] = [];
  const labelMap = new Map<number, number>();

  function getOrAllocLabel(irLabelId: number): number {
    let emitterLabelId = labelMap.get(irLabelId);
    if (emitterLabelId === undefined) {
      emitterLabelId = emitter.label();
      labelMap.set(irLabelId, emitterLabelId);
    }
    return emitterLabelId;
  }

  for (const node of ir) {
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
          diagnostics.push({ message: `Cannot resolve host function: ${node.fnName}` });
          return { bytecode: makeEmptyBytecode(numParams, numLocals, name), diagnostics };
        }
        emitter.hostCallArgs(fnId, node.argc, 0);
        break;
      }
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
      case "TypeCheck":
        emitter.typeCheck(node.nativeType);
        break;
      case "CallIndirect":
        emitter.callIndirect(node.argc);
        break;
      case "PushFunctionRef": {
        const funcId = functionTable?.get(node.funcName);
        if (funcId === undefined) {
          diagnostics.push({ message: `Cannot resolve function: ${node.funcName}` });
          return { bytecode: makeEmptyBytecode(numParams, numLocals, name), diagnostics };
        }
        const idx = pool.add(mkFunctionValue(funcId));
        emitter.pushConst(idx);
        break;
      }
      case "MakeClosure": {
        const closureFuncId = functionTable?.get(node.funcName);
        if (closureFuncId === undefined) {
          diagnostics.push({ message: `Cannot resolve closure function: ${node.funcName}` });
          return { bytecode: makeEmptyBytecode(numParams, numLocals, name), diagnostics };
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
  }

  const code = emitter.finalize();
  return {
    bytecode: { code, numParams, numLocals, name },
    diagnostics,
  };
}

function makeEmptyBytecode(numParams: number, numLocals: number, name: string): FunctionBytecode {
  const emitter = new compiler.BytecodeEmitter();
  return { code: emitter.finalize(), numParams, numLocals, name };
}
