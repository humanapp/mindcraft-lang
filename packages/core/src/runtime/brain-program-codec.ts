import { Dict } from "../platform/dict";
import { Error } from "../platform/error";
import { List } from "../platform/list";
import { UniqueSet } from "../platform/uniqueset";
import type { ConstantPools, FunctionBytecode, Instr } from "./bytecode";
import type { BytecodeExecutableAction } from "./context";
import { type ActionDescriptor, mkCallDef } from "./function-defs";
import type { ActionCallSiteEntry, LinkedBrainProgram, PageMetadata } from "./host-bindings";
import { dictFromJsonEntries, dictToJsonEntries, listFromJson, listToJson } from "./json-container-codec";
import type { Program, ProgramTypeEntry } from "./program";
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

  /** Optional type-table index of the injected execution context type. */
  readonly injectCtxTypeIdx?: number;
}

/**
 * JSON-safe representation of one program type-table entry. Mirrors
 * {@link ProgramTypeEntry}: structural child references are table indices, and
 * every entry carries its resolved typeId string.
 */
export type BrainProgramTypeEntryJson =
  | { readonly tag: "atom"; readonly typeId: string; readonly atomId: number }
  | { readonly tag: "list"; readonly typeId: string; readonly elem: number }
  | { readonly tag: "map"; readonly typeId: string; readonly key: number; readonly value: number }
  | { readonly tag: "union"; readonly typeId: string; readonly members: readonly number[] }
  | {
      readonly tag: "function";
      readonly typeId: string;
      readonly params: readonly number[];
      readonly result: number;
    }
  | { readonly tag: "nullable"; readonly typeId: string; readonly base: number }
  | {
      readonly tag: "struct";
      readonly typeId: string;
      readonly name: string;
      readonly maxFieldId: number;
      readonly fields?: readonly { readonly name: string; readonly fieldIndex: number }[];
    }
  | {
      readonly tag: "enum";
      readonly typeId: string;
      readonly name: string;
      readonly symbols: readonly string[];
    };

/** JSON-safe representation of VM constant pools. */
export interface BrainProgramConstantPoolsJson {
  /** Numeric constants addressed by numeric constant-pool operands. */
  readonly numbers: readonly number[];

  /** String constants addressed by string constant-pool operands. */
  readonly strings: readonly string[];

  /** Structured constants addressed by value constant-pool operands. */
  readonly values: readonly BrainProgramValueJson[];
}

/**
 * JSON-safe representation of a bytecode-backed action binding. Records only function ids: the
 * action table is bytecode-only (so the binding kind is implicit), the VM dispatches by slot (so
 * the action key is not needed), and sync vs async is encoded in the call-site opcode
 * (`ACTION_CALL` / `ACTION_CALL_ASYNC`). Human-readable keys, if wanted, belong in a separate
 * debug-symbol side table.
 */
export interface BrainProgramBytecodeExecutableActionJson {
  /** Function id for the action body. */
  readonly entryFuncId: number;

  /** Optional one-time initializer function id. */
  readonly initializerFuncId?: number;

  /** Optional page activation hook function id. */
  readonly activationFuncId?: number;

  /** Optional page deactivation hook function id. */
  readonly deactivationFuncId?: number;
}

/**
 * JSON-safe representation of one linked executable action binding. The action
 * table is bytecode-only; host actions dispatch by stable id via
 * `HOST_ACTION_CALL` and are not serialized here.
 */
export type BrainProgramExecutableActionJson = BrainProgramBytecodeExecutableActionJson;

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

  /** Program type table referenced by typed instruction operands. */
  readonly types?: readonly BrainProgramTypeEntryJson[];

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

/**
 * JSON-safe representation of one action call site entry. A `host` entry
 * carries the stable registry `actionId`; a `bytecode` entry carries the
 * program-local `actionSlot`.
 */
export type LinkedBrainProgramActionCallSiteJsonEntry =
  | { readonly binding: "host"; readonly callSiteId: number; readonly actionId: number }
  | { readonly binding: "bytecode"; readonly callSiteId: number; readonly actionSlot: number };

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
    // Not serialized; hydrates to an empty ruleIndex.
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

  if (json.types !== undefined) {
    program.types = listFromJson(json.types, typeEntryFromJson);
  }

  if (json.entryPoint !== undefined) {
    program.entryPoint = json.entryPoint;
  }
  if (json.actions !== undefined) {
    program.actions = listFromJson(json.actions, bytecodeExecutableActionFromJson);
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
  if (json.injectCtxTypeIdx !== undefined) {
    fn.injectCtxTypeIdx = json.injectCtxTypeIdx;
  }

  return fn;
}

function typeEntryFromJson(json: BrainProgramTypeEntryJson): ProgramTypeEntry {
  switch (json.tag) {
    case "atom":
    case "nullable":
    case "list":
    case "map":
      return json;
    case "struct":
      return {
        tag: "struct",
        typeId: json.typeId,
        name: json.name,
        maxFieldId: json.maxFieldId,
        fields: List.from(json.fields ?? []),
      };
    case "union":
      return { tag: "union", typeId: json.typeId, members: List.from(json.members) };
    case "function":
      return { tag: "function", typeId: json.typeId, params: List.from(json.params), result: json.result };
    case "enum":
      return { tag: "enum", typeId: json.typeId, name: json.name, symbols: List.from(json.symbols) };
    default:
      throw new Error(`Unknown program type-table entry tag: ${(json as { tag: string }).tag}`);
  }
}

function typeEntryToJson(entry: ProgramTypeEntry): BrainProgramTypeEntryJson {
  switch (entry.tag) {
    case "atom":
    case "nullable":
    case "list":
    case "map":
      return entry;
    case "struct":
      return {
        tag: "struct",
        typeId: entry.typeId,
        name: entry.name,
        maxFieldId: entry.maxFieldId,
        fields: entry.fields.toArray(),
      };
    case "union":
      return { tag: "union", typeId: entry.typeId, members: entry.members.toArray() };
    case "function":
      return { tag: "function", typeId: entry.typeId, params: entry.params.toArray(), result: entry.result };
    case "enum":
      return { tag: "enum", typeId: entry.typeId, name: entry.name, symbols: entry.symbols.toArray() };
  }
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

/**
 * Builds a placeholder {@link ActionDescriptor} for a deserialized bytecode action. A lean
 * `.mcprogram` records only function ids -- `key`, `kind`, `callDef`, and `isAsync` are not
 * serialized (the VM dispatches by slot and the call-site opcode encodes sync vs async) -- so
 * neutral defaults are used.
 */
function placeholderActionDescriptor(): ActionDescriptor {
  return { key: "", kind: "sensor", callDef: mkCallDef({ type: "bag", items: [] }), isAsync: false };
}

function bytecodeExecutableActionFromJson(json: BrainProgramBytecodeExecutableActionJson): BytecodeExecutableAction {
  const action: BytecodeExecutableAction = {
    binding: "bytecode",
    descriptor: placeholderActionDescriptor(),
    entryFuncId: json.entryFuncId,
    // Not serialized; defaults to 0.
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
  if (json.binding === "host") {
    return { binding: "host", callSiteId: json.callSiteId, actionId: json.actionId };
  }
  return { binding: "bytecode", callSiteId: json.callSiteId, actionSlot: json.actionSlot };
}

/**
 * Converts a runtime linked brain program into its JSON-safe payload.
 *
 * The `actions` table is bytecode-only; host actions dispatch by id via
 * `HOST_ACTION_CALL` and are not serialized there. Those instruction operands
 * embed registration-order host ids, so a serialized program is only valid
 * against an action registry built in the same order. A durable, pinned host
 * id space is a separate concern.
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
    ...(program.types !== undefined ? { types: listToJson(program.types, typeEntryToJson) } : {}),
    variableNames: program.variableNames.toArray(),
    ...(program.entryPoint !== undefined ? { entryPoint: program.entryPoint } : {}),
    ...(program.actions !== undefined ? { actions: listToJson(program.actions, bytecodeExecutableActionToJson) } : {}),
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
    ...(fn.injectCtxTypeIdx !== undefined ? { injectCtxTypeIdx: fn.injectCtxTypeIdx } : {}),
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

function bytecodeExecutableActionToJson(action: BytecodeExecutableAction): BrainProgramBytecodeExecutableActionJson {
  return {
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
  if (entry.binding === "host") {
    return { binding: "host", callSiteId: entry.callSiteId, actionId: entry.actionId };
  }
  return { binding: "bytecode", callSiteId: entry.callSiteId, actionSlot: entry.actionSlot };
}
