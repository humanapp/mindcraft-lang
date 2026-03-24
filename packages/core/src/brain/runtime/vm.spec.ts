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

import { Dict, List } from "@mindcraft-lang/core";
import {
  BYTECODE_VERSION,
  type ExecutionContext,
  FALSE_VALUE,
  type Fiber,
  FiberState,
  type FunctionBytecode,
  type FunctionValue,
  HandleState,
  HandleTable,
  type Instr,
  isFunctionValue,
  mkBooleanValue,
  mkFunctionValue,
  mkNumberValue,
  mkStringValue,
  mkStructValue,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  Op,
  type Program,
  registerCoreBrainComponents,
  TRUE_VALUE,
  type Value,
  VmStatus,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import { FiberScheduler, VM } from "@mindcraft-lang/core/brain/runtime";

before(() => {
  registerCoreBrainComponents();
});

// -- Helpers --

function mkProgram(functions: FunctionBytecode[], constants: Value[] = [], variableNames: string[] = []): Program {
  return {
    version: BYTECODE_VERSION,
    functions: List.from(functions),
    constants: List.from(constants),
    variableNames: List.from(variableNames),
    entryPoint: 0,
  };
}

function mkFunc(code: Instr[], numParams = 0, name?: string): FunctionBytecode {
  return { code: List.from(code), numParams, name };
}

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    brain: undefined as never,
    getVariable: () => undefined,
    setVariable: () => {},
    clearVariable: () => {},
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

describe("VM -- stack operations", () => {
  test("PUSH_CONST pushes constant onto stack", () => {
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.RET }])], [mkNumberValue(42)]);
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
      [mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.DUP }, { op: Op.POP }, { op: Op.RET }])],
      [mkNumberValue(10)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // push 1
          { op: Op.PUSH_CONST, a: 1 }, // push 2
          { op: Op.SWAP }, // [2, 1]
          { op: Op.POP }, // [2]
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(1), mkNumberValue(2)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
  test("STORE_VAR and LOAD_VAR round-trip", () => {
    const vars = new Dict<string, Value>();
    const ctx = mkCtx({
      getVariable: <T extends Value>(id: string) => vars.get(id) as T | undefined,
      setVariable: (id: string, val: Value) => vars.set(id, val),
    });

    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST, a: 0 }, // push 99
          { op: Op.STORE_VAR, a: 0 }, // store to "x"
          { op: Op.LOAD_VAR, a: 0 }, // load "x"
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(99)],
      ["x"]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 99);
    }
  });

  test("LOAD_VAR returns NIL for unset variable", () => {
    const ctx = mkCtx();

    const prog = mkProgram([mkFunc([{ op: Op.LOAD_VAR, a: 0 }, { op: Op.RET }])], [], ["unset"]);
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // 0: push 42
          { op: Op.JMP, a: 2 }, // 1: JMP -> pc 1+2 = 3 (RET)
          { op: Op.PUSH_CONST, a: 1 }, // 2: push 999 (should be skipped)
          { op: Op.RET }, // 3
        ]),
      ],
      [mkNumberValue(42), mkNumberValue(999)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // 0: push false
          { op: Op.JMP_IF_FALSE, a: 3 }, // 1: if false, JMP -> 4
          { op: Op.PUSH_CONST, a: 2 }, // 2: push 999
          { op: Op.RET }, // 3: return 999
          { op: Op.PUSH_CONST, a: 3 }, // 4: push 1 (taken branch)
          { op: Op.RET }, // 5: return 1
        ]),
      ],
      [FALSE_VALUE, TRUE_VALUE, mkNumberValue(999), mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // 0: push true
          { op: Op.JMP_IF_TRUE, a: 3 }, // 1: if true, JMP -> 4
          { op: Op.PUSH_CONST, a: 1 }, // 2: push 999 (skipped)
          { op: Op.RET }, // 3: return 999
          { op: Op.PUSH_CONST, a: 2 }, // 4: push 1 (taken branch)
          { op: Op.RET }, // 5: return 1
        ]),
      ],
      [TRUE_VALUE, mkNumberValue(999), mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // push 42
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // push 10
          { op: Op.PUSH_CONST, a: 1 }, // push 20
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
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // push "first"
          { op: Op.PUSH_CONST, a: 1 }, // push "second"
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
    const vm = new VM(prog, handles);
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
        mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.CALL, a: 1, b: 1 }, { op: Op.RET }]),
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
    const vm = new VM(prog, handles);
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
            { op: Op.PUSH_CONST, a: 0 }, // push sentinel 111
            { op: Op.PUSH_CONST, a: 1 }, // push arg 222
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
            { op: Op.PUSH_CONST, a: 2 }, // push 333 (return value)
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
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // push arg 5
          { op: Op.CALL, a: 1, b: 1 },
          { op: Op.RET },
        ]),
        {
          code: List.from([
            { op: Op.PUSH_CONST, a: 1 }, // push 10
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
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // push 7
          { op: Op.CALL, a: 1, b: 1 },
          { op: Op.RET },
        ]),
        {
          code: List.from([
            { op: Op.LOAD_LOCAL, a: 0 }, // push 7 (received arg)
            { op: Op.PUSH_CONST, a: 1 }, // push 3
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
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // push 50
          { op: Op.CALL, a: 1, b: 1 },
          { op: Op.RET },
        ]),
        {
          code: List.from([
            { op: Op.PUSH_CONST, a: 1 }, // push 999
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
    const vm = new VM(prog, handles);
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
            { op: Op.PUSH_CONST, a: 0 }, // push 5
            { op: Op.STORE_LOCAL, a: 0 }, // local[0] = 5
            { op: Op.PUSH_CONST, a: 1 }, // push 10
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
    const vm = new VM(prog, handles);
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
            { op: Op.PUSH_CONST, a: 0 }, // push 99
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
            { op: Op.PUSH_CONST, a: 1 }, // push 1
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
    const vm = new VM(prog, handles);
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
    const vm = new VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.from([mkNumberValue(77)]), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 77);
    }
  });

  test("LOAD_LOCAL out of bounds rejected by verifier", () => {
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
    assert.throws(() => new VM(prog, handles), /LOAD_LOCAL index 5 out of bounds/);
  });
});

// ---- Callsite-persistent variables ----

describe("VM -- callsite-persistent variables", () => {
  test("LOAD_CALLSITE_VAR and STORE_CALLSITE_VAR read/write fiber.callsiteVars", () => {
    const prog = mkProgram(
      [
        {
          code: List.from([
            { op: Op.PUSH_CONST, a: 0 }, // push 42
            { op: Op.STORE_CALLSITE_VAR, a: 0 }, // callsiteVars[0] = 42
            { op: Op.LOAD_CALLSITE_VAR, a: 0 }, // push callsiteVars[0]
            { op: Op.RET },
          ]),
          numParams: 0,
          numLocals: 0,
          name: "test",
        },
      ],
      [mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.callsiteVars = List.from([NIL_VALUE, NIL_VALUE]);
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 42);
    }
  });

  test("LOAD_CALLSITE_VAR without callsiteVars faults", () => {
    const prog = mkProgram([
      {
        code: List.from([{ op: Op.LOAD_CALLSITE_VAR, a: 0 }, { op: Op.RET }]),
        numParams: 0,
        numLocals: 0,
        name: "test",
      },
    ]);
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.FAULT);
  });

  test("callsiteVars persist across calls within same fiber", () => {
    // func 0: store 100 into callsiteVar[0], call func 1, ret
    // func 1: load callsiteVar[0], ret
    const prog = mkProgram(
      [
        {
          code: List.from([
            { op: Op.PUSH_CONST, a: 0 },
            { op: Op.STORE_CALLSITE_VAR, a: 0 },
            { op: Op.CALL, a: 1, b: 0 },
            { op: Op.RET },
          ]),
          numParams: 0,
          numLocals: 0,
          name: "outer",
        },
        {
          code: List.from([{ op: Op.LOAD_CALLSITE_VAR, a: 0 }, { op: Op.RET }]),
          numParams: 0,
          numLocals: 0,
          name: "inner",
        },
      ],
      [mkNumberValue(100)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.callsiteVars = List.from([NIL_VALUE]);
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 100);
    }
  });
});

// ---- Fiber state machine ----

describe("VM -- fiber state machine", () => {
  test("fiber starts in RUNNABLE state", () => {
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.RET }])], [NIL_VALUE]);
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());

    assert.equal(fiber.state, FiberState.RUNNABLE);
  });

  test("fiber transitions to DONE on completion", () => {
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.RET }])], [NIL_VALUE]);
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(fiber.state, FiberState.DONE);
  });

  test("fiber transitions to CANCELLED when cancelled", () => {
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.RET }])], [NIL_VALUE]);
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());

    vm.cancelFiber(fiber, mkSchedulerCallbacks());

    assert.equal(fiber.state, FiberState.CANCELLED);
  });

  test("budget exhaustion returns YIELDED", () => {
    // Loop: JMP back to self
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.PUSH_CONST, a: 0 }, // 0: push nil
          { op: Op.POP }, // 1: pop
          { op: Op.JMP, a: -2 }, // 2: jump back to 0
        ]),
      ],
      [NIL_VALUE]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 5;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.YIELDED);
    assert.equal(fiber.state, FiberState.RUNNABLE);
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
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.AWAIT }, { op: Op.RET }])], [handleValue]);
    const vm = new VM(prog, handles);
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
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.AWAIT }, { op: Op.RET }])], [handleValue]);
    const vm = new VM(prog, handles);
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
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.AWAIT }, { op: Op.RET }])], [handleValue]);
    const vm = new VM(prog, handles);
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
    const errVal: Value = { t: "err", e: { tag: "ScriptError", message: "test" } };
    const prog = mkProgram(
      [
        mkFunc([
          { op: Op.TRY, a: 3 }, // 0: TRY, catch at pc 0+3 = 3
          { op: Op.PUSH_CONST, a: 0 }, // 1: push error value
          { op: Op.THROW }, // 2: throw
          { op: Op.POP }, // 3: [catch] pop the error
          { op: Op.END_TRY }, // 4: exit try
          { op: Op.PUSH_CONST, a: 1 }, // 5: push 1 (success)
          { op: Op.RET }, // 6
        ]),
      ],
      [errVal, mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());

    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.equal((result.result as { v: number }).v, 1);
    }
  });

  test("uncaught THROW faults the fiber", () => {
    const errVal: Value = { t: "err", e: { tag: "ScriptError", message: "uncaught" } };
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.THROW }])], [errVal]);
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // 1: push 42
          { op: Op.LIST_PUSH }, // 2: list.push(42)
          { op: Op.PUSH_CONST, a: 0 }, // 3: push 42 again
          { op: Op.LIST_PUSH }, // 4: list.push(42)
          { op: Op.LIST_LEN }, // 5: push list.length
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 2 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 3 },
          { op: Op.LIST_GET },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(30), mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 1 },
          { op: Op.LIST_GET },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(99)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 2 },
          { op: Op.PUSH_CONST, a: 3 },
          { op: Op.LIST_SET },
          { op: Op.PUSH_CONST, a: 2 },
          { op: Op.LIST_GET },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(0), mkNumberValue(99)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 2 },
          { op: Op.LIST_PUSH },
          { op: Op.LIST_POP },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(30)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 2 },
          { op: Op.LIST_PUSH },
          { op: Op.LIST_SHIFT },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(30)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 2 },
          { op: Op.LIST_PUSH },
          { op: Op.DUP },
          { op: Op.PUSH_CONST, a: 3 },
          { op: Op.LIST_REMOVE },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(30), mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.DUP },
          { op: Op.PUSH_CONST, a: 2 },
          { op: Op.PUSH_CONST, a: 3 },
          { op: Op.LIST_INSERT },
          { op: Op.PUSH_CONST, a: 2 },
          { op: Op.LIST_GET },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(30), mkNumberValue(1), mkNumberValue(20)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 2 },
          { op: Op.LIST_PUSH },
          { op: Op.DUP },
          { op: Op.PUSH_CONST, a: 3 },
          { op: Op.PUSH_CONST, a: 4 },
          { op: Op.LIST_SWAP },
          { op: Op.PUSH_CONST, a: 3 },
          { op: Op.LIST_GET },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(30), mkNumberValue(0), mkNumberValue(2)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.LIST_PUSH },
          { op: Op.PUSH_CONST, a: 1 },
          { op: Op.LIST_PUSH },
          { op: Op.DUP },
          { op: Op.PUSH_CONST, a: 2 },
          { op: Op.PUSH_CONST, a: 3 },
          { op: Op.LIST_SWAP },
          { op: Op.LIST_LEN },
          { op: Op.RET },
        ]),
      ],
      [mkNumberValue(10), mkNumberValue(20), mkNumberValue(0), mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // 1: push key "foo"
          { op: Op.PUSH_CONST, a: 1 }, // 2: push value 99
          { op: Op.MAP_SET }, // 3: map.set("foo", 99)
          { op: Op.PUSH_CONST, a: 0 }, // 4: push key "foo"
          { op: Op.MAP_GET }, // 5: push map.get("foo")
          { op: Op.RET },
        ]),
      ],
      [mkStringValue("foo"), mkNumberValue(99)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.PUSH_CONST, a: 1 },
          { op: Op.MAP_SET },
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.MAP_HAS },
          { op: Op.RET },
        ]),
      ],
      [mkStringValue("key"), mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // 1: push false
          { op: Op.WHEN_END, a: 5 }, // 2: if falsy, JMP to pc 2+5 = 7
          { op: Op.DO_START }, // 3
          { op: Op.PUSH_CONST, a: 2 }, // 4: push 999 (should be skipped)
          { op: Op.POP }, // 5: pop 999
          { op: Op.DO_END }, // 6
          { op: Op.PUSH_CONST, a: 1 }, // 7: push nil (end label)
          { op: Op.RET }, // 8
        ]),
      ],
      [FALSE_VALUE, NIL_VALUE, mkNumberValue(999)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 }, // 1: push true
          { op: Op.WHEN_END, a: 5 }, // 2: if truthy, continue to 3
          { op: Op.DO_START }, // 3
          { op: Op.PUSH_CONST, a: 1 }, // 4: push 42
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
    const vm = new VM(prog, handles);
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
      [mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.TYPE_CHECK, a: NativeType.Number }, { op: Op.RET }])],
      [mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
      [mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.TYPE_CHECK, a: NativeType.Number }, { op: Op.RET }])],
      [mkStringValue("hello")]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
      [mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.TYPE_CHECK, a: NativeType.Nil }, { op: Op.RET }])],
      [NIL_VALUE]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
      [mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.TYPE_CHECK, a: NativeType.String }, { op: Op.RET }])],
      [mkStringValue("hello")]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
      [mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.TYPE_CHECK, a: NativeType.Boolean }, { op: Op.RET }])],
      [TRUE_VALUE]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
      [mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.TYPE_CHECK, a: NativeType.Boolean }, { op: Op.RET }])],
      [mkNumberValue(1)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
        mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.CALL_INDIRECT, a: 0 }, { op: Op.RET }]),
        mkFunc([{ op: Op.PUSH_CONST, a: 1 }, { op: Op.RET }]),
      ],
      [mkFunctionValue(1), mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.PUSH_CONST, a: 1 },
          { op: Op.PUSH_CONST, a: 2 },
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
    const vm = new VM(prog, handles);
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
      [mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.CALL_INDIRECT, a: 0 }, { op: Op.RET }])],
      [mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
    // FunctionValues are immutable; STORE_VAR deep-copies, so test that
    // storing a FunctionValue via STORE_VAR and loading it back works
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.STORE_VAR, a: 0 }, { op: Op.LOAD_VAR, a: 0 }, { op: Op.RET }])],
      [mkFunctionValue(0)],
      ["myFunc"]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
    const vars = new Map<string, Value>();
    const fiber = vm.spawnFiber(
      1,
      0,
      List.empty(),
      mkCtx({
        setVariable: (k, v) => vars.set(k, v),
        getVariable: <T extends Value>(k: string) => vars.get(k) as T | undefined,
      })
    );
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.DONE);
    if (result.status === VmStatus.DONE) {
      assert.ok(isFunctionValue(result.result!));
      assert.equal((result.result as { funcId: number }).funcId, 0);
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
        mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.MAKE_CLOSURE, a: 1, b: 1 }, { op: Op.RET }]),
        mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.RET }]),
      ],
      [mkNumberValue(42)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.MAKE_CLOSURE, a: 1, b: 1 },
          { op: Op.CALL_INDIRECT, a: 0 },
          { op: Op.RET },
        ]),
        mkFunc([{ op: Op.LOAD_CAPTURE, a: 0 }, { op: Op.RET }]),
      ],
      [mkNumberValue(99)]
    );
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
          { op: Op.PUSH_CONST, a: 0 },
          { op: Op.PUSH_CONST, a: 1 },
          { op: Op.MAKE_CLOSURE, a: 1, b: 2 },
          { op: Op.PUSH_CONST, a: 2 },
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
    const vm = new VM(prog, handles);
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
            { op: Op.PUSH_CONST, a: 0 },
            { op: Op.STORE_LOCAL, a: 0 },
            { op: Op.LOAD_LOCAL, a: 0 },
            { op: Op.MAKE_CLOSURE, a: 1, b: 1 },
            { op: Op.PUSH_CONST, a: 1 },
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
    const vm = new VM(prog, handles);
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
    const vm = new VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, mkSchedulerCallbacks());
    assert.equal(result.status, VmStatus.FAULT);
  });
});

// ---- FiberScheduler ----

describe("FiberScheduler", () => {
  test("spawn creates a runnable fiber and tick executes it", () => {
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.RET }])], [NIL_VALUE]);
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.POP }, { op: Op.JMP, a: -2 }])], [NIL_VALUE]);
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
    const scheduler = new FiberScheduler(vm, { maxFibersPerTick: 10, defaultBudget: 1000, autoGcHandles: true });

    const fiberId = scheduler.spawn(0, List.empty(), mkCtx());
    scheduler.cancel(fiberId);

    const fiber = scheduler.getFiber(fiberId);
    assert.equal(fiber!.state, FiberState.CANCELLED);
  });

  test("gc removes completed/faulted/cancelled fibers", () => {
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.RET }])], [NIL_VALUE]);
    const handles = new HandleTable(100);
    const vm = new VM(prog, handles);
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
    const prog = mkProgram([mkFunc([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.AWAIT }, { op: Op.RET }])], [handleValue]);

    const vm = new VM(prog, handles);
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

    table.reject(id, { tag: "HostError", message: "fail" });
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
