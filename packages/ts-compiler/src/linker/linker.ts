import { List } from "@mindcraft-lang/core";
import type { BrainProgram, ConstantOffsets, FunctionBytecode, Instr, Value } from "@mindcraft-lang/core/brain";
import { isFunctionValue, NativeType, Op } from "@mindcraft-lang/core/brain";
import type { DebugMetadata, LinkedUserProgram, UserAuthoredProgram } from "../compiler/types.js";

/** Output of {@link linkUserPrograms}: the merged brain program and per-program offset metadata. */
export interface LinkResult {
  linkedProgram: BrainProgram;
  linkedArtifacts: LinkedUserProgram[];
}

/** Append each user program's bytecode, constants, and variable names to a base brain program, fixing up cross-table indices. */
export function linkUserPrograms(brainProgram: BrainProgram, userPrograms: UserAuthoredProgram[]): LinkResult {
  const linkedFunctions: FunctionBytecode[] = brainProgram.functions.toArray();
  const linkedValues: Value[] = brainProgram.constantPools.values.toArray();
  const linkedNumbers: number[] = brainProgram.constantPools.numbers.toArray();
  const linkedStrings: string[] = brainProgram.constantPools.strings.toArray();
  const linkedVariableNames = brainProgram.variableNames.toArray();
  const linkedArtifacts: LinkedUserProgram[] = [];

  for (const userProg of userPrograms) {
    const funcOffset = linkedFunctions.length;
    const constantOffsets: ConstantOffsets = {
      numbers: linkedNumbers.length,
      strings: linkedStrings.length,
      values: linkedValues.length,
    };
    const variableOffset = linkedVariableNames.length;

    for (let i = 0; i < userProg.constantPools.values.size(); i++) {
      const c = userProg.constantPools.values.get(i);
      if (isFunctionValue(c)) {
        linkedValues.push({ t: NativeType.Function, funcId: c.funcId + funcOffset });
      } else {
        linkedValues.push(c);
      }
    }

    for (let i = 0; i < userProg.constantPools.numbers.size(); i++) {
      linkedNumbers.push(userProg.constantPools.numbers.get(i)!);
    }

    for (let i = 0; i < userProg.constantPools.strings.size(); i++) {
      linkedStrings.push(userProg.constantPools.strings.get(i)!);
    }

    for (let i = 0; i < userProg.variableNames.size(); i++) {
      linkedVariableNames.push(userProg.variableNames.get(i)!);
    }

    for (let i = 0; i < userProg.functions.size(); i++) {
      const fn = userProg.functions.get(i);
      const remappedCode = remapInstructions(fn.code, funcOffset, constantOffsets, variableOffset);
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
      constantOffsets,
      variableOffset,
      linkedDebugMetadata: remapDebugMetadata(userProg.debugMetadata, funcOffset),
    });
  }

  const linkedProgram: BrainProgram = {
    version: brainProgram.version,
    functions: List.from(linkedFunctions),
    constantPools: {
      numbers: List.from(linkedNumbers),
      strings: List.from(linkedStrings),
      values: List.from(linkedValues),
    },
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
  constOffsets: ConstantOffsets,
  variableOffset: number
): List<Instr> {
  const remapped: Instr[] = [];
  for (let i = 0; i < code.size(); i++) {
    const instr = code.get(i);
    if (instr.op === Op.CALL && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + funcOffset });
    } else if (instr.op === Op.MAKE_CLOSURE && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + funcOffset });
    } else if (instr.op === Op.PUSH_CONST_VAL && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + constOffsets.values });
    } else if (instr.op === Op.PUSH_CONST_NUM && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + constOffsets.numbers });
    } else if (instr.op === Op.PUSH_CONST_STR && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + constOffsets.strings });
    } else if (instr.op === Op.INSTANCE_OF && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + constOffsets.strings });
    } else if ((instr.op === Op.LOAD_VAR_SLOT || instr.op === Op.STORE_VAR_SLOT) && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + variableOffset });
    } else if (
      (instr.op === Op.LIST_NEW ||
        instr.op === Op.MAP_NEW ||
        instr.op === Op.STRUCT_NEW ||
        instr.op === Op.STRUCT_COPY_EXCEPT) &&
      instr.b !== undefined
    ) {
      remapped.push({ ...instr, b: instr.b + constOffsets.strings });
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
