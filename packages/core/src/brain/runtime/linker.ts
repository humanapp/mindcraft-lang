import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import type {
  ActionDescriptor,
  BytecodeExecutableAction,
  ExecutableAction,
  ExecutableBrainProgram,
  FunctionBytecode,
  IBrainActionTileDef,
  IBrainDef,
  IBrainRuleDef,
  IBrainTileDef,
  Instr,
  ITileCatalog,
  ResolvedAction,
  UnlinkedBrainProgram,
  UserActionArtifact,
  Value,
} from "../interfaces";
import { isFunctionValue, Op } from "../interfaces";
import type { BrainActionResolver } from "../interfaces/runtime";

function isActionTileDef(tileDef: IBrainTileDef): tileDef is IBrainActionTileDef {
  return tileDef.kind === "sensor" || tileDef.kind === "actuator";
}

function addDescriptor(descriptors: Dict<string, ActionDescriptor>, descriptor: ActionDescriptor): void {
  if (!descriptors.has(descriptor.key)) {
    descriptors.set(descriptor.key, descriptor);
  }
}

function collectTileDescriptors(
  tileDefs: ReadonlyList<IBrainTileDef>,
  descriptors: Dict<string, ActionDescriptor>
): void {
  for (let i = 0; i < tileDefs.size(); i++) {
    const tileDef = tileDefs.get(i)!;
    if (isActionTileDef(tileDef)) {
      addDescriptor(descriptors, tileDef.action);
    }
  }
}

function collectRuleDescriptors(ruleDef: IBrainRuleDef, descriptors: Dict<string, ActionDescriptor>): void {
  collectTileDescriptors(ruleDef.when().tiles(), descriptors);
  collectTileDescriptors(ruleDef.do().tiles(), descriptors);

  const children = ruleDef.children();
  for (let i = 0; i < children.size(); i++) {
    collectRuleDescriptors(children.get(i)!, descriptors);
  }
}

function buildActionDescriptorIndex(
  brainDef: IBrainDef,
  catalogs: ReadonlyList<ITileCatalog>
): Dict<string, ActionDescriptor> {
  const descriptors = new Dict<string, ActionDescriptor>();

  const pages = brainDef.pages();
  for (let i = 0; i < pages.size(); i++) {
    const rules = pages.get(i)!.children();
    for (let j = 0; j < rules.size(); j++) {
      collectRuleDescriptors(rules.get(j)!, descriptors);
    }
  }

  for (let i = 0; i < catalogs.size(); i++) {
    const catalog = catalogs.get(i)!;
    const tileDefs = catalog.getAll();

    for (let j = 0; j < tileDefs.size(); j++) {
      const tileDef = tileDefs.get(j)!;
      if (!isActionTileDef(tileDef)) {
        continue;
      }
      addDescriptor(descriptors, tileDef.action);
    }
  }

  return descriptors;
}

function validateResolvedAction(descriptor: ActionDescriptor, resolved: ResolvedAction): void {
  if (resolved.descriptor.key !== descriptor.key) {
    throw new Error(
      `linkBrainProgram: resolver returned action '${resolved.descriptor.key}' for descriptor '${descriptor.key}'`
    );
  }
  if (resolved.descriptor.kind !== descriptor.kind) {
    throw new Error(`linkBrainProgram: action kind mismatch for '${descriptor.key}'`);
  }
  if (resolved.descriptor.isAsync !== descriptor.isAsync) {
    throw new Error(`linkBrainProgram: action async flag mismatch for '${descriptor.key}'`);
  }

  if (resolved.binding === "host") {
    if (descriptor.isAsync) {
      if (!resolved.execAsync) {
        throw new Error(`linkBrainProgram: async host action '${descriptor.key}' is missing execAsync`);
      }
      return;
    }
    if (!resolved.execSync) {
      throw new Error(`linkBrainProgram: sync host action '${descriptor.key}' is missing execSync`);
    }
    return;
  }

  const artifact = resolved.artifact;
  if (artifact.key !== descriptor.key) {
    throw new Error(`linkBrainProgram: bytecode artifact key mismatch for '${descriptor.key}'`);
  }
  if (artifact.kind !== descriptor.kind) {
    throw new Error(`linkBrainProgram: bytecode artifact kind mismatch for '${descriptor.key}'`);
  }
  if (artifact.isAsync !== descriptor.isAsync) {
    throw new Error(`linkBrainProgram: bytecode artifact async flag mismatch for '${descriptor.key}'`);
  }
  if (artifact.entryFuncId < 0 || artifact.entryFuncId >= artifact.functions.size()) {
    throw new Error(`linkBrainProgram: action '${descriptor.key}' has invalid entryFuncId ${artifact.entryFuncId}`);
  }
  if (
    artifact.activationFuncId !== undefined &&
    (artifact.activationFuncId < 0 || artifact.activationFuncId >= artifact.functions.size())
  ) {
    throw new Error(
      `linkBrainProgram: action '${descriptor.key}' has invalid activationFuncId ${artifact.activationFuncId}`
    );
  }
  if (artifact.numStateSlots < 0) {
    throw new Error(`linkBrainProgram: action '${descriptor.key}' has invalid numStateSlots ${artifact.numStateSlots}`);
  }
}

function remapValue(value: Value, funcOffset: number): Value {
  if (!isFunctionValue(value)) {
    return value;
  }

  if (!value.captures) {
    return { ...value, funcId: value.funcId + funcOffset };
  }

  const captures = List.empty<Value>();
  for (let i = 0; i < value.captures.size(); i++) {
    captures.push(remapValue(value.captures.get(i)!, funcOffset));
  }

  return {
    ...value,
    funcId: value.funcId + funcOffset,
    captures,
  };
}

function remapInstruction(instr: Instr, funcOffset: number, constOffset: number, variableOffset: number): Instr {
  switch (instr.op) {
    case Op.CALL:
    case Op.MAKE_CLOSURE:
      if (instr.a !== undefined) {
        return { ...instr, a: instr.a + funcOffset };
      }
      return instr;
    case Op.PUSH_CONST:
      if (instr.a !== undefined) {
        return { ...instr, a: instr.a + constOffset };
      }
      return instr;
    case Op.LOAD_VAR:
    case Op.STORE_VAR:
      if (instr.a !== undefined) {
        return { ...instr, a: instr.a + variableOffset };
      }
      return instr;
    case Op.LIST_NEW:
    case Op.MAP_NEW:
    case Op.STRUCT_NEW:
    case Op.STRUCT_COPY_EXCEPT:
      if (instr.b !== undefined) {
        return { ...instr, b: instr.b + constOffset };
      }
      return instr;
    default:
      return instr;
  }
}

function remapInstructions(
  code: ReadonlyList<Instr>,
  funcOffset: number,
  constOffset: number,
  variableOffset: number
): List<Instr> {
  const remapped = List.empty<Instr>();

  for (let i = 0; i < code.size(); i++) {
    remapped.push(remapInstruction(code.get(i)!, funcOffset, constOffset, variableOffset));
  }

  return remapped;
}

function appendArtifactTables(
  descriptor: ActionDescriptor,
  artifact: UserActionArtifact,
  functions: List<FunctionBytecode>,
  constants: List<Value>,
  variableNames: List<string>
): BytecodeExecutableAction {
  const funcOffset = functions.size();
  const constOffset = constants.size();
  const variableOffset = variableNames.size();

  for (let i = 0; i < artifact.constants.size(); i++) {
    constants.push(remapValue(artifact.constants.get(i)!, funcOffset));
  }

  for (let i = 0; i < artifact.variableNames.size(); i++) {
    variableNames.push(artifact.variableNames.get(i)!);
  }

  for (let i = 0; i < artifact.functions.size(); i++) {
    const fn = artifact.functions.get(i)!;
    functions.push({
      code: remapInstructions(fn.code, funcOffset, constOffset, variableOffset),
      numParams: fn.numParams,
      numLocals: fn.numLocals,
      name: fn.name,
      maxStackDepth: fn.maxStackDepth,
      injectCtxTypeId: fn.injectCtxTypeId,
    });
  }

  return {
    binding: "bytecode",
    descriptor,
    entryFuncId: artifact.entryFuncId + funcOffset,
    activationFuncId: artifact.activationFuncId !== undefined ? artifact.activationFuncId + funcOffset : undefined,
    numStateSlots: artifact.numStateSlots,
  };
}

function toExecutableAction(
  resolved: ResolvedAction,
  functions: List<FunctionBytecode>,
  constants: List<Value>,
  variableNames: List<string>
): ExecutableAction {
  if (resolved.binding === "host") {
    return resolved;
  }

  return appendArtifactTables(resolved.descriptor, resolved.artifact, functions, constants, variableNames);
}

export function linkBrainProgram(
  program: UnlinkedBrainProgram,
  brainDef: IBrainDef,
  catalogs: ReadonlyList<ITileCatalog>,
  resolver: BrainActionResolver
): ExecutableBrainProgram {
  const descriptorIndex = buildActionDescriptorIndex(brainDef, catalogs);
  const functions = List.empty<FunctionBytecode>();
  const constants = List.empty<Value>();
  const variableNames = List.empty<string>();
  const actions = List.empty<ExecutableAction>();

  for (let i = 0; i < program.functions.size(); i++) {
    functions.push(program.functions.get(i)!);
  }
  for (let i = 0; i < program.constants.size(); i++) {
    constants.push(program.constants.get(i)!);
  }
  for (let i = 0; i < program.variableNames.size(); i++) {
    variableNames.push(program.variableNames.get(i)!);
  }

  for (let i = 0; i < program.actionRefs.size(); i++) {
    const actionRef = program.actionRefs.get(i)!;
    const descriptor = descriptorIndex.get(actionRef.key);
    if (!descriptor) {
      throw new Error(`linkBrainProgram: missing action descriptor for '${actionRef.key}'`);
    }

    const resolved = resolver.resolveAction(descriptor);
    if (!resolved) {
      throw new Error(`linkBrainProgram: missing action binding for '${descriptor.key}'`);
    }

    validateResolvedAction(descriptor, resolved);
    actions.push(toExecutableAction(resolved, functions, constants, variableNames));
  }

  return {
    version: program.version,
    functions,
    constants,
    variableNames,
    entryPoint: program.entryPoint,
    ruleIndex: program.ruleIndex,
    pages: program.pages,
    actions,
  };
}
