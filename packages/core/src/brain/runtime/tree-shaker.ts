import { Dict } from "../../platform/dict";
import { List } from "../../platform/list";
import { logger } from "../../platform/logger";
import { UniqueSet } from "../../platform/uniqueset";
import type {
  BytecodeExecutableAction,
  ExecutableAction,
  ExecutableBrainProgram,
  FunctionBytecode,
  Instr,
  PageMetadata,
  Value,
} from "../interfaces";
import { isFunctionValue, NativeType, Op } from "../interfaces";

function markReachableFunctions(program: ExecutableBrainProgram): UniqueSet<number> {
  const reachable = new UniqueSet<number>();
  const worklist = List.empty<number>();

  function enqueue(funcId: number): void {
    if (funcId >= 0 && funcId < program.functions.size() && !reachable.has(funcId)) {
      reachable.add(funcId);
      worklist.push(funcId);
    }
  }

  if (program.entryPoint !== undefined) {
    enqueue(program.entryPoint);
  }

  for (let p = 0; p < program.pages.size(); p++) {
    const page = program.pages.get(p);
    for (let r = 0; r < page.rootRuleFuncIds.size(); r++) {
      enqueue(page.rootRuleFuncIds.get(r));
    }
  }

  for (let a = 0; a < program.actions.size(); a++) {
    const action = program.actions.get(a);
    if (action.binding === "bytecode") {
      enqueue(action.entryFuncId);
      if (action.activationFuncId !== undefined) {
        enqueue(action.activationFuncId);
      }
    }
  }

  function markFuncIdsInValue(v: Value): void {
    if (!isFunctionValue(v)) return;
    enqueue(v.funcId);
    if (v.captures) {
      for (let i = 0; i < v.captures.size(); i++) {
        markFuncIdsInValue(v.captures.get(i));
      }
    }
  }

  while (worklist.size() > 0) {
    const funcId = worklist.pop()!;
    const fn = program.functions.get(funcId);
    const code = fn.code;

    for (let i = 0; i < code.size(); i++) {
      const ins = code.get(i);
      if (ins.op === Op.CALL || ins.op === Op.MAKE_CLOSURE) {
        if (ins.a !== undefined) {
          enqueue(ins.a);
        }
      }
      if (ins.op === Op.PUSH_CONST && ins.a !== undefined) {
        const constVal = program.constants.get(ins.a);
        markFuncIdsInValue(constVal);
      }
    }
  }

  return reachable;
}

function markReachableConstants(program: ExecutableBrainProgram, reachableFuncs: UniqueSet<number>): UniqueSet<number> {
  const reachable = new UniqueSet<number>();

  for (let i = 0; i < program.functions.size(); i++) {
    if (!reachableFuncs.has(i)) continue;
    const fn = program.functions.get(i);
    for (let j = 0; j < fn.code.size(); j++) {
      const ins = fn.code.get(j);
      if ((ins.op === Op.PUSH_CONST || ins.op === Op.INSTANCE_OF) && ins.a !== undefined) {
        reachable.add(ins.a);
      }
      if (
        (ins.op === Op.LIST_NEW ||
          ins.op === Op.MAP_NEW ||
          ins.op === Op.STRUCT_NEW ||
          ins.op === Op.STRUCT_COPY_EXCEPT) &&
        ins.b !== undefined
      ) {
        reachable.add(ins.b);
      }
    }
  }

  return reachable;
}

function markReachableVariableNames(
  program: ExecutableBrainProgram,
  reachableFuncs: UniqueSet<number>
): UniqueSet<number> {
  const reachable = new UniqueSet<number>();

  for (let i = 0; i < program.functions.size(); i++) {
    if (!reachableFuncs.has(i)) continue;
    const fn = program.functions.get(i);
    for (let j = 0; j < fn.code.size(); j++) {
      const ins = fn.code.get(j);
      if ((ins.op === Op.LOAD_VAR || ins.op === Op.STORE_VAR) && ins.a !== undefined) {
        reachable.add(ins.a);
      }
    }
  }

  return reachable;
}

function buildRemapTable(totalItems: number, reachable: UniqueSet<number>): Dict<number, number> {
  const remap = Dict.empty<number, number>();
  let nextId = 0;
  for (let i = 0; i < totalItems; i++) {
    if (reachable.has(i)) {
      remap.set(i, nextId++);
    }
  }
  return remap;
}

function remapFuncIdInValue(v: Value, remap: Dict<number, number>): Value {
  if (!isFunctionValue(v)) return v;
  const newFuncId = remap.get(v.funcId);
  if (newFuncId === undefined) return v;
  if (!v.captures) {
    return { ...v, funcId: newFuncId };
  }
  const captures = List.empty<Value>();
  for (let i = 0; i < v.captures.size(); i++) {
    captures.push(remapFuncIdInValue(v.captures.get(i), remap));
  }
  return { ...v, funcId: newFuncId, captures };
}

function remapInstruction(
  ins: Instr,
  funcRemap: Dict<number, number>,
  constRemap: Dict<number, number>,
  varRemap: Dict<number, number>
): Instr {
  const op = ins.op;

  if (op === Op.CALL || op === Op.MAKE_CLOSURE) {
    if (ins.a !== undefined) {
      const newA = funcRemap.get(ins.a) ?? ins.a;
      if (newA !== ins.a) return { ...ins, a: newA };
    }
    return ins;
  }

  if (op === Op.PUSH_CONST || op === Op.INSTANCE_OF) {
    if (ins.a !== undefined) {
      const newA = constRemap.get(ins.a) ?? ins.a;
      if (newA !== ins.a) return { ...ins, a: newA };
    }
    return ins;
  }

  if (op === Op.LIST_NEW || op === Op.MAP_NEW || op === Op.STRUCT_NEW || op === Op.STRUCT_COPY_EXCEPT) {
    if (ins.b !== undefined) {
      const newB = constRemap.get(ins.b) ?? ins.b;
      if (newB !== ins.b) return { ...ins, b: newB };
    }
    return ins;
  }

  if (op === Op.LOAD_VAR || op === Op.STORE_VAR) {
    if (ins.a !== undefined) {
      const newA = varRemap.get(ins.a) ?? ins.a;
      if (newA !== ins.a) return { ...ins, a: newA };
    }
    return ins;
  }

  return ins;
}

function constantKey(v: Value): string | undefined {
  switch (v.t) {
    case NativeType.Unknown:
      return "U";
    case NativeType.Void:
      return "V";
    case NativeType.Nil:
      return "N";
    case NativeType.Boolean:
      return `B:${v.v}`;
    case NativeType.Number:
      return `D:${v.v}`;
    case NativeType.String:
      return `S:${v.v}`;
    case NativeType.Enum:
      return `E:${v.typeId}:${v.v}`;
    case NativeType.Function: {
      let key = `F:${v.funcId}`;
      if (v.captures) {
        key += "[";
        for (let i = 0; i < v.captures.size(); i++) {
          const capKey = constantKey(v.captures.get(i));
          if (capKey === undefined) return undefined;
          if (i > 0) key += ",";
          key += capKey;
        }
        key += "]";
      }
      return key;
    }
    default:
      return undefined;
  }
}

function deduplicateConstants(
  functions: List<FunctionBytecode>,
  constants: List<Value>
): { functions: List<FunctionBytecode>; constants: List<Value> } | undefined {
  const seen = Dict.empty<string, number>();
  const dedupRemap = Dict.empty<number, number>();
  const newConstants = List.empty<Value>();
  let hasDuplicates = false;

  for (let i = 0; i < constants.size(); i++) {
    const key = constantKey(constants.get(i));
    if (key !== undefined) {
      const existing = seen.get(key);
      if (existing !== undefined) {
        dedupRemap.set(i, existing);
        hasDuplicates = true;
        continue;
      }
      seen.set(key, newConstants.size());
    }
    dedupRemap.set(i, newConstants.size());
    newConstants.push(constants.get(i));
  }

  if (!hasDuplicates) return undefined;

  const removed = constants.size() - newConstants.size();
  logger.debug(`[tree-shaker] deduplicated ${removed}/${constants.size()} constants`);

  const newFunctions = List.empty<FunctionBytecode>();
  for (let i = 0; i < functions.size(); i++) {
    const fn = functions.get(i);
    const newCode = List.empty<Instr>();
    let changed = false;
    for (let j = 0; j < fn.code.size(); j++) {
      const ins = fn.code.get(j);
      const remapped = remapInstructionConsts(ins, dedupRemap);
      if (remapped !== ins) changed = true;
      newCode.push(remapped);
    }
    newFunctions.push(changed ? { ...fn, code: newCode } : fn);
  }

  return { functions: newFunctions, constants: newConstants };
}

function remapInstructionConsts(ins: Instr, constRemap: Dict<number, number>): Instr {
  const op = ins.op;

  if (op === Op.PUSH_CONST || op === Op.INSTANCE_OF) {
    if (ins.a !== undefined) {
      const newA = constRemap.get(ins.a) ?? ins.a;
      if (newA !== ins.a) return { ...ins, a: newA };
    }
    return ins;
  }

  if (op === Op.LIST_NEW || op === Op.MAP_NEW || op === Op.STRUCT_NEW || op === Op.STRUCT_COPY_EXCEPT) {
    if (ins.b !== undefined) {
      const newB = constRemap.get(ins.b) ?? ins.b;
      if (newB !== ins.b) return { ...ins, b: newB };
    }
    return ins;
  }

  return ins;
}

export function treeshakeProgram(program: ExecutableBrainProgram): ExecutableBrainProgram {
  const reachableFuncs = markReachableFunctions(program);
  const reachableConsts = markReachableConstants(program, reachableFuncs);
  const reachableVars = markReachableVariableNames(program, reachableFuncs);

  const funcsDead = reachableFuncs.size() < program.functions.size();
  const constsDead = reachableConsts.size() < program.constants.size();
  const varsDead = reachableVars.size() < program.variableNames.size();

  if (!funcsDead && !constsDead && !varsDead) {
    const dedup = deduplicateConstants(program.functions, program.constants);
    if (dedup) {
      return { ...program, functions: dedup.functions, constants: dedup.constants };
    }
    return program;
  }

  if (funcsDead) {
    const shakenNames: string[] = [];
    for (let i = 0; i < program.functions.size(); i++) {
      if (!reachableFuncs.has(i)) {
        const fn = program.functions.get(i);
        shakenNames.push(fn.name ?? `<func#${i}>`);
      }
    }
    const removed = program.functions.size() - reachableFuncs.size();
    logger.debug(`[tree-shaker] removed ${removed}/${program.functions.size()} functions: ${shakenNames.join(", ")}`);
  }

  if (constsDead) {
    const removed = program.constants.size() - reachableConsts.size();
    logger.debug(`[tree-shaker] removed ${removed}/${program.constants.size()} constants`);
  }

  if (varsDead) {
    const shakenVarNames: string[] = [];
    for (let i = 0; i < program.variableNames.size(); i++) {
      if (!reachableVars.has(i)) {
        shakenVarNames.push(program.variableNames.get(i));
      }
    }
    const removed = program.variableNames.size() - reachableVars.size();
    logger.debug(
      `[tree-shaker] removed ${removed}/${program.variableNames.size()} variable names: ${shakenVarNames.join(", ")}`
    );
  }

  const funcRemap = buildRemapTable(program.functions.size(), reachableFuncs);
  const constRemap = buildRemapTable(program.constants.size(), reachableConsts);
  const varRemap = buildRemapTable(program.variableNames.size(), reachableVars);

  const newFunctions = List.empty<FunctionBytecode>();
  for (let i = 0; i < program.functions.size(); i++) {
    if (!reachableFuncs.has(i)) continue;
    const fn = program.functions.get(i);
    const newCode = List.empty<Instr>();
    for (let j = 0; j < fn.code.size(); j++) {
      newCode.push(remapInstruction(fn.code.get(j), funcRemap, constRemap, varRemap));
    }
    newFunctions.push({ ...fn, code: newCode });
  }

  const newConstants = List.empty<Value>();
  for (let i = 0; i < program.constants.size(); i++) {
    if (!reachableConsts.has(i)) continue;
    newConstants.push(remapFuncIdInValue(program.constants.get(i), funcRemap));
  }

  const newVariableNames = List.empty<string>();
  for (let i = 0; i < program.variableNames.size(); i++) {
    if (!reachableVars.has(i)) continue;
    newVariableNames.push(program.variableNames.get(i));
  }

  const newEntryPoint = program.entryPoint !== undefined ? funcRemap.get(program.entryPoint) : undefined;

  const newRuleIndex = Dict.empty<string, number>();
  program.ruleIndex.forEach((funcId, key) => {
    const newId = funcRemap.get(funcId);
    if (newId !== undefined) {
      newRuleIndex.set(key, newId);
    }
  });

  const newPages = List.empty<PageMetadata>();
  for (let p = 0; p < program.pages.size(); p++) {
    const page = program.pages.get(p);
    const newRootRuleFuncIds = List.empty<number>();
    for (let r = 0; r < page.rootRuleFuncIds.size(); r++) {
      const newId = funcRemap.get(page.rootRuleFuncIds.get(r));
      if (newId !== undefined) {
        newRootRuleFuncIds.push(newId);
      }
    }
    newPages.push({ ...page, rootRuleFuncIds: newRootRuleFuncIds });
  }

  const newActions = List.empty<ExecutableAction>();
  for (let a = 0; a < program.actions.size(); a++) {
    const action = program.actions.get(a);
    if (action.binding !== "bytecode") {
      newActions.push(action);
      continue;
    }
    const newEntry = funcRemap.get(action.entryFuncId);
    const newActivation = action.activationFuncId !== undefined ? funcRemap.get(action.activationFuncId) : undefined;
    const remapped: BytecodeExecutableAction = {
      ...action,
      entryFuncId: newEntry ?? action.entryFuncId,
    };
    if (newActivation !== undefined) {
      remapped.activationFuncId = newActivation;
    }
    newActions.push(remapped);
  }

  let resultFunctions = newFunctions;
  let resultConstants = newConstants;

  const dedup = deduplicateConstants(newFunctions, newConstants);
  if (dedup) {
    resultFunctions = dedup.functions;
    resultConstants = dedup.constants;
  }

  return {
    version: program.version,
    functions: resultFunctions,
    constants: resultConstants,
    variableNames: newVariableNames,
    entryPoint: newEntryPoint,
    ruleIndex: newRuleIndex,
    pages: newPages,
    actions: newActions,
  };
}
