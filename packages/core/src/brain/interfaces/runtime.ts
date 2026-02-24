import { Dict } from "../../platform/dict";
import type { List } from "../../platform/list";
import type { UniqueSet } from "../../platform/uniqueset";
import type { EventEmitterConsumer } from "../../util";
import type { TileId } from "./tiles";
import type { FunctionBytecode, Value } from "./vm";
/**
 * Extended Program interface for compiled brains. Adds rule-to-function mapping
 * and page metadata.
 */
export interface BrainProgram {
  /** Bytecode version for compatibility checking */
  version: number;

  /** All functions in the program (one per rule) */
  functions: List<FunctionBytecode>;

  /** Shared constant pool across all rules */
  constants: List<Value>;

  /** Named variable identifiers for cross-context variable access */
  variableNames: List<string>;

  /** Entry point function ID (main orchestrator, or first page's first rule) */
  entryPoint: number;

  /**
   * Mapping from rule path to function ID.
   *
   * Key format: "pageIndex/ruleIndex" or "pageIndex/ruleIndex/childIndex/..."
   * Example: "0/0" = Page 0, Rule 0; "0/0/1" = Page 0, Rule 0, Child 1
   */
  ruleIndex: Dict<string, number>;

  /**
   * Page metadata for page-switching logic. Each page entry contains the
   * function IDs of its root rules.
   */
  pages: List<PageMetadata>;
}

/**
 * A HOST_CALL / HOST_CALL_ASYNC call site recorded during compilation. Used to
 * notify host functions via onPageEntered when a page is activated.
 */
export interface HostCallSiteEntry {
  fnId: number;
  callSiteId: number;
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

  /** All HOST_CALL / HOST_CALL_ASYNC call sites in this page's rule tree */
  hostCallSites: List<HostCallSiteEntry>;

  /** Unique sensor tile IDs referenced by rules in this page */
  sensors: UniqueSet<TileId>;

  /** Unique actuator tile IDs referenced by rules in this page */
  actuators: UniqueSet<TileId>;
}

/**
 * Per-call-site state storage for host functions.
 * Keyed by call-site ID (assigned at compile time).
 * Each host function can store arbitrary state that persists across ticks.
 */
export type CallSiteStateMap = Dict<number, unknown>;

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
  getProgram(): BrainProgram | undefined;
  rng(): number; // Returns a random number between 0 and 1.
  requestPageChange(pageIndex: number): void;
  requestPageChangeByPageId(pageId: string): void;
  requestPageChangeByName(name: string): void;
  requestPageRestart(): void;
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
   * Fiber ID for the currently executing fiber.
   * Useful for debugging and logging.
   * This is set by the VM when the fiber is created.
   */
  fiberId: number;

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
   * Per-call-site state storage for host functions.
   * Each HOST_CALL instruction has a unique call-site ID assigned at compile time.
   * Host functions can use this to persist state across ticks (e.g., cooldown timestamps).
   *
   * Initialized lazily on first use. Use getCallSiteState/setCallSiteState helpers.
   */
  callSiteState?: CallSiteStateMap;

  /**
   * Current call-site ID being executed.
   * Set by the VM before invoking a host function via HOST_CALL/HOST_CALL_ASYNC.
   * Host functions can use this with callSiteState to access per-call-site data.
   */
  currentCallSiteId?: number;

  /**
   * The BrainRule currently being executed. This provides access to rule-specific state
   * and metadata. It is set by the VM before each HOST_CALL using the funcIdToRule mapping.
   */
  rule?: IBrainRule;

  /**
   * Mapping from function ID to the IBrainRule that was compiled into that function.
   * Set by the Brain during initialization. Used by the VM to resolve ctx.rule
   * before HOST_CALL instructions, based on the current frame's funcId.
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

// ============================================================================
// Call-Site State Helper Functions
// ============================================================================

/**
 * Get the per-call-site state for the current HOST_CALL.
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
  const callSiteId = ctx.currentCallSiteId;
  if (callSiteId === undefined || !ctx.callSiteState) {
    return undefined;
  }
  if (!ctx.callSiteState.has(callSiteId)) {
    return undefined;
  }
  return ctx.callSiteState.get(callSiteId) as T;
}

/**
 * Set the per-call-site state for the current HOST_CALL.
 * This allows host functions to persist state across ticks.
 *
 * @param ctx - The execution context
 * @param state - The state object to store
 */
export function setCallSiteState<T>(ctx: ExecutionContext, state: T): void {
  const callSiteId = ctx.currentCallSiteId;
  if (callSiteId === undefined) {
    return;
  }

  // Lazy initialization of callSiteState map
  if (!ctx.callSiteState) {
    ctx.callSiteState = new Dict<number, unknown>();
  }

  ctx.callSiteState.set(callSiteId, state);
}
