import assert from "node:assert/strict";
import { test } from "node:test";

import { List } from "@mindcraft-lang/core";
import {
  BYTECODE_VERSION,
  type ExecutionContext,
  mkNumberValue,
  NIL_VALUE,
  Op,
  type Program,
  VM,
  VmStatus,
} from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";

test("CALL transfers control to a callee and propagates its return value", () => {
  const program: Program = {
    version: BYTECODE_VERSION,
    functions: List.from([
      {
        // func0: calls func1 and returns its result
        code: List.from([{ op: Op.CALL, a: 1, b: 0 }, { op: Op.RET }]),
        numParams: 0,
      },
      {
        // func1: returns 99
        code: List.from([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }]),
        numParams: 0,
      },
    ]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.from([mkNumberValue(99)]),
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

  const vm = new VM(program, __test__createPlatformServices().runtime);
  const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
  fiber.instrBudget = 20;
  const result = vm.runFiber(fiber, {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  });

  assert.equal(result.status, VmStatus.DONE);
  assert.deepEqual(result.result, mkNumberValue(99));
});
