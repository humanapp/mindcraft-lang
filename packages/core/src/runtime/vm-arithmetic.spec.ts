import assert from "node:assert/strict";
import { test } from "node:test";

import { List } from "@wendoo/core";
import {
  BYTECODE_VERSION,
  type ExecutionContext,
  FunctionRegistry,
  type HostSyncFn,
  mkCallDef,
  mkNumberValue,
  NIL_VALUE,
  type NumberValue,
  Op,
  type Program,
  VM,
  VmStatus,
} from "@wendoo/core/runtime";
import { __test__createPlatformServices } from "@wendoo/core/runtime/__test__";

test("HOST_CALL invokes a sync host function and returns the result", () => {
  const registry = new FunctionRegistry();
  const callDef = mkCallDef({
    type: "seq",
    items: [
      { type: "arg", tileId: "a" },
      { type: "arg", tileId: "b" },
    ],
  });
  const addFn: HostSyncFn = {
    exec: (_ctx, args) => mkNumberValue((args.get(0) as NumberValue).v + (args.get(1) as NumberValue).v),
  };
  const entry = registry.register(2001, "add", false, addFn, callDef);

  const program: Program = {
    version: BYTECODE_VERSION,
    functions: List.from([
      {
        code: List.from([
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.HOST_CALL, a: entry.id, b: 2, c: 0 },
          { op: Op.RET },
        ]),
        numParams: 0,
      },
    ]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.from([mkNumberValue(2), mkNumberValue(3)]),
    },
    variableNames: List.empty<string>(),
    entryPoint: 0,
  };

  const ctx: ExecutionContext = {
    services: __test__createPlatformServices(),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
  };

  const vm = new VM(program, __test__createPlatformServices({ runtime: { functions: registry } }).runtime);
  const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
  fiber.instrBudget = 20;
  const result = vm.runFiber(fiber, {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  });

  assert.equal(result.status, VmStatus.DONE);
  assert.deepEqual(result.result, mkNumberValue(5));
});
