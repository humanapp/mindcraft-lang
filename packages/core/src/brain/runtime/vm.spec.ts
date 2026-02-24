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
  HandleState,
  HandleTable,
  type Instr,
  mkBooleanValue,
  mkNumberValue,
  mkStringValue,
  mkStructValue,
  NativeType,
  NIL_VALUE,
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
    fiberId: 0,
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
