import { List } from "@mindcraft-lang/core";
import type { BrainProgram, FunctionBytecode, Instr, Value } from "@mindcraft-lang/core/brain";
import { isFunctionValue, NativeType, Op } from "@mindcraft-lang/core/brain";
import type { DebugMetadata, LinkedUserProgram, UserAuthoredProgram } from "../compiler/types.js";

export interface LinkResult {
  linkedProgram: BrainProgram;
  linkedArtifacts: LinkedUserProgram[];
}

export function linkUserPrograms(brainProgram: BrainProgram, userPrograms: UserAuthoredProgram[]): LinkResult {
  const linkedFunctions: FunctionBytecode[] = brainProgram.functions.toArray();
  const linkedConstants: Value[] = brainProgram.constants.toArray();
  const linkedVariableNames = brainProgram.variableNames.toArray();
  const linkedArtifacts: LinkedUserProgram[] = [];

  for (const userProg of userPrograms) {
    const funcOffset = linkedFunctions.length;
    const constOffset = linkedConstants.length;
    const variableOffset = linkedVariableNames.length;

    for (let i = 0; i < userProg.constants.size(); i++) {
      const c = userProg.constants.get(i);
      // FunctionValue constants embed a funcId that also needs offsetting
      if (isFunctionValue(c)) {
        linkedConstants.push({ t: NativeType.Function, funcId: c.funcId + funcOffset });
      } else {
        linkedConstants.push(c);
      }
    }

    for (let i = 0; i < userProg.variableNames.size(); i++) {
      linkedVariableNames.push(userProg.variableNames.get(i)!);
    }

    for (let i = 0; i < userProg.functions.size(); i++) {
      const fn = userProg.functions.get(i);
      const remappedCode = remapInstructions(fn.code, funcOffset, constOffset, variableOffset);
      linkedFunctions.push({
        code: remappedCode,
        numParams: fn.numParams,
        numLocals: fn.numLocals,
        name: fn.name,
        maxStackDepth: fn.maxStackDepth,
        injectCtxTypeId: fn.injectCtxTypeId,
      });
    }

    linkedArtifacts.push({
      program: userProg,
      functionOffset: funcOffset,
      constantOffset: constOffset,
      variableOffset,
      linkedDebugMetadata: remapDebugMetadata(userProg.debugMetadata, funcOffset),
    });
  }

  const linkedProgram: BrainProgram = {
    version: brainProgram.version,
    functions: List.from(linkedFunctions),
    constants: List.from(linkedConstants),
    variableNames: List.from(linkedVariableNames),
    entryPoint: brainProgram.entryPoint,
    ruleIndex: brainProgram.ruleIndex,
    actionRefs: brainProgram.actionRefs,
    pages: brainProgram.pages,
  };

  return { linkedProgram, linkedArtifacts };
}

// Post-link instruction remapping: after merging a user program's functions and
// constants into the brain program's tables, all references to function IDs and
// constant indices must be offset by the merge point.
function remapInstructions(
  code: List<Instr>,
  funcOffset: number,
  constOffset: number,
  variableOffset: number
): List<Instr> {
  const remapped: Instr[] = [];
  for (let i = 0; i < code.size(); i++) {
    const instr = code.get(i);
    if (instr.op === Op.CALL && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + funcOffset });
    } else if (instr.op === Op.MAKE_CLOSURE && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + funcOffset });
    } else if (instr.op === Op.PUSH_CONST && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + constOffset });
    } else if ((instr.op === Op.LOAD_VAR || instr.op === Op.STORE_VAR) && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + variableOffset });
    } else if (
      (instr.op === Op.LIST_NEW ||
        instr.op === Op.MAP_NEW ||
        instr.op === Op.STRUCT_NEW ||
        instr.op === Op.STRUCT_COPY_EXCEPT) &&
      instr.b !== undefined
    ) {
      remapped.push({ ...instr, b: instr.b + constOffset });
    } else {
      remapped.push(instr);
    }
  }
  return List.from(remapped);
}

function remapDebugMetadata(metadata: DebugMetadata | undefined, funcOffset: number): DebugMetadata | undefined {
  if (!metadata) return undefined;
  return {
    files: metadata.files,
    functions: metadata.functions.map((fn) => ({
      ...fn,
      compiledFuncId: fn.compiledFuncId + funcOffset,
    })),
  };
}
