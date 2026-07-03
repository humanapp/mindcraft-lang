import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import type { ConstantOffsets, FunctionBytecode, Instr } from "../../runtime/bytecode";
import { Op } from "../../runtime/bytecode";
import type { BytecodeExecutableAction } from "../../runtime/context";
import type { IConversionRegistry } from "../../runtime/conversion-defs";
import { isBytecodeConversion } from "../../runtime/conversion-defs";
import type { ActionDescriptor } from "../../runtime/function-defs";
import type {
  BrainActionResolver,
  LinkedBrainProgram,
  ResolvedAction,
  UnlinkedBrainProgram,
} from "../../runtime/host-bindings";
import type { ProgramArtifact, ProgramTypeEntry, SystemRegistration } from "../../runtime/program";
import { remapProgramTypeEntry } from "../../runtime/program";
import type { Value } from "../../runtime/value";
import { isFunctionValue } from "../../runtime/value";
import type { IBrainActionTileDef, IBrainDef, IBrainRuleDef, IBrainTileDef, ITileCatalog } from "../interfaces";
import { type BrainBuildDiagnostic, type BrainBuildResult, LinkDiagCode } from "./diagnostics";

function isActionTileDef(tileDef: IBrainTileDef): tileDef is IBrainActionTileDef {
  return tileDef.kind === "sensor" || tileDef.kind === "actuator";
}

function invalidArtifact(message: string): BrainBuildDiagnostic {
  return { code: LinkDiagCode.InvalidActionArtifact, severity: "error", message };
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
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry
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

  // Bytecode conversions have no tile; their call sites resolve through the
  // descriptor each registry entry carries.
  conversions.forEach((conv) => {
    if (isBytecodeConversion(conv)) {
      addDescriptor(descriptors, conv.descriptor);
    }
  });

  return descriptors;
}

function validateResolvedAction(
  descriptor: ActionDescriptor,
  resolved: ResolvedAction
): BrainBuildDiagnostic | undefined {
  if (resolved.descriptor.key !== descriptor.key) {
    throw new Error(
      `linkBrainProgram: resolver returned action '${resolved.descriptor.key}' for descriptor '${descriptor.key}'`
    );
  }
  if (resolved.descriptor.kind !== descriptor.kind) {
    return invalidArtifact(`Action '${descriptor.key}' kind does not match the registered action.`);
  }
  if (resolved.descriptor.isAsync !== descriptor.isAsync) {
    return invalidArtifact(`Action '${descriptor.key}' async flag does not match the registered action.`);
  }

  if (resolved.binding === "host") {
    if (descriptor.isAsync) {
      if (!resolved.execAsync) {
        throw new Error(`linkBrainProgram: async host action '${descriptor.key}' is missing execAsync`);
      }
      return undefined;
    }
    if (!resolved.execSync) {
      throw new Error(`linkBrainProgram: sync host action '${descriptor.key}' is missing execSync`);
    }
    return undefined;
  }

  const artifact = resolved.artifact;
  const metadata = resolved.metadata;
  if (metadata.key !== descriptor.key) {
    return invalidArtifact(`Bytecode artifact key does not match action '${descriptor.key}'.`);
  }
  if (metadata.kind !== descriptor.kind) {
    return invalidArtifact(`Bytecode artifact kind does not match action '${descriptor.key}'.`);
  }
  if (artifact.isAsync !== descriptor.isAsync) {
    return invalidArtifact(`Bytecode artifact async flag does not match action '${descriptor.key}'.`);
  }
  if (artifact.entryFuncId < 0 || artifact.entryFuncId >= artifact.functions.size()) {
    return invalidArtifact(`Action '${descriptor.key}' has invalid entryFuncId ${artifact.entryFuncId}.`);
  }
  if (
    artifact.activationFuncId !== undefined &&
    (artifact.activationFuncId < 0 || artifact.activationFuncId >= artifact.functions.size())
  ) {
    return invalidArtifact(`Action '${descriptor.key}' has invalid activationFuncId ${artifact.activationFuncId}.`);
  }
  if (
    artifact.initializerFuncId !== undefined &&
    (artifact.initializerFuncId < 0 || artifact.initializerFuncId >= artifact.functions.size())
  ) {
    return invalidArtifact(`Action '${descriptor.key}' has invalid initializerFuncId ${artifact.initializerFuncId}.`);
  }
  if (
    artifact.deactivationFuncId !== undefined &&
    (artifact.deactivationFuncId < 0 || artifact.deactivationFuncId >= artifact.functions.size())
  ) {
    return invalidArtifact(`Action '${descriptor.key}' has invalid deactivationFuncId ${artifact.deactivationFuncId}.`);
  }
  if (artifact.numStateSlots < 0) {
    return invalidArtifact(`Action '${descriptor.key}' has invalid numStateSlots ${artifact.numStateSlots}.`);
  }
  return undefined;
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

function remapInstruction(
  instr: Instr,
  funcOffset: number,
  constOffsets: ConstantOffsets,
  typeOffset: number,
  variableOffset: number,
  systemSlotRemap: Dict<number, number>
): Instr {
  switch (instr.op) {
    case Op.LOAD_SYSTEM_VAR:
    case Op.STORE_SYSTEM_VAR:
      if (instr.a !== undefined) {
        const globalSlot = systemSlotRemap.get(instr.a);
        if (globalSlot !== undefined && globalSlot !== instr.a) {
          return { ...instr, a: globalSlot };
        }
      }
      return instr;
    case Op.CALL:
    case Op.MAKE_CLOSURE:
    case Op.SPAWN_RULE:
      if (instr.a !== undefined) {
        return { ...instr, a: instr.a + funcOffset };
      }
      return instr;
    case Op.PUSH_CONST_VAL:
      if (instr.a !== undefined) {
        return { ...instr, a: instr.a + constOffsets.values };
      }
      return instr;
    case Op.PUSH_CONST_NUM:
      if (instr.a !== undefined) {
        return { ...instr, a: instr.a + constOffsets.numbers };
      }
      return instr;
    case Op.PUSH_CONST_STR:
      if (instr.a !== undefined) {
        return { ...instr, a: instr.a + constOffsets.strings };
      }
      return instr;
    case Op.INSTANCE_OF:
      if (instr.a !== undefined) {
        return { ...instr, a: instr.a + typeOffset };
      }
      return instr;
    case Op.LOAD_VAR_SLOT:
    case Op.STORE_VAR_SLOT:
      if (instr.a !== undefined) {
        return { ...instr, a: instr.a + variableOffset };
      }
      return instr;
    case Op.LIST_NEW:
    case Op.MAP_NEW:
    case Op.STRUCT_NEW:
    case Op.STRUCT_COPY_EXCEPT:
      if (instr.b !== undefined) {
        return { ...instr, b: instr.b + typeOffset };
      }
      return instr;
    default:
      return instr;
  }
}

function remapInstructions(
  code: ReadonlyList<Instr>,
  funcOffset: number,
  constOffsets: ConstantOffsets,
  typeOffset: number,
  variableOffset: number,
  systemSlotRemap: Dict<number, number>
): List<Instr> {
  const remapped = List.empty<Instr>();

  for (let i = 0; i < code.size(); i++) {
    remapped.push(
      remapInstruction(code.get(i)!, funcOffset, constOffsets, typeOffset, variableOffset, systemSlotRemap)
    );
  }

  return remapped;
}

interface MutableConstantPools {
  numbers: List<number>;
  strings: List<string>;
  values: List<Value>;
}

function appendArtifactTables(
  descriptor: ActionDescriptor,
  artifact: ProgramArtifact,
  functions: List<FunctionBytecode>,
  pools: MutableConstantPools,
  types: List<ProgramTypeEntry>,
  variableNames: List<string>,
  systemSlotByIdentity: Dict<string, number>,
  systemRegistry: List<SystemRegistration>
): BytecodeExecutableAction {
  const funcOffset = functions.size();
  const constOffsets: ConstantOffsets = {
    numbers: pools.numbers.size(),
    strings: pools.strings.size(),
    values: pools.values.size(),
  };
  const typeOffset = types.size();
  const variableOffset = variableNames.size();

  // Resolve this artifact's local System slots to brain-global slots by
  // identity, registering each System once (the first artifact that wins).
  const systemSlotRemap = new Dict<number, number>();
  const artifactSystems = artifact.artifactSystems;
  if (artifactSystems) {
    for (let i = 0; i < artifactSystems.size(); i++) {
      const sys = artifactSystems.get(i)!;
      let globalSlot = systemSlotByIdentity.get(sys.identity);
      if (globalSlot === undefined) {
        globalSlot = systemRegistry.size();
        systemSlotByIdentity.set(sys.identity, globalSlot);
        systemRegistry.push({
          name: sys.name,
          storeSlot: globalSlot,
          initFuncId: sys.initFuncId + funcOffset,
          thinkFuncId: sys.thinkFuncId !== undefined ? sys.thinkFuncId + funcOffset : undefined,
        });
      }
      systemSlotRemap.set(sys.localSlot, globalSlot);
    }
  }

  const artifactTypes = artifact.types ?? List.empty<ProgramTypeEntry>();
  for (let i = 0; i < artifactTypes.size(); i++) {
    types.push(remapProgramTypeEntry(artifactTypes.get(i)!, (idx) => idx + typeOffset));
  }

  for (let i = 0; i < artifact.constantPools.values.size(); i++) {
    pools.values.push(remapValue(artifact.constantPools.values.get(i)!, funcOffset));
  }

  for (let i = 0; i < artifact.constantPools.numbers.size(); i++) {
    pools.numbers.push(artifact.constantPools.numbers.get(i)!);
  }

  for (let i = 0; i < artifact.constantPools.strings.size(); i++) {
    pools.strings.push(artifact.constantPools.strings.get(i)!);
  }

  for (let i = 0; i < artifact.variableNames.size(); i++) {
    variableNames.push(artifact.variableNames.get(i)!);
  }

  for (let i = 0; i < artifact.functions.size(); i++) {
    const fn = artifact.functions.get(i)!;
    functions.push({
      code: remapInstructions(fn.code, funcOffset, constOffsets, typeOffset, variableOffset, systemSlotRemap),
      numParams: fn.numParams,
      numLocals: fn.numLocals,
      name: fn.name,
      maxStackDepth: fn.maxStackDepth,
      ...(fn.injectCtxTypeIdx === undefined ? {} : { injectCtxTypeIdx: fn.injectCtxTypeIdx + typeOffset }),
    });
  }

  return {
    binding: "bytecode",
    descriptor,
    entryFuncId: artifact.entryFuncId + funcOffset,
    initializerFuncId: artifact.initializerFuncId !== undefined ? artifact.initializerFuncId + funcOffset : undefined,
    activationFuncId: artifact.activationFuncId !== undefined ? artifact.activationFuncId + funcOffset : undefined,
    deactivationFuncId:
      artifact.deactivationFuncId !== undefined ? artifact.deactivationFuncId + funcOffset : undefined,
    numStateSlots: artifact.numStateSlots,
  };
}

/**
 * Link an {@link UnlinkedBrainProgram} into a {@link LinkedBrainProgram} by
 * resolving every action reference through `resolver` and inlining bytecode-backed
 * action artifacts into the program's function/constant/variable tables. The
 * returned program carries the executable action bindings on `Program.actions`;
 * brain-side rule-to-function and page metadata are returned alongside.
 */
export function linkBrainProgram(
  program: UnlinkedBrainProgram,
  brainDef: IBrainDef,
  catalogs: ReadonlyList<ITileCatalog>,
  resolver: BrainActionResolver,
  conversions: IConversionRegistry
): BrainBuildResult {
  const descriptorIndex = buildActionDescriptorIndex(brainDef, catalogs, conversions);
  const functions = List.empty<FunctionBytecode>();
  const pools: MutableConstantPools = {
    numbers: List.empty<number>(),
    strings: List.empty<string>(),
    values: List.empty<Value>(),
  };
  const types = List.empty<ProgramTypeEntry>();
  const variableNames = List.empty<string>();
  const actions = List.empty<BytecodeExecutableAction>();
  const systemRegistry = List.empty<SystemRegistration>();
  const systemSlotByIdentity = new Dict<string, number>();
  const diagnostics = List.empty<BrainBuildDiagnostic>();

  for (let i = 0; i < program.functions.size(); i++) {
    functions.push(program.functions.get(i)!);
  }
  for (let i = 0; i < program.constantPools.values.size(); i++) {
    pools.values.push(program.constantPools.values.get(i)!);
  }
  for (let i = 0; i < program.constantPools.numbers.size(); i++) {
    pools.numbers.push(program.constantPools.numbers.get(i)!);
  }
  for (let i = 0; i < program.constantPools.strings.size(); i++) {
    pools.strings.push(program.constantPools.strings.get(i)!);
  }
  const programTypes = program.types ?? List.empty<ProgramTypeEntry>();
  for (let i = 0; i < programTypes.size(); i++) {
    types.push(programTypes.get(i)!);
  }
  for (let i = 0; i < program.variableNames.size(); i++) {
    variableNames.push(program.variableNames.get(i)!);
  }

  for (let i = 0; i < program.actionRefs.size(); i++) {
    const actionRef = program.actionRefs.get(i)!;
    const descriptor = descriptorIndex.get(actionRef.key);
    if (!descriptor) {
      diagnostics.push({
        code: LinkDiagCode.MissingActionDescriptor,
        severity: "error",
        message: `Brain references action '${actionRef.key}' with no descriptor in the catalog.`,
      });
      continue;
    }

    const resolved = resolver.resolveAction(descriptor);
    if (!resolved) {
      diagnostics.push({
        code: LinkDiagCode.MissingActionBinding,
        severity: "error",
        message: `Action '${descriptor.key}' could not be resolved in this environment.`,
      });
      continue;
    }

    const diagnostic = validateResolvedAction(descriptor, resolved);
    if (diagnostic) {
      diagnostics.push(diagnostic);
      continue;
    }
    if (resolved.binding !== "bytecode") {
      diagnostics.push({
        code: LinkDiagCode.MissingActionBinding,
        severity: "error",
        message: `Action '${descriptor.key}' resolved to a host binding but is referenced by a bytecode action slot.`,
      });
      continue;
    }
    actions.push(
      appendArtifactTables(
        resolved.descriptor,
        resolved.artifact,
        functions,
        pools,
        types,
        variableNames,
        systemSlotByIdentity,
        systemRegistry
      )
    );
  }

  if (!diagnostics.isEmpty()) {
    return { diagnostics };
  }

  return {
    program: {
      program: {
        version: program.version,
        functions,
        constantPools: {
          numbers: pools.numbers,
          strings: pools.strings,
          values: pools.values,
        },
        types,
        variableNames,
        entryPoint: program.entryPoint,
        actions,
        ruleFuncIds: program.ruleFuncIds,
        ruleAncestors: program.ruleAncestors,
        systems: systemRegistry.isEmpty() ? undefined : systemRegistry,
      },
      ruleIndex: program.ruleIndex,
      pages: program.pages,
    },
    diagnostics,
  };
}
