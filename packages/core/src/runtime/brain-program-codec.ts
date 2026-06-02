import { List } from "../platform/list";
import { UniqueSet } from "../platform/uniqueset";
import type { ConstantPools, FunctionBytecode, Instr } from "./bytecode";
import type { BytecodeExecutableAction, ExecutableAction } from "./context";
import type { ActionDescriptor, BrainActionArgSlot, BrainActionCallDef } from "./function-defs";
import type { ActionCallSiteEntry, LinkedBrainProgram, PageMetadata } from "./host-bindings";
import { dictFromJsonEntries, dictToJsonEntries, listFromJson, listToJson } from "./json-container-codec";
import type { Program } from "./program";
import type { BrainProgramValueJson } from "./value-codec";
import { brainValueFromJson, brainValueToJson } from "./value-codec";

export type {
  BrainProgramJsonObject,
  BrainProgramJsonPrimitive,
  BrainProgramJsonValue,
  BrainProgramValueJson,
} from "./value-codec";
export { brainValueFromJson, brainValueToJson } from "./value-codec";

/** JSON-safe representation of one VM instruction. */
export interface BrainProgramInstructionJson {
  /** VM opcode numeric value. */
  readonly op: number;

  /** First numeric operand. */
  readonly a?: number;

  /** Second numeric operand. */
  readonly b?: number;

  /** Third numeric operand. */
  readonly c?: number;
}

/** JSON-safe representation of one VM function body. */
export interface BrainProgramFunctionBytecodeJson {
  /** VM instructions in execution order. */
  readonly code: readonly BrainProgramInstructionJson[];

  /** Number of positional parameters. */
  readonly numParams: number;

  /** Total local slot count, including parameters. */
  readonly numLocals?: number;

  /** Optional compiler/debug name. */
  readonly name?: string;

  /** Optional maximum operand stack depth. */
  readonly maxStackDepth?: number;

  /** Optional injected execution context type id. */
  readonly injectCtxTypeId?: string;
}

/** JSON-safe representation of VM constant pools. */
export interface BrainProgramConstantPoolsJson {
  /** Numeric constants addressed by numeric constant-pool operands. */
  readonly numbers: readonly number[];

  /** String constants addressed by string constant-pool operands. */
  readonly strings: readonly string[];

  /** Structured constants addressed by value constant-pool operands. */
  readonly values: readonly BrainProgramValueJson[];
}

/** JSON-safe representation of a bytecode-backed action binding. */
export interface BrainProgramBytecodeExecutableActionJson {
  /** Action binding kind. */
  readonly binding: "bytecode";

  /** Static action metadata. */
  readonly descriptor: BrainProgramActionDescriptorJson;

  /** Function id for the action body. */
  readonly entryFuncId: number;

  /** Optional one-time initializer function id. */
  readonly initializerFuncId?: number;

  /** Optional page activation hook function id. */
  readonly activationFuncId?: number;

  /** Optional page deactivation hook function id. */
  readonly deactivationFuncId?: number;

  /** Number of state slots allocated for the action instance. */
  readonly numStateSlots: number;
}

/** JSON-safe representation of a host-bound executable action. */
export interface BrainProgramHostExecutableActionJson {
  /** Action binding kind. */
  readonly binding: "host";

  /** Static action metadata used to rebind the host function from the environment at load. */
  readonly descriptor: BrainProgramActionDescriptorJson;
}

/** JSON-safe representation of one linked executable action binding. */
export type BrainProgramExecutableActionJson =
  | BrainProgramHostExecutableActionJson
  | BrainProgramBytecodeExecutableActionJson;

/** JSON-safe representation of a brain action descriptor. */
export interface BrainProgramActionDescriptorJson {
  /** Stable action key. */
  readonly key: string;

  /** Action kind. */
  readonly kind: "sensor" | "actuator";

  /** Action call grammar and flattened slots. */
  readonly callDef: BrainProgramActionCallDefJson;

  /** True when the action body is asynchronous. */
  readonly isAsync: boolean;

  /** Sensor output type id. */
  readonly outputType?: string;
}

/** JSON-safe representation of a brain action call definition. */
export interface BrainProgramActionCallDefJson {
  /** Original action call grammar tree. */
  readonly callSpec: BrainProgramActionCallSpecJson;

  /** Flattened argument slots in call order. */
  readonly argSlots: readonly BrainProgramActionArgSlotJson[];
}

/** JSON-safe representation of one flattened action argument slot. */
export interface BrainProgramActionArgSlotJson {
  /** Slot index used by compiled call sites. */
  readonly slotId: number;

  /** Source argument spec. */
  readonly argSpec: BrainProgramActionCallArgSpecJson;

  /** Optional choice-group identifier. */
  readonly choiceGroup?: number;
}

/** JSON-safe representation of an action call grammar node. */
export type BrainProgramActionCallSpecJson =
  | BrainProgramActionCallArgSpecJson
  | BrainProgramActionCallSeqSpecJson
  | BrainProgramActionCallChoiceSpecJson
  | BrainProgramActionCallOptionalSpecJson
  | BrainProgramActionCallRepeatSpecJson
  | BrainProgramActionCallBagSpecJson
  | BrainProgramActionCallConditionalSpecJson;

/** JSON-safe representation of one action argument grammar node. */
export interface BrainProgramActionCallArgSpecJson {
  /** Grammar node type. */
  readonly type: "arg";

  /** Optional display or binding name. */
  readonly name?: string;

  /** Tile id consumed by this argument. */
  readonly tileId: string;

  /** True when this argument is required. */
  readonly required?: boolean;

  /** True when this argument has no visible slot name. */
  readonly anonymous?: boolean;
}

/** JSON-safe representation of an ordered action grammar sequence. */
export interface BrainProgramActionCallSeqSpecJson {
  /** Grammar node type. */
  readonly type: "seq";

  /** Optional display or binding name. */
  readonly name?: string;

  /** Ordered child grammar nodes. */
  readonly items: readonly BrainProgramActionCallSpecJson[];
}

/** JSON-safe representation of a choice action grammar node. */
export interface BrainProgramActionCallChoiceSpecJson {
  /** Grammar node type. */
  readonly type: "choice";

  /** Optional display or binding name. */
  readonly name?: string;

  /** Available grammar options. */
  readonly options: readonly BrainProgramActionCallSpecJson[];
}

/** JSON-safe representation of an optional action grammar node. */
export interface BrainProgramActionCallOptionalSpecJson {
  /** Grammar node type. */
  readonly type: "optional";

  /** Optional display or binding name. */
  readonly name?: string;

  /** Optional child grammar node. */
  readonly item: BrainProgramActionCallSpecJson;
}

/** JSON-safe representation of a repeated action grammar node. */
export interface BrainProgramActionCallRepeatSpecJson {
  /** Grammar node type. */
  readonly type: "repeat";

  /** Optional display or binding name. */
  readonly name?: string;

  /** Repeated child grammar node. */
  readonly item: BrainProgramActionCallSpecJson;

  /** Minimum repetition count. */
  readonly min?: number;

  /** Maximum repetition count. */
  readonly max?: number;
}

/** JSON-safe representation of an unordered action grammar bag. */
export interface BrainProgramActionCallBagSpecJson {
  /** Grammar node type. */
  readonly type: "bag";

  /** Optional display or binding name. */
  readonly name?: string;

  /** Unordered child grammar nodes. */
  readonly items: readonly BrainProgramActionCallSpecJson[];
}

/** JSON-safe representation of a conditional action grammar node. */
export interface BrainProgramActionCallConditionalSpecJson {
  /** Grammar node type. */
  readonly type: "conditional";

  /** Optional display or binding name. */
  readonly name?: string;

  /** Named grammar node used as the condition. */
  readonly condition: string;

  /** Child grammar node used when the condition is true. */
  readonly then: BrainProgramActionCallSpecJson;

  /** Child grammar node used when the condition is false. */
  readonly else?: BrainProgramActionCallSpecJson;
}

/** JSON-safe representation of one rule ancestor edge. */
export interface BrainProgramRuleAncestorJsonEntry {
  /** Child rule function id. */
  readonly ruleFuncId: number;

  /** Parent rule function id. */
  readonly parentRuleFuncId: number;
}

/** JSON-safe representation of one linked VM program. */
export interface BrainProgramJson {
  /** Bytecode format version. */
  readonly version: number;

  /** VM function table. */
  readonly functions: readonly BrainProgramFunctionBytecodeJson[];

  /** VM constant pools. */
  readonly constantPools: BrainProgramConstantPoolsJson;

  /** Variable names indexed by compiler-assigned variable slot. */
  readonly variableNames: readonly string[];

  /** Optional entry function id. */
  readonly entryPoint?: number;

  /** Linked executable action bindings (host-bound or bytecode-backed). */
  readonly actions?: readonly BrainProgramExecutableActionJson[];

  /** Function ids that are brain rule entries. */
  readonly ruleFuncIds?: readonly number[];

  /** Parent rule lookup entries. */
  readonly ruleAncestors?: readonly BrainProgramRuleAncestorJsonEntry[];
}

/** JSON-safe representation of one linked brain rule-index entry. */
export interface LinkedBrainProgramRuleIndexJsonEntry {
  /** Rule path inside the brain. */
  readonly path: string;

  /** Function id for the rule body. */
  readonly functionId: number;
}

/** JSON-safe representation of one action call site entry. */
export interface LinkedBrainProgramActionCallSiteJsonEntry {
  /** Action slot in the linked program. */
  readonly actionSlot: number;

  /** Stable call site id. */
  readonly callSiteId: number;
}

/** JSON-safe representation of one linked brain page. */
export interface LinkedBrainProgramPageMetadataJson {
  /** Page index inside the brain. */
  readonly pageIndex: number;

  /** Stable page id. */
  readonly pageId: string;

  /** Page name. */
  readonly pageName: string;

  /** Root rule function ids for the page. */
  readonly rootRuleFuncIds: readonly number[];

  /** Action call sites referenced by page rules. */
  readonly actionCallSites: readonly LinkedBrainProgramActionCallSiteJsonEntry[];

  /** Sensor tile ids referenced by page rules. */
  readonly sensors: readonly string[];

  /** Actuator tile ids referenced by page rules. */
  readonly actuators: readonly string[];
}

/** JSON-safe payload for linked brain execution. */
export interface LinkedBrainProgramJson {
  /** Linked VM program. */
  readonly program: BrainProgramJson;

  /** Rule paths mapped to linked function ids. */
  readonly ruleIndex: readonly LinkedBrainProgramRuleIndexJsonEntry[];

  /** Page metadata used by the brain runtime. */
  readonly pages: readonly LinkedBrainProgramPageMetadataJson[];
}

/**
 * Converts a JSON-safe linked brain payload into the runtime container shape.
 *
 * @param json - Serialized linked brain program payload.
 */
export function linkedBrainProgramFromJson(json: LinkedBrainProgramJson): LinkedBrainProgram {
  return {
    program: brainProgramFromJson(json.program),
    ruleIndex: dictFromJsonEntries(json.ruleIndex, (entry) => [entry.path, entry.functionId]),
    pages: listFromJson(json.pages, pageMetadataFromJson),
  };
}

function brainProgramFromJson(json: BrainProgramJson): Program {
  const program: Program = {
    version: json.version,
    functions: listFromJson(json.functions, functionBytecodeFromJson),
    constantPools: constantPoolsFromJson(json.constantPools),
    variableNames: List.from(json.variableNames),
  };

  if (json.entryPoint !== undefined) {
    program.entryPoint = json.entryPoint;
  }
  if (json.actions !== undefined) {
    program.actions = listFromJson(json.actions, executableActionFromJson);
  }
  if (json.ruleFuncIds !== undefined) {
    program.ruleFuncIds = new UniqueSet(json.ruleFuncIds);
  }
  if (json.ruleAncestors !== undefined) {
    program.ruleAncestors = dictFromJsonEntries(json.ruleAncestors, (entry) => [
      entry.ruleFuncId,
      entry.parentRuleFuncId,
    ]);
  }

  return program;
}

function functionBytecodeFromJson(json: BrainProgramFunctionBytecodeJson): FunctionBytecode {
  const fn: FunctionBytecode = {
    code: listFromJson(json.code, instructionFromJson),
    numParams: json.numParams,
  };

  if (json.numLocals !== undefined) {
    fn.numLocals = json.numLocals;
  }
  if (json.name !== undefined) {
    fn.name = json.name;
  }
  if (json.maxStackDepth !== undefined) {
    fn.maxStackDepth = json.maxStackDepth;
  }
  if (json.injectCtxTypeId !== undefined) {
    fn.injectCtxTypeId = json.injectCtxTypeId;
  }

  return fn;
}

function instructionFromJson(json: BrainProgramInstructionJson): Instr {
  const instruction: Instr = { op: json.op };
  if (json.a !== undefined) {
    instruction.a = json.a;
  }
  if (json.b !== undefined) {
    instruction.b = json.b;
  }
  if (json.c !== undefined) {
    instruction.c = json.c;
  }
  return instruction;
}

function constantPoolsFromJson(json: BrainProgramConstantPoolsJson): ConstantPools {
  return {
    numbers: List.from(json.numbers),
    strings: List.from(json.strings),
    values: listFromJson(json.values, brainValueFromJson),
  };
}

function executableActionFromJson(json: BrainProgramExecutableActionJson): ExecutableAction {
  if (json.binding === "host") {
    return { binding: "host", descriptor: actionDescriptorFromJson(json.descriptor) };
  }
  return bytecodeExecutableActionFromJson(json);
}

function bytecodeExecutableActionFromJson(json: BrainProgramBytecodeExecutableActionJson): BytecodeExecutableAction {
  const action: BytecodeExecutableAction = {
    binding: "bytecode",
    descriptor: actionDescriptorFromJson(json.descriptor),
    entryFuncId: json.entryFuncId,
    numStateSlots: json.numStateSlots,
  };

  if (json.initializerFuncId !== undefined) {
    action.initializerFuncId = json.initializerFuncId;
  }
  if (json.activationFuncId !== undefined) {
    action.activationFuncId = json.activationFuncId;
  }
  if (json.deactivationFuncId !== undefined) {
    action.deactivationFuncId = json.deactivationFuncId;
  }

  return action;
}

function actionDescriptorFromJson(json: BrainProgramActionDescriptorJson): ActionDescriptor {
  const descriptor: ActionDescriptor = {
    key: json.key,
    kind: json.kind,
    callDef: actionCallDefFromJson(json.callDef),
    isAsync: json.isAsync,
  };

  if (json.outputType !== undefined) {
    descriptor.outputType = json.outputType;
  }

  return descriptor;
}

function actionCallDefFromJson(json: BrainProgramActionCallDefJson): BrainActionCallDef {
  return {
    callSpec: json.callSpec,
    argSlots: listFromJson(json.argSlots, actionArgSlotFromJson).asReadonly(),
  };
}

function actionArgSlotFromJson(json: BrainProgramActionArgSlotJson): BrainActionArgSlot {
  if (json.choiceGroup !== undefined) {
    return {
      slotId: json.slotId,
      argSpec: json.argSpec,
      choiceGroup: json.choiceGroup,
    };
  }

  return {
    slotId: json.slotId,
    argSpec: json.argSpec,
  };
}

function pageMetadataFromJson(json: LinkedBrainProgramPageMetadataJson): PageMetadata {
  return {
    pageIndex: json.pageIndex,
    pageId: json.pageId,
    pageName: json.pageName,
    rootRuleFuncIds: List.from(json.rootRuleFuncIds),
    actionCallSites: listFromJson(json.actionCallSites, actionCallSiteFromJson),
    sensors: new UniqueSet(json.sensors),
    actuators: new UniqueSet(json.actuators),
  };
}

function actionCallSiteFromJson(json: LinkedBrainProgramActionCallSiteJsonEntry): ActionCallSiteEntry {
  return {
    actionSlot: json.actionSlot,
    callSiteId: json.callSiteId,
  };
}

/**
 * Converts a runtime linked brain program into its JSON-safe payload.
 *
 * @param program - Linked brain program to serialize.
 */
export function linkedBrainProgramToJson(program: LinkedBrainProgram): LinkedBrainProgramJson {
  return {
    program: brainProgramToJson(program.program),
    ruleIndex: dictToJsonEntries(program.ruleIndex, (path, functionId) => ({ path, functionId })),
    pages: listToJson(program.pages, pageMetadataToJson),
  };
}

function brainProgramToJson(program: Program): BrainProgramJson {
  return {
    version: program.version,
    functions: listToJson(program.functions, functionBytecodeToJson),
    constantPools: constantPoolsToJson(program.constantPools),
    variableNames: program.variableNames.toArray(),
    ...(program.entryPoint !== undefined ? { entryPoint: program.entryPoint } : {}),
    ...(program.actions !== undefined ? { actions: listToJson(program.actions, executableActionToJson) } : {}),
    ...(program.ruleFuncIds !== undefined ? { ruleFuncIds: program.ruleFuncIds.toArray() } : {}),
    ...(program.ruleAncestors !== undefined
      ? {
          ruleAncestors: dictToJsonEntries(program.ruleAncestors, (ruleFuncId, parentRuleFuncId) => ({
            ruleFuncId,
            parentRuleFuncId,
          })),
        }
      : {}),
  };
}

function functionBytecodeToJson(fn: FunctionBytecode): BrainProgramFunctionBytecodeJson {
  return {
    code: listToJson(fn.code, instructionToJson),
    numParams: fn.numParams,
    ...(fn.numLocals !== undefined ? { numLocals: fn.numLocals } : {}),
    ...(fn.name !== undefined ? { name: fn.name } : {}),
    ...(fn.maxStackDepth !== undefined ? { maxStackDepth: fn.maxStackDepth } : {}),
    ...(fn.injectCtxTypeId !== undefined ? { injectCtxTypeId: fn.injectCtxTypeId } : {}),
  };
}

function instructionToJson(instruction: Instr): BrainProgramInstructionJson {
  return {
    op: instruction.op,
    ...(instruction.a !== undefined ? { a: instruction.a } : {}),
    ...(instruction.b !== undefined ? { b: instruction.b } : {}),
    ...(instruction.c !== undefined ? { c: instruction.c } : {}),
  };
}

function constantPoolsToJson(pools: ConstantPools): BrainProgramConstantPoolsJson {
  return {
    numbers: pools.numbers.toArray(),
    strings: pools.strings.toArray(),
    values: listToJson(pools.values, brainValueToJson),
  };
}

function executableActionToJson(action: ExecutableAction): BrainProgramExecutableActionJson {
  if (action.binding === "host") {
    return { binding: "host", descriptor: actionDescriptorToJson(action.descriptor) };
  }
  return bytecodeExecutableActionToJson(action);
}

function bytecodeExecutableActionToJson(action: BytecodeExecutableAction): BrainProgramBytecodeExecutableActionJson {
  return {
    binding: "bytecode",
    descriptor: actionDescriptorToJson(action.descriptor),
    entryFuncId: action.entryFuncId,
    numStateSlots: action.numStateSlots,
    ...(action.initializerFuncId !== undefined ? { initializerFuncId: action.initializerFuncId } : {}),
    ...(action.activationFuncId !== undefined ? { activationFuncId: action.activationFuncId } : {}),
    ...(action.deactivationFuncId !== undefined ? { deactivationFuncId: action.deactivationFuncId } : {}),
  };
}

function actionDescriptorToJson(descriptor: ActionDescriptor): BrainProgramActionDescriptorJson {
  return {
    key: descriptor.key,
    kind: descriptor.kind,
    callDef: actionCallDefToJson(descriptor.callDef),
    isAsync: descriptor.isAsync,
    ...(descriptor.outputType !== undefined ? { outputType: descriptor.outputType } : {}),
  };
}

function actionCallDefToJson(callDef: BrainActionCallDef): BrainProgramActionCallDefJson {
  return {
    callSpec: callDef.callSpec,
    argSlots: listToJson(callDef.argSlots, actionArgSlotToJson),
  };
}

function actionArgSlotToJson(slot: BrainActionArgSlot): BrainProgramActionArgSlotJson {
  return {
    slotId: slot.slotId,
    argSpec: slot.argSpec,
    ...(slot.choiceGroup !== undefined ? { choiceGroup: slot.choiceGroup } : {}),
  };
}

function pageMetadataToJson(page: PageMetadata): LinkedBrainProgramPageMetadataJson {
  return {
    pageIndex: page.pageIndex,
    pageId: page.pageId,
    pageName: page.pageName,
    rootRuleFuncIds: page.rootRuleFuncIds.toArray(),
    actionCallSites: listToJson(page.actionCallSites, actionCallSiteToJson),
    sensors: page.sensors.toArray(),
    actuators: page.actuators.toArray(),
  };
}

function actionCallSiteToJson(entry: ActionCallSiteEntry): LinkedBrainProgramActionCallSiteJsonEntry {
  return {
    actionSlot: entry.actionSlot,
    callSiteId: entry.callSiteId,
  };
}
