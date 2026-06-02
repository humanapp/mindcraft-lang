import { Dict } from "../platform/dict";
import { List } from "../platform/list";
import { UniqueSet } from "../platform/uniqueset";
import type { ConstantPools, FunctionBytecode, Instr } from "./bytecode";
import type { BytecodeExecutableAction, ExecutableAction, HostActionBinding } from "./context";
import { type ActionDescriptor, mkCallDef } from "./function-defs";
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

  /** Stable action key identifying the bytecode action. */
  readonly key: string;

  /** True when the action body is asynchronous; selects ACTION_CALL vs ACTION_CALL_ASYNC dispatch. */
  readonly isAsync: boolean;

  /** Function id for the action body. */
  readonly entryFuncId: number;

  /** Optional one-time initializer function id. */
  readonly initializerFuncId?: number;

  /** Optional page activation hook function id. */
  readonly activationFuncId?: number;

  /** Optional page deactivation hook function id. */
  readonly deactivationFuncId?: number;
}

/** JSON-safe representation of a host-bound executable action. */
export interface BrainProgramHostExecutableActionJson {
  /** Action binding kind. */
  readonly binding: "host";

  /**
   * Stable action key identifying the host builtin. The live functions and full
   * descriptor are owned by the runtime environment and rebound by this key at load.
   */
  readonly key: string;
}

/** JSON-safe representation of one linked executable action binding. */
export type BrainProgramExecutableActionJson =
  | BrainProgramHostExecutableActionJson
  | BrainProgramBytecodeExecutableActionJson;

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
}

/** JSON-safe payload for linked brain execution. */
export interface LinkedBrainProgramJson {
  /** Linked VM program. */
  readonly program: BrainProgramJson;

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
    // ruleIndex is not serialized (no load/execute reader); it is rebuilt on the authoring side
    // from the live compile result, so a deserialized program starts with an empty map.
    ruleIndex: Dict.empty<string, number>(),
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
    return unresolvedHostActionBinding(json.key);
  }
  return bytecodeExecutableActionFromJson(json);
}

/**
 * Builds a placeholder action descriptor from the fields a lean `.mcprogram` records. The call
 * grammar, kind, and output type are not serialized; the `kind` and `callDef` here are inert
 * placeholders the runtime never reads. Host actions are rebound to their environment descriptor by
 * key at load; bytecode actions are dispatched by slot and read only `key`/`isAsync` off the
 * descriptor.
 */
function placeholderActionDescriptor(key: string, isAsync: boolean): ActionDescriptor {
  return { key, kind: "sensor", callDef: mkCallDef({ type: "bag", items: [] }), isAsync };
}

/**
 * Builds an unresolved host action binding from a serialized action key.
 *
 * A serialized `.mcprogram` records a host action as its descriptor key alone; the live functions
 * and full descriptor are environment builtins. The returned binding is a placeholder: only
 * `descriptor.key` is meaningful, it carries no functions, and a loader must resolve it against the
 * runtime environment by key before the program executes.
 */
function unresolvedHostActionBinding(key: string): HostActionBinding {
  return { binding: "host", descriptor: placeholderActionDescriptor(key, false) };
}

function bytecodeExecutableActionFromJson(json: BrainProgramBytecodeExecutableActionJson): BytecodeExecutableAction {
  const action: BytecodeExecutableAction = {
    binding: "bytecode",
    descriptor: placeholderActionDescriptor(json.key, json.isAsync),
    entryFuncId: json.entryFuncId,
    // numStateSlots is not serialized; the callsite store allocates state slots lazily.
    numStateSlots: 0,
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

function pageMetadataFromJson(json: LinkedBrainProgramPageMetadataJson): PageMetadata {
  return {
    pageIndex: json.pageIndex,
    pageId: json.pageId,
    pageName: json.pageName,
    rootRuleFuncIds: List.from(json.rootRuleFuncIds),
    actionCallSites: listFromJson(json.actionCallSites, actionCallSiteFromJson),
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
    return { binding: "host", key: action.descriptor.key };
  }
  return bytecodeExecutableActionToJson(action);
}

function bytecodeExecutableActionToJson(action: BytecodeExecutableAction): BrainProgramBytecodeExecutableActionJson {
  return {
    binding: "bytecode",
    key: action.descriptor.key,
    isAsync: action.descriptor.isAsync,
    entryFuncId: action.entryFuncId,
    ...(action.initializerFuncId !== undefined ? { initializerFuncId: action.initializerFuncId } : {}),
    ...(action.activationFuncId !== undefined ? { activationFuncId: action.activationFuncId } : {}),
    ...(action.deactivationFuncId !== undefined ? { deactivationFuncId: action.deactivationFuncId } : {}),
  };
}

function pageMetadataToJson(page: PageMetadata): LinkedBrainProgramPageMetadataJson {
  return {
    pageIndex: page.pageIndex,
    pageId: page.pageId,
    pageName: page.pageName,
    rootRuleFuncIds: page.rootRuleFuncIds.toArray(),
    actionCallSites: listToJson(page.actionCallSites, actionCallSiteToJson),
  };
}

function actionCallSiteToJson(entry: ActionCallSiteEntry): LinkedBrainProgramActionCallSiteJsonEntry {
  return {
    actionSlot: entry.actionSlot,
    callSiteId: entry.callSiteId,
  };
}
