import type { IFunctionRegistry } from "./function-defs";
import type { ITypeRegistry } from "./type-defs";
import type { Value } from "./value";

/**
 * Program-table lookups exposed to the VM and host functions. Allocations are
 * compile-time per the dense-state id allocation policy.
 */
export interface IProgramServices {
  /**
   * Resolve the rule that owns a function id. Returns the rule's own funcId
   * when `funcId` is itself a rule entry, or the enclosing rule's funcId for
   * functions nested inside a rule. Returns `undefined` for functions that
   * are not owned by any rule.
   */
  getRuleFuncIdForFunc(funcId: number): number | undefined;
}

/**
 * Brain-level variable storage keyed by variable name. Backs the
 * {@link BrainContext.getVariable} / {@link BrainContext.setVariable} host
 * functions and any host-side reads of program-global variables.
 */
export interface IBrainVariableServices {
  getByName(name: string): Value;
  setByName(name: string, value: Value): void;
  clearByName(name: string): void;
}

/**
 * Per-rule variable storage keyed by rule funcId and variable name. Backs the
 * {@link RuleContext.getVariable} / {@link RuleContext.setVariable} host
 * functions. When `ruleFuncId` is `undefined` (i.e. execution is not inside
 * a rule), reads return {@link NIL_VALUE} and writes are no-ops.
 */
export interface IRuleVariableServices {
  getByName(ruleFuncId: number | undefined, name: string): Value;
  setByName(ruleFuncId: number | undefined, name: string, value: Value): void;
  clearByName(ruleFuncId: number | undefined, name: string): void;
}

/**
 * Page lifecycle operations (current/previous page query, page-change requests).
 * Backs the core page-related sensors and actuators.
 */
export interface IBrainPageServices {
  getCurrentPageId(): string;
  getPreviousPageId(): string;
  requestPageChange(pageIndex: number): void;
  requestPageChangeByPageId(pageId: string): void;
  requestPageRestart(): void;
}

/** Random number generator scoped to a single brain (or VM-wide for tests). */
export interface IRngServices {
  /** Returns the next pseudo-random number in `[0, 1)`. */
  next(): number;
}

/**
 * Per-callsite host-side state cell. Used by host functions that need to
 * persist opaque payloads across ticks at a single call site (e.g. cooldown
 * timers). Lifetime is brain-instance-scoped: the cell survives page
 * deactivation / activation cycles. Use {@link clearHostState} to drop the
 * cell explicitly (e.g. from a host `onPageExited` hook).
 */
export interface ICallSiteServices {
  getHostState(callSiteId: number): unknown;
  setHostState(callSiteId: number, state: unknown): void;
  /**
   * Clear the host-state cell for `callSiteId`. After this call,
   * {@link getHostState} returns `undefined` until the next
   * {@link setHostState}. Equivalent in cost to
   * `setHostState(callSiteId, undefined)`.
   */
  clearHostState(callSiteId: number): void;
}

/**
 * Per-callsite action-state slots backing bytecode-action `LOAD_CALLSITE_VAR` /
 * `STORE_CALLSITE_VAR` reads and writes. Storage is brain-instance-scoped
 * and lazy: the slot list is allocated on first {@link setStateSlot} (or
 * first {@link ensureCallsite}), and grows on demand to cover the largest
 * `slotIdx` written so far. Reads of unwritten slots return
 * {@link NIL_VALUE} without allocating. Use {@link resetCallsite} to
 * deallocate explicitly.
 */
export interface IActionServices {
  /**
   * Mark the call site as touched, allocating an empty slot list if the
   * call site has not been touched before. Used exclusively as the
   * one-time gate for bytecode-action initializer dispatch.
   *
   * @returns `true` if the call site was newly allocated by this call,
   *   `false` if it already existed.
   */
  ensureCallsite(callSiteId: number): boolean;
  getStateSlot(callSiteId: number, slotIdx: number): Value;
  setStateSlot(callSiteId: number, slotIdx: number, value: Value): void;
  /**
   * Deallocate the call site's slot list. The next
   * {@link ensureCallsite} for this `callSiteId` returns `true` and runs
   * the action's `initializerFuncId` again. Does not touch host-state;
   * use {@link ICallSiteServices.clearHostState} for that.
   */
  resetCallsite(callSiteId: number): void;
}

/** Runtime service aggregate required by VM execution paths. */
export interface PlatformServices {
  /** Host function registry used by HOST_CALL and HOST_CALL_ASYNC dispatch. */
  functions: IFunctionRegistry;

  /** Type registry used by VM value copying and struct field access paths. */
  types: ITypeRegistry;

  /** Program-table lookups (rule resolution by funcId). */
  program: IProgramServices;

  /** Brain-level variable storage by name. */
  brainVars: IBrainVariableServices;

  /** Per-rule variable storage by (rule funcId, name). */
  ruleVars: IRuleVariableServices;

  /** Page lifecycle operations. */
  brainPages: IBrainPageServices;

  /** Random-number stream. */
  rng: IRngServices;

  /** Per-callsite host-side state cells. */
  callSite: ICallSiteServices;

  /** Per-callsite action state slots (bytecode action LOAD/STORE_CALLSITE_VAR). */
  action: IActionServices;
}
