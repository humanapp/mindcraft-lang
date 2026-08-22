import assert from "node:assert/strict";
import { test } from "node:test";

import { List } from "@wendoo-lang/core";
import {
  BYTECODE_VERSION,
  ErrorCode,
  type ExecutionContext,
  NIL_VALUE,
  Op,
  type Program,
  VM,
  VmStatus,
} from "@wendoo-lang/core/runtime";
import { __test__createPlatformServices } from "@wendoo-lang/core/runtime/__test__";

test("THROW with a non-error value faults the fiber with ScriptError", () => {
  const program: Program = {
    version: BYTECODE_VERSION,
    functions: List.from([
      {
        code: List.from([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.THROW }]),
        numParams: 0,
      },
    ]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.from([NIL_VALUE]),
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

  assert.equal(result.status, VmStatus.FAULT);
  if (result.status === VmStatus.FAULT) {
    assert.equal(result.error.code, ErrorCode.ScriptError);
  }
});
