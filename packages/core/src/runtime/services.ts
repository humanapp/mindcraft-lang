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
 * Per-callsite runtime state, keyed by `callSiteId`.
 *
 * Each callsite carries two distinct kinds of state, both
 * brain-instance-scoped:
 *
 * - **Slots:** a typed pad of {@link Value} slots indexed by `slotIdx`,
 *   backing the bytecode `LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR`
 *   opcodes that implement compiled-action local state. The slot list is
 *   allocated empty on first touch and grows on demand to cover the
 *   largest `slotIdx` ever written; reads of unwritten slots return
 *   {@link NIL_VALUE} without allocating.
 * - **Host state:** a single opaque cell of type `unknown`, used by host
 *   sensors and actuators (e.g. cooldown timers, consumption windows) to
 *   persist private payloads across ticks at one call site.
 *
 * Both kinds share a single per-callsite record. The first {@link setSlot},
 * {@link setHostState}, or {@link ensure} for a `callSiteId` allocates the
 * record; {@link reset} drops both. {@link clearHostState} drops only the
 * host-state cell and leaves any slot list intact.
 *
 * Lifetime is brain-instance-scoped: callsite records survive page
 * deactivation / activation cycles and are dropped en masse on
 * `Brain.shutdown()`.
 */
export interface ICallsiteServices {
  /**
   * Mark the call site as touched, allocating an empty record if the
   * call site has not been touched before. Used as the one-time gate
   * for bytecode-action initializer dispatch.
   *
   * @returns `true` if the call site was newly allocated by this call,
   *   `false` if it already existed.
   */
  ensure(callSiteId: number): boolean;

  /**
   * Drop the call site's record (slot list and host-state cell). The
   * next {@link ensure} for this `callSiteId` returns `true`, which
   * Brain uses to re-run a bytecode action's `initializerFuncId`.
   */
  reset(callSiteId: number): void;

  /**
   * Read state slot `slotIdx` at `callSiteId`. Returns {@link NIL_VALUE}
   * when the call site has not been allocated or the slot has not been
   * written.
   */
  getSlot(callSiteId: number, slotIdx: number): Value;

  /**
   * Write `value` to state slot `slotIdx` at `callSiteId`. Allocates
   * the call-site record if absent; grows the slot list as needed.
   */
  setSlot(callSiteId: number, slotIdx: number, value: Value): void;

  /**
   * Read the host-owned opaque cell at `callSiteId`. Returns
   * `undefined` when the call site has not been allocated or the cell
   * has not been written.
   */
  getHostState(callSiteId: number): unknown;

  /**
   * Write the host-owned opaque cell at `callSiteId`. Allocates the
   * call-site record if absent.
   */
  setHostState(callSiteId: number, state: unknown): void;

  /**
   * Drop the host-owned cell at `callSiteId` while leaving any
   * allocated slot list intact. After this call, {@link getHostState}
   * returns `undefined` until the next {@link setHostState}.
   */
  clearHostState(callSiteId: number): void;
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

  /**
   * Per-callsite state: bytecode-addressable typed slots
   * (`LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR`) and a host-owned
   * opaque cell. Both share a per-callsite record and lifetime.
   */
  callsite: ICallsiteServices;
}
