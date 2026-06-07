import type { ReadonlyList } from "../platform/list";
import type { ActionDescriptor } from "./function-defs";
import type { PlatformServices } from "./services";
import type { HandleId, Value } from "./value";

/** Action binding implemented by a host (sync or async) function. */
export interface HostActionBinding {
  binding: "host";
  descriptor: ActionDescriptor;
  /**
   * Stable numeric id assigned by the brain action registry when the binding
   * is registered. Dense and in registration order across the registry's host
   * actions; used by `HOST_ACTION_CALL` / `HOST_ACTION_CALL_ASYNC` dispatch via
   * the registry's `getById`. `undefined` until the binding has been
   * registered.
   */
  id?: number;
  /**
   * Invoked exactly once per `(brainInstance, callSiteId)`, on the first
   * activation that allocates the call site, before {@link onPageEntered}
   * fires for the same activation. Symmetric to the bytecode
   * {@link BytecodeExecutableAction.initializerFuncId} hook. Cleared by
   * `services.callsite.reset(callSiteId)` (re-runs on the next activation)
   * and by `Brain.shutdown()` (re-runs on the next `Brain.startup()`).
   * Soft `requestPageRestart` does not re-fire this hook.
   */
  onInitialized?: (ctx: ExecutionContext) => void;
  /**
   * Invoked every time the action's owning page is activated, with the
   * action's call site bound on `ctx.currentCallSiteId`. Symmetric to
   * {@link onPageExited}.
   */
  onPageEntered?: (ctx: ExecutionContext) => void;
  /**
   * Invoked every time the action's owning page is deactivated, before the
   * page's fibers are cancelled. Runs with `ctx.currentCallSiteId` bound to
   * the action's call site so the hook can inspect or clear per-call-site
   * host state via `ctx.services.brain.callsite.getHostState` /
   * `setHostState` / `clearHostState`.
   */
  onPageExited?: (ctx: ExecutionContext) => void;
  execSync?: (ctx: ExecutionContext, args: ReadonlyList<Value>) => Value;
  execAsync?: (ctx: ExecutionContext, args: ReadonlyList<Value>, handleId: HandleId) => void;
}

/**
 * Bytecode-backed action ready for VM execution.
 *
 * `entryFuncId` is the action body invoked on every `ACTION_CALL` /
 * `ACTION_CALL_ASYNC`. The three lifecycle hooks below are independent and
 * may all be set, all be unset, or any combination. Each is `undefined`
 * when the action has no hook for that lifetime stage; numeric `0` is a
 * real `funcId`, so `undefined` is the only "no hook" sentinel.
 */
export interface BytecodeExecutableAction {
  binding: "bytecode";
  descriptor: ActionDescriptor;
  entryFuncId: number;
  /**
   * Runs exactly once per `(brainInstance, callSiteId)`, on the first
   * allocation of the call site (or after an explicit
   * `services.callsite.reset`). Backs module-scope `let` / `const`
   * initializer emission for user-language actions.
   */
  initializerFuncId?: number;
  /**
   * Runs every time the action's owning page is activated, after
   * {@link initializerFuncId} on the first activation that allocates the
   * call site. Symmetric to the host {@link HostActionBinding.onPageEntered}
   * hook.
   */
  activationFuncId?: number;
  /**
   * Runs every time the action's owning page is deactivated, before the
   * page's fibers are cancelled. Symmetric to the host
   * {@link HostActionBinding.onPageExited} hook.
   */
  deactivationFuncId?: number;
  numStateSlots: number;
}

/**
 * Execution context passed to host functions and bytecode dispatch paths.
 *
 * Provides id-keyed and slot-indexed access to per-tick scalar anchors
 * (`time`, `dt`, `currentTick`), the currently-executing call site / rule,
 * and program-global variable slot storage. All other state previously
 * reachable as object references (brain, rule, action instance, callsite
 * map) lives behind {@link PlatformServices} ops on `services`.
 *
 * Apps may extend this interface (e.g. sim's `ActorExecutionContext`) to
 * carry app-specific payloads through the `data` field; the base shape
 * stays portable across constrained-target VM implementations.
 */
export interface ExecutionContext {
  /**
   * Per-VM service aggregate exposing program-table lookups, brain/rule
   * variable storage, page lifecycle, RNG, and per-callsite state
   * (slots and host-owned cell). Host functions reach into runtime
   * services through this field.
   */
  services: PlatformServices;

  /**
   * Read a variable by its compiler-assigned slot index. The slot index is
   * the operand of `LOAD_VAR_SLOT` and corresponds to a position in the
   * loaded program's `variableNames` list. Returns the slot's current value,
   * or `NIL_VALUE` if the slot has never been written.
   *
   * @param slotId - Slot index assigned by the compiler
   */
  getVariableBySlot(slotId: number): Value;

  /**
   * Write a variable by its compiler-assigned slot index. The slot index is
   * the operand of `STORE_VAR_SLOT` and corresponds to a position in the
   * loaded program's `variableNames` list.
   *
   * @param slotId - Slot index assigned by the compiler
   * @param value - The value to store
   */
  setVariableBySlot(slotId: number, value: Value): void;

  /**
   * Optional application-specific data attached to the execution context.
   * Allows host functions (sensors, actuators) to reach environment-specific
   * state without coupling the core VM to application-specific types.
   *
   * Type is `unknown` to maintain cross-platform compatibility; consumers
   * use type guards or assertions when accessing this field.
   */
  data?: unknown;

  /**
   * Current call-site ID being executed.
   * Set by the VM before invoking a host function via HOST_CALL/HOST_CALL_ASYNC
   * or a host-backed action via ACTION_CALL/ACTION_CALL_ASYNC.
   * Host functions can use this with {@link PlatformServices.callsite} to
   * access per-call-site host state.
   */
  currentCallSiteId?: number;

  /**
   * The funcId of the rule currently being executed, or `undefined` when
   * execution is not inside any rule. Set by the VM before host or action
   * calls based on the current frame's `ruleFuncId`. Resolve associated
   * metadata via {@link PlatformServices.program.getRuleFuncIdForFunc}.
   */
  currentRuleFuncId?: number;

  /** Current time in milliseconds since epoch. Updated before each think() call. */
  time: number;

  /** Delta time in milliseconds since the last tick. Updated before each think() call. */
  dt: number;

  /** Current tick number. Incremented on each think() call. */
  currentTick: number;
}

// ============================================================================
// Rule Variable Helper Functions
// ============================================================================

/**
 * Read a rule-scoped variable by name from the rule currently being executed.
 * Returns `NIL_VALUE` when execution is not inside any rule (i.e.
 * {@link ExecutionContext.currentRuleFuncId} is `undefined`) or when the
 * named variable has never been written.
 *
 * The optional type parameter `T` narrows the return type for callers that
 * know the expected `Value` shape; the runtime does not validate the cast,
 * so callers must guard against `NIL_VALUE` when reads can be absent.
 *
 * @param ctx - The execution context
 * @param name - The variable name as authored on the rule
 */
export function getRuleVariable<T extends Value = Value>(ctx: ExecutionContext, name: string): T {
  return ctx.services.brain.ruleVars.getByName(ctx.currentRuleFuncId, name) as T;
}

/**
 * Write a rule-scoped variable by name on the rule currently being executed.
 * No-op when execution is not inside any rule (i.e.
 * {@link ExecutionContext.currentRuleFuncId} is `undefined`).
 *
 * @param ctx - The execution context
 * @param name - The variable name as authored on the rule
 * @param value - The value to store
 */
export function setRuleVariable(ctx: ExecutionContext, name: string, value: Value): void {
  ctx.services.brain.ruleVars.setByName(ctx.currentRuleFuncId, name, value);
}

// ============================================================================
// Call-Site Host State Helper Functions
// ============================================================================

/**
 * Read the host-owned state attached to the current call site, or
 * `undefined` if no state has been written. The call site is taken from
 * {@link ExecutionContext.currentCallSiteId}, which the VM binds before
 * dispatching to a host function via `HOST_CALL` / `HOST_CALL_ASYNC` /
 * `ACTION_CALL` / `ACTION_CALL_ASYNC`.
 *
 * The optional type parameter `T` narrows the return type for callers that
 * know the stored shape; the runtime does not validate the cast.
 *
 * Throws when invoked outside a host-call dispatch (i.e.
 * `currentCallSiteId` is `undefined`).
 *
 * @param ctx - The execution context
 */
export function getCallSiteState<T>(ctx: ExecutionContext): T | undefined {
  return ctx.services.brain.callsite.getHostState(ctx.currentCallSiteId!) as T | undefined;
}

/**
 * Write the host-owned state attached to the current call site. The state
 * persists for the lifetime of the brain instance and survives page
 * deactivation/reactivation. Use {@link clearCallSiteState} from an
 * `onPageExited` hook to opt out of survival.
 *
 * Throws when invoked outside a host-call dispatch (i.e.
 * `currentCallSiteId` is `undefined`).
 *
 * @param ctx - The execution context
 * @param value - The host-owned state to store
 */
export function setCallSiteState(ctx: ExecutionContext, value: unknown): void {
  ctx.services.brain.callsite.setHostState(ctx.currentCallSiteId!, value);
}

/**
 * Drop the host-owned state attached to the current call site. Subsequent
 * {@link getCallSiteState} calls return `undefined` until the next
 * {@link setCallSiteState}.
 *
 * Throws when invoked outside a host-call dispatch (i.e.
 * `currentCallSiteId` is `undefined`).
 *
 * @param ctx - The execution context
 */
export function clearCallSiteState(ctx: ExecutionContext): void {
  ctx.services.brain.callsite.clearHostState(ctx.currentCallSiteId!);
}
