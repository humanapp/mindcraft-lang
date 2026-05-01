import { Dict } from "../../platform/dict";
import { List } from "../../platform/list";
import { logger } from "../../platform/logger";
import { UniqueSet } from "../../platform/uniqueset";
import type {
  BytecodeExecutableAction,
  ConstantPools,
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
      if (ins.op === Op.PUSH_CONST_VAL && ins.a !== undefined) {
        const constVal = program.constantPools.values.get(ins.a);
        markFuncIdsInValue(constVal);
      }
    }
  }

  return reachable;
}

interface ReachableConstSets {
  values: UniqueSet<number>;
  numbers: UniqueSet<number>;
  strings: UniqueSet<number>;
}

function markReachableConstants(
  program: ExecutableBrainProgram,
  reachableFuncs: UniqueSet<number>
): ReachableConstSets {
  const values = new UniqueSet<number>();
  const numbers = new UniqueSet<number>();
  const strings = new UniqueSet<number>();

  for (let i = 0; i < program.functions.size(); i++) {
    if (!reachableFuncs.has(i)) continue;
    const fn = program.functions.get(i);
    for (let j = 0; j < fn.code.size(); j++) {
      const ins = fn.code.get(j);
      if (ins.op === Op.PUSH_CONST_VAL && ins.a !== undefined) {
        values.add(ins.a);
      }
      if (ins.op === Op.PUSH_CONST_NUM && ins.a !== undefined) {
        numbers.add(ins.a);
      }
      if (ins.op === Op.PUSH_CONST_STR && ins.a !== undefined) {
        strings.add(ins.a);
      }
      if (ins.op === Op.INSTANCE_OF && ins.a !== undefined) {
        strings.add(ins.a);
      }
      if (
        (ins.op === Op.LIST_NEW ||
          ins.op === Op.MAP_NEW ||
          ins.op === Op.STRUCT_NEW ||
          ins.op === Op.STRUCT_COPY_EXCEPT) &&
        ins.b !== undefined
      ) {
        strings.add(ins.b);
      }
    }
  }

  return { values, numbers, strings };
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
      if ((ins.op === Op.LOAD_VAR_SLOT || ins.op === Op.STORE_VAR_SLOT) && ins.a !== undefined) {
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

interface ConstRemaps {
  values: Dict<number, number>;
  numbers: Dict<number, number>;
  strings: Dict<number, number>;
}

function remapInstruction(
  ins: Instr,
  funcRemap: Dict<number, number>,
  consts: ConstRemaps,
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

  if (op === Op.PUSH_CONST_VAL) {
    if (ins.a !== undefined) {
      const newA = consts.values.get(ins.a) ?? ins.a;
      if (newA !== ins.a) return { ...ins, a: newA };
    }
    return ins;
  }

  if (op === Op.PUSH_CONST_NUM) {
    if (ins.a !== undefined) {
      const newA = consts.numbers.get(ins.a) ?? ins.a;
      if (newA !== ins.a) return { ...ins, a: newA };
    }
    return ins;
  }

  if (op === Op.PUSH_CONST_STR || op === Op.INSTANCE_OF) {
    if (ins.a !== undefined) {
      const newA = consts.strings.get(ins.a) ?? ins.a;
      if (newA !== ins.a) return { ...ins, a: newA };
    }
    return ins;
  }

  if (op === Op.LIST_NEW || op === Op.MAP_NEW || op === Op.STRUCT_NEW || op === Op.STRUCT_COPY_EXCEPT) {
    if (ins.b !== undefined) {
      const newB = consts.strings.get(ins.b) ?? ins.b;
      if (newB !== ins.b) return { ...ins, b: newB };
    }
    return ins;
  }

  if (op === Op.LOAD_VAR_SLOT || op === Op.STORE_VAR_SLOT) {
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

interface DedupResult {
  functions: List<FunctionBytecode>;
  constantPools: ConstantPools;
}

function dedupValues(constants: List<Value>): {
  newConstants: List<Value>;
  remap: Dict<number, number>;
  changed: boolean;
} {
  const seen = Dict.empty<string, number>();
  const remap = Dict.empty<number, number>();
  const newConstants = List.empty<Value>();
  let changed = false;
  for (let i = 0; i < constants.size(); i++) {
    const v = constants.get(i);
    const key = constantKey(v);
    if (key !== undefined) {
      const existing = seen.get(key);
      if (existing !== undefined) {
        remap.set(i, existing);
        changed = true;
        continue;
      }
      seen.set(key, newConstants.size());
    }
    remap.set(i, newConstants.size());
    newConstants.push(v);
  }
  return { newConstants, remap, changed };
}

function dedupNumbers(constants: List<number>): {
  newConstants: List<number>;
  remap: Dict<number, number>;
  changed: boolean;
} {
  const seen = Dict.empty<number, number>();
  const remap = Dict.empty<number, number>();
  const newConstants = List.empty<number>();
  let changed = false;
  for (let i = 0; i < constants.size(); i++) {
    const v = constants.get(i)!;
    const existing = seen.get(v);
    if (existing !== undefined) {
      remap.set(i, existing);
      changed = true;
      continue;
    }
    seen.set(v, newConstants.size());
    remap.set(i, newConstants.size());
    newConstants.push(v);
  }
  return { newConstants, remap, changed };
}

function dedupStrings(constants: List<string>): {
  newConstants: List<string>;
  remap: Dict<number, number>;
  changed: boolean;
} {
  const seen = Dict.empty<string, number>();
  const remap = Dict.empty<number, number>();
  const newConstants = List.empty<string>();
  let changed = false;
  for (let i = 0; i < constants.size(); i++) {
    const v = constants.get(i)!;
    const existing = seen.get(v);
    if (existing !== undefined) {
      remap.set(i, existing);
      changed = true;
      continue;
    }
    seen.set(v, newConstants.size());
    remap.set(i, newConstants.size());
    newConstants.push(v);
  }
  return { newConstants, remap, changed };
}

function deduplicateConstants(functions: List<FunctionBytecode>, pools: ConstantPools): DedupResult | undefined {
  const r = dedupValues(pools.values);
  const n = dedupNumbers(pools.numbers);
  const s = dedupStrings(pools.strings);

  if (!r.changed && !n.changed && !s.changed) return undefined;

  if (r.changed) {
    logger.debug(
      `[tree-shaker] deduplicated ${pools.values.size() - r.newConstants.size()}/${pools.values.size()} constants`
    );
  }
  if (n.changed) {
    logger.debug(
      `[tree-shaker] deduplicated ${pools.numbers.size() - n.newConstants.size()}/${pools.numbers.size()} number constants`
    );
  }
  if (s.changed) {
    logger.debug(
      `[tree-shaker] deduplicated ${pools.strings.size() - s.newConstants.size()}/${pools.strings.size()} string constants`
    );
  }

  const remaps: ConstRemaps = { values: r.remap, numbers: n.remap, strings: s.remap };

  const newFunctions = List.empty<FunctionBytecode>();
  for (let i = 0; i < functions.size(); i++) {
    const fn = functions.get(i);
    const newCode = List.empty<Instr>();
    let changed = false;
    for (let j = 0; j < fn.code.size(); j++) {
      const ins = fn.code.get(j);
      const remapped = remapInstructionForDedup(ins, remaps);
      if (remapped !== ins) changed = true;
      newCode.push(remapped);
    }
    newFunctions.push(changed ? { ...fn, code: newCode } : fn);
  }

  return {
    functions: newFunctions,
    constantPools: {
      numbers: n.newConstants,
      strings: s.newConstants,
      values: r.newConstants,
    },
  };
}

function remapInstructionForDedup(ins: Instr, consts: ConstRemaps): Instr {
  const op = ins.op;

  if (op === Op.PUSH_CONST_VAL) {
    if (ins.a !== undefined) {
      const newA = consts.values.get(ins.a) ?? ins.a;
      if (newA !== ins.a) return { ...ins, a: newA };
    }
    return ins;
  }

  if (op === Op.PUSH_CONST_NUM) {
    if (ins.a !== undefined) {
      const newA = consts.numbers.get(ins.a) ?? ins.a;
      if (newA !== ins.a) return { ...ins, a: newA };
    }
    return ins;
  }

  if (op === Op.PUSH_CONST_STR || op === Op.INSTANCE_OF) {
    if (ins.a !== undefined) {
      const newA = consts.strings.get(ins.a) ?? ins.a;
      if (newA !== ins.a) return { ...ins, a: newA };
    }
    return ins;
  }

  if (op === Op.LIST_NEW || op === Op.MAP_NEW || op === Op.STRUCT_NEW || op === Op.STRUCT_COPY_EXCEPT) {
    if (ins.b !== undefined) {
      const newB = consts.strings.get(ins.b) ?? ins.b;
      if (newB !== ins.b) return { ...ins, b: newB };
    }
    return ins;
  }

  return ins;
}

/** Strip unreachable functions, constants, and variable names from `program` and dedupe constants. */
export function treeshakeProgram(program: ExecutableBrainProgram): ExecutableBrainProgram {
  const reachableFuncs = markReachableFunctions(program);
  const reachableConsts = markReachableConstants(program, reachableFuncs);
  const reachableVars = markReachableVariableNames(program, reachableFuncs);

  const funcsDead = reachableFuncs.size() < program.functions.size();
  const valuesDead = reachableConsts.values.size() < program.constantPools.values.size();
  const numbersDead = reachableConsts.numbers.size() < program.constantPools.numbers.size();
  const stringsDead = reachableConsts.strings.size() < program.constantPools.strings.size();
  const varsDead = reachableVars.size() < program.variableNames.size();

  if (!funcsDead && !valuesDead && !numbersDead && !stringsDead && !varsDead) {
    const dedup = deduplicateConstants(program.functions, program.constantPools);
    if (dedup) {
      return {
        ...program,
        functions: dedup.functions,
        constantPools: dedup.constantPools,
      };
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

  if (valuesDead) {
    const removed = program.constantPools.values.size() - reachableConsts.values.size();
    logger.debug(`[tree-shaker] removed ${removed}/${program.constantPools.values.size()} constants`);
  }
  if (numbersDead) {
    const removed = program.constantPools.numbers.size() - reachableConsts.numbers.size();
    logger.debug(`[tree-shaker] removed ${removed}/${program.constantPools.numbers.size()} number constants`);
  }
  if (stringsDead) {
    const removed = program.constantPools.strings.size() - reachableConsts.strings.size();
    logger.debug(`[tree-shaker] removed ${removed}/${program.constantPools.strings.size()} string constants`);
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
  const constRemap: ConstRemaps = {
    values: buildRemapTable(program.constantPools.values.size(), reachableConsts.values),
    numbers: buildRemapTable(program.constantPools.numbers.size(), reachableConsts.numbers),
    strings: buildRemapTable(program.constantPools.strings.size(), reachableConsts.strings),
  };
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

  const newValues = List.empty<Value>();
  for (let i = 0; i < program.constantPools.values.size(); i++) {
    if (!reachableConsts.values.has(i)) continue;
    newValues.push(remapFuncIdInValue(program.constantPools.values.get(i), funcRemap));
  }

  const newNumbers = List.empty<number>();
  for (let i = 0; i < program.constantPools.numbers.size(); i++) {
    if (!reachableConsts.numbers.has(i)) continue;
    newNumbers.push(program.constantPools.numbers.get(i)!);
  }

  const newStrings = List.empty<string>();
  for (let i = 0; i < program.constantPools.strings.size(); i++) {
    if (!reachableConsts.strings.has(i)) continue;
    newStrings.push(program.constantPools.strings.get(i)!);
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
  let resultPools: ConstantPools = {
    numbers: newNumbers,
    strings: newStrings,
    values: newValues,
  };

  const dedup = deduplicateConstants(newFunctions, resultPools);
  if (dedup) {
    resultFunctions = dedup.functions;
    resultPools = dedup.constantPools;
  }

  return {
    version: program.version,
    functions: resultFunctions,
    constantPools: resultPools,
    variableNames: newVariableNames,
    entryPoint: newEntryPoint,
    ruleIndex: newRuleIndex,
    pages: newPages,
    actions: newActions,
  };
}
