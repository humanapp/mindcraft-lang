import { Dict } from "../platform/dict";
import { Error } from "../platform/error";
import { EventEmitter } from "../platform/event-emitter";
import type { List, ReadonlyList } from "../platform/list";
import { Time } from "../platform/time";
import { UniqueSet } from "../platform/uniqueset";
import type { ActionInstance, ExecutionContext } from "./context";
import { ErrorCode, type ErrorValue, type HandleId, type StructValue, type Value } from "./value";

///////////////////////////
// Capacity-violation signaling
///////////////////////////

/**
 * Thrown by VM-side capacity checks (operand stack push, frame stack push,
 * handler stack push, handle table allocation, fiber pool allocation) when
 * a configured limit would be exceeded. Caught by the VM dispatch loop and
 * converted into an `ErrorCode.StackOverflow` fault on the offending fiber.
 *
 * Hosts that invoke `HandleTable.createPending` or
 * `FiberScheduler.spawn` / `addFiber` directly may receive this thrown
 * value; detect it with {@link isOverflowError}.
 */
export class OverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OverflowError";
  }
}

/**
 * Thrown by VM-side underflow checks (operand stack `pop` / `peek` on an
 * empty stack). Caught by the VM dispatch loop and converted into an
 * `ErrorCode.StackUnderflow` fault on the offending fiber.
 */
export class UnderflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnderflowError";
  }
}

/**
 * Throw an {@link OverflowError}. Always surfaces as
 * `ErrorCode.StackOverflow` at the VM dispatch boundary.
 */
export function throwOverflow(message: string): never {
  throw new OverflowError(message);
}

/**
 * Throw an {@link UnderflowError}. Always surfaces as
 * `ErrorCode.StackUnderflow` at the VM dispatch boundary.
 */
export function throwUnderflow(message: string): never {
  throw new UnderflowError(message);
}

/** True if `e` is an {@link OverflowError}. */
export function isOverflowError(e: unknown): e is OverflowError {
  return e instanceof OverflowError;
}

/** True if `e` is an {@link UnderflowError}. */
export function isUnderflowError(e: unknown): e is UnderflowError {
  return e instanceof UnderflowError;
}

///////////////////////////
// Configuration & Limits
///////////////////////////

/** VM tunables: stack/frame/handle/fiber limits and per-tick instruction budget. */
export interface VmConfig {
  /** Maximum number of frames per fiber (recursion limit) */
  maxFrameDepth: number;
  /** Maximum operand stack size per fiber */
  maxStackSize: number;
  /** Maximum number of handlers per fiber */
  maxHandlers: number;
  /** Maximum number of pending handles */
  maxHandles: number;
  /** Default instruction budget per fiber execution */
  defaultBudget: number;
  /** Enable debug mode: validates stack depth after function calls, warns on potential leaks */
  debugStackChecks?: boolean;
}

///////////////////////////
// Host Function Interface
///////////////////////////

/**
 * Synchronous host function signature.
 *
 * `args` is a positional read-only view (`Sublist`) over the operand
 * stack of size `callDef.argSlots.size()`. Read by `slotId` --
 * `args.get(getSlotId(callDef, ...))` -- not by name. Unsupplied
 * slots are filled with `NIL_VALUE`; check via `isNilValue`.
 *
 * **Lifetime:** the wrapper is ephemeral. Do not retain `args` past
 * the call. Read what you need into locals and return. Individual
 * `Value` heap objects returned by `args.get(i)` are safe to retain.
 *
 * @param ctx - Execution context providing access to variables, rule, etc.
 * @param args - Positional view of arguments, indexed by slotId.
 * @returns The result value to push onto the stack
 */
export type HostSyncFn = {
  onPageEntered?: (ctx: ExecutionContext) => void;
  exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => Value;
};

/**
 * Asynchronous host function signature.
 *
 * `args` is an owned positional snapshot (a freshly-allocated
 * `List<Value>`) of size `callDef.argSlots.size()`. Read by `slotId`
 * -- `args.get(getSlotId(callDef, ...))` -- not by name. Unsupplied
 * slots are filled with `NIL_VALUE`; check via `isNilValue`.
 *
 * **Lifetime:** the wrapper is owned. Free to retain `args` and
 * close over individual values across the async boundary; resolve or
 * reject the handle whenever the async work completes.
 *
 * @param ctx - Execution context providing access to variables, rule, etc.
 * @param args - Positional snapshot of arguments, indexed by slotId.
 * @param handleId - Handle ID for resolving the async operation
 */
export type HostAsyncFn = {
  onPageEntered?: (ctx: ExecutionContext) => void;
  exec: (ctx: ExecutionContext, args: ReadonlyList<Value>, handleId: HandleId) => void;
};

/**
 * Field getter function for native-backed struct types.
 * Called by GET_FIELD when a StructTypeDef has a fieldGetter registered.
 * The source is the StructValue; ctx provides the execution context for resolver-based natives.
 */
export type StructFieldGetterFn = (source: StructValue, fieldName: string, ctx: ExecutionContext) => Value | undefined;

/**
 * Field setter function for native-backed struct types.
 * Called by SET_FIELD when a StructTypeDef has a fieldSetter registered.
 * Returns true if the field was successfully set.
 */
export type StructFieldSetterFn = (
  source: StructValue,
  fieldName: string,
  value: Value,
  ctx: ExecutionContext
) => boolean;

/**
 * Snapshot function for native-backed struct types.
 * Called during deep-copy (assignment) to materialize a lazy `native` handle.
 * Receives the source StructValue and the current ExecutionContext.
 * Returns the resolved native value to store in the copied struct.
 */
export type StructSnapshotNativeFn = (source: StructValue, ctx: ExecutionContext) => unknown;

/** Tagged-union of host function bindings: synchronous or asynchronous. */
export type HostFn = HostSyncFn | HostAsyncFn;

///////////////////////////
// VM Execution Results
///////////////////////////

/** Status of a single fiber-execution slice. */
export enum VmStatus {
  DONE = "DONE",
  YIELDED = "YIELDED",
  WAITING = "WAITING",
  FAULT = "FAULT",
}

/** Result of running a fiber: completed, voluntarily yielded, blocked on a handle, or faulted. */
export type VmRunResult =
  | { status: VmStatus.DONE; result?: Value }
  | { status: VmStatus.YIELDED }
  | { status: VmStatus.WAITING; handleId: HandleId }
  | { status: VmStatus.FAULT; error: ErrorValue };

///////////////////////////
// Fiber State Machine
///////////////////////////

/** Lifecycle states of a {@link Fiber}. */
export enum FiberState {
  RUNNABLE = "RUNNABLE",
  WAITING = "WAITING",
  DONE = "DONE",
  FAULT = "FAULT",
  CANCELLED = "CANCELLED",
}

/** Per-frame binding describing the action and call-site whose state slots back this frame. */
export interface ActionFrameBinding {
  actionKey: string;
  callSiteId: number;
  isAsync: boolean;
  actionInstance: ActionInstance;
}

/** Single call frame on a fiber's frame stack. */
export interface Frame {
  funcId: number;
  pc: number;
  base: number;
  locals: List<Value>;
  captures?: List<Value>;
  ruleFuncId?: number;
  actionBinding?: ActionFrameBinding;
}

/** Active try/catch handler installed by `TRY` and removed by `END_TRY`. */
export interface Handler {
  catchPc: number;
  stackHeight: number;
  frameDepth: number;
}

/** State recorded when a fiber blocks on a handle, used to resume execution. */
export interface AwaitSite {
  resumePc: number;
  stackHeight: number;
  frameDepth: number;
  handleId: HandleId;
}

/** A single VM execution thread: stacks, frames, handlers, and execution context. */
export interface Fiber {
  id: number;
  state: FiberState;
  vstack: List<Value>;
  frames: List<Frame>;
  handlers: List<Handler>;
  await?: AwaitSite;
  lastError?: ErrorValue;
  pendingInjectedThrow?: boolean;
  instrBudget: number;
  createdAt: number;
  lastRunAt: number;
  /**
   * Execution context for this fiber.
   * Provides access to the rule, variables, and other execution state.
   */
  executionContext: ExecutionContext;
  /**
   * Legacy direct state-slot seeding path for wrapper-oriented runtime/tests.
   * Core action dispatch binds state through action frames instead.
   */
  callsiteVars?: List<Value>;
  asyncResultHandleId?: HandleId;
}

///////////////////////////
// Async Handle Management
///////////////////////////

/** Lifecycle states of an async {@link Handle}. */
export enum HandleState {
  PENDING = "PENDING",
  RESOLVED = "RESOLVED",
  REJECTED = "REJECTED",
  CANCELLED = "CANCELLED",
}

/** Async operation handle: state, result/error, and the set of waiting fibers. */
export interface Handle {
  id: HandleId;
  state: HandleState;
  result?: Value;
  error?: ErrorValue;
  waiters: UniqueSet<number>;
  createdAt: number;
}

/** Events emitted by a {@link HandleTable}. */
export type HandleTableEvents = {
  /**
   * Emitted when a handle completes (resolved, rejected, or cancelled)
   */
  completed: HandleId;
};

/** Tracks pending async operations: creates handles, resolves/rejects/cancels them, and notifies waiters. */
export class HandleTable {
  private nextId = 1;
  private handles = new Dict<HandleId, Handle>();
  private eventEmitter = new EventEmitter<HandleTableEvents>();
  public readonly events = this.eventEmitter.consumer();

  constructor(public readonly maxHandles: number) {}

  createPending(): HandleId {
    if (this.handles.size() >= this.maxHandles) {
      throwOverflow(`Handle limit exceeded: ${this.maxHandles}`);
    }

    const id = this.nextId++;
    this.handles.set(id, {
      id,
      state: HandleState.PENDING,
      waiters: new UniqueSet<number>(),
      createdAt: Time.nowMs(),
    });
    return id;
  }

  get(id: HandleId): Handle | undefined {
    return this.handles.get(id);
  }

  getOrThrow(id: HandleId): Handle {
    const h = this.get(id);
    if (!h) throw new Error(`Unknown handle ${id}`);
    return h;
  }

  has(id: HandleId): boolean {
    return this.handles.has(id);
  }

  resolve(id: HandleId, result: Value): void {
    const h = this.getOrThrow(id);
    if (h.state !== HandleState.PENDING) {
      throw new Error(`Cannot resolve handle ${id} in state ${h.state}`);
    }
    h.state = HandleState.RESOLVED;
    h.result = result;
    this.eventEmitter.emit("completed", id);
  }

  reject(id: HandleId, err: ErrorValue): void {
    const h = this.getOrThrow(id);
    if (h.state !== HandleState.PENDING) {
      throw new Error(`Cannot reject handle ${id} in state ${h.state}`);
    }
    h.state = HandleState.REJECTED;
    h.error = err;
    this.eventEmitter.emit("completed", id);
  }

  cancel(id: HandleId, message = "Cancelled"): void {
    const h = this.getOrThrow(id);
    if (h.state !== HandleState.PENDING) {
      throw new Error(`Cannot cancel handle ${id} in state ${h.state}`);
    }
    h.state = HandleState.CANCELLED;
    h.error = { code: ErrorCode.Cancelled, message };
    this.eventEmitter.emit("completed", id);
  }

  delete(id: HandleId): void {
    this.handles.delete(id);
  }

  clear(): void {
    this.handles.clear();
  }

  gc(): number {
    let removed = 0;
    for (const [id, h] of this.handles.entries().toArray()) {
      if (h.state !== HandleState.PENDING && h.waiters.size() === 0) {
        this.handles.delete(id);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.handles.size();
  }
}

///////////////////////////
// Scheduler Interface
///////////////////////////

/** Minimal scheduler hooks the VM uses to enqueue, complete, and look up fibers. */
export interface Scheduler {
  onHandleCompleted: (handleId: HandleId) => void;
  enqueueRunnable: (fiberId: number) => void;
  getFiber: (fiberId: number) => Fiber | undefined;
  addFiber?: (fiber: Fiber) => void;
}

///////////////////////////
// VM Interface
///////////////////////////

/**
 * Interface for the VM implementation
 *
 * Defines the public API for the bytecode virtual machine that executes
 * compiled programs with fiber-based concurrency and async operations.
 */
export interface IVM {
  /**
   * Handle table for managing async operations
   */
  readonly handles: HandleTable;

  /**
   * Spawn a new fiber with the given function ID and arguments
   * @param fiberId - Unique identifier for the fiber
   * @param funcId - Function ID to execute
   * @param args - Arguments to pass to the function
   * @param executionContext - Execution context for this fiber
   * @returns The newly spawned fiber
   */
  spawnFiber(fiberId: number, funcId: number, args: List<Value>, executionContext: ExecutionContext): Fiber;

  /**
   * Run a fiber until it yields, waits, completes, or faults
   * @param fiber - The fiber to run
   * @param scheduler - Scheduler for managing fiber lifecycle events
   * @returns Result of the execution
   */
  runFiber(fiber: Fiber, scheduler: Scheduler): VmRunResult;

  /**
   * Resume a fiber that was waiting on an async handle
   * @param fiber - The fiber to resume
   * @param handleId - Handle that completed
   * @param scheduler - Scheduler for managing fiber lifecycle events
   */
  resumeFiberFromHandle(fiber: Fiber, handleId: HandleId, scheduler: Scheduler): void;

  /**
   * Cancel a running or waiting fiber
   * @param fiber - The fiber to cancel
   * @param scheduler - Scheduler for managing fiber lifecycle events
   */
  cancelFiber(fiber: Fiber, scheduler: Scheduler): void;
}

///////////////////////////
// Fiber Scheduler Interface
///////////////////////////

/** Counters returned by {@link IFiberScheduler.getStats}. */
export interface FiberSchedulerStats {
  totalFibers: number;
  runnableFibers: number;
  waitingFibers: number;
  doneFibers: number;
  faultedFibers: number;
  cancelledFibers: number;
  pendingHandles: number;
}

/**
 * Interface for the fiber scheduler implementation
 *
 * Manages fiber execution, queuing, and lifecycle. The scheduler
 * coordinates between the VM and fibers, handling execution budgets
 * and cooperative multitasking.
 */
export interface IFiberScheduler extends Scheduler {
  /**
   * Spawn a new fiber to execute the specified function
   * @param funcId - Function ID to execute
   * @param args - Arguments to pass to the function
   * @param executionContext - Execution context for this fiber
   * @returns The newly created fiber ID
   */
  spawn(funcId: number, args: List<Value>, executionContext: ExecutionContext): number;

  /**
   * Add an existing fiber to the scheduler
   * @param fiber - Fiber to add
   */
  addFiber(fiber: Fiber): void;

  /**
   * Remove a fiber from the scheduler
   * @param fiberId - ID of fiber to remove
   */
  removeFiber(fiberId: number): void;

  /**
   * Cancel a fiber's execution
   * @param fiberId - ID of fiber to cancel
   */
  cancel(fiberId: number): void;

  /**
   * Execute one scheduler tick, running fibers until budget exhausted
   * @returns Number of fibers executed in this tick
   */
  tick(): number;

  /**
   * Get statistics about current scheduler state
   * @returns Statistics object
   */
  getStats(): FiberSchedulerStats;

  /**
   * Garbage collect completed/faulted/cancelled fibers
   * @returns Number of fibers removed
   */
  gc(): number;
}
