import { compiler, type FunctionBytecode } from "@mindcraft-lang/core/brain";
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
  resolveHostFn: (name: string) => number | undefined
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
      case "Return":
        emitter.ret();
        break;
      case "Pop":
        emitter.pop();
        break;
      case "Dup":
        emitter.dup();
        break;
      case "HostCallArgs": {
        const fnId = resolveHostFn(node.fnName);
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
