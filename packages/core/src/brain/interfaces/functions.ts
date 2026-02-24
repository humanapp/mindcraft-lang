import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import { TypeUtils } from "../../platform/types";
import type { HostAsyncFn, HostFn, HostSyncFn } from "./vm";

// ----------------------------------------------------
// Action Calls - Grammar-Like CallSpec Specification
// ----------------------------------------------------

/**
 * Grammar-like specification for action calls.
 */
export type BrainActionCallSpec =
  | BrainActionCallArgSpec
  | BrainActionCallSeqSpec
  | BrainActionCallChoiceSpec
  | BrainActionCallOptionalSpec
  | BrainActionCallRepeatSpec
  | BrainActionCallBagSpec
  | BrainActionCallConditionalSpec;

/**
 * A single argument slot (parameter or modifier tile)
 */
export interface BrainActionCallArgSpec {
  readonly type: "arg";
  readonly name?: string;
  readonly tileId: string;
  readonly required?: boolean;
  readonly anonymous?: boolean;
}

/**
 * All items must appear in sequence
 */
export interface BrainActionCallSeqSpec {
  readonly type: "seq";
  readonly name?: string;
  readonly items: readonly BrainActionCallSpec[];
}

/**
 * Exactly one option must be chosen
 */
export interface BrainActionCallChoiceSpec {
  readonly type: "choice";
  readonly name?: string;
  readonly options: readonly BrainActionCallSpec[];
}

/**
 * Zero or one occurrence
 */
export interface BrainActionCallOptionalSpec {
  readonly type: "optional";
  readonly name?: string;
  readonly item: BrainActionCallSpec;
}

/**
 * Repetition with min/max bounds
 */
export interface BrainActionCallRepeatSpec {
  readonly type: "repeat";
  readonly name?: string;
  readonly item: BrainActionCallSpec;
  readonly min?: number; // default 0
  readonly max?: number; // default Infinity
}

/**
 * Unordered set of items (bag) where items can appear in any order.
 * Each item is typically an arg spec or optional arg spec.
 * The parser will try to match items in any order until no more items can be matched.
 */
export interface BrainActionCallBagSpec {
  readonly type: "bag";
  readonly name?: string;
  readonly items: readonly BrainActionCallSpec[];
}

/**
 * Conditional spec that checks if a named call spec has been successfully matched.
 * Used in bag specs to make certain items available only when a condition is met.
 * The condition is the name of another call spec - if that spec matched, the condition is true.
 */
export interface BrainActionCallConditionalSpec {
  readonly type: "conditional";
  readonly name?: string;
  readonly condition: string; // Name of the call spec to check
  readonly then: BrainActionCallSpec;
  readonly else?: BrainActionCallSpec;
}

export interface BrainActionArgSlot {
  readonly slotId: number;
  readonly argSpec: BrainActionCallArgSpec;
  readonly choiceGroup?: number;
}

export type BrainActionCallDef = {
  callSpec: BrainActionCallSpec;
  argSlots: ReadonlyList<BrainActionArgSlot>;
};

export function mkCallDef(callSpec: BrainActionCallSpec): BrainActionCallDef {
  const argSlots = callSpecToArgSlots(callSpec);
  return {
    callSpec,
    argSlots,
  };
}

/**
 * Looks up the slotId for a given tileId in a callDef's argSlots.
 * Accepts either a raw tileId string or a BrainActionCallArgSpec (extracts `.tileId`).
 * Throws if the tileId is not found, catching misconfigured call specs early.
 */
export function getSlotId(callDef: BrainActionCallDef, tileIdOrSpec: string | BrainActionCallArgSpec): number {
  const tileId = TypeUtils.isString(tileIdOrSpec) ? tileIdOrSpec : tileIdOrSpec.tileId;
  const idx = callDef.argSlots.findIndex((s) => s.argSpec.tileId === tileId);
  if (idx === -1) {
    throw new Error(`No arg slot found for tileId: ${tileId}`);
  }
  return idx;
}

let nextChoiceGroupId = 0;

export function callSpecToArgSlots(callSpec: BrainActionCallSpec): ReadonlyList<BrainActionArgSlot> {
  const argList = List.empty<BrainActionArgSlot>();
  callSpecToArgSlotsImpl(callSpec, argList, undefined);
  return argList.asReadonly();
}

function callSpecToArgSlotsImpl(
  callSpec: BrainActionCallSpec,
  argList: List<BrainActionArgSlot>,
  choiceGroup: number | undefined
) {
  switch (callSpec.type) {
    case "arg":
      argList.push({
        slotId: argList.size(),
        argSpec: callSpec,
        choiceGroup,
      });
      break;
    case "seq":
      for (const item of callSpec.items) {
        callSpecToArgSlotsImpl(item, argList, choiceGroup);
      }
      break;
    case "choice": {
      const groupId = nextChoiceGroupId++;
      for (const option of callSpec.options) {
        callSpecToArgSlotsImpl(option, argList, groupId);
      }
      break;
    }
    case "optional":
      callSpecToArgSlotsImpl(callSpec.item, argList, choiceGroup);
      break;
    case "repeat":
      callSpecToArgSlotsImpl(callSpec.item, argList, choiceGroup);
      break;
    case "bag":
      for (const item of callSpec.items) {
        callSpecToArgSlotsImpl(item, argList, choiceGroup);
      }
      break;
    case "conditional":
      callSpecToArgSlotsImpl(callSpec.then, argList, choiceGroup);
      if (callSpec.else) {
        callSpecToArgSlotsImpl(callSpec.else, argList, choiceGroup);
      }
      break;
    default: {
      const _exhaustive: never = callSpec;
      break;
    }
  }
}

export type BrainFunctionCommon = {
  id: number;
  name: string;
  callDef: BrainActionCallDef;
};

export type BrainSyncFunctionEntry = BrainFunctionCommon & {
  isAsync: false;
  fn: HostSyncFn;
};

export type BrainAsyncFunctionEntry = BrainFunctionCommon & {
  isAsync: true;
  fn: HostAsyncFn;
};

export type BrainFunctionEntry = BrainSyncFunctionEntry | BrainAsyncFunctionEntry;

export interface IFunctionRegistry {
  register(name: string, isAsync: boolean, fn: HostFn, callDef: BrainActionCallDef): BrainFunctionEntry;
  get(name: string): BrainFunctionEntry | undefined;
  getSyncById(id: number): BrainSyncFunctionEntry | undefined;
  getAsyncById(id: number): BrainAsyncFunctionEntry | undefined;
  size(): number;
}
