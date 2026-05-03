import { Dict } from "../platform/dict";
import { List, type ReadonlyList } from "../platform/list";
import type { ActionDescriptor } from "./function-defs";
import type { IBrain, IBrainRule } from "./host-bindings";
import { type HandleId, NIL_VALUE, type Value } from "./value";

/** Action binding implemented by a host (sync or async) function. */
export interface HostActionBinding {
  binding: "host";
  descriptor: ActionDescriptor;
  onPageEntered?: (ctx: ExecutionContext) => void;
  execSync?: (ctx: ExecutionContext, args: ReadonlyList<Value>) => Value;
  execAsync?: (ctx: ExecutionContext, args: ReadonlyList<Value>, handleId: HandleId) => void;
}

/** Bytecode-backed action ready for VM execution: entry function id and state-slot count. */
export interface BytecodeExecutableAction {
  binding: "bytecode";
  descriptor: ActionDescriptor;
  entryFuncId: number;
  activationFuncId?: number;
  numStateSlots: number;
}

/** Tagged-union of executable action bindings: host function or executable bytecode. */
export type ExecutableAction = HostActionBinding | BytecodeExecutableAction;

/**
 * Page-activation-scoped action-instance state.
 *
 * Bytecode-backed actions use `stateSlots` for LOAD_CALLSITE_VAR /
 * STORE_CALLSITE_VAR. Host-backed actions store their opaque persistent payload
 * in `hostState` via getCallSiteState()/setCallSiteState().
 */
export interface ActionInstance {
  callSiteId: number;
  stateSlots: List<Value>;
  hostState?: unknown;
}

/** Maps `callSiteId` to its persistent {@link ActionInstance} for an active page. */
export type ActionInstanceMap = Dict<number, ActionInstance>;
/** Alias for {@link ActionInstanceMap}, used in call-site state contexts. */
export type CallSiteStateMap = ActionInstanceMap;

/**
 * Execution context passed to host functions.
 *
 * This context provides access to:
 * - The BrainRule being executed (for accessing runtime state)
 * - Variable storage (via the rule's Brain)
 * - Fiber scheduler (for spawning new fibers)
 * - Other execution state
 *
 * The execution context is the bridge between the VM's execution
 * and the brain's runtime state, enabling host functions to:
 * - Read/write variables at the Brain level
 * - Access rule-specific state
 * - Spawn child fibers
 * - Query execution metadata
 */
export interface ExecutionContext {
  /**
   * The brain hosting this execution context.
   */
  brain: IBrain;

  /**
   * Get a variable value from the Brain's variable storage.
   * Variables are identified by their unique ID (not by name).
   *
   * @param varId - Unique identifier for the variable
   * @returns The variable's current value, or undefined if not found
   */
  getVariable<T extends Value>(varId: string): T | undefined;

  /**
   * Set a variable value in the Brain's variable storage.
   * Variables are identified by their unique ID (not by name).
   *
   * @param varId - Unique identifier for the variable
   * @param value - The value to store
   */
  setVariable(varId: string, value: Value): void;

  /**
   * Clear a variable from the Brain's variable storage.
   * @param varId - Unique identifier for the variable
   */
  clearVariable(varId: string): void;

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
   * Optional application-specific data that can be attached to the execution context.
   * This allows host functions (sensors, actuators) to access environment-specific state
   * without coupling the core VM to application-specific types.
   *
   * Example use cases:
   * - Game: Actor/Entity reference for movement, collision detection
   * - Web: DOM elements, browser APIs
   * - Server: Request context, database connections
   *
   * Type is unknown to maintain cross-platform compatibility.
   * Applications should use type guards or assertions when accessing this field.
   */
  data?: unknown;

  /**
   * Page-activation-scoped action-instance storage keyed by action call-site ID.
   * Runtime code binds the current action instance through `currentActionInstance`.
   */
  callSiteState?: CallSiteStateMap;

  /**
   * The currently bound action instance for host-backed action execution or the
   * current bytecode action frame chain.
   */
  currentActionInstance?: ActionInstance;

  /**
   * Current call-site ID being executed.
   * Set by the VM before invoking a host function via HOST_CALL/HOST_CALL_ASYNC
   * or a host-backed action via ACTION_CALL/ACTION_CALL_ASYNC.
   * Host functions can use this with callSiteState to access per-call-site data.
   */
  currentCallSiteId?: number;

  /**
   * The BrainRule currently being executed. This provides access to rule-specific state
   * and metadata. It is set by the VM before host-backed host or action calls using
   * the funcIdToRule mapping.
   */
  rule?: IBrainRule;

  /**
   * Mapping from function ID to the IBrainRule that was compiled into that function.
   * Set by the Brain during initialization. Used by the VM to resolve ctx.rule
   * before host-backed host or action calls, based on the current frame's funcId.
   */
  funcIdToRule?: Dict<number, IBrainRule>;

  /**
   * Current time in milliseconds since epoch. Updated before each think() call.
   */
  time: number;

  /**
   * Delta time in milliseconds since the last tick. Updated before each think() call.
   */
  dt: number;

  /**
   * Current tick number. Incremented on each think() call.
   */
  currentTick: number;
}

function createActionStateSlots(numStateSlots: number): List<Value> {
  const stateSlots = List.empty<Value>();
  for (let i = 0; i < numStateSlots; i++) {
    stateSlots.push(NIL_VALUE);
  }
  return stateSlots;
}

function isActionInstance(value: unknown): value is ActionInstance {
  if (!value) {
    return false;
  }

  const maybeActionInstance = value as Partial<ActionInstance>;
  return maybeActionInstance.callSiteId !== undefined && maybeActionInstance.stateSlots !== undefined;
}

export function getActionInstance(ctx: ExecutionContext, callSiteId: number): ActionInstance | undefined {
  const rawValue = ctx.callSiteState?.get(callSiteId) as unknown;
  if (rawValue === undefined) {
    return undefined;
  }

  if (isActionInstance(rawValue)) {
    return rawValue;
  }

  const actionInstance: ActionInstance = {
    callSiteId,
    stateSlots: List.empty<Value>(),
    hostState: rawValue,
  };
  ctx.callSiteState!.set(callSiteId, actionInstance);
  return actionInstance;
}

export function getOrCreateActionInstance(
  ctx: ExecutionContext,
  callSiteId: number,
  numStateSlots: number
): ActionInstance {
  if (!ctx.callSiteState) {
    ctx.callSiteState = new Dict<number, ActionInstance>();
  }

  const existing = getActionInstance(ctx, callSiteId);
  if (existing) {
    return existing;
  }

  const actionInstance: ActionInstance = {
    callSiteId,
    stateSlots: createActionStateSlots(numStateSlots),
  };
  ctx.callSiteState.set(callSiteId, actionInstance);
  return actionInstance;
}

export function resetActionInstance(ctx: ExecutionContext, callSiteId: number, numStateSlots: number): ActionInstance {
  if (!ctx.callSiteState) {
    ctx.callSiteState = new Dict<number, ActionInstance>();
  }

  const existingHostState = getActionInstance(ctx, callSiteId)?.hostState;
  const actionInstance: ActionInstance = {
    callSiteId,
    stateSlots: createActionStateSlots(numStateSlots),
    ...(existingHostState !== undefined ? { hostState: existingHostState } : {}),
  };
  ctx.callSiteState.set(callSiteId, actionInstance);

  if (ctx.currentCallSiteId === callSiteId) {
    ctx.currentActionInstance = actionInstance;
  }

  return actionInstance;
}

// ============================================================================
// Call-Site State Helper Functions
// ============================================================================

/**
 * Get the per-call-site state for the current host-backed call.
 * This allows host functions to persist state across ticks.
 *
 * @param ctx - The execution context
 * @returns The state object for this call site, or undefined if not set
 *
 * @example
 * ```typescript
 * interface MoveState { lastMoveTime: number; }
 *
 * function fnMove(ctx: ExecutionContext, args: List<Value>): Value {
 *   const state = getCallSiteState<MoveState>(ctx);
 *   const now = getCurrentTime();
 *
 *   if (state && now - state.lastMoveTime < COOLDOWN) {
 *     return FALSE_VALUE; // Still on cooldown
 *   }
 *
 *   // Perform move...
 *   setCallSiteState(ctx, { lastMoveTime: now });
 *   return TRUE_VALUE;
 * }
 * ```
 */
export function getCallSiteState<T>(ctx: ExecutionContext): T | undefined {
  const actionInstance =
    ctx.currentActionInstance ??
    (ctx.currentCallSiteId !== undefined ? getActionInstance(ctx, ctx.currentCallSiteId) : undefined);
  if (!actionInstance) {
    return undefined;
  }
  return actionInstance.hostState as T | undefined;
}

/**
 * Set the per-call-site state for the current host-backed call.
 * This allows host functions to persist state across ticks.
 *
 * @param ctx - The execution context
 * @param state - The state object to store
 */
export function setCallSiteState<T>(ctx: ExecutionContext, state: T): void {
  let actionInstance = ctx.currentActionInstance;
  if (!actionInstance) {
    const callSiteId = ctx.currentCallSiteId;
    if (callSiteId === undefined) {
      return;
    }

    actionInstance = getOrCreateActionInstance(ctx, callSiteId, 0);
    ctx.currentActionInstance = actionInstance;
  }

  actionInstance.hostState = state;
}
