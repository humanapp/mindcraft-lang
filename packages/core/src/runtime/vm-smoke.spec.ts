import assert from "node:assert/strict";
import { test } from "node:test";

import { List } from "@wendoo-lang/core";
import { BYTECODE_VERSION, NIL_VALUE, Op, type Program, VM, VmStatus, VOID_VALUE } from "@wendoo-lang/core/runtime";
import { __test__createPlatformServices } from "@wendoo-lang/core/runtime/__test__";

test("VM terminates cleanly from a runtime-only program with no event observer", () => {
  const program: Program = {
    version: BYTECODE_VERSION,
    functions: List.from([{ code: List.from([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }]), numParams: 0 }]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.from([VOID_VALUE]),
    },
    variableNames: List.empty<string>(),
    entryPoint: 0,
  };

  const vm = new VM(program, __test__createPlatformServices().runtime);

  const fiber = vm.spawnFiber(1, 0, List.empty(), {
    services: __test__createPlatformServices(),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
  });
  fiber.instrBudget = 10;

  const result = vm.runFiber(fiber, {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  });

  assert.equal(result.status, VmStatus.DONE);
});
