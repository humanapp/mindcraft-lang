import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { List, type ReadonlyList } from "@mindcraft-lang/core";
import {
  BrainActionRegistry,
  BYTECODE_VERSION,
  type ExecutionContext,
  HandleTable,
  type HostActionBinding,
  type Instr,
  mkCallDef,
  mkNumberValue,
  NIL_VALUE,
  Op,
  type Program,
  type Value,
  VM,
  VmStatus,
} from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";

const scheduler = {
  onHandleCompleted: () => {},
  enqueueRunnable: () => {},
  getFiber: () => undefined,
};

function registerSyncAction(
  actions: BrainActionRegistry,
  key: string,
  fn: (args: ReadonlyList<Value>) => Value
): HostActionBinding {
  const binding: HostActionBinding = {
    binding: "host",
    id: 3201,
    descriptor: { key, kind: "actuator", callDef: mkCallDef({ type: "seq", items: [] }), isAsync: false },
    execSync: (_ctx, args) => fn(args),
  };
  actions.register(binding);
  return binding;
}

function run(code: Instr[], actions: BrainActionRegistry, handles: HandleTable, numbers: number[] = []) {
  const services = __test__createPlatformServices({ runtime: { actions } });
  const program: Program = {
    version: BYTECODE_VERSION,
    functions: List.from([{ code: List.from(code), numParams: 0 }]),
    constantPools: {
      numbers: List.from(numbers),
      strings: List.empty<string>(),
      values: List.empty(),
    },
    variableNames: List.empty<string>(),
    entryPoint: 0,
  };
  const ctx: ExecutionContext = {
    services,
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
  };
  const vm = new VM(program, services.runtime, { handles });
  const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
  fiber.instrBudget = 50;
  return vm.runFiber(fiber, scheduler);
}

describe("HOST_ACTION_CALL dispatch", () => {
  test("dispatches a sync host action by stable id and returns its result", () => {
    const actions = new BrainActionRegistry();
    const action = registerSyncAction(actions, "echo", (args) => args.get(0) ?? NIL_VALUE);
    const handles = new HandleTable(10);

    const result = run(
      [{ op: Op.PUSH_CONST_NUM, a: 0 }, { op: Op.HOST_ACTION_CALL, a: action.id ?? 0, b: 1, c: 0 }, { op: Op.RET }],
      actions,
      handles,
      [42]
    );

    assert.equal(result.status, VmStatus.DONE);
    assert.deepEqual(result.result, mkNumberValue(42));
  });

  test("dispatches an async host action by stable id and awaits its handle", () => {
    const actions = new BrainActionRegistry();
    const handles = new HandleTable(10);
    const binding: HostActionBinding = {
      binding: "host",
      id: 3202,
      descriptor: { key: "asyncEcho", kind: "sensor", callDef: mkCallDef({ type: "seq", items: [] }), isAsync: true },
      execAsync: (_ctx, _args, handle) => {
        handle.resolve(mkNumberValue(99));
      },
    };
    actions.register(binding);

    const result = run(
      [{ op: Op.HOST_ACTION_CALL_ASYNC, a: binding.id ?? 0, b: 0, c: 0 }, { op: Op.AWAIT }, { op: Op.RET }],
      actions,
      handles
    );

    assert.equal(result.status, VmStatus.DONE);
    assert.deepEqual(result.result, mkNumberValue(99));
  });

  test("faults when no action holds the id", () => {
    const actions = new BrainActionRegistry();
    const handles = new HandleTable(10);

    const result = run([{ op: Op.HOST_ACTION_CALL, a: 7, b: 0, c: 0 }, { op: Op.RET }], actions, handles);

    assert.equal(result.status, VmStatus.FAULT);
  });

  test("faults when a sync action is invoked via the async opcode", () => {
    const actions = new BrainActionRegistry();
    const action = registerSyncAction(actions, "syncOnly", () => NIL_VALUE);
    const handles = new HandleTable(10);

    const result = run(
      [{ op: Op.HOST_ACTION_CALL_ASYNC, a: action.id ?? 0, b: 0, c: 0 }, { op: Op.AWAIT }, { op: Op.RET }],
      actions,
      handles
    );

    assert.equal(result.status, VmStatus.FAULT);
  });
});
