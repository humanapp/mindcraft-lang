import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List } from "../../platform/list";
import { logger } from "../../platform/logger";
import { MathOps } from "../../platform/math";
import { StringUtils as SU } from "../../platform/string";
import { Time } from "../../platform/time";
import { UniqueSet } from "../../platform/uniqueset";
import type {
  ErrorValue,
  ExecutionContext,
  FunctionBytecode,
  HandleId,
  IFiberScheduler,
  Instr,
  ITypeRegistry,
  IVM,
  MapValue,
  Program,
  StructTypeDef,
  TypeId,
  Value,
  VmConfig,
} from "../interfaces";
import { NativeType, ValueDict } from "../interfaces";
import {
  BYTECODE_VERSION,
  FALSE_VALUE,
  type Fiber,
  FiberState,
  type Frame,
  type Handler,
  HandleState,
  type HandleTable,
  isBooleanValue,
  isEnumValue,
  isErrValue,
  isHandleValue,
  isListValue,
  isMapValue,
  isNumberValue,
  isStringValue,
  isStructValue,
  NIL_VALUE,
  Op,
  type Scheduler,
  TRUE_VALUE,
  UNKNOWN_VALUE,
  type VmRunResult,
  VmStatus,
  VOID_VALUE,
} from "../interfaces/vm";
import { getBrainServices } from "../services";

/**
 * Stack-based bytecode VM
 *
 * Features:
 * - Fibers (lightweight coroutines with isolated stack state)
 * - Async operations via handles with AWAIT suspension/resumption
 * - Structured exception handling (TRY/THROW/FAULT)
 * - Budgeted execution for fairness and DoS protection
 * - Comprehensive bounds checking and validation
 * - Proper lifecycle management and resource cleanup
 * - Named variable access via LOAD_VAR/STORE_VAR with resolution chain
 *
 * Threading Model:
 * - Single-threaded execution per VM instance
 * - No reentrancy: host operations must not call VM methods synchronously
 * - Host completion callbacks enqueue work; scheduler drives execution
 *
 * Safety Guarantees:
 * - All memory accesses are bounds-checked
 * - Stack overflow/underflow detection
 * - Bytecode verification before execution
 * - Configurable resource limits (memory, stack depth, frame depth)
 * - Type-safe value operations
 *
 * Variable Access:
 * - All variables stored in ExecutionContext by name
 * - Resolved through resolution chain (local -> shared -> parent)
 * - Accessed via LOAD_VAR/STORE_VAR with variable names
 *
 * Invariants:
 * - vstack contains only operand stack (variables managed by ExecutionContext)
 * - handlers reference valid frame indices and stack heights
 * - await sites are cleared during exception unwinding
 * - fiber state transitions follow valid state machine
 * - variable resolution chain maintains consistent scoping semantics
 */

///////////////////////////
// Configuration & Limits
///////////////////////////

export const DEFAULT_VM_CONFIG: VmConfig = {
  maxFrameDepth: 256,
  maxStackSize: 4096,
  maxHandlers: 64,
  maxFibers: 10000,
  maxHandles: 100000,
  defaultBudget: 1000,
};

///////////////////////////
// Value Model
///////////////////////////

const V = {
  unknown(): Value {
    return UNKNOWN_VALUE;
  },
  void(): Value {
    return VOID_VALUE;
  },
  nil(): Value {
    return NIL_VALUE;
  },
  bool(v: boolean): Value {
    return v ? TRUE_VALUE : FALSE_VALUE;
  },
  num(v: number): Value {
    return { t: NativeType.Number, v };
  },
  str(v: string): Value {
    return { t: NativeType.String, v };
  },
  enum(key: string, typeId: TypeId): Value {
    return { t: NativeType.Enum, typeId, v: key };
  },
  list(items: List<Value>, typeId: TypeId): Value {
    return { t: NativeType.List, typeId, v: items };
  },
  map(entries: ValueDict, typeId: TypeId): Value {
    return { t: NativeType.Map, typeId, v: entries };
  },
  struct(fields: Dict<string, Value>, typeId: TypeId): Value {
    return { t: NativeType.Struct, typeId, v: fields };
  },
  handle(id: HandleId): Value {
    return { t: "handle", id };
  },
  err(e: ErrorValue): Value {
    return { t: "err", e };
  },
};

// Value comparison for truthiness
/**
 * Deep-copy a Value for assignment semantics.
 * Primitives (boolean, number, string, enum, nil, void, unknown) are immutable and returned as-is.
 * Struct values are recursively deep-copied: a new StructValue is created with a cloned Dict
 * of fields (each field value is itself deep-copied).
 * For native structs, if a `snapshotNative` hook is registered on the type, it is called to
 * materialize the native handle (e.g., resolve a lazy resolver to a concrete value).
 * Otherwise the native handle is copied by reference.
 * A `visited` list prevents infinite loops from circular references.
 */
function deepCopyValue(v: Value, types: ITypeRegistry, ctx: ExecutionContext, visited?: List<Value>): Value {
  if (!isStructValue(v)) {
    // Primitives, enums, nil, void, unknown, handles, errors -- all immutable or VM-internal
    return v;
  }

  // Guard against circular references (linear scan; nesting depth is expected to be very shallow)
  if (!visited) {
    visited = List.empty<Value>();
  }
  for (let i = 0; i < visited.size(); i++) {
    if (visited.get(i) === v) {
      // Circular reference detected -- return the original to avoid infinite recursion.
      return v;
    }
  }
  visited.push(v);

  // Deep-copy the fields Dict
  const oldFields = v.v;
  let newFields: Dict<string, Value>;
  if (oldFields && oldFields.size() > 0) {
    const entries = oldFields.entries();
    const copied: Array<readonly [string, Value]> = [];
    for (let i = 0; i < entries.size(); i++) {
      const entry = entries.get(i)!;
      copied.push([entry[0], deepCopyValue(entry[1], types, ctx, visited)]);
    }
    newFields = new Dict<string, Value>(copied);
  } else {
    newFields = new Dict<string, Value>();
  }

  // Snapshot the native handle if the type has a snapshotNative hook
  let nativeHandle = v.native;
  if (nativeHandle !== undefined) {
    const typeDef = types.get(v.typeId) as StructTypeDef | undefined;
    if (typeDef?.snapshotNative) {
      nativeHandle = typeDef.snapshotNative(v, ctx);
    }
  }

  return { t: NativeType.Struct, typeId: v.typeId, v: newFields, native: nativeHandle };
}

function isTruthy(v: Value): boolean {
  switch (v.t) {
    case NativeType.Unknown:
    case NativeType.Void:
    case NativeType.Nil:
      return false;
    case NativeType.Boolean:
      return v.v;
    case NativeType.Number:
      return v.v !== 0;
    case NativeType.String:
      return SU.length(v.v) > 0;
    case NativeType.Enum:
      return true;
    case NativeType.List:
      return v.v.size() > 0;
    case NativeType.Map:
      return v.v.size() > 0;
    case NativeType.Struct:
      return true;
    case "handle":
      return true;
    case "err":
      return false;
  }
}

///////////////////////////
// Fiber State Machine
///////////////////////////

const VALID_TRANSITIONS: Record<FiberState, UniqueSet<FiberState>> = {
  [FiberState.RUNNABLE]: new UniqueSet([FiberState.WAITING, FiberState.DONE, FiberState.FAULT, FiberState.CANCELLED]),
  [FiberState.WAITING]: new UniqueSet([FiberState.RUNNABLE, FiberState.CANCELLED, FiberState.FAULT]),
  [FiberState.DONE]: new UniqueSet([]),
  [FiberState.FAULT]: new UniqueSet([]),
  [FiberState.CANCELLED]: new UniqueSet([]),
};

///////////////////////////
// Bytecode Verification
///////////////////////////

class BytecodeVerifier {
  constructor(private prog: Program) {}

  verify(): { ok: boolean; errors: List<string> } {
    const errors = List.empty<string>();

    if (this.prog.version !== BYTECODE_VERSION) {
      errors.push(`Bytecode version mismatch: expected ${BYTECODE_VERSION}, got ${this.prog.version}`);
    }

    for (let i = 0; i < this.prog.functions.size(); i++) {
      const fn = this.prog.functions.get(i)!;
      this.verifyFunction(fn, i, errors);
    }

    return { ok: errors.size() === 0, errors };
  }

  private verifyFunction(fn: FunctionBytecode, funcId: number, errors: List<string>): void {
    const funcName = fn.name ?? `func[${funcId}]`;

    for (let pc = 0; pc < fn.code.size(); pc++) {
      const ins = fn.code.get(pc)!;
      this.verifyInstruction(ins, pc, fn, funcName, errors);
    }
  }

  private verifyInstruction(
    ins: Instr,
    pc: number,
    fn: FunctionBytecode,
    funcName: string,
    errors: List<string>
  ): void {
    const site = `${funcName}@${pc}`;

    switch (ins.op) {
      case Op.PUSH_CONST: {
        const k = ins.a ?? 0;
        if (k < 0 || k >= this.prog.constants.size()) {
          errors.push(`${site}: PUSH_CONST index ${k} out of bounds [0, ${this.prog.constants.size()})`);
        }
        break;
      }
      case Op.LOAD_VAR:
      case Op.STORE_VAR: {
        const nameIdx = ins.a ?? 0;
        if (nameIdx < 0 || nameIdx >= this.prog.variableNames.size()) {
          errors.push(
            `${site}: ${Op[ins.op]} name index ${nameIdx} out of bounds [0, ${this.prog.variableNames.size()})`
          );
        }
        break;
      }
      case Op.JMP:
      case Op.JMP_IF_FALSE:
      case Op.JMP_IF_TRUE: {
        const rel = (ins.a ?? 0) | 0;
        const target = pc + rel;
        if (target < 0 || target >= fn.code.size()) {
          errors.push(`${site}: ${Op[ins.op]} target ${target} out of bounds [0, ${fn.code.size()})`);
        }
        break;
      }
      case Op.TRY: {
        const catchRel = (ins.a ?? 0) | 0;
        const catchPc = pc + catchRel;
        if (catchPc < 0 || catchPc >= fn.code.size()) {
          errors.push(`${site}: TRY catchPc ${catchPc} out of bounds [0, ${fn.code.size()})`);
        }
        break;
      }
      case Op.CALL: {
        const calleeId = ins.a ?? 0;
        const argc = ins.b ?? 0;
        if (calleeId < 0 || calleeId >= this.prog.functions.size()) {
          errors.push(`${site}: CALL funcId ${calleeId} out of bounds [0, ${this.prog.functions.size()})`);
        } else {
          const callee = this.prog.functions.get(calleeId)!;
          if (argc !== callee.numParams) {
            errors.push(`${site}: CALL argc ${argc} != ${callee.numParams} params`);
          }
        }
        break;
      }
    }
  }
}

///////////////////////////
// VM Core
///////////////////////////

export class VM implements IVM {
  private config: VmConfig;
  private verifier: BytecodeVerifier;
  private services = getBrainServices();
  private fns = this.services.functions;

  constructor(
    private prog: Program,
    public handles: HandleTable,
    config?: Partial<VmConfig>
  ) {
    this.config = { ...DEFAULT_VM_CONFIG, ...config };
    this.verifier = new BytecodeVerifier(prog);

    const verification = this.verifier.verify();
    if (!verification.ok) {
      throw new Error(`Bytecode verification failed:\n${verification.errors.toArray().join("\n")}`);
    }

    // Wire HandleTable events to forward to VM consumers
    // This allows external components to listen to handle completion via VM
    this.handles.events.on("completed", (handleId) => {
      // Handle completion is managed internally by onHandleCompleted callback
      // from scheduler when it subscribes to handle events
    });
  }

  spawnFiber(fiberId: number, funcId: number, args: List<Value>, executionContext: ExecutionContext): Fiber {
    if (funcId < 0 || funcId >= this.prog.functions.size()) {
      throw new Error(`Invalid function ID: ${funcId}`);
    }

    const fn = this.prog.functions.get(funcId)!;
    if (args.size() !== fn.numParams) {
      throw new Error(
        `Argument count mismatch for ${fn.name ?? `func[${funcId}]`}: expected ${fn.numParams}, got ${args.size()}`
      );
    }

    const vstack = List.empty<Value>();
    const base = 0;

    // Set the fiber ID in the execution context
    executionContext.fiberId = fiberId;

    const now = Time.nowMs();
    const fiber: Fiber = {
      id: fiberId,
      state: FiberState.RUNNABLE,
      vstack,
      frames: List.from([{ funcId, pc: 0, base }]),
      handlers: List.empty<Handler>(),
      instrBudget: 0,
      createdAt: now,
      lastRunAt: now,
      executionContext,
    };

    return fiber;
  }

  runFiber(fiber: Fiber, scheduler: Scheduler): VmRunResult {
    if (fiber.state !== FiberState.RUNNABLE) {
      throw new Error(`Cannot run fiber ${fiber.id} in state ${fiber.state}`);
    }
    if (fiber.instrBudget <= 0) {
      throw new Error(`Cannot run fiber ${fiber.id} with non-positive budget ${fiber.instrBudget}`);
    }

    fiber.lastRunAt = Time.nowMs();

    while (fiber.instrBudget > 0) {
      // If the fiber was cancelled mid-execution (e.g., by a HOST_CALL that
      // triggered a page change), stop immediately.
      if (fiber.state !== FiberState.RUNNABLE) {
        return { status: VmStatus.DONE };
      }

      fiber.instrBudget--;

      if (fiber.pendingInjectedThrow) {
        fiber.pendingInjectedThrow = false;
        const err = fiber.lastError ?? { tag: "ScriptError", message: "Unknown error" };
        const caught = this.throwValue(fiber, err);
        if (!caught) {
          this.transitionState(fiber, FiberState.FAULT);
          scheduler.onFiberFault?.(fiber.id, err);
          return { status: VmStatus.FAULT, error: err };
        }
        continue;
      }

      const frame = this.topFrame(fiber);
      if (!frame) {
        const err: ErrorValue = { tag: "ScriptError", message: "No frame on stack" };
        this.faultFiber(fiber, err, scheduler);
        return { status: VmStatus.FAULT, error: err };
      }

      const fn = this.prog.functions.get(frame.funcId)!;
      if (frame.pc < 0 || frame.pc >= fn.code.size()) {
        const err: ErrorValue = {
          tag: "ScriptError",
          message: `PC out of bounds: ${frame.pc} not in [0, ${fn.code.size()})`,
          site: { funcId: frame.funcId, pc: frame.pc },
        };
        this.faultFiber(fiber, err, scheduler);
        return { status: VmStatus.FAULT, error: err };
      }

      const ins = fn.code.get(frame.pc)!;
      const result = this.executeInstruction(fiber, ins, frame, fn, scheduler);
      if (result) return result;
    }

    return { status: VmStatus.YIELDED };
  }

  private executeInstruction(
    fiber: Fiber,
    ins: Instr,
    frame: Frame,
    fn: FunctionBytecode,
    scheduler: Scheduler
  ): VmRunResult | undefined {
    try {
      switch (ins.op) {
        case Op.PUSH_CONST:
          return this.execPushConst(fiber, ins, frame);
        case Op.POP:
          return this.execPop(fiber, frame);
        case Op.DUP:
          return this.execDup(fiber, frame);
        case Op.SWAP:
          return this.execSwap(fiber, frame);
        case Op.LOAD_VAR:
          return this.execLoadVar(fiber, ins, frame);
        case Op.STORE_VAR:
          return this.execStoreVar(fiber, ins, frame);
        case Op.JMP:
          return this.execJmp(fiber, ins, frame);
        case Op.JMP_IF_FALSE:
          return this.execJmpIfFalse(fiber, ins, frame);
        case Op.JMP_IF_TRUE:
          return this.execJmpIfTrue(fiber, ins, frame);
        case Op.CALL:
          return this.execCall(fiber, ins, frame);
        case Op.RET:
          return this.execRet(fiber, scheduler);
        case Op.HOST_CALL:
          return this.execHostCall(fiber, ins, frame);
        case Op.HOST_CALL_ASYNC:
          return this.execHostCallAsync(fiber, ins, frame, scheduler);
        case Op.HOST_CALL_ARGS:
          return this.execHostCallArgs(fiber, ins, frame);
        case Op.HOST_CALL_ARGS_ASYNC:
          return this.execHostCallArgsAsync(fiber, ins, frame, scheduler);
        case Op.AWAIT:
          return this.execAwait(fiber, frame, scheduler);
        case Op.YIELD:
          frame.pc++;
          return { status: VmStatus.YIELDED };
        case Op.TRY:
          return this.execTry(fiber, ins, frame);
        case Op.END_TRY:
          return this.execEndTry(fiber, frame);
        case Op.THROW:
          return this.execThrow(fiber, frame, scheduler);
        case Op.WHEN_START:
          return this.execWhenStart(fiber, ins, frame);
        case Op.WHEN_END:
          return this.execWhenEnd(fiber, ins, frame);
        case Op.DO_START:
          return this.execDoStart(fiber, ins, frame);
        case Op.DO_END:
          return this.execDoEnd(fiber, frame);
        case Op.LIST_NEW:
          return this.execListNew(fiber, frame);
        case Op.LIST_PUSH:
          return this.execListPush(fiber, frame);
        case Op.LIST_GET:
          return this.execListGet(fiber, frame);
        case Op.LIST_SET:
          return this.execListSet(fiber, frame);
        case Op.LIST_LEN:
          return this.execListLen(fiber, frame);
        case Op.MAP_NEW:
          return this.execMapNew(fiber, frame);
        case Op.MAP_SET:
          return this.execMapSet(fiber, frame);
        case Op.MAP_GET:
          return this.execMapGet(fiber, frame);
        case Op.MAP_HAS:
          return this.execMapHas(fiber, frame);
        case Op.MAP_DELETE:
          return this.execMapDelete(fiber, frame);
        case Op.STRUCT_NEW:
          return this.execStructNew(fiber, ins, frame);
        case Op.STRUCT_GET:
          return this.execStructGet(fiber, ins, frame);
        case Op.STRUCT_SET:
          return this.execStructSet(fiber, ins, frame);
        case Op.GET_FIELD:
          return this.execGetField(fiber, frame);
        case Op.SET_FIELD:
          return this.execSetField(fiber, frame);
        default: {
          const err: ErrorValue = {
            tag: "ScriptError",
            message: `Unknown opcode: ${ins.op}`,
            site: { funcId: frame.funcId, pc: frame.pc },
          };
          this.faultFiber(fiber, err, scheduler);
          return { status: VmStatus.FAULT, error: err };
        }
      }
    } catch (e) {
      const err: ErrorValue = {
        tag: "ScriptError",
        message: `Internal error: ${SU.toString(e)}`,
        detail: e,
        site: { funcId: frame.funcId, pc: frame.pc },
      };
      this.faultFiber(fiber, err, scheduler);
      return { status: VmStatus.FAULT, error: err };
    }
  }

  private execPushConst(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    const k = ins.a ?? 0;
    if (k < 0 || k >= this.prog.constants.size()) {
      throw new Error(`PUSH_CONST: constant index ${k} out of bounds`);
    }
    this.push(fiber, this.prog.constants.get(k)!);
    frame.pc++;
    return undefined;
  }

  private execPop(fiber: Fiber, frame: Frame): undefined {
    this.pop(fiber);
    frame.pc++;
    return undefined;
  }

  private execDup(fiber: Fiber, frame: Frame): undefined {
    const v = this.peek(fiber);
    this.push(fiber, v);
    frame.pc++;
    return undefined;
  }

  private execSwap(fiber: Fiber, frame: Frame): undefined {
    const a = this.pop(fiber);
    const b = this.pop(fiber);
    this.push(fiber, a);
    this.push(fiber, b);
    frame.pc++;
    return undefined;
  }

  private execLoadVar(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    const nameIdx = ins.a ?? 0;
    if (nameIdx < 0 || nameIdx >= this.prog.variableNames.size()) {
      throw new Error(`LOAD_VAR: name index ${nameIdx} out of bounds`);
    }
    const varName = this.prog.variableNames.get(nameIdx)!;
    const value = this.resolveVariable(fiber, varName);
    this.push(fiber, value);
    frame.pc++;
    return undefined;
  }

  private execStoreVar(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    const nameIdx = ins.a ?? 0;
    if (nameIdx < 0 || nameIdx >= this.prog.variableNames.size()) {
      throw new Error(`STORE_VAR: name index ${nameIdx} out of bounds`);
    }
    const varName = this.prog.variableNames.get(nameIdx)!;
    const value = deepCopyValue(this.pop(fiber), this.services.types, fiber.executionContext);
    this.setResolvedVariable(fiber, varName, value);
    frame.pc++;
    return undefined;
  }

  private execJmp(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    const rel = (ins.a ?? 0) | 0;
    frame.pc = frame.pc + rel;
    return undefined;
  }

  private execJmpIfFalse(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    const rel = (ins.a ?? 0) | 0;
    const v = this.pop(fiber);
    frame.pc = isTruthy(v) ? frame.pc + 1 : frame.pc + rel;
    return undefined;
  }

  private execJmpIfTrue(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    const rel = (ins.a ?? 0) | 0;
    const v = this.pop(fiber);
    frame.pc = isTruthy(v) ? frame.pc + rel : frame.pc + 1;
    return undefined;
  }

  private execCall(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    const calleeId = ins.a ?? 0;
    const argc = ins.b ?? 0;
    this.doCall(fiber, calleeId, argc);
    return undefined;
  }

  private execRet(fiber: Fiber, scheduler: Scheduler): VmRunResult | undefined {
    const retv = this.pop(fiber);
    const done = this.doRet(fiber, retv);
    if (done) {
      this.transitionState(fiber, FiberState.DONE);
      scheduler.onFiberDone?.(fiber.id, retv);
      return { status: VmStatus.DONE, result: retv };
    }
    return undefined;
  }

  private execHostCall(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    const fnId = ins.a ?? 0;
    const callSiteId = ins.c ?? 0;

    const args = this.pop(fiber);

    if (args.t !== NativeType.Map) {
      throw new Error(`HOST_CALL: expected map arguments, got ${args.t}`);
    }

    if (fnId < 0 || fnId >= this.fns.size()) {
      throw new Error(`HOST_CALL: function index ${fnId} out of bounds`);
    }

    // Set current call-site ID so host function can access per-call-site state
    fiber.executionContext.currentCallSiteId = callSiteId;
    fiber.executionContext.rule = fiber.executionContext.funcIdToRule?.get(frame.funcId);

    const result = this.fns.getSyncById(fnId)!.fn.exec(fiber.executionContext, args);
    this.push(fiber, result);
    frame.pc++;
    return undefined;
  }

  private execHostCallAsync(fiber: Fiber, ins: Instr, frame: Frame, scheduler: Scheduler): VmRunResult | undefined {
    const fnId = ins.a ?? 0;
    const callSiteId = ins.c ?? 0;

    const args = this.pop(fiber);

    if (args.t !== NativeType.Map) {
      throw new Error(`HOST_CALL_ASYNC: expected map arguments, got ${args.t}`);
    }

    if (fnId < 0 || fnId >= this.fns.size()) {
      throw new Error(`HOST_CALL_ASYNC: function index ${fnId} out of bounds`);
    }

    const hid = this.handles.createPending();
    this.push(fiber, V.handle(hid));

    // Set current call-site ID so host function can access per-call-site state
    fiber.executionContext.currentCallSiteId = callSiteId;
    fiber.executionContext.rule = fiber.executionContext.funcIdToRule?.get(frame.funcId);

    this.fns.getAsyncById(fnId)!.fn.exec(fiber.executionContext, args, hid);
    frame.pc++;
    return undefined;
  }

  /**
   * Pop `argc` raw values from the stack and wrap them into a MapValue
   * with 0-indexed numeric keys. Used by HOST_CALL_ARGS and HOST_CALL_ARGS_ASYNC
   * to avoid compiler-side map construction for operators and conversions.
   */
  private collectArgsToMap(fiber: Fiber, argc: number): MapValue {
    const dict = new ValueDict();
    // Pop in reverse order so slot 0 = first pushed (left operand)
    for (let i = argc - 1; i >= 0; i--) {
      dict.set(i, this.pop(fiber));
    }
    return { t: NativeType.Map, typeId: "map:<args>", v: dict } as MapValue;
  }

  private execHostCallArgs(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    const fnId = ins.a ?? 0;
    const argc = ins.b ?? 0;
    const callSiteId = ins.c ?? 0;

    const args = this.collectArgsToMap(fiber, argc);

    if (fnId < 0 || fnId >= this.fns.size()) {
      throw new Error(`HOST_CALL_ARGS: function index ${fnId} out of bounds`);
    }

    fiber.executionContext.currentCallSiteId = callSiteId;
    fiber.executionContext.rule = fiber.executionContext.funcIdToRule?.get(frame.funcId);

    const result = this.fns.getSyncById(fnId)!.fn.exec(fiber.executionContext, args);
    this.push(fiber, result);
    frame.pc++;
    return undefined;
  }

  private execHostCallArgsAsync(fiber: Fiber, ins: Instr, frame: Frame, scheduler: Scheduler): VmRunResult | undefined {
    const fnId = ins.a ?? 0;
    const argc = ins.b ?? 0;
    const callSiteId = ins.c ?? 0;

    const args = this.collectArgsToMap(fiber, argc);

    if (fnId < 0 || fnId >= this.fns.size()) {
      throw new Error(`HOST_CALL_ARGS_ASYNC: function index ${fnId} out of bounds`);
    }

    const hid = this.handles.createPending();
    this.push(fiber, V.handle(hid));

    fiber.executionContext.currentCallSiteId = callSiteId;
    fiber.executionContext.rule = fiber.executionContext.funcIdToRule?.get(frame.funcId);

    this.fns.getAsyncById(fnId)!.fn.exec(fiber.executionContext, args, hid);
    frame.pc++;
    return undefined;
  }

  private execAwait(fiber: Fiber, frame: Frame, scheduler: Scheduler): VmRunResult | undefined {
    const hv = this.pop(fiber);
    if (!isHandleValue(hv)) {
      throw new Error("AWAIT: expected handle value");
    }

    const h = this.handles.get(hv.id);
    if (!h) {
      throw new Error(`AWAIT: unknown handle ${hv.id}`);
    }

    if (h.state === HandleState.RESOLVED) {
      this.push(fiber, h.result ?? V.nil());
      frame.pc++;
      return undefined;
    }

    if (h.state === HandleState.REJECTED || h.state === HandleState.CANCELLED) {
      const err: ErrorValue = h.error ?? {
        tag: "HostError",
        message: "Handle failed without error",
      };
      const caught = this.throwValue(fiber, err);
      if (!caught) {
        this.transitionState(fiber, FiberState.FAULT);
        scheduler.onFiberFault?.(fiber.id, err);
        return { status: VmStatus.FAULT, error: err };
      }
      return undefined;
    }

    this.transitionState(fiber, FiberState.WAITING);
    fiber.await = {
      resumePc: frame.pc + 1,
      stackHeight: fiber.vstack.size(),
      frameDepth: fiber.frames.size(),
      handleId: hv.id,
    };

    h.waiters.add(fiber.id);
    scheduler.onFiberWaiting?.(fiber.id, hv.id);

    return { status: VmStatus.WAITING, handleId: hv.id };
  }

  private execTry(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    if (fiber.handlers.size() >= this.config.maxHandlers) {
      throw new Error(`Handler limit exceeded: ${this.config.maxHandlers}`);
    }

    const catchRel = (ins.a ?? 0) | 0;
    const catchPc = frame.pc + catchRel;

    fiber.handlers.push({
      catchPc,
      stackHeight: fiber.vstack.size(),
      frameDepth: fiber.frames.size(),
    });

    frame.pc++;
    return undefined;
  }

  private execEndTry(fiber: Fiber, frame: Frame): undefined {
    fiber.handlers.pop();
    frame.pc++;
    return undefined;
  }

  private execThrow(fiber: Fiber, frame: Frame, scheduler: Scheduler): VmRunResult | undefined {
    const v = this.pop(fiber);
    const err: ErrorValue = isErrValue(v)
      ? v.e
      : {
          tag: "ScriptError",
          message: "THROW requires error value",
          detail: v,
          site: { funcId: frame.funcId, pc: frame.pc },
        };

    const caught = this.throwValue(fiber, err);
    if (!caught) {
      this.transitionState(fiber, FiberState.FAULT);
      scheduler.onFiberFault?.(fiber.id, err);
      return { status: VmStatus.FAULT, error: err };
    }
    return undefined;
  }

  // Boundaries
  private execWhenStart(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    // Semantic marker for WHEN section start - no-op
    // The WHEN section will push exactly one value onto the stack
    frame.pc++;
    return undefined;
  }

  private execWhenEnd(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    // WHEN always pushes exactly one value - pop it and check truthiness
    const whenResult = this.pop(fiber);

    if (!isTruthy(whenResult)) {
      // WHEN evaluated to falsy - skip DO section and children
      const offset = ins.a ?? 0;
      frame.pc += offset; // Jump to end label
    } else {
      // WHEN evaluated to truthy - continue to DO section
      frame.pc++;
    }
    return undefined;
  }

  private execDoStart(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    frame.pc++;
    return undefined;
  }

  private execDoEnd(fiber: Fiber, frame: Frame): undefined {
    frame.pc++;
    return undefined;
  }

  // List operations
  private execListNew(fiber: Fiber, frame: Frame): undefined {
    this.push(fiber, V.list(List.empty<Value>(), "list:<unknown>"));
    frame.pc++;
    return undefined;
  }

  private execListPush(fiber: Fiber, frame: Frame): undefined {
    const item = this.pop(fiber);
    const list = this.pop(fiber);
    if (!isListValue(list)) {
      throw new Error("LIST_PUSH: requires list");
    }
    // Mutate in place for performance
    list.v.push(item);
    this.push(fiber, list);
    frame.pc++;
    return undefined;
  }

  private execListGet(fiber: Fiber, frame: Frame): undefined {
    const index = this.pop(fiber);
    const list = this.pop(fiber);
    if (!isListValue(list)) {
      throw new Error("LIST_GET: requires list");
    }
    if (!isNumberValue(index)) {
      throw new Error("LIST_GET: index must be number");
    }
    const idx = MathOps.floor(index.v);
    const item = list.v.get(idx);
    this.push(fiber, item ?? V.nil());
    frame.pc++;
    return undefined;
  }

  private execListSet(fiber: Fiber, frame: Frame): undefined {
    const value = this.pop(fiber);
    const index = this.pop(fiber);
    const list = this.pop(fiber);
    if (!isListValue(list)) {
      throw new Error("LIST_SET: requires list");
    }
    if (!isNumberValue(index)) {
      throw new Error("LIST_SET: index must be number");
    }
    const idx = MathOps.floor(index.v);
    // Mutate in place for performance
    list.v.set(idx, value);
    this.push(fiber, list);
    frame.pc++;
    return undefined;
  }

  private execListLen(fiber: Fiber, frame: Frame): undefined {
    const list = this.pop(fiber);
    if (!isListValue(list)) {
      throw new Error("LIST_LEN: requires list");
    }
    this.push(fiber, V.num(list.v.size()));
    frame.pc++;
    return undefined;
  }

  // Map operations
  private execMapNew(fiber: Fiber, frame: Frame): undefined {
    this.push(fiber, V.map(new ValueDict(), "map:<unknown>"));
    frame.pc++;
    return undefined;
  }

  private execMapSet(fiber: Fiber, frame: Frame): undefined {
    const value = this.pop(fiber);
    const key = this.pop(fiber);
    const map = this.pop(fiber);
    if (!isMapValue(map)) {
      throw new Error("MAP_SET: requires map");
    }
    if (!isStringValue(key) && !isNumberValue(key)) {
      throw new Error("MAP_SET: key must be string or number");
    }
    // Mutate in place for performance
    map.v.set(key.v, value);
    this.push(fiber, map);
    frame.pc++;
    return undefined;
  }

  private execMapGet(fiber: Fiber, frame: Frame): undefined {
    const key = this.pop(fiber);
    const map = this.pop(fiber);
    if (!isMapValue(map)) {
      throw new Error("MAP_GET: requires map");
    }
    if (!isStringValue(key) && !isNumberValue(key)) {
      throw new Error("MAP_GET: key must be string or number");
    }
    const value = map.v.get(key.v);
    this.push(fiber, value ?? V.nil());
    frame.pc++;
    return undefined;
  }

  private execMapHas(fiber: Fiber, frame: Frame): undefined {
    const key = this.pop(fiber);
    const map = this.pop(fiber);
    if (!isMapValue(map)) {
      throw new Error("MAP_HAS: requires map");
    }
    if (!isStringValue(key) && !isNumberValue(key)) {
      throw new Error("MAP_HAS: key must be string or number");
    }
    this.push(fiber, V.bool(map.v.has(key.v)));
    frame.pc++;
    return undefined;
  }

  private execMapDelete(fiber: Fiber, frame: Frame): undefined {
    const key = this.pop(fiber);
    const map = this.pop(fiber);
    if (!isMapValue(map)) {
      throw new Error("MAP_DELETE: requires map");
    }
    if (!isStringValue(key) && !isNumberValue(key)) {
      throw new Error("MAP_DELETE: key must be string or number");
    }
    // Mutate in place for performance
    map.v.delete(key.v);
    this.push(fiber, map);
    frame.pc++;
    return undefined;
  }

  // Struct operations
  private execStructNew(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    const numFields = ins.a ?? 0;
    const fields = new Dict<string, Value>();

    for (let i = 0; i < numFields; i++) {
      const value = this.pop(fiber);
      const fieldName = this.pop(fiber);
      if (!isStringValue(fieldName)) {
        throw new Error("STRUCT_NEW: field name must be string");
      }
      fields.set(fieldName.v, value);
    }

    // Use constant pool index b for typeId if provided, otherwise generic
    let typeId = "struct:<anonymous>";
    if (ins.b !== undefined && ins.b >= 0 && ins.b < this.prog.constants.size()) {
      const typeIdVal = this.prog.constants.get(ins.b);
      if (typeIdVal && isStringValue(typeIdVal)) {
        typeId = typeIdVal.v;
      }
    }

    this.push(fiber, V.struct(fields, typeId));
    frame.pc++;
    return undefined;
  }

  private execStructGet(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    const fieldName = this.pop(fiber);
    const struct = this.pop(fiber);
    if (!isStructValue(struct)) {
      throw new Error("STRUCT_GET: requires struct");
    }
    if (!isStringValue(fieldName)) {
      throw new Error("STRUCT_GET: field name must be string");
    }
    const value = struct.v?.get(fieldName.v);
    this.push(fiber, value ?? V.nil());
    frame.pc++;
    return undefined;
  }

  private execStructSet(fiber: Fiber, ins: Instr, frame: Frame): undefined {
    const value = this.pop(fiber);
    const fieldName = this.pop(fiber);
    const struct = this.pop(fiber);
    if (!isStructValue(struct)) {
      throw new Error("STRUCT_SET: requires struct");
    }
    if (!isStringValue(fieldName)) {
      throw new Error("STRUCT_SET: field name must be string");
    }
    // Mutate in place for performance
    struct.v?.set(fieldName.v, value);
    this.push(fiber, struct);
    frame.pc++;
    return undefined;
  }

  private execGetField(fiber: Fiber, frame: Frame): undefined {
    const fieldName = this.pop(fiber);
    const source = this.pop(fiber);

    if (!isStringValue(fieldName)) {
      throw new Error("GET_FIELD: field name must be string");
    }

    let result: Value | undefined;

    if (isStructValue(source)) {
      // Check for a registered fieldGetter on the struct type
      const typeDef = this.services.types.get(source.typeId) as StructTypeDef | undefined;
      if (typeDef?.fieldGetter) {
        result = typeDef.fieldGetter(source, fieldName.v, fiber.executionContext);
      } else {
        result = source.v?.get(fieldName.v);
      }
    } else {
      result = NIL_VALUE;
    }

    this.push(fiber, result ?? V.nil());
    frame.pc++;
    return undefined;
  }

  private execSetField(fiber: Fiber, frame: Frame): undefined {
    const value = deepCopyValue(this.pop(fiber), this.services.types, fiber.executionContext);
    const fieldName = this.pop(fiber);
    const source = this.pop(fiber);

    if (!isStringValue(fieldName)) {
      throw new Error("SET_FIELD: field name must be string");
    }

    if (isStructValue(source)) {
      // Check for a registered fieldSetter on the struct type
      const typeDef = this.services.types.get(source.typeId) as StructTypeDef | undefined;
      if (typeDef?.fieldSetter) {
        const success = typeDef.fieldSetter(source, fieldName.v, value, fiber.executionContext);
        if (!success) {
          throw new Error(`SET_FIELD: cannot set field '${fieldName.v}' on type ${source.typeId}`);
        }
      } else {
        // Mutate in place for performance
        source.v?.set(fieldName.v, value);
      }
      this.push(fiber, source);
    } else {
      throw new Error(`SET_FIELD: cannot set field '${fieldName.v}' on type ${source.t}`);
    }

    frame.pc++;
    return undefined;
  }

  resumeFiberFromHandle(fiber: Fiber, handleId: HandleId, scheduler: Scheduler): void {
    if (fiber.state !== FiberState.WAITING) {
      return;
    }

    if (!fiber.await || fiber.await.handleId !== handleId) {
      return;
    }

    const h = this.handles.get(handleId);
    if (!h) {
      const err: ErrorValue = { tag: "HostError", message: `Handle ${handleId} no longer exists` };
      fiber.lastError = err;
      fiber.pendingInjectedThrow = true;
      fiber.await = undefined;
      this.transitionState(fiber, FiberState.RUNNABLE);
      scheduler.enqueueRunnable(fiber.id);
      return;
    }

    const a = fiber.await;
    while (fiber.frames.size() > a.frameDepth) {
      fiber.frames.pop();
    }
    while (fiber.vstack.size() > a.stackHeight) {
      fiber.vstack.pop();
    }

    const frame = this.topFrame(fiber);
    if (frame) {
      frame.pc = a.resumePc;
    }

    fiber.await = undefined;
    this.transitionState(fiber, FiberState.RUNNABLE);

    if (h.state === HandleState.RESOLVED) {
      this.push(fiber, h.result ?? V.nil());
    } else {
      const err: ErrorValue =
        h.error ??
        (h.state === HandleState.CANCELLED
          ? { tag: "Cancelled", message: "Operation cancelled" }
          : { tag: "HostError", message: "Operation failed" });
      fiber.lastError = err;
      fiber.pendingInjectedThrow = true;
    }

    scheduler.enqueueRunnable(fiber.id);
  }

  cancelFiber(fiber: Fiber, scheduler: Scheduler): void {
    if (fiber.state === FiberState.DONE || fiber.state === FiberState.FAULT || fiber.state === FiberState.CANCELLED) {
      return;
    }

    if (fiber.state === FiberState.WAITING && fiber.await) {
      const h = this.handles.get(fiber.await.handleId);
      if (h) {
        h.waiters.delete(fiber.id);
      }
      fiber.await = undefined;
    }

    this.transitionState(fiber, FiberState.CANCELLED);
    fiber.lastError = { tag: "Cancelled", message: "Fiber cancelled" };
    scheduler.onFiberCancelled?.(fiber.id);
  }

  private topFrame(fiber: Fiber): Frame | undefined {
    const n = fiber.frames.size();
    return n > 0 ? fiber.frames.get(n - 1) : undefined;
  }

  private peek(fiber: Fiber): Value {
    const n = fiber.vstack.size();
    if (n <= 0) {
      throw new Error("Stack underflow: cannot peek empty stack");
    }
    return fiber.vstack.get(n - 1)!;
  }

  private pop(fiber: Fiber): Value {
    if (fiber.vstack.size() <= 0) {
      throw new Error("Stack underflow: cannot pop empty stack");
    }
    return fiber.vstack.pop()!;
  }

  private push(fiber: Fiber, v: Value): void {
    if (fiber.vstack.size() >= this.config.maxStackSize) {
      throw new Error(`Stack overflow: limit ${this.config.maxStackSize} exceeded`);
    }
    fiber.vstack.push(v);
  }

  /**
   * Resolve a named variable through the execution context resolution chain.
   *
   * Resolution order:
   * 1. Check if context has custom resolveVariable implementation
   * 2. Try local scope: getVariable(name)
   * 3. Try shared scope (if exists)
   * 4. Walk parent context chain
   * 5. Return nil if not found
   */
  private resolveVariable(fiber: Fiber, name: string): Value {
    const ctx = fiber.executionContext;

    // Try custom resolution if provided (try-catch for Roblox-TS compatibility)
    try {
      const resolverFn = (ctx as { resolveVariable?: (name: string) => Value | undefined }).resolveVariable;
      if (resolverFn) {
        const value = resolverFn(name);
        return value ?? V.nil();
      }
    } catch {
      // No custom resolver, fall through to default
    }

    const value = ctx.getVariable(name);
    if (value !== undefined) {
      return value;
    }

    // Not found - return nil
    return V.nil();
  }

  /**
   * Set a resolved variable through the execution context resolution chain.
   * If the variable exists in any scope, updates it there.
   * Otherwise, creates it in the current context.
   */
  private setResolvedVariable(fiber: Fiber, name: string, value: Value): void {
    const ctx = fiber.executionContext;

    // Try custom setter if provided (try-catch for Roblox-TS compatibility)
    try {
      const setterFn = (ctx as { setResolvedVariable?: (name: string, value: Value) => boolean }).setResolvedVariable;
      if (setterFn) {
        setterFn(name, value);
        return;
      }
    } catch {
      // No custom setter, fall through to default
    }

    // Create/update in current context
    ctx.setVariable(name, value);
  }

  private doCall(fiber: Fiber, calleeId: number, argc: number): void {
    if (calleeId < 0 || calleeId >= this.prog.functions.size()) {
      throw new Error(`CALL: function ${calleeId} out of bounds`);
    }

    if (fiber.frames.size() >= this.config.maxFrameDepth) {
      throw new Error(`Stack overflow: frame depth limit ${this.config.maxFrameDepth} exceeded`);
    }

    const callee = this.prog.functions.get(calleeId)!;
    if (argc !== callee.numParams) {
      throw new Error(`CALL: argc ${argc} != numParams ${callee.numParams}`);
    }

    // Pop arguments and store in reverse order to avoid double reversal
    const args = List.empty<Value>();
    for (let i = 0; i < argc; i++) {
      args.push(V.nil()); // Pre-allocate space
    }
    for (let i = argc - 1; i >= 0; i--) {
      args.set(i, this.pop(fiber));
    }

    const caller = this.topFrame(fiber);
    if (caller) caller.pc++;

    const base = fiber.vstack.size();

    fiber.frames.push({ funcId: calleeId, pc: 0, base });
  }

  private doRet(fiber: Fiber, retv: Value): boolean {
    const frame = fiber.frames.pop();
    if (!frame) {
      this.push(fiber, retv);
      return true;
    }

    // Debug mode: check for stack leaks before cleanup
    if (this.config.debugStackChecks) {
      const expectedStackSize = frame.base + 1; // base + return value that was just popped
      const actualStackSize = fiber.vstack.size();
      if (actualStackSize > frame.base) {
        const leaked = actualStackSize - frame.base;
        const fn = this.prog.functions.get(frame.funcId);
        const fnName = fn?.name ?? `func[${frame.funcId}]`;
        logger.warn(
          `[VM] Stack leak detected in ${fnName}: expected stack at ${frame.base}, found ${actualStackSize} (${leaked} extra values). Cleaning up.`
        );
      }
    }

    while (fiber.vstack.size() > frame.base) {
      fiber.vstack.pop();
    }

    if (fiber.frames.size() === 0) {
      this.push(fiber, retv);
      return true;
    }

    this.push(fiber, retv);
    return false;
  }

  private throwValue(fiber: Fiber, err: ErrorValue): boolean {
    fiber.await = undefined;

    while (fiber.handlers.size() > 0) {
      const h = fiber.handlers.pop()!;

      while (fiber.frames.size() > h.frameDepth) {
        fiber.frames.pop();
      }
      while (fiber.vstack.size() > h.stackHeight) {
        fiber.vstack.pop();
      }

      this.push(fiber, V.err(err));

      const frame = this.topFrame(fiber);
      if (frame) {
        frame.pc = h.catchPc;
      }

      return true;
    }

    fiber.lastError = err;
    return false;
  }

  private transitionState(fiber: Fiber, newState: FiberState): void {
    const validTransitions = VALID_TRANSITIONS[fiber.state];
    if (!validTransitions.has(newState)) {
      throw new Error(`Invalid state transition: ${fiber.state} -> ${newState}`);
    }
    fiber.state = newState;
  }

  private faultFiber(fiber: Fiber, err: ErrorValue, scheduler: Scheduler): void {
    fiber.lastError = err;
    this.transitionState(fiber, FiberState.FAULT);
    scheduler.onFiberFault?.(fiber.id, err);
  }
}

///////////////////////////
// Fiber Scheduler
///////////////////////////

export interface SchedulerConfig {
  maxFibersPerTick: number;
  defaultBudget: number;
  autoGcHandles: boolean;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  maxFibersPerTick: 64,
  defaultBudget: 1000,
  autoGcHandles: true,
};

export class FiberScheduler implements IFiberScheduler {
  private config: SchedulerConfig;
  private fibers = new Dict<number, Fiber>();
  private runQueue = List.empty<number>();
  private nextFiberId = 1;

  constructor(
    private vm: VM,
    config?: Partial<SchedulerConfig>
  ) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.vm.handles.events.on("completed", (handleId) => this.onHandleCompleted(handleId));
  }

  spawn(funcId: number, args: List<Value>, executionContext: ExecutionContext): number {
    const fiberId = this.nextFiberId++;
    const fiber = this.vm.spawnFiber(fiberId, funcId, args, executionContext);
    this.addFiber(fiber);
    return fiberId;
  }

  addFiber(fiber: Fiber): void {
    this.fibers.set(fiber.id, fiber);
    this.enqueueRunnable(fiber.id);
  }

  removeFiber(fiberId: number): void {
    this.fibers.delete(fiberId);
  }

  getFiber = (fiberId: number): Fiber | undefined => {
    return this.fibers.get(fiberId);
  };

  enqueueRunnable = (fiberId: number): void => {
    const fiber = this.getFiber(fiberId);
    if (!fiber) return;

    if (fiber.state !== FiberState.RUNNABLE) return;

    if (this.runQueue.contains(fiberId)) return;

    this.runQueue.push(fiberId);
  };

  onHandleCompleted = (handleId: HandleId): void => {
    const h = this.vm.handles.get(handleId);
    if (!h) return;

    const waiters = List.empty<number>();
    h.waiters.forEach((fid) => {
      waiters.push(fid);
    });
    h.waiters.clear();

    for (let i = 0; i < waiters.size(); i++) {
      const fiberId = waiters.get(i)!;
      const fiber = this.getFiber(fiberId);
      if (fiber) {
        this.vm.resumeFiberFromHandle(fiber, handleId, this);
      }
    }

    if (this.config.autoGcHandles && h.state !== HandleState.PENDING) {
      this.vm.handles.delete(handleId);
    }
  };

  onFiberWaiting = (fiberId: number, handleId: HandleId): void => {
    // Fiber removed from runnable set by state transition
  };

  onFiberDone = (fiberId: number, result?: Value): void => {
    // Fiber can be removed or kept for result inspection
  };

  onFiberFault = (fiberId: number, err: ErrorValue): void => {
    // Fiber faulted - log or inspect as needed
  };

  onFiberCancelled = (fiberId: number): void => {
    // Fiber cancelled
  };

  cancel(fiberId: number): void {
    const fiber = this.getFiber(fiberId);
    if (fiber) {
      this.vm.cancelFiber(fiber, this);
    }
  }

  tick(): number {
    let executed = 0;
    const maxFibers = this.config.maxFibersPerTick;

    while (this.runQueue.size() > 0 && executed < maxFibers) {
      const fiberId = this.runQueue.shift()!;
      const fiber = this.getFiber(fiberId);

      if (!fiber || fiber.state !== FiberState.RUNNABLE) {
        continue;
      }

      fiber.instrBudget = this.config.defaultBudget;

      const result = this.vm.runFiber(fiber, this);

      switch (result.status) {
        case VmStatus.YIELDED:
          this.enqueueRunnable(fiberId);
          break;
        case VmStatus.WAITING:
          break;
        case VmStatus.DONE:
        case VmStatus.FAULT:
          break;
      }

      executed++;
    }

    return executed;
  }

  getStats(): {
    totalFibers: number;
    runnableFibers: number;
    waitingFibers: number;
    doneFibers: number;
    faultedFibers: number;
    cancelledFibers: number;
    pendingHandles: number;
  } {
    let runnable = 0;
    let waiting = 0;
    let done = 0;
    let faulted = 0;
    let cancelled = 0;

    for (const [, fiber] of this.fibers.entries().toArray()) {
      switch (fiber.state) {
        case FiberState.RUNNABLE:
          runnable++;
          break;
        case FiberState.WAITING:
          waiting++;
          break;
        case FiberState.DONE:
          done++;
          break;
        case FiberState.FAULT:
          faulted++;
          break;
        case FiberState.CANCELLED:
          cancelled++;
          break;
      }
    }

    return {
      totalFibers: this.fibers.size(),
      runnableFibers: runnable,
      waitingFibers: waiting,
      doneFibers: done,
      faultedFibers: faulted,
      cancelledFibers: cancelled,
      pendingHandles: this.vm.handles.size(),
    };
  }

  gc(): number {
    let removed = 0;
    for (const [id, fiber] of this.fibers.entries().toArray()) {
      if (fiber.state === FiberState.DONE || fiber.state === FiberState.FAULT || fiber.state === FiberState.CANCELLED) {
        this.fibers.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
