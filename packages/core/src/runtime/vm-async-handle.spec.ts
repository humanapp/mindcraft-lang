import assert from "node:assert/strict";
import { test } from "node:test";

import { List } from "@mindcraft-lang/core";
import {
  BYTECODE_VERSION,
  type ExecutionContext,
  FunctionRegistry,
  HandleTable,
  type HostAsyncFn,
  mkCallDef,
  mkNumberValue,
  NIL_VALUE,
  Op,
  type Program,
  VM,
  VmStatus,
} from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";

test("HOST_CALL_ASYNC and AWAIT complete in one run when the handle resolves synchronously", () => {
  const handles = new HandleTable(10);
  const registry = new FunctionRegistry();
  const callDef = mkCallDef({ type: "seq", items: [] });
  const asyncFn: HostAsyncFn = {
    exec: (_ctx, _args, handleId) => {
      handles.resolve(handleId, mkNumberValue(42));
    },
  };
  const entry = registry.register("asyncOp", true, asyncFn, callDef);

  const program: Program = {
    version: BYTECODE_VERSION,
    functions: List.from([
      {
        code: List.from([{ op: Op.HOST_CALL_ASYNC, a: entry.id, b: 0, c: 0 }, { op: Op.AWAIT }, { op: Op.RET }]),
        numParams: 0,
      },
    ]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.empty(),
    },
    variableNames: List.empty<string>(),
    entryPoint: 0,
  };

  const ctx: ExecutionContext = {
    services: __test__createPlatformServices(),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
  };

  const vm = new VM(program, __test__createPlatformServices({ runtime: { functions: registry } }), { handles });
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
