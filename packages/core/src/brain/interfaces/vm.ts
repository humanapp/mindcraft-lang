import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import type { List } from "../../platform/list";
import { Time } from "../../platform/time";
import { UniqueSet } from "../../platform/uniqueset";
import { EventEmitter } from "../../util/event-emitter";
import type { ActionInstance, ExecutionContext } from "./runtime";
import { NativeType, type TypeId } from "./type-system";

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
  /** Maximum number of fibers system-wide */
  maxFibers: number;
  /** Maximum number of pending handles */
  maxHandles: number;
  /** Default instruction budget per fiber execution */
  defaultBudget: number;
  /** Enable debug mode: validates stack depth after function calls, warns on potential leaks */
  debugStackChecks?: boolean;
}

///////////////////////////
// Value Model
///////////////////////////

/** Opaque identifier for a pending async operation. */
export type HandleId = number;

/** Tagged error payload produced by the VM (timeouts, host exceptions, stack faults, etc.). */
export type ErrorValue = {
  tag: "Timeout" | "Cancelled" | "HostError" | "ScriptError" | "StackOverflow" | "StackUnderflow";
  message: string;
  detail?: unknown;
  site?: { funcId: number; pc: number };
  stackTrace?: List<string>;
};

/** Dictionary of brain {@link Value}s with typed accessors per native type. */
export class ValueDict extends Dict<string | number, Value> {
  getString(key: string | number): StringValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.String) {
      return val as StringValue;
    }
    return undefined;
  }

  getNumber(key: string | number): NumberValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.Number) {
      return val as NumberValue;
    }
    return undefined;
  }

  getBoolean(key: string | number): BooleanValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.Boolean) {
      return val as BooleanValue;
    }
    return undefined;
  }

  getList(key: string | number): ListValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.List) {
      return val as ListValue;
    }
    return undefined;
  }

  getMap(key: string | number): MapValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.Map) {
      return val as MapValue;
    }
    return undefined;
  }

  getStruct(key: string | number): StructValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.Struct) {
      return val as StructValue;
    }
    return undefined;
  }

  getEnum(key: string | number): EnumValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.Enum) {
      return val as EnumValue;
    }
    return undefined;
  }
}

/** Brain runtime value of unknown native type. */
export type UnknownValue = { t: NativeType.Unknown };
/** Brain runtime value representing the absence of a value (statement result). */
export type VoidValue = { t: NativeType.Void };
/** Brain runtime value representing nil. */
export type NilValue = { t: NativeType.Nil };
/** Brain runtime boolean value. */
export type BooleanValue = { t: NativeType.Boolean; v: boolean };
/** Brain runtime number value. */
export type NumberValue = { t: NativeType.Number; v: number };
/** Brain runtime string value. */
export type StringValue = { t: NativeType.String; v: string };
/** Brain runtime enum value: `typeId` plus the symbol `key`. */
export type EnumValue = { t: NativeType.Enum; typeId: TypeId; v: string };
/** Brain runtime list value. */
export type ListValue = { t: NativeType.List; typeId: TypeId; v: List<Value> };
/** Brain runtime map value. */
export type MapValue = { t: NativeType.Map; typeId: TypeId; v: ValueDict };
/** Brain runtime struct value. `v` holds field values; `native` holds an optional host-backing object. */
export type StructValue = { t: NativeType.Struct; typeId: TypeId; v?: Dict<string, Value>; native?: unknown };
/** Brain runtime function value: function id plus optional captured upvalues. */
export type FunctionValue = { t: NativeType.Function; funcId: number; captures?: List<Value> };

/** Tagged-union of all brain runtime values, including VM-internal `handle` and `err`. */
export type Value =
  | UnknownValue
  | VoidValue
  | NilValue
  | BooleanValue
  | NumberValue
  | StringValue
  | EnumValue
  | ListValue
  | MapValue
  | StructValue
  | FunctionValue
  | { t: "handle"; id: HandleId } // VM-internal type
  | { t: "err"; e: ErrorValue }; // VM-internal type

/** Pooled singleton {@link UnknownValue}. */
export const UNKNOWN_VALUE: UnknownValue = { t: NativeType.Unknown };
/** Pooled singleton {@link VoidValue}. */
export const VOID_VALUE: VoidValue = { t: NativeType.Void };
/** Pooled singleton {@link NilValue}. */
export const NIL_VALUE: NilValue = { t: NativeType.Nil };
/** Pooled singleton {@link BooleanValue} for `true`. */
export const TRUE_VALUE: BooleanValue = { t: NativeType.Boolean, v: true };
/** Pooled singleton {@link BooleanValue} for `false`. */
export const FALSE_VALUE: BooleanValue = { t: NativeType.Boolean, v: false };

/** Return the pooled singleton {@link BooleanValue} for `b`. */
export function mkBooleanValue(b: boolean): BooleanValue {
  return b ? TRUE_VALUE : FALSE_VALUE;
}
/** Build a {@link NumberValue}. */
export function mkNumberValue(n: number): NumberValue {
  return { t: NativeType.Number, v: n };
}
/** Build a {@link StringValue}. */
export function mkStringValue(str: string): StringValue {
  return { t: NativeType.String, v: str };
}
/** Build a {@link StructValue} with explicit fields and optional `native` backing. */
export function mkStructValue(typeId: TypeId, fields: Dict<string, Value>, native?: unknown): StructValue {
  return { t: NativeType.Struct, typeId, v: fields, native };
}
/** Build a native-backed {@link StructValue} with no field map. */
export function mkNativeStructValue(typeId: TypeId, native: unknown): StructValue {
  return { t: NativeType.Struct, typeId, v: new Dict<string, Value>(), native };
}
/** Build a {@link ListValue}. */
export function mkListValue(typeId: TypeId, items: List<Value>): ListValue {
  return { t: NativeType.List, typeId, v: items };
}
/** Build a {@link FunctionValue}, optionally with captured upvalues. */
export function mkFunctionValue(funcId: number, captures?: List<Value>): FunctionValue {
  if (captures !== undefined) {
    return { t: NativeType.Function, funcId, captures };
  }
  return { t: NativeType.Function, funcId };
}
//export function mkMapValue(typeId: TypeId, entries: Dict<string | number, Value>): MapValue {
//  return { t: NativeType.Map, typeId, v: new ValueDict(entries) };
//}

// Value extractors
/** Return the boolean payload, or undefined if `v` is not a {@link BooleanValue}. */
export function extractBooleanValue(v: Value | undefined): boolean | undefined {
  if (v && v.t === NativeType.Boolean) {
    return v.v;
  }
  return undefined;
}
/** Return the number payload, or undefined if `v` is not a {@link NumberValue}. */
export function extractNumberValue(v: Value | undefined): number | undefined {
  if (v && v.t === NativeType.Number) {
    return v.v;
  }
  return undefined;
}
/** Return the string payload, or undefined if `v` is not a {@link StringValue}. */
export function extractStringValue(v: Value | undefined): string | undefined {
  if (v && v.t === NativeType.String) {
    return v.v;
  }
  return undefined;
}
/** Return the list payload, or undefined if `v` is not a {@link ListValue}. */
export function extractListValue(v: Value | undefined): List<Value> | undefined {
  if (v && v.t === NativeType.List) {
    return v.v;
  }
  return undefined;
}

// Type guards
/** Type guard for VM-internal handle values. */
export function isHandleValue(v: Value): v is { t: "handle"; id: HandleId } {
  return v.t === "handle";
}
/** Type guard for {@link UnknownValue}. */
export function isUnknownValue(v: Value): v is UnknownValue {
  return v.t === NativeType.Unknown;
}
/** Type guard for {@link VoidValue}. */
export function isVoidValue(v: Value): v is VoidValue {
  return v.t === NativeType.Void;
}
/** Type guard for {@link NilValue}. */
export function isNilValue(v: Value): v is NilValue {
  return v.t === NativeType.Nil;
}
/** Type guard for {@link BooleanValue}. */
export function isBooleanValue(v: Value): v is BooleanValue {
  return v.t === NativeType.Boolean;
}
/** Type guard for {@link NumberValue}. */
export function isNumberValue(v: Value): v is NumberValue {
  return v.t === NativeType.Number;
}
/** Type guard for {@link StringValue}. */
export function isStringValue(v: Value): v is StringValue {
  return v.t === NativeType.String;
}
/** Type guard for {@link EnumValue}. */
export function isEnumValue(v: Value): v is EnumValue {
  return v.t === NativeType.Enum;
}
/** Type guard for {@link ListValue}. */
export function isListValue(v: Value): v is ListValue {
  return v.t === NativeType.List;
}
/** Type guard for {@link MapValue}. */
export function isMapValue(v: Value): v is MapValue {
  return v.t === NativeType.Map;
}
/** Type guard for {@link StructValue}. */
export function isStructValue(v: Value): v is StructValue {
  return v.t === NativeType.Struct;
}
/** Type guard for {@link FunctionValue}. */
export function isFunctionValue(v: Value): v is FunctionValue {
  return v.t === NativeType.Function;
}
/** Type guard for VM-internal error values. */
export function isErrValue(v: Value): v is { t: "err"; e: ErrorValue } {
  return v.t === "err";
}

///////////////////////////
// Opcodes
///////////////////////////

/** Brain VM bytecode opcodes. */
export enum Op {
  // Stack manipulation
  PUSH_CONST = 0,
  POP,
  DUP,
  SWAP,

  // Variables (stored in execution context)
  LOAD_VAR = 10,
  STORE_VAR,

  // Control flow
  JMP = 20,
  JMP_IF_FALSE,
  JMP_IF_TRUE,

  // Function calls
  CALL = 30,
  RET,

  // Host calls (pre-built MapValue on stack)
  HOST_CALL = 40,
  HOST_CALL_ASYNC,
  // Host calls (raw args on stack -- VM auto-wraps into MapValue with 0-indexed keys)
  HOST_CALL_ARGS,
  HOST_CALL_ARGS_ASYNC,

  // Action calls (pre-built MapValue on stack)
  ACTION_CALL = 44,
  ACTION_CALL_ASYNC,

  // Async operations and cooperative scheduling
  AWAIT = 50,
  YIELD,

  // Exception handling
  TRY = 60,
  END_TRY,
  THROW,

  // Boundaries
  WHEN_START = 70,
  WHEN_END,
  DO_START,
  DO_END,

  // List operations
  LIST_NEW = 90,
  LIST_PUSH,
  LIST_GET,
  LIST_SET,
  LIST_LEN,
  LIST_POP,
  LIST_SHIFT,
  LIST_REMOVE,
  LIST_INSERT,
  LIST_SWAP,

  // Map operations
  MAP_NEW = 100,
  MAP_SET,
  MAP_GET,
  MAP_HAS,
  MAP_DELETE,

  // Struct operations
  STRUCT_NEW = 110,
  STRUCT_GET,
  STRUCT_SET,
  STRUCT_COPY_EXCEPT,

  // Generic field access (works with Struct, extensible for custom types)
  GET_FIELD = 120,
  SET_FIELD,

  // Frame-local variables (indexed slots on the current call frame)
  LOAD_LOCAL = 130,
  STORE_LOCAL,

  // Legacy opcode name retained; resolves against the current action instance state slots.
  LOAD_CALLSITE_VAR = 140,
  STORE_CALLSITE_VAR,

  // Type introspection
  TYPE_CHECK = 150,
  INSTANCE_OF,

  // Indirect function calls
  CALL_INDIRECT = 160,
  CALL_INDIRECT_ARGS,

  // Closure operations
  MAKE_CLOSURE = 170,
  LOAD_CAPTURE,
}

/** Current bytecode format version. */
export const BYTECODE_VERSION = 1;

///////////////////////////
// Bytecode Structures
///////////////////////////

/** Single VM instruction: opcode plus up to three operands. */
export interface Instr {
  op: Op;
  a?: number;
  b?: number;
  c?: number;
}

/** Compiled function body: instruction list plus param/local counts and optional metadata. */
export interface FunctionBytecode {
  code: List<Instr>;
  numParams: number;
  /** Total number of local variable slots (includes params). Defaults to numParams. */
  numLocals?: number;
  name?: string;
  maxStackDepth?: number;
  injectCtxTypeId?: TypeId;
}

/** Compiled program: functions, constant pool, named variables, and entry point. */
export interface Program {
  version: number;
  functions: List<FunctionBytecode>;
  constants: List<Value>;
  /** Named variable identifiers for cross-context variable access */
  variableNames: List<string>;
  entryPoint?: number;
}

///////////////////////////
// Host Function Interface
///////////////////////////

/**
 * Synchronous host function signature.
 *
 * @param ctx - Execution context providing access to variables, rule, etc.
 * @param args - Map of argument values passed from the VM, mapped by slotId from call spec
 * @returns The result value to push onto the stack
 */
export type HostSyncFn = {
  onPageEntered?: (ctx: ExecutionContext) => void;
  exec: (ctx: ExecutionContext, args: MapValue) => Value;
};

/**
 * Asynchronous host function signature.
 *
 * @param ctx - Execution context providing access to variables, rule, etc.
 * @param args - Map of argument values passed from the VM, mapped by slotId from call spec
 * @param handleId - Handle ID for resolving the async operation
 */
export type HostAsyncFn = {
  onPageEntered?: (ctx: ExecutionContext) => void;
  exec: (ctx: ExecutionContext, args: MapValue, handleId: HandleId) => void;
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

  constructor(private maxHandles: number) {}

  createPending(): HandleId {
    if (this.handles.size() >= this.maxHandles) {
      throw new Error(`Handle limit exceeded: ${this.maxHandles}`);
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
    h.error = { tag: "Cancelled", message };
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
  onFiberWaiting?: (fiberId: number, handleId: HandleId) => void;
  onFiberFault?: (fiberId: number, error: ErrorValue) => void;
  onFiberDone?: (fiberId: number, result?: Value) => void;
  onFiberCancelled?: (fiberId: number) => void;
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
