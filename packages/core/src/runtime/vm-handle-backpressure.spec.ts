/**
 * Async-dispatch backpressure on handle exhaustion.
 *
 * When an async dispatch (`HOST_CALL_ASYNC`, `ACTION_CALL_ASYNC`,
 * `HOST_ACTION_CALL_ASYNC`) cannot allocate a handle because the `HandleTable`
 * is full, the fiber yields without advancing its pc and re-executes the same
 * dispatch on a later round. Excess concurrent async spills across thinks: no
 * action faults, none is lost, and the live-handle count never exceeds
 * `maxHandles`. These tests pin that mechanism with hand-assembled programs.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { List } from "@mindcraft-lang/core";
import {
  type AsyncHandle,
  BYTECODE_VERSION,
  type ExecutionContext,
  FiberScheduler,
  FiberState,
  type FunctionBytecode,
  FunctionRegistry,
  type HostAsyncFn,
  type Instr,
  mkCallDef,
  mkNumberValue,
  NIL_VALUE,
  Op,
  type Program,
  type Value,
  VM,
} from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";

const HOLD_FN_ID = 7101;
const holdCallDef = mkCallDef({ type: "seq", items: [] });

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

/**
 * An async host function that parks: it retains each handle it is handed and
 * never settles it on its own, so every successful dispatch holds a live slot
 * until the test resolves it. Records the total number of successful dispatches.
 */
function makeHold(): { fn: HostAsyncFn; held: AsyncHandle[]; calls: () => number } {
  const held: AsyncHandle[] = [];
  const fn: HostAsyncFn = {
    exec: (_ctx, _args, handle) => {
      held.push(handle);
    },
  };
  return { fn, held, calls: () => held.length };
}

/** A VM whose one async host function is `hold`, capped at `maxHandles` handles. */
function makeVm(prog: Program, hold: HostAsyncFn, maxHandles: number, onFiberFault: () => void): VM {
  const registry = new FunctionRegistry();
  registry.register(HOLD_FN_ID, "hold", true, hold, holdCallDef);
  return new VM(prog, __test__createPlatformServices({ runtime: { functions: registry } }).runtime, {
    maxHandles,
    events: { onFiberFault },
  });
}

/** `[HOST_CALL_ASYNC(hold); AWAIT; RET]` -- one pending async dispatch, then park on it. */
const asyncDispatchBody: Instr[] = [
  { op: Op.HOST_CALL_ASYNC, a: HOLD_FN_ID, b: 0, c: 0 },
  { op: Op.AWAIT },
  { op: Op.RET },
];

describe("async-dispatch handle backpressure", () => {
  test("a dispatch with no free handle parks and retries next round without faulting", () => {
    const hold = makeHold();
    const faults: number[] = [];
    const prog = mkProgram([mkFunc(asyncDispatchBody)]);
    const vm = makeVm(prog, hold.fn, 2, () => faults.push(1));
    const scheduler = new FiberScheduler(vm, { defaultBudget: 1000, autoGcHandles: true });

    const ids = [
      scheduler.spawn(0, List.empty(), mkCtx()),
      scheduler.spawn(0, List.empty(), mkCtx()),
      scheduler.spawn(0, List.empty(), mkCtx()),
      scheduler.spawn(0, List.empty(), mkCtx()),
    ];

    scheduler.tick();
    // Only two fit under the cap; the other two backpressured.
    assert.equal(hold.calls(), 2, "only maxHandles dispatches succeed in the first round");
    assert.equal(vm.handles.size(), 2, "the live-handle count is exactly the cap");
    assert.equal(faults.length, 0, "handle exhaustion parks, it does not fault");
    assert.equal(scheduler.getFiber(ids[2])!.state, FiberState.RUNNABLE, "a parked dispatcher stays runnable");
    assert.equal(scheduler.getFiber(ids[3])!.state, FiberState.RUNNABLE);

    // Settle the two in-flight handles, freeing both slots for the next round.
    for (const handle of hold.held) {
      handle.resolve(mkNumberValue(0));
    }

    scheduler.tick();
    // The two parked dispatchers re-execute their identical dispatch and now fit.
    assert.equal(hold.calls(), 4, "every async action eventually dispatches");
    assert.equal(vm.handles.size(), 2, "the live-handle count never exceeds the cap");
    assert.equal(faults.length, 0);
  });

  test("a same-think child that backpressures spills to the next round, not the same tick", () => {
    const hold = makeHold();
    const faults: number[] = [];
    // Parent (0) spawns four child rules (func 1) at its tail; each child does one
    // async dispatch. Under a cap of 2, the same-think cascade dispatches two and
    // backpressures the rest to the next round.
    const prog = mkProgram(
      [
        mkFunc(
          [
            { op: Op.SPAWN_RULE, a: 1 },
            { op: Op.SPAWN_RULE, a: 1 },
            { op: Op.SPAWN_RULE, a: 1 },
            { op: Op.SPAWN_RULE, a: 1 },
            { op: Op.PUSH_CONST_VAL, a: 0 },
            { op: Op.RET },
          ],
          0,
          "parent"
        ),
        mkFunc(asyncDispatchBody, 0, "child"),
      ],
      [NIL_VALUE]
    );
    const vm = makeVm(prog, hold.fn, 2, () => faults.push(1));
    const scheduler = new FiberScheduler(vm, { defaultBudget: 1000, autoGcHandles: true });

    scheduler.spawn(0, List.empty(), mkCtx());

    scheduler.tick();
    // Two children dispatched in the same-think drain; the other two did NOT retry
    // within this tick (handles free only across thinks).
    assert.equal(hold.calls(), 2, "backpressured children wait for the next round, not a same-tick retry");
    assert.equal(vm.handles.size(), 2, "live handles are bounded by the cap during the cascade");
    assert.equal(faults.length, 0);

    for (const handle of hold.held) {
      handle.resolve(mkNumberValue(0));
    }

    scheduler.tick();
    assert.equal(hold.calls(), 4, "the backpressured children dispatch on the next round; no action is lost");
    assert.equal(vm.handles.size(), 2);
    assert.equal(faults.length, 0);
  });

  test("wide async breadth spills across rounds in bounded waves that never exceed the cap", () => {
    const hold = makeHold();
    const faults: number[] = [];
    // Six independent dispatchers under a cap of 2: two settle and free their
    // slots each round, so the breadth drains in three waves of two.
    const prog = mkProgram([mkFunc(asyncDispatchBody)]);
    const vm = makeVm(prog, hold.fn, 2, () => faults.push(1));
    const scheduler = new FiberScheduler(vm, { defaultBudget: 1000, autoGcHandles: true });

    for (let i = 0; i < 6; i++) {
      scheduler.spawn(0, List.empty(), mkCtx());
    }

    const dispatchesPerRound: number[] = [];
    let settled = 0;
    for (let round = 0; round < 3; round++) {
      const before = hold.calls();
      scheduler.tick();
      dispatchesPerRound.push(hold.calls() - before);
      assert.ok(vm.handles.size() <= 2, "the live-handle count never exceeds the cap");
      // Settle the handles this round dispatched, freeing their slots for the next.
      for (; settled < hold.held.length; settled++) {
        hold.held[settled]!.resolve(mkNumberValue(0));
      }
    }

    assert.deepEqual(dispatchesPerRound, [2, 2, 2], "the breadth drains in bounded waves of the cap size");
    assert.equal(hold.calls(), 6, "every async action eventually dispatches");
    assert.equal(faults.length, 0, "no wave ever faults");
  });
});
