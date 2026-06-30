/**
 * Round-based scheduler tick tests.
 *
 * `FiberScheduler.tick()` is a round: every fiber in the runnable queue at
 * tick entry gets exactly one budget slice, and anything enqueued during
 * the tick (spawns, YIELD or budget-exhaustion re-enqueues) joins the next
 * round. These tests pin that guarantee and the loud `maxFibers` spawn fault.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { List } from "@mindcraft-lang/core";
import {
  BYTECODE_VERSION,
  ErrorCode,
  type ErrorValue,
  type ExecutionContext,
  FiberScheduler,
  FiberState,
  type FunctionBytecode,
  FunctionRegistry,
  type Instr,
  isOverflowError,
  mkCallDef,
  NIL_VALUE,
  Op,
  type Program,
  type Value,
  VM,
} from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";

const RECORD_FN_ID = 9001;
const SPAWN_CHILD_FN_ID = 9002;

const hostCallDef = mkCallDef({ type: "bag", items: [] });

function mkProgram(functions: FunctionBytecode[], constants: Value[] = []): Program {
  return {
    version: BYTECODE_VERSION,
    functions: List.from(functions),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.from(constants),
    },
    variableNames: List.empty<string>(),
    entryPoint: 0,
  };
}

function mkFunc(code: Instr[], numParams = 0, name?: string): FunctionBytecode {
  return { code: List.from(code), numParams, name };
}

function mkCtx(): ExecutionContext {
  return {
    services: __test__createPlatformServices(),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
  };
}

describe("FiberScheduler -- round-based ticks", () => {
  test("every fiber runnable at tick start runs exactly once per tick regardless of count", () => {
    const registry = new FunctionRegistry();
    const counter = { calls: 0 };
    registry.register(
      RECORD_FN_ID,
      "record",
      false,
      {
        exec: () => {
          counter.calls++;
          return NIL_VALUE;
        },
      },
      hostCallDef
    );

    // Each slice records once and then yields; a capped scheduler would
    // starve some fibers, a same-tick resume would record more than once.
    const prog = mkProgram([
      mkFunc([
        { op: Op.HOST_CALL, a: RECORD_FN_ID, b: 0, c: 0 },
        { op: Op.POP },
        { op: Op.YIELD },
        { op: Op.JMP, a: -3 },
      ]),
    ]);
    const vm = new VM(prog, __test__createPlatformServices({ runtime: { functions: registry } }).runtime);
    const scheduler = new FiberScheduler(vm, { defaultBudget: 1000, autoGcHandles: true });

    const fiberCount = 100;
    for (let i = 0; i < fiberCount; i++) {
      scheduler.spawn(0, List.empty(), mkCtx());
    }

    assert.equal(scheduler.tick(), fiberCount);
    assert.equal(counter.calls, fiberCount);

    assert.equal(scheduler.tick(), fiberCount);
    assert.equal(counter.calls, 2 * fiberCount);
  });

  test("a fiber spawned mid-tick joins the next round", () => {
    const registry = new FunctionRegistry();
    const counter = { calls: 0 };
    let scheduler: FiberScheduler;
    registry.register(
      RECORD_FN_ID,
      "record",
      false,
      {
        exec: () => {
          counter.calls++;
          return NIL_VALUE;
        },
      },
      hostCallDef
    );
    registry.register(
      SPAWN_CHILD_FN_ID,
      "spawnChild",
      false,
      {
        exec: () => {
          scheduler.spawn(1, List.empty(), mkCtx());
          return NIL_VALUE;
        },
      },
      hostCallDef
    );

    const prog = mkProgram([
      mkFunc([{ op: Op.HOST_CALL, a: SPAWN_CHILD_FN_ID, b: 0, c: 0 }, { op: Op.RET }], 0, "parent"),
      mkFunc([{ op: Op.HOST_CALL, a: RECORD_FN_ID, b: 0, c: 0 }, { op: Op.RET }], 0, "child"),
    ]);
    const vm = new VM(prog, __test__createPlatformServices({ runtime: { functions: registry } }).runtime);
    scheduler = new FiberScheduler(vm, { defaultBudget: 1000, autoGcHandles: true });

    scheduler.spawn(0, List.empty(), mkCtx());

    assert.equal(scheduler.tick(), 1, "only the parent runs in the round it spawned during");
    assert.equal(counter.calls, 0, "the child must not run in the same tick it was spawned");

    scheduler.tick();
    assert.equal(counter.calls, 1);
  });

  test("YIELD resumes on the next tick, not the same tick", () => {
    const registry = new FunctionRegistry();
    const counter = { calls: 0 };
    registry.register(
      RECORD_FN_ID,
      "record",
      false,
      {
        exec: () => {
          counter.calls++;
          return NIL_VALUE;
        },
      },
      hostCallDef
    );

    const prog = mkProgram([
      mkFunc([
        { op: Op.HOST_CALL, a: RECORD_FN_ID, b: 0, c: 0 },
        { op: Op.POP },
        { op: Op.YIELD },
        { op: Op.HOST_CALL, a: RECORD_FN_ID, b: 0, c: 0 },
        { op: Op.RET },
      ]),
    ]);
    const vm = new VM(prog, __test__createPlatformServices({ runtime: { functions: registry } }).runtime);
    const scheduler = new FiberScheduler(vm, { defaultBudget: 1000, autoGcHandles: true });

    const fiberId = scheduler.spawn(0, List.empty(), mkCtx());

    scheduler.tick();
    assert.equal(counter.calls, 1, "the section after YIELD must wait for the next tick");
    assert.equal(scheduler.getFiber(fiberId)!.state, FiberState.RUNNABLE);

    scheduler.tick();
    assert.equal(counter.calls, 2);
    assert.equal(scheduler.getFiber(fiberId)!.state, FiberState.DONE);
  });

  test("a budget-exhausted fiber resumes on the next tick with a fresh slice", () => {
    const prog = mkProgram(
      [mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.POP }, { op: Op.JMP, a: -2 }])],
      [NIL_VALUE]
    );
    const vm = new VM(prog, __test__createPlatformServices().runtime);
    const scheduler = new FiberScheduler(vm, { defaultBudget: 10, autoGcHandles: true });

    const fiberId = scheduler.spawn(0, List.empty(), mkCtx());

    assert.equal(scheduler.tick(), 1, "the exhausted fiber must not re-run within the same tick");
    assert.equal(scheduler.getFiber(fiberId)!.state, FiberState.RUNNABLE);
    assert.equal(scheduler.tick(), 1);
  });

  test("maxFibers exhaustion at host-side spawn throws a loud OverflowError", () => {
    const prog = mkProgram([mkFunc([{ op: Op.JMP, a: 0 }])]);
    const vm = new VM(prog, __test__createPlatformServices().runtime);
    const scheduler = new FiberScheduler(vm, { defaultBudget: 1, autoGcHandles: true, maxFibers: 2 });

    scheduler.spawn(0, List.empty(), mkCtx());
    scheduler.spawn(0, List.empty(), mkCtx());

    let caught: unknown;
    try {
      scheduler.spawn(0, List.empty(), mkCtx());
    } catch (e) {
      caught = e;
    }
    assert.ok(isOverflowError(caught), "expected OverflowError from spawn at the fiber cap");
  });

  test("maxFibers exhaustion at a bytecode async-action spawn faults the fiber with StackOverflow", () => {
    const descriptor = {
      key: "test-round-scheduler-fiber-cap",
      kind: "actuator" as const,
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: true,
    };
    const prog: Program = {
      ...mkProgram(
        [
          mkFunc([{ op: Op.ACTION_CALL_ASYNC, a: 0, b: 0, c: 3 }, { op: Op.RET }], 0, "root"),
          mkFunc([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }], 0, "action-entry"),
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

    let fault: ErrorValue | undefined;
    const vm = new VM(prog, __test__createPlatformServices().runtime, {
      events: { onFiberFault: (payload) => (fault = payload.err) },
    });
    const scheduler = new FiberScheduler(vm, { defaultBudget: 1000, autoGcHandles: true, maxFibers: 1 });

    const rootFiberId = scheduler.spawn(0, List.empty(), mkCtx());
    scheduler.tick();

    assert.equal(scheduler.getFiber(rootFiberId)!.state, FiberState.FAULT);
    assert.ok(fault, "expected a fiber fault event");
    assert.equal(fault!.code, ErrorCode.StackOverflow);
  });
});
