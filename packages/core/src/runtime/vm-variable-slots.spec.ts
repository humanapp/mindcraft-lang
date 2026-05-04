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
  type Value,
  VM,
  VmStatus,
} from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";

test("STORE_VAR_SLOT and LOAD_VAR_SLOT round-trip a value through the execution context", () => {
  const slots = List.empty<Value>();
  const ctx: ExecutionContext = {
    services: __test__createPlatformServices(),
    getVariableBySlot: (slotId) => slots.get(slotId) ?? NIL_VALUE,
    setVariableBySlot: (slotId, value) => {
      while (slots.size() <= slotId) {
        slots.push(NIL_VALUE);
      }
      slots.set(slotId, value);
    },
    time: 0,
    dt: 0,
    currentTick: 0,
  };

  const program: Program = {
    version: BYTECODE_VERSION,
    functions: List.from([
      {
        code: List.from([
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.STORE_VAR_SLOT, a: 0 },
          { op: Op.LOAD_VAR_SLOT, a: 0 },
          { op: Op.RET },
        ]),
        numParams: 0,
      },
    ]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.from([mkNumberValue(42)]),
    },
    variableNames: List.from(["x"]),
    entryPoint: 0,
  };

  const vm = new VM(program, __test__createPlatformServices());
  const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
  fiber.instrBudget = 20;
  const result = vm.runFiber(fiber, {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  });

  assert.equal(result.status, VmStatus.DONE);
  assert.deepEqual(result.result, mkNumberValue(42));
});
