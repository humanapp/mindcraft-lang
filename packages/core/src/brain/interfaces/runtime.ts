import { Dict } from "../../platform/dict";
import { List, type ReadonlyList } from "../../platform/list";
import type { UniqueSet } from "../../platform/uniqueset";
import type { EventEmitterConsumer } from "../../util";
import type { ITileCatalog } from "./catalog";
import type { ActionDescriptor, ActionKey, ActionKind, BrainActionCallDef } from "./functions";
import type { TileId } from "./tiles";
import type { TypeId } from "./type-system";
import type { HandleId, MapValue, Program, Value } from "./vm";
import { NIL_VALUE } from "./vm";

export interface ActionRef {
  slot: number;
  key: ActionKey;
}

export interface ActionCallSiteEntry {
  actionSlot: number;
  callSiteId: number;
}

/**
 * Extended Program interface for compiled brains. Adds rule-to-function mapping
 * and page metadata.
 */
export interface UnlinkedBrainProgram extends Program {
  /**
   * Mapping from rule path to function ID.
   *
   * Key format: "pageIndex/ruleIndex" or "pageIndex/ruleIndex/childIndex/..."
   * Example: "0/0" = Page 0, Rule 0; "0/0/1" = Page 0, Rule 0, Child 1
   */
  ruleIndex: Dict<string, number>;

  /**
   * Program-local action slots referenced by ACTION_CALL instructions.
   */
  actionRefs: List<ActionRef>;

  /**
   * Page metadata for page-switching logic. Each page entry contains the
   * function IDs of its root rules.
   */
  pages: List<PageMetadata>;
}

export type BrainProgram = UnlinkedBrainProgram;

export interface HostActionBinding {
  binding: "host";
  descriptor: ActionDescriptor;
  onPageEntered?: (ctx: ExecutionContext) => void;
  execSync?: (ctx: ExecutionContext, args: MapValue) => Value;
  execAsync?: (ctx: ExecutionContext, args: MapValue, handleId: HandleId) => void;
}

export interface UserActionArtifact extends Program {
  key: ActionKey;
  kind: ActionKind;
  callDef: BrainActionCallDef;
  outputType?: TypeId;
  isAsync: boolean;
  numStateSlots: number;
  entryFuncId: number;
  activationFuncId?: number;
  revisionId: string;
}

export interface BytecodeResolvedAction {
  binding: "bytecode";
  descriptor: ActionDescriptor;
  artifact: UserActionArtifact;
}

export type ResolvedAction = HostActionBinding | BytecodeResolvedAction;

export interface BytecodeExecutableAction {
  binding: "bytecode";
  descriptor: ActionDescriptor;
  entryFuncId: number;
  activationFuncId?: number;
  numStateSlots: number;
}

export type ExecutableAction = HostActionBinding | BytecodeExecutableAction;

export interface ExecutableBrainProgram extends Program {
  ruleIndex: Dict<string, number>;
  pages: List<PageMetadata>;
  actions: List<ExecutableAction>;
}

export interface BrainActionResolver {
  resolveAction(descriptor: ActionDescriptor): ResolvedAction | undefined;
}

export interface IBrainActionRegistry extends BrainActionResolver {
  register(action: ResolvedAction): ResolvedAction;
  getByKey(key: ActionKey): ResolvedAction | undefined;
  size(): number;
}

export interface BrainLinkEnvironment {
  catalogs: ReadonlyList<ITileCatalog>;
  actionResolver: BrainActionResolver;
}

export interface PageMetadata {
  /** Page index in the brain */
  pageIndex: number;

  /** Stable page identifier (UUID), persists across renames */
  pageId: string;

  /** Page name for debugging */
  pageName: string;

  /** Function IDs of root-level rules in this page (in order) */
  rootRuleFuncIds: List<number>;

  /** All ACTION_CALL / ACTION_CALL_ASYNC call sites in this page's rule tree */
  actionCallSites: List<ActionCallSiteEntry>;

  /** Unique sensor tile IDs referenced by rules in this page */
  sensors: UniqueSet<TileId>;

  /** Unique actuator tile IDs referenced by rules in this page */
  actuators: UniqueSet<TileId>;
}

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

export type ActionInstanceMap = Dict<number, ActionInstance>;
export type CallSiteStateMap = ActionInstanceMap;

export type BrainEvents = {
  page_activated: { pageIndex: number };
  page_deactivated: { pageIndex: number };
  //  variable_changed: { varId: string; oldValue: Value | undefined; newValue: Value };
};

export interface IBrain {
  events(): EventEmitterConsumer<BrainEvents>;
  getVariable(varId: string): Value | undefined;
  setVariable(varId: string, value: Value): void;
  clearVariable(varId: string): void;
  clearVariables(): void;

  /**
   * Initialize the brain and set context data. Must be called before startup().
   *
   * @param contextData - Application-specific data to attach to the brain's execution context
     (e.g., game entity, DOM context). This will be available to all host functions via ctx.data.
   */
  initialize(contextData?: unknown): void;
  startup(): void;
  shutdown(): void;
  think(currentTime: number): void;
  getProgram(): ExecutableBrainProgram | undefined;
  getCompiledProgram(): UnlinkedBrainProgram | undefined;
  rng(): number; // Returns a random number between 0 and 1.
  requestPageChange(pageIndex: number): void;
  requestPageChangeByPageId(pageId: string): void;
  requestPageChangeByName(name: string): void;
  requestPageRestart(): void;
  getCurrentPageId(): string;
  getPreviousPageId(): string;
}

export interface IBrainPage {
  brain(): IBrain;
}

export interface IBrainRule {
  page(): IBrainPage;
  ancestor(): IBrainRule | undefined;
  getVariable<T extends Value>(varName: string): T | undefined;
  setVariable(varName: string, value: Value): void;
  clearVariable(varName: string): void;
  clearVariables(): void;
  children(): List<IBrainRule>;
}

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
   * Resolve a named variable through the resolution chain.
   * This is used for cross-context variable access.
   *
   * Resolution order:
   * 1. Local scope (getVariable)
   * 2. Shared scope (if exists)
   * 3. Parent context chain (if exists)
   * 4. Returns nil if not found
   *
   * @param name - Variable name to resolve
   * @returns The variable's value, or undefined if not found
   */
  resolveVariable?(name: string): Value | undefined;

  /**
   * Set a resolved variable through the resolution chain.
   * If the variable exists in any scope, updates it there.
   * Otherwise, creates it in the current context.
   *
   * @param name - Variable name to set
   * @param value - The value to store
   * @returns true if successful, false otherwise
   */
  setResolvedVariable?(name: string, value: Value): boolean;

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

  const actionInstance: ActionInstance = {
    callSiteId,
    stateSlots: createActionStateSlots(numStateSlots),
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
