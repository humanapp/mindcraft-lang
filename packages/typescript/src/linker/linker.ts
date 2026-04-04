import { List } from "@mindcraft-lang/core";
import type { BrainProgram, FunctionBytecode, Instr, Value } from "@mindcraft-lang/core/brain";
import { isFunctionValue, NativeType, Op } from "@mindcraft-lang/core/brain";
import type { DebugMetadata, UserAuthoredProgram, UserTileLinkInfo } from "../compiler/types.js";

export interface LinkResult {
  linkedProgram: BrainProgram;
  userLinks: UserTileLinkInfo[];
}

export function linkUserPrograms(brainProgram: BrainProgram, userPrograms: UserAuthoredProgram[]): LinkResult {
  const linkedFunctions: FunctionBytecode[] = brainProgram.functions.toArray();
  const linkedConstants: Value[] = brainProgram.constants.toArray();
  const userLinks: UserTileLinkInfo[] = [];

  for (const userProg of userPrograms) {
    const funcOffset = linkedFunctions.length;
    const constOffset = linkedConstants.length;

    for (let i = 0; i < userProg.constants.size(); i++) {
      const c = userProg.constants.get(i);
      // FunctionValue constants embed a funcId that also needs offsetting
      if (isFunctionValue(c)) {
        linkedConstants.push({ t: NativeType.Function, funcId: c.funcId + funcOffset });
      } else {
        linkedConstants.push(c);
      }
    }

    for (let i = 0; i < userProg.functions.size(); i++) {
      const fn = userProg.functions.get(i);
      const remappedCode = remapInstructions(fn.code, funcOffset, constOffset);
      linkedFunctions.push({
        code: remappedCode,
        numParams: fn.numParams,
        numLocals: fn.numLocals,
        name: fn.name,
        maxStackDepth: fn.maxStackDepth,
        injectCtxTypeId: fn.injectCtxTypeId,
      });
    }

    const linkedEntryFuncId = userProg.entryFuncId + funcOffset;
    const linkedInitFuncId = userProg.initFuncId !== undefined ? userProg.initFuncId + funcOffset : undefined;
    const linkedOnPageEntered =
      userProg.lifecycleFuncIds.onPageEntered !== undefined
        ? userProg.lifecycleFuncIds.onPageEntered + funcOffset
        : undefined;

    userLinks.push({
      program: userProg,
      linkedEntryFuncId,
      linkedInitFuncId,
      linkedOnPageEnteredFuncId: linkedOnPageEntered,
      linkedDebugMetadata: remapDebugMetadata(userProg.debugMetadata, funcOffset),
    });
  }

  const linkedProgram: BrainProgram = {
    version: brainProgram.version,
    functions: List.from(linkedFunctions),
    constants: List.from(linkedConstants),
    variableNames: brainProgram.variableNames,
    entryPoint: brainProgram.entryPoint,
    ruleIndex: brainProgram.ruleIndex,
    actionRefs: brainProgram.actionRefs,
    pages: brainProgram.pages,
  };

  return { linkedProgram, userLinks };
}

// Post-link instruction remapping: after merging a user program's functions and
// constants into the brain program's tables, all references to function IDs and
// constant indices must be offset by the merge point.
function remapInstructions(code: List<Instr>, funcOffset: number, constOffset: number): List<Instr> {
  const remapped: Instr[] = [];
  for (let i = 0; i < code.size(); i++) {
    const instr = code.get(i);
    if (instr.op === Op.CALL && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + funcOffset });
    } else if (instr.op === Op.MAKE_CLOSURE && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + funcOffset });
    } else if (instr.op === Op.PUSH_CONST && instr.a !== undefined) {
      remapped.push({ ...instr, a: instr.a + constOffset });
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
