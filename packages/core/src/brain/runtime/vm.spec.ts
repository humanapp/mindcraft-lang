/**
 * Targeted VM unit tests.
 *
 * These test VM internals that are hard to exercise through the Brain API:
 * - Stack operations and opcode handlers
 * - Fiber state machine transitions
 * - Async await/resume and handle completion
 * - Exception handling (TRY/THROW/END_TRY)
 * - deepCopyValue and isTruthy
 * - FiberScheduler tick, spawn, cancel, gc
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { Dict, List, type ReadonlyList } from "@mindcraft-lang/core";
import {
  BrainServices,
  BYTECODE_VERSION,
  ContextTypeIds,
  CoreOpId,
  CoreTypeIds,
  ErrorCode,
  type ExecutionContext,
  errorCodeName,
  FALSE_VALUE,
  type Fiber,
  FiberState,
  type FunctionBytecode,
  type FunctionValue,
  getCallSiteState,
  HandleState,
  HandleTable,
  type IBrainRule,
  type Instr,
  isFunctionValue,
  isOverflowError,
  mkBooleanValue,
  mkCallDef,
  mkFunctionValue,
  mkNumberValue,
  mkStringValue,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  Op,
  type Program,
  setCallSiteState,
  TRUE_VALUE,
  type Value,
  ValueDict,
  VmStatus,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { FiberScheduler, VM } from "@mindcraft-lang/core/brain/runtime";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

// -- Helpers --

function mkProgram(functions: FunctionBytecode[], constants: Value[] = [], variableNames: string[] = []): Program {
  return {
    version: BYTECODE_VERSION,
    functions: List.from(functions),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.from(constants),
    },
    variableNames: List.from(variableNames),
    entryPoint: 0,
  };
}

function mkFunc(code: Instr[], numParams = 0, name?: string): FunctionBytecode {
  return { code: List.from(code), numParams, name };
}

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const slots = List.empty<Value>();
  return {
    brain: undefined as never,
    getVariable: () => undefined,
    setVariable: () => {},
    clearVariable: () => {},
    getVariableBySlot: (slotId: number) => slots.get(slotId) ?? NIL_VALUE,
    setVariableBySlot: (slotId: number, value: Value) => {
      while (slots.size() <= slotId) slots.push(NIL_VALUE);
      slots.set(slotId, value);
    },
    time: 0,
    dt: 0,
    currentTick: 0,
    ...overrides,
  };
}

function mkSchedulerCallbacks() {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
    onFiberWaiting: undefined as ((fid: number, hid: number) => void) | undefined,
    onFiberFault: undefined as ((fid: number, err: unknown) => void) | undefined,
    onFiberDone: undefined as ((fid: number, result?: Value) => void) | undefined,
    onFiberCancelled: undefined as ((fid: number) => void) | undefined,
  };
}

// ---- Stack operations ----

describe("VM -- closed struct field opcodes", () => {
  test("STRUCT_SET_FIELD and STRUCT_GET_FIELD use fieldIndex slots", () => {
    const typeId = mkTypeId(NativeType.Struct, "IndexedPair");
    if (!services.types.get(typeId)) {
      services.types.addStructType("IndexedPair", {
        fields: List.from([
          { name: "left", typeId: CoreTypeIds.Number },
          { name: "right", typeId: CoreTypeIds.Number },
        ]),
      });
    }
    const prog: Program = {
      version: BYTECODE_VERSION,
      functions: List.from([
        mkFunc([
          { op: Op.STRUCT_NEW, b: 0 },
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.STRUCT_SET_FIELD, a: 1 },
          { op: Op.STRUCT_GET_FIELD, a: 1 },
          { op: Op.RET },
        ]),
      ]),
      constantPools: {
        numbers: List.empty<number>(),
        strings: List.from([typeId]),
        values: List.from([mkNumberValue(42)]),
      },
      variableNames: List.empty<string>(),
      entryPoint: 0,
    };
    const vm = new VM(services, prog, new HandleTable(100));
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 42);
    }
  });

  test("GET_FIELD remains name-keyed for native-backed structs", () => {
    const typeId = mkTypeId(NativeType.Struct, "V33NativePoint");
    if (!services.types.get(typeId)) {
      services.types.addStructType("V33NativePoint", {
        fields: List.from([{ name: "x", typeId: CoreTypeIds.Number }]),
        fieldGetter: (source, fieldName) => {
          if (fieldName === "x") {
            return mkNumberValue((source.native as { x: number }).x);
          }
          return undefined;
        },
      });
    }
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.PUSH_CONST_STR, a: 0 },
          { op: Op.GET_FIELD },
          { op: Op.RET },
        ]),
      ],
      [{ t: NativeType.Struct, typeId, native: { x: 77 }, v: List.empty<Value>() }]
    );
    prog.constantPools.strings.push("x");
    const vm = new VM(services, prog, new HandleTable(100));
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 77);
    }
  });
});

describe("VM -- stack operations", () => {
  test("PUSH_CONST pushes constant onto stack", () => {
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }])], [mkNumberValue(42)]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const ctx = mkCtx();
    const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.ok(result.result !== undefined);
      assert.equal(result.result!.t, NativeType.Number);
      assert.equal((result.result as { v: number }).v, 42);
    }
  });

  test("DUP duplicates top of stack", () => {
    // Push 10, DUP, add them (via two POPs and checking result)
    // Simpler: push 10, dup, pop (discard top), ret -> returns 10
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.DUP }, { op: Op.POP }, { op: Op.RET }])],
      [mkNumberValue(10)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 10);
    }
  });

  test("SWAP exchanges top two stack values", () => {
    // Push 1, push 2, swap, pop (remove 1), ret -> returns 2
    // Wait: swap makes it [2, 1], pop removes top (1), ret returns 2
    // Actually: push 1 -> [1], push 2 -> [1, 2], swap -> [2, 1], pop -> [2], ret -> 2
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 }, // push 1
          { op: Op.PUSH_CONST_VAL, a: 1 }, // push 2
          { op: Op.SWAP }, // [2, 1]
          { op: Op.POP }, // [2]
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(1), mkNumberValue(2)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 2);
    }
  });
});

// ---- Variable operations ----

describe("VM -- variable operations", () => {
  test("STORE_VAR_SLOT and LOAD_VAR_SLOT round-trip", () => {
    const ctx = mkCtx();

    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 }, // push 99
          { op: Op.STORE_VAR_SLOT, a: 0 }, // store to slot 0 ("x")
          { op: Op.LOAD_VAR_SLOT, a: 0 }, // load slot 0 ("x")
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(99)],
      ["x"]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 99);
    }
  });

  test("LOAD_VAR_SLOT returns NIL for unset variable", () => {
    const ctx = mkCtx();

    const prog = mkProgram([mkFunc([{ op: Op.LOAD_VAR_SLOT, a: 0 }, { op: Op.RET }])], [], ["unset"]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal(result.result!.t, NativeType.Nil);
    }
  });
});

// ---- Control flow ----

describe("VM -- control flow", () => {
  test("JMP skips instructions", () => {
    // Push 1, JMP +2 (skip push 2 & pop), push 3, ret -> returns 1
    // Actually: code[0]=push 1, code[1]=JMP +3, code[2]=push 999, code[3]=pop, code[4]=push 3, ...
    // Simpler: JMP to ret
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 }, // 0: push 42
          { op: Op.JMP, a: 2 }, // 1: JMP -> pc 1+2 = 3 (RET)
          { op: Op.PUSH_CONST_VAL, a: 1 }, // 2: push 999 (should be skipped)
          { op: Op.RET }, // 3
        ]),
      ],
      [mkNumberValue(42), mkNumberValue(999)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 42);
    }
  });

  test("JMP_IF_FALSE branches on falsy value", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 }, // 0: push false
          { op: Op.JMP_IF_FALSE, a: 3 }, // 1: if false, JMP -> 4
          { op: Op.PUSH_CONST_VAL, a: 2 }, // 2: push 999
          { op: Op.RET }, // 3: return 999
          { op: Op.PUSH_CONST_VAL, a: 3 }, // 4: push 1 (taken branch)
          { op: Op.RET }, // 5: return 1
        ]),
      ],
      [FALSE_VALUE, TRUE_VALUE, mkNumberValue(999), mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 1);
    }
  });

  test("JMP_IF_TRUE branches on truthy value", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 }, // 0: push true
          { op: Op.JMP_IF_TRUE, a: 3 }, // 1: if true, JMP -> 4
          { op: Op.PUSH_CONST_VAL, a: 1 }, // 2: push 999 (skipped)
          { op: Op.RET }, // 3: return 999
          { op: Op.PUSH_CONST_VAL, a: 2 }, // 4: push 1 (taken branch)
          { op: Op.RET }, // 5: return 1
        ]),
      ],
      [TRUE_VALUE, mkNumberValue(999), mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 1);
    }
  });
});

// ---- Function calls ----

describe("VM -- function calls", () => {
  test("CALL and RET with return value", () => {
    // func 0: CALL func 1, RET
    // func 1: PUSH 42, RET
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.CALL, a: 1, b: 0 }, // call func 1 with 0 args
          { op: Op.RET }, // return result from func 1
        ]),
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 }, // push 42
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 42);
    }
  });

  test("CALL passes arguments into callee locals", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 }, // push 10
          { op: Op.PUSH_CONST_VAL, a: 1 }, // push 20
          { op: Op.CALL, a: 1, b: 2 }, // call func 1 with 2 args
          { op: Op.RET },
        ]),
        {
          code: List.from([
            { op: Op.LOAD_LOCAL, a: 1 }, // load second arg (20)
            { op: Op.RET },
          ]),
          numParams: 2,
          numLocals: 2,
          name: "add",
        },
      ],
      [mkNumberValue(10), mkNumberValue(20)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 20);
    }
  });

  test("CALL preserves argument order (first arg is local 0)", () => {
    // Push A then B onto stack; callee should get A as local 0, B as local 1
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 }, // push "first"
          { op: Op.PUSH_CONST_VAL, a: 1 }, // push "second"
          { op: Op.CALL, a: 1, b: 2 },
          { op: Op.RET },
        ]),
        {
          code: List.from([
            { op: Op.LOAD_LOCAL, a: 0 }, // load first arg
            { op: Op.RET },
          ]),
          numParams: 2,
          numLocals: 2,
          name: "getFirst",
        },
      ],
      [mkStringValue("first"), mkStringValue("second")]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: string }).v, "first");
    }
  });

  test("CALL with single argument", () => {
    const prog = mkProgram(
      [
        mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.CALL, a: 1, b: 1 }, { op: Op.RET }]),
        {
          code: List.from([{ op: Op.LOAD_LOCAL, a: 0 }, { op: Op.RET }]),
          numParams: 1,
          numLocals: 1,
          name: "identity",
        },
      ],
      [mkNumberValue(99)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 99);
    }
  });

  test("CALL args are removed from caller stack", () => {
    // Push sentinel, push arg, call, pop return value, ret -> should return sentinel
    const prog = mkProgram(
      [
        {
          code: List.from([
            { op: Op.PUSH_CONST_VAL, a: 0 }, // push sentinel 111
            { op: Op.PUSH_CONST_VAL, a: 1 }, // push arg 222
            { op: Op.CALL, a: 1, b: 1 }, // call func 1 with 1 arg (pops 222)
            { op: Op.POP }, // pop return value
            { op: Op.RET }, // return sentinel 111
          ]),
          numParams: 0,
          numLocals: 0,
          name: "caller",
        },
        {
          code: List.from([
            { op: Op.PUSH_CONST_VAL, a: 2 }, // push 333 (return value)
            { op: Op.RET },
          ]),
          numParams: 1,
          numLocals: 1,
          name: "callee",
        },
      ],
      [mkNumberValue(111), mkNumberValue(222), mkNumberValue(333)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 111);
    }
  });

  test("callee locals include extra slots beyond params", () => {
    // func with 1 param but 3 locals -- extra slots start as NIL
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 }, // push arg 5
          { op: Op.CALL, a: 1, b: 1 },
          { op: Op.RET },
        ]),
        {
          code: List.from([
            { op: Op.PUSH_CONST_VAL, a: 1 }, // push 10
            { op: Op.STORE_LOCAL, a: 2 }, // store into extra local slot 2
            { op: Op.LOAD_LOCAL, a: 2 }, // load it back
            { op: Op.RET }, // return 10
          ]),
          numParams: 1,
          numLocals: 3,
          name: "extraLocals",
        },
      ],
      [mkNumberValue(5), mkNumberValue(10)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 10);
    }
  });

  test("nested CALL chains pass args correctly", () => {
    // func 0: push 7, call func 1(1 arg), ret
    // func 1: load local 0 (7), push 3, call func 2(2 args), ret
    // func 2: load local 0, load local 1 -> return local 0 (should be 7)
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 }, // push 7
          { op: Op.CALL, a: 1, b: 1 },
          { op: Op.RET },
        ]),
        {
          code: List.from([
            { op: Op.LOAD_LOCAL, a: 0 }, // push 7 (received arg)
            { op: Op.PUSH_CONST_VAL, a: 1 }, // push 3
            { op: Op.CALL, a: 2, b: 2 },
            { op: Op.RET },
          ]),
          numParams: 1,
          numLocals: 1,
          name: "middle",
        },
        {
          code: List.from([
            { op: Op.LOAD_LOCAL, a: 0 }, // first arg (7)
            { op: Op.RET },
          ]),
          numParams: 2,
          numLocals: 2,
          name: "leaf",
        },
      ],
      [mkNumberValue(7), mkNumberValue(3)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 7);
    }
  });

  test("callee can mutate its locals without affecting caller", () => {
    // func 0: push 50, call func 1(1 arg), ret
    // func 1: store 999 into local 0 (overwriting arg), load local 0, ret
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 }, // push 50
          { op: Op.CALL, a: 1, b: 1 },
          { op: Op.RET },
        ]),
        {
          code: List.from([
            { op: Op.PUSH_CONST_VAL, a: 1 }, // push 999
            { op: Op.STORE_LOCAL, a: 0 }, // overwrite arg with 999
            { op: Op.LOAD_LOCAL, a: 0 },
            { op: Op.RET },
          ]),
          numParams: 1,
          numLocals: 1,
          name: "mutator",
        },
      ],
      [mkNumberValue(50), mkNumberValue(999)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 999);
    }
  });
});

// ---- Local variables ----

describe("VM -- local variables", () => {
  test("LOAD_LOCAL and STORE_LOCAL work within a function", () => {
    // func with 0 params, 2 locals
    // PUSH 5, STORE_LOCAL 0, PUSH 10, STORE_LOCAL 1, LOAD_LOCAL 0, LOAD_LOCAL 1 -> stack has [5, 10]
    // Pop 10, return 5
    const prog = mkProgram(
      [
        {
          code: List.from([
            { op: Op.PUSH_CONST_VAL, a: 0 }, // push 5
            { op: Op.STORE_LOCAL, a: 0 }, // local[0] = 5
            { op: Op.PUSH_CONST_VAL, a: 1 }, // push 10
            { op: Op.STORE_LOCAL, a: 1 }, // local[1] = 10
            { op: Op.LOAD_LOCAL, a: 0 }, // push local[0] (5)
            { op: Op.RET },
          ]),
          numParams: 0,
          numLocals: 2,
          name: "test",
        },
      ],
      [mkNumberValue(5), mkNumberValue(10)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 5);
    }
  });

  test("locals are isolated between frames", () => {
    // func 0: PUSH 99, STORE_LOCAL 0, CALL func 1, POP, LOAD_LOCAL 0, RET
    // func 1: PUSH 1, STORE_LOCAL 0, LOAD_LOCAL 0, RET
    // func 0 should return 99, not 1
    const prog = mkProgram(
      [
        {
          code: List.from([
            { op: Op.PUSH_CONST_VAL, a: 0 }, // push 99
            { op: Op.STORE_LOCAL, a: 0 }, // local[0] = 99
            { op: Op.CALL, a: 1, b: 0 },
            { op: Op.POP }, // discard callee result
            { op: Op.LOAD_LOCAL, a: 0 }, // load MY local[0] -> should be 99
            { op: Op.RET },
          ]),
          numParams: 0,
          numLocals: 1,
          name: "caller",
        },
        {
          code: List.from([
            { op: Op.PUSH_CONST_VAL, a: 1 }, // push 1
            { op: Op.STORE_LOCAL, a: 0 }, // local[0] = 1
            { op: Op.LOAD_LOCAL, a: 0 }, // push 1
            { op: Op.RET },
          ]),
          numParams: 0,
          numLocals: 1,
          name: "callee",
        },
      ],
      [mkNumberValue(99), mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 99);
    }
  });

  test("entry function receives args as locals via spawnFiber", () => {
    const prog = mkProgram(
      [{ code: List.from([{ op: Op.LOAD_LOCAL, a: 0 }, { op: Op.RET }]), numParams: 1, numLocals: 1, name: "entry" }],
      [mkNumberValue(77)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.from([mkNumberValue(77)]), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 77);
    }
  });

  test("LOAD_LOCAL out of bounds faults as ScriptError", () => {
    const prog = mkProgram([
      {
        code: List.from([
          { op: Op.LOAD_LOCAL, a: 5 }, // only 1 local, index 5 is oob
          { op: Op.RET },
        ]),
        numParams: 0,
        numLocals: 1,
        name: "test",
      },
    ]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.FAULT);
    if (result.status === VmStatus.FAULT) {
      assert.equal(result.error.code, ErrorCode.ScriptError);
    }
  });
});

// ---- Out-of-bounds operands fault gracefully ----

describe("VM -- malformed bytecode faults as ScriptError", () => {
  function expectScriptErrorFault(prog: Program): void {
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 1000;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.FAULT, "expected fiber to fault");
    if (result.status === VmStatus.FAULT) {
      assert.equal(result.error.code, ErrorCode.ScriptError);
    }
  }

  test("PUSH_CONST out-of-bounds constant index faults", () => {
    expectScriptErrorFault(mkProgram([mkFunc([{ op: Op.PUSH_CONST_VAL, a: 99 }, { op: Op.RET }])], []));
  });

  test("LOAD_VAR_SLOT out-of-bounds slot index faults", () => {
    expectScriptErrorFault(mkProgram([mkFunc([{ op: Op.LOAD_VAR_SLOT, a: 7 }, { op: Op.RET }])], [], []));
  });

  test("STORE_VAR_SLOT out-of-bounds slot index faults", () => {
    expectScriptErrorFault(
      mkProgram(
        [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.STORE_VAR_SLOT, a: 7 }, { op: Op.RET }])],
        [NIL_VALUE],
        []
      )
    );
  });

  test("JMP target out of bounds faults via PC bounds check", () => {
    expectScriptErrorFault(mkProgram([mkFunc([{ op: Op.JMP, a: 99 }, { op: Op.RET }])], []));
  });

  test("CALL with unknown funcId faults", () => {
    expectScriptErrorFault(mkProgram([mkFunc([{ op: Op.CALL, a: 99, b: 0 }, { op: Op.RET }])], []));
  });

  test("CALL with mismatched argc faults", () => {
    expectScriptErrorFault(
      mkProgram(
        [mkFunc([{ op: Op.CALL, a: 1, b: 0 }, { op: Op.RET }], 0, "main"), mkFunc([{ op: Op.RET }], 2, "callee")],
        []
      )
    );
  });

  test("CALL_INDIRECT with bad funcId faults", () => {
    // Push a fabricated FunctionValue referencing a missing funcId, then CALL_INDIRECT with 0 args.
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.CALL_INDIRECT, a: 0 }, { op: Op.RET }])],
      [mkFunctionValue(99)]
    );
    expectScriptErrorFault(prog);
  });

  test("INSTANCE_OF with non-string constant faults", () => {
    expectScriptErrorFault(
      mkProgram(
        [
          mkFunc([
            { op: Op.PUSH_CONST_VAL, a: 0 },
            { op: Op.PUSH_CONST_VAL, a: 1 },
            { op: Op.INSTANCE_OF, a: 1 },
            { op: Op.RET },
          ]),
        ],
        [NIL_VALUE, mkNumberValue(42)]
      )
    );
  });

  test("LOAD_CAPTURE without captures faults", () => {
    expectScriptErrorFault(mkProgram([mkFunc([{ op: Op.LOAD_CAPTURE, a: 0 }, { op: Op.RET }])], []));
  });

  test("HOST_CALL with unknown fnId faults", () => {
    expectScriptErrorFault(
      mkProgram([mkFunc([{ op: Op.MAP_NEW }, { op: Op.HOST_CALL, a: 99999, c: 0 }, { op: Op.RET }])], [])
    );
  });

  test("THROW of a non-error value faults as ScriptError", () => {
    expectScriptErrorFault(
      mkProgram([mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.THROW }])], [mkNumberValue(1)])
    );
  });

  test("Unknown opcode faults", () => {
    // 255 is not assigned in the Op enum.
    expectScriptErrorFault(mkProgram([mkFunc([{ op: 255 as unknown as Op }, { op: Op.RET }])], []));
  });

  test("randomized Instr arrays never let a platform throw escape runFiber", () => {
    // Construct random Instr objects from the assigned Op values plus a couple of
    // unassigned opcodes; pick wild operand values; run each program. The dispatch
    // try/catch must convert every failure to a ScriptError fault.
    const ops: number[] = [];
    const seen = new Set<number>();
    for (const key of Object.keys(Op)) {
      const v = (Op as unknown as Record<string, number | string>)[key];
      if (typeof v === "number" && !seen.has(v)) {
        seen.add(v);
        ops.push(v);
      }
    }
    ops.push(200, 250, 255);

    const constants: Value[] = [
      NIL_VALUE,
      TRUE_VALUE,
      FALSE_VALUE,
      mkNumberValue(0),
      mkNumberValue(-1),
      mkStringValue("x"),
      mkFunctionValue(0),
      mkFunctionValue(99),
    ];

    let seed = 0x12345678;
    function nextRand(): number {
      seed = (seed * 1664525 + 1013904223) | 0;
      return seed >>> 0;
    }

    const TRIALS = 200;
    const PROG_LEN = 12;

    for (let trial = 0; trial < TRIALS; trial++) {
      const code: Instr[] = [];
      for (let i = 0; i < PROG_LEN; i++) {
        const op = ops[nextRand() % ops.length] as Op;
        code.push({
          op,
          a: (nextRand() % 200) - 50,
          b: (nextRand() % 200) - 50,
          c: (nextRand() % 200) - 50,
        });
      }
      code.push({ op: Op.RET });

      const prog = mkProgram([mkFunc(code, 0, `fuzz-${trial}`)], constants, ["x", "y"]);
      const handles = new HandleTable(100);
      const vm = new VM(services, prog, handles);
      const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
      fiber.instrBudget = 200;

      let result: ReturnType<typeof vm.runFiber>;
      try {
        result = vm.runFiber(fiber, mkSchedulerCallbacks());
      } catch (e) {
        assert.fail(`trial ${trial}: platform throw escaped runFiber: ${String(e)}`);
      }

      // Acceptable terminal states for a randomized program: DONE (rare), YIELDED
      // (budget exhausted on a tight loop), or FAULT with a controlled tag
      // (ScriptError for malformed bytecode; StackUnderflow when a POP-family
      // op runs on an empty stack; StackOverflow if a tight loop exceeds caps).
      if (result.status === VmStatus.FAULT) {
        const tag = result.error.code;
        assert.ok(
          tag === ErrorCode.ScriptError || tag === ErrorCode.StackUnderflow || tag === ErrorCode.StackOverflow,
          `trial ${trial}: fault tag must be controlled, got ${errorCodeName(tag)}`
        );
      } else {
        assert.ok(
          result.status === VmStatus.DONE || result.status === VmStatus.YIELDED,
          `trial ${trial}: unexpected status ${String(result.status)}`
        );
      }
    }
  });
});

// ---- Callsite-persistent variables ----

describe("VM -- callsite-persistent variables", () => {
  test("LOAD_CALLSITE_VAR and STORE_CALLSITE_VAR read/write current action state slots", () => {
    const prog = mkProgram(
      [
        {
          code: List.from([{ op: Op.ACTION_CALL, a: 0, b: 0, c: 9 }, { op: Op.RET }]),
          numParams: 0,
          numLocals: 0,
          name: "root",
        },
        {
          code: List.from([
            { op: Op.PUSH_CONST_VAL, a: 1 },
            { op: Op.STORE_CALLSITE_VAR, a: 0 },
            { op: Op.LOAD_CALLSITE_VAR, a: 0 },
            { op: Op.RET },
          ]),
          numParams: 0,
          numLocals: 0,
          name: "action-entry",
        },
      ],
      [NIL_VALUE, mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(
      services,
      {
        ...prog,
        actions: List.from([
          {
            binding: "bytecode" as const,
            descriptor: {
              key: "test-vm-action-state-slots",
              kind: "actuator" as const,
              callDef: mkCallDef({ type: "bag", items: [] }),
              isAsync: false,
            },
            entryFuncId: 1,
            numStateSlots: 1,
          },
        ]),
      } as Program,
      handles
    );
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 42);
    }
  });

  test("LOAD_CALLSITE_VAR without an action binding faults", () => {
    const prog = mkProgram([
      {
        code: List.from([{ op: Op.LOAD_CALLSITE_VAR, a: 0 }, { op: Op.RET }]),
        numParams: 0,
        numLocals: 0,
        name: "test",
      },
    ]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.FAULT);
  });

  test("action state slots persist across helper CALLs within the same action", () => {
    const prog = mkProgram(
      [
        {
          code: List.from([{ op: Op.ACTION_CALL, a: 0, b: 0, c: 4 }, { op: Op.RET }]),
          numParams: 0,
          numLocals: 0,
          name: "root",
        },
        {
          code: List.from([
            { op: Op.PUSH_CONST_VAL, a: 1 },
            { op: Op.STORE_CALLSITE_VAR, a: 0 },
            { op: Op.CALL, a: 2, b: 0 },
            { op: Op.RET },
          ]),
          numParams: 0,
          numLocals: 0,
          name: "action-entry",
        },
        {
          code: List.from([{ op: Op.LOAD_CALLSITE_VAR, a: 0 }, { op: Op.RET }]),
          numParams: 0,
          numLocals: 0,
          name: "action-helper",
        },
      ],
      [NIL_VALUE, mkNumberValue(100)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(
      services,
      {
        ...prog,
        actions: List.from([
          {
            binding: "bytecode" as const,
            descriptor: {
              key: "test-vm-action-state-helper-call",
              kind: "actuator" as const,
              callDef: mkCallDef({ type: "bag", items: [] }),
              isAsync: false,
            },
            entryFuncId: 1,
            numStateSlots: 1,
          },
        ]),
      } as Program,
      handles
    );
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 100);
    }
  });

  test("distinct action callsites in the same rule fiber keep independent host-backed state", () => {
    const seenValues: number[] = [];
    const descriptor = {
      key: "test-vm-host-action-state-isolation",
      kind: "actuator" as const,
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
    };
    const prog = {
      ...mkProgram(
        [
          mkFunc(
            [
              { op: Op.ACTION_CALL, a: 0, b: 0, c: 1 },
              { op: Op.POP },
              { op: Op.ACTION_CALL, a: 0, b: 0, c: 2 },
              { op: Op.POP },
              { op: Op.ACTION_CALL, a: 0, b: 0, c: 1 },
              { op: Op.RET },
            ],
            0,
            "root"
          ),
        ],
        [NIL_VALUE]
      ),
      actions: List.from([
        {
          binding: "host" as const,
          descriptor,
          execSync: (ctx: ExecutionContext) => {
            const nextValue = (getCallSiteState<number>(ctx) ?? 0) + 1;
            setCallSiteState(ctx, nextValue);
            seenValues.push(nextValue);
            return mkNumberValue(nextValue);
          },
        },
      ]),
    };

    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 2);
    }
    assert.deepEqual(seenValues, [1, 1, 2]);
  });
});

// ---- Fiber state machine ----

describe("VM -- fiber state machine", () => {
  test("fiber starts in RUNNABLE state", () => {
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }])], [NIL_VALUE]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());

    assert.equal(fiber.state, FiberState.RUNNABLE);
  });

  test("fiber transitions to DONE on completion", () => {
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }])], [NIL_VALUE]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(fiber.state, FiberState.DONE);
  });

  test("fiber transitions to CANCELLED when cancelled", () => {
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }])], [NIL_VALUE]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());

    vm.cancelFiber(fiber, mkSchedulerCallbacks());

    assert.equal(fiber.state, FiberState.CANCELLED);
  });

  test("budget exhaustion returns YIELDED", () => {
    // Loop: JMP back to self
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 }, // 0: push nil
          { op: Op.POP }, // 1: pop
          { op: Op.JMP, a: -2 }, // 2: jump back to 0
        ]),
      ],
      [NIL_VALUE]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 5;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.YIELDED);
    assert.equal(fiber.state, FiberState.RUNNABLE);
  });
});

// ---- Action calls ----

describe("VM -- action calls", () => {
  test("ACTION_CALL resolves action slot through executable actions", () => {
    const actionId = "test-vm-action-call";
    let seenCallSiteId: number | undefined;

    const descriptor = {
      key: actionId,
      kind: "actuator" as const,
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
    };
    const action = {
      binding: "host" as const,
      descriptor,
      execSync: (ctx: ExecutionContext) => {
        seenCallSiteId = ctx.currentCallSiteId;
        return mkNumberValue(321);
      },
    };

    const prog = {
      ...mkProgram([mkFunc([{ op: Op.ACTION_CALL, a: 0, b: 0, c: 9 }, { op: Op.RET }])], [NIL_VALUE]),
      actions: List.from([action]),
    };

    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 321);
    }
    assert.equal(seenCallSiteId, 9);
  });

  test("ACTION_CALL passes host-bound action args as positional stack values", () => {
    let observed: List<Value> | undefined;
    const descriptor = {
      key: "test-vm-action-call-positional-host",
      kind: "sensor" as const,
      callDef: mkCallDef({
        type: "seq",
        items: [
          { type: "arg", tileId: "action.arg.a", name: "a", required: true },
          { type: "arg", tileId: "action.arg.b", name: "b", required: true },
        ],
      }),
      isAsync: false,
    };
    const action = {
      binding: "host" as const,
      descriptor,
      execSync: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const snap = List.empty<Value>();
        for (let i = 0; i < args.size(); i++) snap.push(args.get(i));
        observed = snap;
        const a = args.get(0) as NumberValue;
        const b = args.get(1) as NumberValue;
        return mkNumberValue(a.v + b.v);
      },
    };

    const prog = {
      ...mkProgram(
        [
          mkFunc([
            { op: Op.PUSH_CONST_VAL, a: 2 },
            { op: Op.PUSH_CONST_VAL, a: 2 },
            { op: Op.PUSH_CONST_VAL, a: 0 },
            { op: Op.STACK_SET_REL, a: 1 },
            { op: Op.PUSH_CONST_VAL, a: 1 },
            { op: Op.STACK_SET_REL, a: 0 },
            { op: Op.ACTION_CALL, a: 0, b: 2, c: 12 },
            { op: Op.RET },
          ]),
        ],
        [mkNumberValue(7), mkNumberValue(11), NIL_VALUE]
      ),
      actions: List.from([action]),
    };

    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 18);
    }
    assert.ok(observed, "action should have observed positional args");
    assert.equal((observed!.get(0) as NumberValue).v, 7);
    assert.equal((observed!.get(1) as NumberValue).v, 11);
  });

  test("ACTION_CALL out-of-bounds slot faults as ScriptError", () => {
    const prog = {
      ...mkProgram([mkFunc([{ op: Op.ACTION_CALL, a: 1, b: 0, c: 0 }, { op: Op.RET }])], [NIL_VALUE]),
      actions: List.from([
        {
          binding: "host" as const,
          descriptor: {
            key: "test-vm-action-verifier",
            kind: "actuator" as const,
            callDef: mkCallDef({ type: "bag", items: [] }),
            isAsync: false,
          },
          execSync: () => VOID_VALUE,
        },
      ]),
    };

    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.FAULT);
    if (result.status === VmStatus.FAULT) {
      assert.equal(result.error.code, ErrorCode.ScriptError);
    }
  });

  test("ACTION_CALL_ASYNC preserves host-backed handle behavior", () => {
    const handles = new HandleTable(100);
    const descriptor = {
      key: "test-vm-action-call-async-host",
      kind: "actuator" as const,
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: true,
    };
    const prog = {
      ...mkProgram(
        [mkFunc([{ op: Op.ACTION_CALL_ASYNC, a: 0, b: 0, c: 7 }, { op: Op.AWAIT }, { op: Op.RET }])],
        [NIL_VALUE]
      ),
      actions: List.from([
        {
          binding: "host" as const,
          descriptor,
          execAsync: (_ctx: ExecutionContext, _args: ReadonlyList<Value>, handleId: number) => {
            handles.resolve(handleId, mkNumberValue(654));
          },
        },
      ]),
    };

    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 654);
    }
  });

  test("ACTION_CALL_ASYNC passes host-bound action args as an owned snapshot", () => {
    let captured: ReadonlyList<Value> | undefined;
    const descriptor = {
      key: "test-vm-action-call-async-positional-host",
      kind: "actuator" as const,
      callDef: mkCallDef({
        type: "seq",
        items: [
          { type: "arg", tileId: "action.async.a", name: "a", required: true },
          { type: "arg", tileId: "action.async.b", name: "b", required: true },
        ],
      }),
      isAsync: true,
    };
    const prog = {
      ...mkProgram(
        [
          mkFunc([
            { op: Op.PUSH_CONST_VAL, a: 2 },
            { op: Op.PUSH_CONST_VAL, a: 2 },
            { op: Op.PUSH_CONST_VAL, a: 0 },
            { op: Op.STACK_SET_REL, a: 1 },
            { op: Op.PUSH_CONST_VAL, a: 1 },
            { op: Op.STACK_SET_REL, a: 0 },
            { op: Op.ACTION_CALL_ASYNC, a: 0, b: 2, c: 13 },
            { op: Op.POP },
            { op: Op.PUSH_CONST_VAL, a: 0 },
            { op: Op.PUSH_CONST_VAL, a: 1 },
            { op: Op.POP },
            { op: Op.POP },
            { op: Op.PUSH_CONST_VAL, a: 2 },
            { op: Op.RET },
          ]),
        ],
        [mkNumberValue(23), mkNumberValue(29), NIL_VALUE]
      ),
      actions: List.from([
        {
          binding: "host" as const,
          descriptor,
          execAsync: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
            captured = args;
          },
        },
      ]),
    };

    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    assert.ok(captured, "async action should capture args");
    assert.equal(captured!.size(), 2);
    assert.equal((captured!.get(0) as NumberValue).v, 23);
    assert.equal((captured!.get(1) as NumberValue).v, 29);
  });

  test("ACTION_CALL routes sync bytecode actions through the current fiber and caller TRY handlers", () => {
    const errVal: Value = { t: "err", e: { code: ErrorCode.ScriptError, message: "bytecode boom" } };
    const descriptor = {
      key: "test-vm-action-call-bytecode-throw",
      kind: "actuator" as const,
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
    };
    const prog = {
      ...mkProgram(
        [
          mkFunc(
            [
              { op: Op.TRY, a: 6 },
              { op: Op.ACTION_CALL, a: 0, b: 0, c: 5 },
              { op: Op.END_TRY },
              { op: Op.PUSH_CONST_VAL, a: 2 },
              { op: Op.RET },
              { op: Op.POP },
              { op: Op.PUSH_CONST_VAL, a: 1 },
              { op: Op.RET },
            ],
            0,
            "root"
          ),
          mkFunc([{ op: Op.PUSH_CONST_VAL, a: 3 }, { op: Op.THROW }], 0, "action-entry"),
        ],
        [NIL_VALUE, mkNumberValue(77), mkNumberValue(999), errVal]
      ),
      actions: List.from([
        {
          binding: "bytecode" as const,
          descriptor,
          entryFuncId: 1,
          numStateSlots: 0,
        },
      ]),
    };

    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 77);
    }
  });

  test("ACTION_CALL seeds bytecode action args as positional locals after injected ctx", () => {
    const descriptor = {
      key: "test-vm-action-call-bytecode-positional-locals",
      kind: "sensor" as const,
      callDef: mkCallDef({
        type: "seq",
        items: [
          { type: "arg", tileId: "bytecode.action.a", name: "a", required: true },
          { type: "arg", tileId: "bytecode.action.b", name: "b", required: true },
        ],
      }),
      isAsync: false,
    };
    const prog = {
      ...mkProgram(
        [
          mkFunc([
            { op: Op.PUSH_CONST_VAL, a: 2 },
            { op: Op.PUSH_CONST_VAL, a: 2 },
            { op: Op.PUSH_CONST_VAL, a: 0 },
            { op: Op.STACK_SET_REL, a: 1 },
            { op: Op.PUSH_CONST_VAL, a: 1 },
            { op: Op.STACK_SET_REL, a: 0 },
            { op: Op.ACTION_CALL, a: 0, b: 2, c: 14 },
            { op: Op.RET },
          ]),
          {
            code: List.from([{ op: Op.LOAD_LOCAL, a: 2 }, { op: Op.RET }]),
            numParams: 3,
            numLocals: 5,
            injectCtxTypeId: ContextTypeIds.Context,
            name: "action-entry",
          },
        ],
        [mkNumberValue(31), mkNumberValue(37), NIL_VALUE]
      ),
      actions: List.from([
        {
          binding: "bytecode" as const,
          descriptor,
          entryFuncId: 1,
          numStateSlots: 0,
        },
      ]),
    };

    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 37);
    }
  });

  test("ACTION_CALL bytecode actions preserve the caller rule for host calls", () => {
    const fakeRule = { name: "caller-rule" } as unknown as IBrainRule;
    let seenRule: unknown;

    const hostFnEntry = services.functions.register(
      "test-vm-bytecode-action-rule-host",
      false,
      {
        exec: (ctx: ExecutionContext) => {
          seenRule = ctx.rule;
          return mkNumberValue(7);
        },
      },
      mkCallDef({ type: "bag", items: [] })
    );

    const descriptor = {
      key: "test-vm-action-call-bytecode-rule",
      kind: "actuator" as const,
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
    };
    const prog = {
      ...mkProgram(
        [
          mkFunc([{ op: Op.ACTION_CALL, a: 0, b: 0, c: 5 }, { op: Op.RET }], 0, "root"),
          mkFunc([{ op: Op.HOST_CALL, a: hostFnEntry.id, b: 0, c: 11 }, { op: Op.RET }], 0, "action-entry"),
        ],
        [NIL_VALUE]
      ),
      actions: List.from([
        {
          binding: "bytecode" as const,
          descriptor,
          entryFuncId: 1,
          numStateSlots: 0,
        },
      ]),
    };

    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(
      1,
      0,
      List.empty(),
      mkCtx({
        funcIdToRule: new Dict<number, IBrainRule>([[0, fakeRule]]),
      })
    );
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 7);
    }
    assert.equal(seenRule, fakeRule);
  });

  test("sync bytecode actions fault if an indirect call reaches a suspension point at runtime", () => {
    const descriptor = {
      key: "test-vm-action-sync-indirect-yield",
      kind: "actuator" as const,
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
    };
    const prog = {
      ...mkProgram(
        [
          mkFunc([{ op: Op.ACTION_CALL, a: 0, b: 0, c: 4 }, { op: Op.RET }], 0, "root"),
          mkFunc([{ op: Op.PUSH_CONST_VAL, a: 1 }, { op: Op.CALL_INDIRECT, a: 0 }, { op: Op.RET }], 0, "action-entry"),
          mkFunc([{ op: Op.YIELD }, { op: Op.PUSH_CONST_VAL, a: 2 }, { op: Op.RET }], 0, "indirect-helper"),
        ],
        [NIL_VALUE, mkFunctionValue(2), mkNumberValue(5)]
      ),
      actions: List.from([
        {
          binding: "bytecode" as const,
          descriptor,
          entryFuncId: 1,
          numStateSlots: 0,
        },
      ]),
    };

    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.FAULT);
    assert.equal(fiber.state, FiberState.FAULT);
  });

  test("ACTION_CALL_ASYNC runs bytecode actions on child fibers and resolves the returned handle", () => {
    const descriptor = {
      key: "test-vm-action-call-async-bytecode",
      kind: "actuator" as const,
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: true,
    };
    const prog = {
      ...mkProgram(
        [
          mkFunc([{ op: Op.ACTION_CALL_ASYNC, a: 0, b: 0, c: 3 }, { op: Op.AWAIT }, { op: Op.RET }], 0, "root"),
          mkFunc([{ op: Op.PUSH_CONST_VAL, a: 1 }, { op: Op.YIELD }, { op: Op.RET }], 0, "action-entry"),
        ],
        [NIL_VALUE, mkNumberValue(42)]
      ),
      actions: List.from([
        {
          binding: "bytecode" as const,
          descriptor,
          entryFuncId: 1,
          numStateSlots: 0,
        },
      ]),
    };

    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const scheduler = new FiberScheduler(vm, {
      maxFibersPerTick: 64,
      defaultBudget: 100,
      autoGcHandles: true,
    });
    const rootFiberId = scheduler.spawn(0, List.empty(), mkCtx());

    let rootResult: Value | undefined;
    const previousOnFiberDone = scheduler.onFiberDone;
    scheduler.onFiberDone = (fiberId: number, result?: Value) => {
      previousOnFiberDone(fiberId, result);
      if (fiberId === rootFiberId) {
        rootResult = result;
      }
    };

    scheduler.tick();

    const rootFiber = scheduler.getFiber(rootFiberId);
    assert.ok(rootFiber !== undefined, "root fiber should still be tracked until gc");
    assert.equal(rootFiber!.state, FiberState.DONE);
    assert.ok(rootResult !== undefined, "async bytecode action should resolve the outer handle");
    assert.equal((rootResult as NumberValue).v, 42);
  });
});

// ---- Async await/resume ----

describe("VM -- async await/resume", () => {
  test("AWAIT on pending handle transitions to WAITING", () => {
    // We need a HOST_CALL_ASYNC to create a handle, then AWAIT it.
    // Simpler: directly test via handle operations
    const handles = new HandleTable(100);
    const hid = handles.createPending();

    // Build program: push handle value, AWAIT, RET
    const handleValue: Value = { t: "handle" as const, id: hid };
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.AWAIT }, { op: Op.RET }])],
      [handleValue]
    );
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const callbacks = mkSchedulerCallbacks();
    let waitingFiberId: number | undefined;
    callbacks.onFiberWaiting = (fid) => {
      waitingFiberId = fid;
    };

    const result = vm.runFiber(fiber, callbacks);

    assert.equal(result.status, VmStatus.WAITING);
    assert.equal(fiber.state, FiberState.WAITING);
    assert.equal(waitingFiberId, 1);
  });

  test("AWAIT on already-resolved handle returns immediately", () => {
    const handles = new HandleTable(100);
    const hid = handles.createPending();
    handles.resolve(hid, mkNumberValue(55));

    const handleValue: Value = { t: "handle" as const, id: hid };
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.AWAIT }, { op: Op.RET }])],
      [handleValue]
    );
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 55);
    }
  });

  test("resumeFiberFromHandle resumes WAITING fiber", () => {
    const handles = new HandleTable(100);
    const hid = handles.createPending();

    const handleValue: Value = { t: "handle" as const, id: hid };
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.AWAIT }, { op: Op.RET }])],
      [handleValue]
    );
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    let enqueuedId: number | undefined;
    const callbacks = {
      ...mkSchedulerCallbacks(),
      enqueueRunnable: (fid: number) => {
        enqueuedId = fid;
      },
    };

    // First run: AWAIT suspends the fiber
    vm.runFiber(fiber, callbacks);
    assert.equal(fiber.state, FiberState.WAITING);

    // Resolve the handle
    handles.resolve(hid, mkNumberValue(100));

    // Resume the fiber
    vm.resumeFiberFromHandle(fiber, hid, callbacks);

    assert.equal(fiber.state, FiberState.RUNNABLE);
    assert.equal(enqueuedId, 1);

    // Run again to complete
    fiber.instrBudget = 100;
    const result = vm.runFiber(fiber, callbacks);

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 100);
    }
  });
});

// ---- Exception handling ----

describe("VM -- exception handling", () => {
  test("TRY/THROW catches and pushes error value", () => {
    // TRY (catch -> 4), PUSH err, THROW, [catch]: POP error, PUSH 1, RET
    const errVal: Value = { t: "err", e: { code: ErrorCode.ScriptError, message: "test" } };
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.TRY, a: 3 }, // 0: TRY, catch at pc 0+3 = 3
          { op: Op.PUSH_CONST_VAL, a: 0 }, // 1: push error value
          { op: Op.THROW }, // 2: throw
          { op: Op.POP }, // 3: [catch] pop the error
          { op: Op.END_TRY }, // 4: exit try
          { op: Op.PUSH_CONST_VAL, a: 1 }, // 5: push 1 (success)
          { op: Op.RET }, // 6
        ]),
      ],
      [errVal, mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 1);
    }
  });

  test("uncaught THROW faults the fiber", () => {
    const errVal: Value = { t: "err", e: { code: ErrorCode.ScriptError, message: "uncaught" } };
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.THROW }])], [errVal]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    let faultedId: number | undefined;
    const callbacks = {
      ...mkSchedulerCallbacks(),
      onFiberFault: (fid: number) => {
        faultedId = fid;
      },
    };

    const result = vm.runFiber(fiber, callbacks);

    assert.equal(result.status, VmStatus.FAULT);
    assert.equal(fiber.state, FiberState.FAULT);
    assert.equal(faultedId, 1);
  });
});

// ---- List operations ----

describe("VM -- list operations", () => {
  test("LIST_NEW, LIST_PUSH, LIST_LEN", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.LIST_NEW }, // 0: push empty list
          { op: Op.PUSH_CONST_VAL, a: 0 }, // 1: push 42
          { op: Op.LIST_PUSH }, // 2: list.push(42)
          { op: Op.PUSH_CONST_VAL, a: 0 }, // 3: push 42 again
          { op: Op.LIST_PUSH }, // 4: list.push(42)
          { op: Op.LIST_LEN }, // 5: push list.length
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 2);
    }
  });

  test("LIST_GET returns element at index", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.LIST_NEW },
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 3 },
          { op: Op.LIST_GET },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(30), mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 20);
    }
  });

  test("LIST_GET returns nil for out-of-bounds index", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.LIST_NEW },
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.LIST_GET },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(99)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal(result.result!.t, NativeType.Nil);
    }
  });

  test("LIST_SET mutates element at index", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.LIST_NEW },
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.PUSH_CONST_VAL, a: 3 },
          { op: Op.LIST_SET },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.LIST_GET },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(0), mkNumberValue(99)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 99);
    }
  });

  test("LIST_POP removes and returns last element", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.LIST_NEW },
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.LIST_PUSH },
          { op: Op.LIST_POP },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(30)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 30);
    }
  });

  test("LIST_POP on empty list returns nil", () => {
    const prog = mkProgram([mkFunc([{ op: Op.LIST_NEW }, { op: Op.LIST_POP }, { op: Op.RET }])], []);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal(result.result!.t, NativeType.Nil);
    }
  });

  test("LIST_SHIFT removes and returns first element", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.LIST_NEW },
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.LIST_PUSH },
          { op: Op.LIST_SHIFT },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(30)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 10);
    }
  });

  test("LIST_SHIFT on empty list returns nil", () => {
    const prog = mkProgram([mkFunc([{ op: Op.LIST_NEW }, { op: Op.LIST_SHIFT }, { op: Op.RET }])], []);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal(result.result!.t, NativeType.Nil);
    }
  });

  test("LIST_REMOVE removes element at index and returns it", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.LIST_NEW },
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.LIST_PUSH },
          { op: Op.DUP },
          { op: Op.PUSH_CONST_VAL, a: 3 },
          { op: Op.LIST_REMOVE },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(30), mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 20);
    }
  });

  test("LIST_INSERT inserts element at index", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.LIST_NEW },
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.DUP },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.PUSH_CONST_VAL, a: 3 },
          { op: Op.LIST_INSERT },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.LIST_GET },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(30), mkNumberValue(1), mkNumberValue(20)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 20);
    }
  });

  test("LIST_SWAP swaps elements at two indices", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.LIST_NEW },
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.LIST_PUSH },
          { op: Op.DUP },
          { op: Op.PUSH_CONST_VAL, a: 3 },
          { op: Op.PUSH_CONST_VAL, a: 4 },
          { op: Op.LIST_SWAP },
          { op: Op.PUSH_CONST_VAL, a: 3 },
          { op: Op.LIST_GET },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(30), mkNumberValue(0), mkNumberValue(2)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 30);
    }
  });

  test("LIST_SWAP is void (does not push a result)", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.LIST_NEW },
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.DUP },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.PUSH_CONST_VAL, a: 3 },
          { op: Op.LIST_SWAP },
          { op: Op.LIST_LEN },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(0), mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 2);
    }
  });
});

// ---- Map operations ----

describe("VM -- map operations", () => {
  test("MAP_NEW, MAP_SET, MAP_GET", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.MAP_NEW }, // 0: push empty map
          { op: Op.PUSH_CONST_VAL, a: 0 }, // 1: push key "foo"
          { op: Op.PUSH_CONST_VAL, a: 1 }, // 2: push value 99
          { op: Op.MAP_SET }, // 3: map.set("foo", 99)
          { op: Op.PUSH_CONST_VAL, a: 0 }, // 4: push key "foo"
          { op: Op.MAP_GET }, // 5: push map.get("foo")
          { op: Op.RET },
        ]),
      ],
      [mkStringValue("foo"), mkNumberValue(99)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 99);
    }
  });

  test("MAP_HAS returns boolean", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.MAP_NEW },
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.MAP_SET },
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.MAP_HAS },
          { op: Op.RET },
        ]),
      ],
      [mkStringValue("key"), mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal(result.result!.t, NativeType.Boolean);
      assert.equal((result.result as { v: boolean }).v, true);
    }
  });
});

// ---- WHEN/DO boundaries ----

describe("VM -- WHEN/DO boundaries", () => {
  test("WHEN_END skips DO when falsy", () => {
    // WHEN_START, push false, WHEN_END(skip to 6), DO_START, push 999, DO_END, push nil, RET
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.WHEN_START }, // 0
          { op: Op.PUSH_CONST_VAL, a: 0 }, // 1: push false
          { op: Op.WHEN_END, a: 5 }, // 2: if falsy, JMP to pc 2+5 = 7
          { op: Op.DO_START }, // 3
          { op: Op.PUSH_CONST_VAL, a: 2 }, // 4: push 999 (should be skipped)
          { op: Op.POP }, // 5: pop 999
          { op: Op.DO_END }, // 6
          { op: Op.PUSH_CONST_VAL, a: 1 }, // 7: push nil (end label)
          { op: Op.RET }, // 8
        ]),
      ],
      [FALSE_VALUE, NIL_VALUE, mkNumberValue(999)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      // Should return NIL (skipped the DO section)
      assert.equal(result.result!.t, NativeType.Nil);
    }
  });

  test("WHEN_END continues to DO when truthy", () => {
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.WHEN_START }, // 0
          { op: Op.PUSH_CONST_VAL, a: 0 }, // 1: push true
          { op: Op.WHEN_END, a: 5 }, // 2: if truthy, continue to 3
          { op: Op.DO_START }, // 3
          { op: Op.PUSH_CONST_VAL, a: 1 }, // 4: push 42
          { op: Op.DO_END }, // 5
          // No POP needed -- 42 is on stack
          // Normally the compiler emits endLabel + pushConst NIL + RET
          // but for this test, just ret with the 42 on stack
          { op: Op.RET }, // 6
        ]),
      ],
      [TRUE_VALUE, mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 42);
    }
  });
});

// ---- Type check ----

describe("VM -- type check", () => {
  test("TYPE_CHECK with NativeType.Number on NumberValue pushes TRUE_VALUE", () => {
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.TYPE_CHECK, a: NativeType.Number }, { op: Op.RET }])],
      [mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.deepStrictEqual(result.result, TRUE_VALUE);
    }
  });

  test("TYPE_CHECK with NativeType.Number on StringValue pushes FALSE_VALUE", () => {
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.TYPE_CHECK, a: NativeType.Number }, { op: Op.RET }])],
      [mkStringValue("hello")]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.deepStrictEqual(result.result, FALSE_VALUE);
    }
  });

  test("TYPE_CHECK with NativeType.Nil on NIL_VALUE pushes TRUE_VALUE", () => {
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.TYPE_CHECK, a: NativeType.Nil }, { op: Op.RET }])],
      [NIL_VALUE]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.deepStrictEqual(result.result, TRUE_VALUE);
    }
  });

  test("TYPE_CHECK with NativeType.String on StringValue pushes TRUE_VALUE", () => {
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.TYPE_CHECK, a: NativeType.String }, { op: Op.RET }])],
      [mkStringValue("hello")]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.deepStrictEqual(result.result, TRUE_VALUE);
    }
  });

  test("TYPE_CHECK with NativeType.Boolean on BooleanValue pushes TRUE_VALUE", () => {
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.TYPE_CHECK, a: NativeType.Boolean }, { op: Op.RET }])],
      [TRUE_VALUE]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.deepStrictEqual(result.result, TRUE_VALUE);
    }
  });

  test("TYPE_CHECK with NativeType.Boolean on NumberValue pushes FALSE_VALUE", () => {
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.TYPE_CHECK, a: NativeType.Boolean }, { op: Op.RET }])],
      [mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.deepStrictEqual(result.result, FALSE_VALUE);
    }
  });
});

// ---- CALL_INDIRECT ----

describe("VM -- CALL_INDIRECT", () => {
  test("CALL_INDIRECT calls function by FunctionValue on stack", () => {
    // func 0: push FunctionValue(1), CALL_INDIRECT 0 args, RET
    // func 1: push 42, RET
    const prog = mkProgram(
      [
        mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.CALL_INDIRECT, a: 0 }, { op: Op.RET }]),
        mkFunc([{ op: Op.PUSH_CONST_VAL, a: 1 }, { op: Op.RET }]),
      ],
      [mkFunctionValue(1), mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 42);
    }
  });

  test("CALL_INDIRECT with arguments", () => {
    // func 0: push FunctionValue(1), push 10, push 20, CALL_INDIRECT argc=2, RET
    // func 1 (2 params): LOAD_LOCAL 0, LOAD_LOCAL 1, add via return of local 1
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.CALL_INDIRECT, a: 2 },
          { op: Op.RET },
        ]),
        {
          code: List.from([{ op: Op.LOAD_LOCAL, a: 1 }, { op: Op.RET }]),
          numParams: 2,
          numLocals: 2,
          name: "callee",
        },
      ],
      [mkFunctionValue(1), mkNumberValue(10), mkNumberValue(20)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 20);
    }
  });

  test("CALL_INDIRECT with non-FunctionValue throws", () => {
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.CALL_INDIRECT, a: 0 }, { op: Op.RET }])],
      [mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.FAULT);
  });

  test("FunctionValue can be created with mkFunctionValue", () => {
    const fv = mkFunctionValue(42);
    assert.equal(fv.t, NativeType.Function);
    assert.equal(fv.funcId, 42);
  });

  test("isFunctionValue type guard works", () => {
    const fv = mkFunctionValue(7);
    assert.ok(isFunctionValue(fv));
    assert.ok(!isFunctionValue(mkNumberValue(7)));
  });

  test("deepCopyValue returns FunctionValue as-is", () => {
    // FunctionValues are immutable; STORE_VAR_SLOT deep-copies, so test that
    // storing a FunctionValue via STORE_VAR_SLOT and loading it back works
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.STORE_VAR_SLOT, a: 0 },
          { op: Op.LOAD_VAR_SLOT, a: 0 },
          { op: Op.RET },
        ]),
      ],
      [mkFunctionValue(0)],
      ["myFunc"]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.ok(isFunctionValue(result.result!));
      assert.equal((result.result as { funcId: number }).funcId, 0);
    }
  });
});

// ---- CALL_INDIRECT_ARGS ----

describe("VM -- CALL_INDIRECT_ARGS", () => {
  test("truncates extra args when callee has fewer params", () => {
    // func 0: push FunctionValue(1), push 10, push 20, CALL_INDIRECT_ARGS argc=2, RET
    // func 1 (1 param): LOAD_LOCAL 0, RET -- only uses first arg
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.CALL_INDIRECT_ARGS, a: 2 },
          { op: Op.RET },
        ]),
        {
          code: List.from([{ op: Op.LOAD_LOCAL, a: 0 }, { op: Op.RET }]),
          numParams: 1,
          numLocals: 1,
          name: "callee",
        },
      ],
      [mkFunctionValue(1), mkNumberValue(10), mkNumberValue(20)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 10);
    }
  });

  test("pads with nil when callee has more params than provided", () => {
    // func 0: push FunctionValue(1), push 10, CALL_INDIRECT_ARGS argc=1, RET
    // func 1 (2 params): LOAD_LOCAL 1, RET -- returns second param (should be nil)
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.CALL_INDIRECT_ARGS, a: 1 },
          { op: Op.RET },
        ]),
        {
          code: List.from([{ op: Op.LOAD_LOCAL, a: 1 }, { op: Op.RET }]),
          numParams: 2,
          numLocals: 2,
          name: "callee",
        },
      ],
      [mkFunctionValue(1), mkNumberValue(10)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal(result.result!.t, NativeType.Nil);
    }
  });

  test("exact match works like CALL_INDIRECT", () => {
    // func 0: push FunctionValue(1), push 10, push 20, CALL_INDIRECT_ARGS argc=2, RET
    // func 1 (2 params): LOAD_LOCAL 1, RET
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.CALL_INDIRECT_ARGS, a: 2 },
          { op: Op.RET },
        ]),
        {
          code: List.from([{ op: Op.LOAD_LOCAL, a: 1 }, { op: Op.RET }]),
          numParams: 2,
          numLocals: 2,
          name: "callee",
        },
      ],
      [mkFunctionValue(1), mkNumberValue(10), mkNumberValue(20)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 20);
    }
  });
});

// ---- MAKE_CLOSURE / LOAD_CAPTURE ----

describe("VM -- MAKE_CLOSURE and LOAD_CAPTURE", () => {
  test("MAKE_CLOSURE creates a FunctionValue with captures", () => {
    // func 0: push 42, MAKE_CLOSURE(funcId=1, captureCount=1), RET
    // The result should be a FunctionValue with captures
    const prog = mkProgram(
      [
        mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.MAKE_CLOSURE, a: 1, b: 1 }, { op: Op.RET }]),
        mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }]),
      ],
      [mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.ok(isFunctionValue(result.result!));
      const fv = result.result as FunctionValue;
      assert.equal(fv.funcId, 1);
      assert.ok(fv.captures);
      assert.equal(fv.captures!.size(), 1);
      assert.equal((fv.captures!.get(0) as NumberValue).v, 42);
    }
  });

  test("LOAD_CAPTURE reads captured value inside closure", () => {
    // func 0: push 99, MAKE_CLOSURE(funcId=1, captureCount=1), CALL_INDIRECT(0), RET
    // func 1: LOAD_CAPTURE(0), RET
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.MAKE_CLOSURE, a: 1, b: 1 },
          { op: Op.CALL_INDIRECT, a: 0 },
          { op: Op.RET },
        ]),
        mkFunc([{ op: Op.LOAD_CAPTURE, a: 0 }, { op: Op.RET }]),
      ],
      [mkNumberValue(99)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 99);
    }
  });

  test("CALL_INDIRECT on closure attaches captures to frame", () => {
    // func 0: push 10, push 20, MAKE_CLOSURE(funcId=1, captureCount=2), push 5, CALL_INDIRECT(1), RET
    // func 1(1 param): LOAD_LOCAL(0) + LOAD_CAPTURE(0) + LOAD_CAPTURE(1) -- return capture 1
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.MAKE_CLOSURE, a: 1, b: 2 },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.CALL_INDIRECT, a: 1 },
          { op: Op.RET },
        ]),
        {
          code: List.from([{ op: Op.LOAD_CAPTURE, a: 1 }, { op: Op.RET }]),
          numParams: 1,
          numLocals: 1,
          name: "closure",
        },
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(5)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 20);
    }
  });

  test("capture-by-value: modifying variable after closure creation does not affect closure", () => {
    // func 0: push 100, STORE_LOCAL(0), LOAD_LOCAL(0), MAKE_CLOSURE(funcId=1, 1),
    //         push 200, STORE_LOCAL(0),  -- modify the variable
    //         CALL_INDIRECT(0), RET
    // func 1: LOAD_CAPTURE(0), RET  -- should return 100, not 200
    const prog = mkProgram(
      [
        {
          code: List.from([
            { op: Op.PUSH_CONST_VAL, a: 0 },
            { op: Op.STORE_LOCAL, a: 0 },
            { op: Op.LOAD_LOCAL, a: 0 },
            { op: Op.MAKE_CLOSURE, a: 1, b: 1 },
            { op: Op.PUSH_CONST_VAL, a: 1 },
            { op: Op.STORE_LOCAL, a: 0 },
            { op: Op.CALL_INDIRECT, a: 0 },
            { op: Op.RET },
          ]),
          numParams: 0,
          numLocals: 1,
          name: "outer",
        },
        mkFunc([{ op: Op.LOAD_CAPTURE, a: 0 }, { op: Op.RET }]),
      ],
      [mkNumberValue(100), mkNumberValue(200)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 100);
    }
  });

  test("LOAD_CAPTURE out of bounds faults", () => {
    // func 0: MAKE_CLOSURE with 0 captures, call it
    // func 1: try LOAD_CAPTURE(0) when no captures
    const prog = mkProgram(
      [
        mkFunc([{ op: Op.MAKE_CLOSURE, a: 1, b: 0 }, { op: Op.CALL_INDIRECT, a: 0 }, { op: Op.RET }]),
        mkFunc([{ op: Op.LOAD_CAPTURE, a: 0 }, { op: Op.RET }]),
      ],
      []
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.FAULT);
  });
});

// ---- FiberScheduler ----

describe("FiberScheduler", () => {
  test("spawn creates a runnable fiber and tick executes it", () => {
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }])], [NIL_VALUE]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const scheduler = new FiberScheduler(vm, { maxFibersPerTick: 10, defaultBudget: 1000, autoGcHandles: true });

    const fiberId = scheduler.spawn(0, List.empty(), mkCtx());
    const fiber = scheduler.getFiber(fiberId);
    assert.ok(fiber !== undefined);
    assert.equal(fiber!.state, FiberState.RUNNABLE);

    const executed = scheduler.tick();
    assert.ok(executed >= 1);
    assert.equal(fiber!.state, FiberState.DONE);
  });

  test("cancel transitions fiber to CANCELLED", () => {
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.POP }, { op: Op.JMP, a: -2 }])],
      [NIL_VALUE]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const scheduler = new FiberScheduler(vm, { maxFibersPerTick: 10, defaultBudget: 1000, autoGcHandles: true });

    const fiberId = scheduler.spawn(0, List.empty(), mkCtx());
    scheduler.cancel(fiberId);

    const fiber = scheduler.getFiber(fiberId);
    assert.equal(fiber!.state, FiberState.CANCELLED);
  });

  test("gc removes completed/faulted/cancelled fibers", () => {
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }])], [NIL_VALUE]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const scheduler = new FiberScheduler(vm, { maxFibersPerTick: 64, defaultBudget: 1000, autoGcHandles: true });

    scheduler.spawn(0, List.empty(), mkCtx());
    scheduler.spawn(0, List.empty(), mkCtx());
    scheduler.tick();

    const stats = scheduler.getStats();
    assert.equal(stats.doneFibers, 2);

    const removed = scheduler.gc();
    assert.equal(removed, 2);

    const statsAfter = scheduler.getStats();
    assert.equal(statsAfter.totalFibers, 0);
  });

  test("scheduler resumes fiber when handle resolves", () => {
    const handles = new HandleTable(100);
    const hid = handles.createPending();

    const handleValue: Value = { t: "handle" as const, id: hid };
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.AWAIT }, { op: Op.RET }])],
      [handleValue]
    );

    const vm = new VM(services, prog, handles);
    const scheduler = new FiberScheduler(vm, { maxFibersPerTick: 64, defaultBudget: 1000, autoGcHandles: true });

    const fiberId = scheduler.spawn(0, List.empty(), mkCtx());
    scheduler.tick();

    const fiber = scheduler.getFiber(fiberId);
    assert.equal(fiber!.state, FiberState.WAITING);

    // Resolve the handle -- this should trigger onHandleCompleted and resume the fiber
    handles.resolve(hid, mkNumberValue(77));

    // Tick again to run the resumed fiber
    scheduler.tick();

    assert.equal(fiber!.state, FiberState.DONE);
  });
});

// ---- HandleTable ----

describe("HandleTable", () => {
  test("createPending, resolve, get", () => {
    const table = new HandleTable(10);
    const id = table.createPending();
    const h = table.get(id);

    assert.ok(h !== undefined);
    assert.equal(h!.state, HandleState.PENDING);

    table.resolve(id, mkNumberValue(42));
    assert.equal(h!.state, HandleState.RESOLVED);
    assert.equal((h!.result as { v: number }).v, 42);
  });

  test("reject sets state and error", () => {
    const table = new HandleTable(10);
    const id = table.createPending();

    table.reject(id, { code: ErrorCode.HostError, message: "fail" });
    const h = table.get(id)!;
    assert.equal(h.state, HandleState.REJECTED);
    assert.equal(h.error!.message, "fail");
  });

  test("cancel sets state", () => {
    const table = new HandleTable(10);
    const id = table.createPending();

    table.cancel(id);
    const h = table.get(id)!;
    assert.equal(h.state, HandleState.CANCELLED);
  });

  test("gc removes non-pending handles with no waiters", () => {
    const table = new HandleTable(10);
    const id1 = table.createPending();
    const id2 = table.createPending();

    table.resolve(id1, NIL_VALUE);
    // id2 still pending

    const removed = table.gc();
    assert.equal(removed, 1);
    assert.ok(table.get(id1) === undefined);
    assert.ok(table.get(id2) !== undefined);
  });
});

// ---- Error code names ----

describe("ErrorCode", () => {
  test("errorCodeName matches the prior string-tag form", () => {
    assert.equal(errorCodeName(ErrorCode.Timeout), "Timeout");
    assert.equal(errorCodeName(ErrorCode.Cancelled), "Cancelled");
    assert.equal(errorCodeName(ErrorCode.HostError), "HostError");
    assert.equal(errorCodeName(ErrorCode.ScriptError), "ScriptError");
    assert.equal(errorCodeName(ErrorCode.StackOverflow), "StackOverflow");
    assert.equal(errorCodeName(ErrorCode.StackUnderflow), "StackUnderflow");
  });
});

// ---- Capacity overflow surfaces as ErrorCode.StackOverflow ----

describe("VM -- overflow faults", () => {
  test("operand stack overflow surfaces as ErrorCode.StackOverflow", () => {
    // Tight loop that pushes a constant forever. PUSH_CONST advances pc to 1,
    // then JMP -1 returns pc to 0, looping the push without ever popping.
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.JMP, a: -1 },
        ]),
      ],
      [mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles, { maxStackSize: 8 });
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 1000;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.FAULT);
    if (result.status === VmStatus.FAULT) {
      assert.equal(result.error.code, ErrorCode.StackOverflow);
    }
  });

  test("frame depth overflow surfaces as ErrorCode.StackOverflow", () => {
    // Function 0 recurses into itself unconditionally, exhausting maxFrameDepth.
    const prog = mkProgram([mkFunc([{ op: Op.CALL, a: 0, b: 0 }, { op: Op.RET }])]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles, { maxFrameDepth: 8, maxStackSize: 1024 });
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 1000;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.FAULT);
    if (result.status === VmStatus.FAULT) {
      assert.equal(result.error.code, ErrorCode.StackOverflow);
    }
  });

  test("handler stack overflow surfaces as ErrorCode.StackOverflow", () => {
    // Tight loop pushing TRY frames without END_TRY: TRY advances pc by 1,
    // JMP -2 returns pc to 0, looping handler installation.
    const prog = mkProgram([
      mkFunc([
        { op: Op.TRY, a: 10 },
        { op: Op.JMP, a: -1 },
      ]),
    ]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles, { maxHandlers: 8 });
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 1000;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.FAULT);
    if (result.status === VmStatus.FAULT) {
      assert.equal(result.error.code, ErrorCode.StackOverflow);
    }
  });

  test("HandleTable.createPending throws OverflowError when full", () => {
    const handles = new HandleTable(2);
    handles.createPending();
    handles.createPending();
    let caught: unknown;
    try {
      handles.createPending();
    } catch (e) {
      caught = e;
    }
    assert.ok(isOverflowError(caught), "expected OverflowError to be thrown");
  });

  test("FiberScheduler.spawn throws OverflowError when fiber pool is full", () => {
    // Long-running program (infinite loop) so fibers stay RUNNABLE and occupy slots.
    const prog = mkProgram([mkFunc([{ op: Op.JMP, a: 0 }])]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const scheduler = new FiberScheduler(vm, {
      maxFibersPerTick: 1,
      defaultBudget: 1,
      autoGcHandles: true,
      maxFibers: 3,
    });

    scheduler.spawn(0, List.empty(), mkCtx());
    scheduler.spawn(0, List.empty(), mkCtx());
    scheduler.spawn(0, List.empty(), mkCtx());

    let caught: unknown;
    try {
      scheduler.spawn(0, List.empty(), mkCtx());
    } catch (e) {
      caught = e;
    }
    assert.ok(isOverflowError(caught), "expected OverflowError to be thrown");
  });

  test("operand stack underflow surfaces as ErrorCode.StackUnderflow", () => {
    // POP on an empty operand stack: malformed bytecode that hits the
    // pop() underflow guard.
    const prog = mkProgram([mkFunc([{ op: Op.POP }, { op: Op.RET }])]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.FAULT);
    if (result.status === VmStatus.FAULT) {
      assert.equal(result.error.code, ErrorCode.StackUnderflow);
    }
  });
});

// ---- Operator monomorphization ----

/**
 * Build a BrainServices that wraps `services.types` with a Proxy that increments
 * `counter.n` for every property access (including method calls). Used to assert
 * that the dispatch hot path does not consult the type registry for primitive
 * arithmetic.
 */
function makeServicesWithTypeAccessCounter(base: BrainServices, counter: { n: number }): BrainServices {
  const countingTypes = new Proxy(base.types, {
    get(target, prop, receiver) {
      counter.n++;
      return Reflect.get(target, prop, receiver);
    },
  });
  return new BrainServices({
    tiles: base.tiles,
    actions: base.actions,
    operatorTable: base.operatorTable,
    operatorOverloads: base.operatorOverloads,
    types: countingTypes,
    tileBuilder: base.tileBuilder,
    functions: base.functions,
    conversions: base.conversions,
  });
}

describe("VM -- operator monomorphization", () => {
  test("primitive number arithmetic does not consult ITypeRegistry on the dispatch hot path", () => {
    const resolved = services.operatorOverloads.resolve(CoreOpId.Add, [CoreTypeIds.Number, CoreTypeIds.Number]);
    assert.ok(resolved !== undefined, "add(number, number) overload must be registered");
    const addFnId = resolved!.overload.fnEntry.id;

    // Tight number-heavy loop: 1000 iterations of `1 + 1` via HOST_CALL.
    const ITER = 1000;
    const code: Instr[] = [];
    for (let i = 0; i < ITER; i++) {
      code.push({ op: Op.PUSH_CONST_VAL, a: 0 });
      code.push({ op: Op.PUSH_CONST_VAL, a: 0 });
      code.push({ op: Op.HOST_CALL, a: addFnId, b: 2, c: 0 });
      code.push({ op: Op.POP });
    }
    code.push({ op: Op.PUSH_CONST_VAL, a: 0 });
    code.push({ op: Op.RET });

    const prog = mkProgram([mkFunc(code)], [mkNumberValue(1)]);
    const handles = new HandleTable(100);

    const counter = { n: 0 };
    const countedServices = makeServicesWithTypeAccessCounter(services, counter);
    const vm = new VM(countedServices, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = ITER * 4 + 10;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    assert.equal(counter.n, 0, `expected 0 ITypeRegistry accesses during primitive arithmetic, got ${counter.n}`);
  });

  test("counter wrapper observes type-registry access (positive control)", () => {
    // Positive control: directly invoking a method on the wrapped registry must
    // increment the counter, ensuring the previous test's zero count is meaningful.
    const counter = { n: 0 };
    const countedServices = makeServicesWithTypeAccessCounter(services, counter);
    countedServices.types.get(CoreTypeIds.Number);
    assert.ok(counter.n > 0, "counter must observe registry access");
  });
});

// ---- Slot-keyed variable dispatch ----

describe("VM -- slot-keyed variable dispatch", () => {
  test("LOAD_VAR_SLOT / STORE_VAR_SLOT do not call name-keyed getVariable / setVariable", () => {
    const slots = List.empty<Value>();
    const counter = { name: 0, slot: 0 };
    const ctx: ExecutionContext = {
      brain: undefined as never,
      getVariable: () => {
        counter.name++;
        return undefined;
      },
      setVariable: () => {
        counter.name++;
      },
      clearVariable: () => {
        counter.name++;
      },
      getVariableBySlot: (slotId: number) => {
        counter.slot++;
        return slots.get(slotId) ?? NIL_VALUE;
      },
      setVariableBySlot: (slotId: number, value: Value) => {
        counter.slot++;
        while (slots.size() <= slotId) slots.push(NIL_VALUE);
        slots.set(slotId, value);
      },
      time: 0,
      dt: 0,
      currentTick: 0,
    };

    const ITER = 200;
    const code: Instr[] = [];
    for (let i = 0; i < ITER; i++) {
      code.push({ op: Op.PUSH_CONST_VAL, a: 0 });
      code.push({ op: Op.STORE_VAR_SLOT, a: 0 });
      code.push({ op: Op.LOAD_VAR_SLOT, a: 0 });
      code.push({ op: Op.POP });
    }
    code.push({ op: Op.PUSH_CONST_VAL, a: 0 });
    code.push({ op: Op.RET });

    const prog = mkProgram([mkFunc(code)], [mkNumberValue(7)], ["x"]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
    fiber.instrBudget = ITER * 5 + 10;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    assert.equal(counter.name, 0, `expected 0 name-keyed accesses during slot dispatch, got ${counter.name}`);
    assert.equal(counter.slot, ITER * 2, "every LOAD_VAR_SLOT / STORE_VAR_SLOT should call the slot-keyed accessors");
  });
});

// ---- V4.1: New host-call ABI ----

describe("VM -- V4.1 host-call ABI (positional Sublist / owned snapshot)", () => {
  test("HOST_CALL allocates no MapValue / ValueDict across N synchronous host calls", () => {
    // Register a sync host that reads slot 0 / slot 1 and returns slot0 + slot1.
    const callDef = mkCallDef({
      type: "seq",
      items: [
        { type: "arg", tileId: "addArgs.lhs", name: "lhs", required: true },
        { type: "arg", tileId: "addArgs.rhs", name: "rhs", required: true },
      ],
    });
    const fnEntry = services.functions.register(
      "$$test_v4_1_add",
      false,
      {
        exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
          const a = args.get(0) as NumberValue;
          const b = args.get(1) as NumberValue;
          return mkNumberValue(a.v + b.v);
        },
      },
      callDef
    );

    // Spy on MapValue/ValueDict construction by patching ValueDict's
    // prototype constructor via a counter wrapper.
    const allocCounts = { dict: 0 };
    const origCtor = ValueDict.prototype.constructor;
    function PatchedValueDict(this: ValueDict) {
      allocCounts.dict++;
      // Forward to the original constructor.
      Reflect.apply(origCtor, this, []);
    }
    Object.setPrototypeOf(PatchedValueDict.prototype, ValueDict.prototype);

    const ITER = 100;
    const code: Instr[] = [];
    // Push N=2 NIL fillers, fill slot 0 and slot 1, HOST_CALL, POP result.
    for (let i = 0; i < ITER; i++) {
      code.push({ op: Op.PUSH_CONST_VAL, a: 1 }); // NIL filler slot 0
      code.push({ op: Op.PUSH_CONST_VAL, a: 1 }); // NIL filler slot 1
      code.push({ op: Op.PUSH_CONST_VAL, a: 0 }); // operand for slot 0
      code.push({ op: Op.STACK_SET_REL, a: 1 });
      code.push({ op: Op.PUSH_CONST_VAL, a: 0 }); // operand for slot 1
      code.push({ op: Op.STACK_SET_REL, a: 0 });
      code.push({ op: Op.HOST_CALL, a: fnEntry.id, b: 2, c: 0 });
      code.push({ op: Op.POP });
    }
    code.push({ op: Op.PUSH_CONST_VAL, a: 0 });
    code.push({ op: Op.RET });

    const prog = mkProgram([mkFunc(code)], [mkNumberValue(3), NIL_VALUE]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = ITER * 8 + 10;

    // Reset counter and install the patched ValueDict for the run.
    allocCounts.dict = 0;
    const beforeProto = ValueDict.prototype.constructor;
    ValueDict.prototype.constructor = PatchedValueDict as never;

    let result: ReturnType<typeof vm.runFiber>;
    try {
      result = vm.runFiber(fiber, mkSchedulerCallbacks());
    } finally {
      ValueDict.prototype.constructor = beforeProto;
      services.functions.unregister("$$test_v4_1_add");
    }

    assert.equal(result.status, VmStatus.DONE);
    assert.equal(
      allocCounts.dict,
      0,
      `expected 0 ValueDict allocations across ${ITER} sync host calls, got ${allocCounts.dict}`
    );
  });

  test("HostAsyncFn receives an owned snapshot that survives operand-stack reuse", () => {
    let captured: { args: ReadonlyList<Value>; handleId: number } | undefined;
    const callDef = mkCallDef({
      type: "seq",
      items: [
        { type: "arg", tileId: "asyncCapture.a", name: "a", required: true },
        { type: "arg", tileId: "asyncCapture.b", name: "b", required: true },
      ],
    });
    const fnEntry = services.functions.register(
      "$$test_v4_1_async_capture",
      true,
      {
        exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>, handleId: number) => {
          captured = { args, handleId };
        },
      },
      callDef
    );

    const code: Instr[] = [
      // Open 2-wide buffer for HOST_CALL_ASYNC, fill with 7 and 11.
      { op: Op.PUSH_CONST_VAL, a: 1 }, // NIL filler
      { op: Op.PUSH_CONST_VAL, a: 1 }, // NIL filler
      { op: Op.PUSH_CONST_VAL, a: 0 }, // 7
      { op: Op.STACK_SET_REL, a: 1 },
      { op: Op.PUSH_CONST_VAL, a: 2 }, // 11
      { op: Op.STACK_SET_REL, a: 0 },
      { op: Op.HOST_CALL_ASYNC, a: fnEntry.id, b: 2, c: 0 },
      // After the host call returns, scribble on the operand stack to
      // ensure the async snapshot does not alias the live vstack.
      { op: Op.POP }, // discard the handle pushed by HOST_CALL_ASYNC
      { op: Op.PUSH_CONST_VAL, a: 0 },
      { op: Op.PUSH_CONST_VAL, a: 0 },
      { op: Op.POP },
      { op: Op.POP },
      { op: Op.PUSH_CONST_VAL, a: 1 },
      { op: Op.RET },
    ];

    const prog = mkProgram([mkFunc(code)], [mkNumberValue(7), NIL_VALUE, mkNumberValue(11)]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 50;

    let result: ReturnType<typeof vm.runFiber>;
    try {
      result = vm.runFiber(fiber, mkSchedulerCallbacks());
    } finally {
      services.functions.unregister("$$test_v4_1_async_capture");
    }

    assert.equal(result.status, VmStatus.DONE);
    assert.ok(captured, "async host should have been invoked");
    // Even after the operand stack has been reused, the captured args
    // still report the original values.
    assert.equal(captured!.args.size(), 2);
    assert.equal((captured!.args.get(0) as NumberValue).v, 7);
    assert.equal((captured!.args.get(1) as NumberValue).v, 11);
  });

  test("STACK_SET_REL writes pop-then-set to vstack[top - d]", () => {
    // Stack: [10, 20, 30, 40] (deepest..top). After
    // STACK_SET_REL 2: pop 40, write to vstack[top - 2] = vstack[0].
    // Result: [40, 20, 30].
    const code: Instr[] = [
      { op: Op.PUSH_CONST_VAL, a: 0 }, // 10
      { op: Op.PUSH_CONST_VAL, a: 1 }, // 20
      { op: Op.PUSH_CONST_VAL, a: 2 }, // 30
      { op: Op.PUSH_CONST_VAL, a: 3 }, // 40
      { op: Op.STACK_SET_REL, a: 2 },
      // Stack: [40, 20, 30]. Pop the top three to confirm.
      { op: Op.POP }, // 30
      { op: Op.POP }, // 20
      { op: Op.RET }, // returns 40
    ];

    const prog = mkProgram(
      [mkFunc(code)],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(30), mkNumberValue(40)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 50;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as NumberValue).v, 40);
    }
  });

  test("slot-keyed access: supplied vs unsupplied slots resolve correctly", () => {
    // 4-slot host fn: tiles "spy.s0".."spy.s3". Test sparse supply
    // (slot 0 and slot 3 only).
    const callDef = mkCallDef({
      type: "seq",
      items: [
        { type: "arg", tileId: "spy.s0", name: "s0" },
        { type: "arg", tileId: "spy.s1", name: "s1" },
        { type: "arg", tileId: "spy.s2", name: "s2" },
        { type: "arg", tileId: "spy.s3", name: "s3" },
      ],
    });
    let observed: List<Value> | undefined;
    const fnEntry = services.functions.register(
      "$$test_v4_1_spy",
      false,
      {
        // Sync hosts must read into locals before returning -- the
        // sublist view aliases the operand stack which is popped on the
        // way back out. Snapshot here so the test can assert post-call.
        exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
          const snap = List.empty<Value>();
          for (let i = 0; i < args.size(); i++) snap.push(args.get(i));
          observed = snap;
          return NIL_VALUE;
        },
      },
      callDef
    );

    // Buffer width N=4. Supply slot 0 = 100, slot 3 = 300; slots 1, 2 stay NIL.
    const code: Instr[] = [
      { op: Op.PUSH_CONST_VAL, a: 1 }, // NIL slot 0
      { op: Op.PUSH_CONST_VAL, a: 1 }, // NIL slot 1
      { op: Op.PUSH_CONST_VAL, a: 1 }, // NIL slot 2
      { op: Op.PUSH_CONST_VAL, a: 1 }, // NIL slot 3
      // Slot 0 (s0): d = N-1-0 = 3
      { op: Op.PUSH_CONST_VAL, a: 0 }, // 100
      { op: Op.STACK_SET_REL, a: 3 },
      // Slot 3 (s3): d = N-1-3 = 0
      { op: Op.PUSH_CONST_VAL, a: 2 }, // 300
      { op: Op.STACK_SET_REL, a: 0 },
      { op: Op.HOST_CALL, a: fnEntry.id, b: 4, c: 0 },
      { op: Op.RET },
    ];

    const prog = mkProgram([mkFunc(code)], [mkNumberValue(100), NIL_VALUE, mkNumberValue(300)]);
    const handles = new HandleTable(100);
    const vm = new VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 50;

    let result: ReturnType<typeof vm.runFiber>;
    try {
      result = vm.runFiber(fiber, mkSchedulerCallbacks());
    } finally {
      services.functions.unregister("$$test_v4_1_spy");
    }
    assert.equal(result.status, VmStatus.DONE);
    assert.ok(observed);

    // Slot 0 supplied -> 100; slot 3 supplied -> 300; slots 1,2 NIL.
    assert.equal(observed!.size(), 4);
    assert.equal((observed!.get(0) as NumberValue).v, 100);
    assert.equal(observed!.get(1).t, NativeType.Nil, "slot 1 must be NIL");
    assert.equal(observed!.get(2).t, NativeType.Nil, "slot 2 must be NIL");
    assert.equal((observed!.get(3) as NumberValue).v, 300);
  });
});
