import assert from "node:assert/strict";
import { test } from "node:test";

import { List } from "@mindcraft-lang/core";
import {
  type AsyncHandle,
  BYTECODE_VERSION,
  ErrorCode,
  type ExecutionContext,
  FunctionRegistry,
  HandleState,
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

/**
 * Runs a single `HOST_CALL_ASYNC; AWAIT; RET` program whose one async host
 * function is `asyncFn`, and returns the run result alongside the handle table
 * the VM settled against.
 */
function runAsyncOp(asyncFn: HostAsyncFn) {
  const handles = new HandleTable(10);
  const registry = new FunctionRegistry();
  const callDef = mkCallDef({ type: "seq", items: [] });
  const entry = registry.register(2001, "asyncOp", true, asyncFn, callDef);

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
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
  };

  const vm = new VM(program, __test__createPlatformServices({ runtime: { functions: registry } }).runtime, { handles });
  const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
  fiber.instrBudget = 20;
  const result = vm.runFiber(fiber, {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  });
  return { result, handles };
}

test("HOST_CALL_ASYNC and AWAIT complete in one run when the handle resolves synchronously", () => {
  const { result } = runAsyncOp({
    exec: (_ctx, _args, handle) => {
      handle.resolve(mkNumberValue(42));
    },
  });

  assert.equal(result.status, VmStatus.DONE);
  assert.deepEqual(result.result, mkNumberValue(42));
});

test("the bound resolver settles only the first time; later settles are no-ops", () => {
  let bound: AsyncHandle | undefined;
  const { result, handles } = runAsyncOp({
    exec: (_ctx, _args, handle) => {
      bound = handle;
      handle.resolve(mkNumberValue(42));
    },
  });

  assert.equal(result.status, VmStatus.DONE);
  assert.deepEqual(result.result, mkNumberValue(42));
  assert.ok(bound);

  // The handle is already resolved: further settles do not throw and do not
  // change its state.
  assert.doesNotThrow(() => bound!.resolve(mkNumberValue(99)));
  assert.doesNotThrow(() => bound!.reject(ErrorCode.HostError));
  assert.doesNotThrow(() => bound!.cancel());
  assert.equal(handles.get(bound!.id)?.state, HandleState.RESOLVED);

  // Settling after the handle is gone is also a no-op.
  handles.delete(bound!.id);
  assert.doesNotThrow(() => bound!.resolve(mkNumberValue(7)));
});

test("the bound resolver rejects by error code, faulting the awaiting fiber", () => {
  const { result } = runAsyncOp({
    exec: (_ctx, _args, handle) => {
      handle.reject(ErrorCode.HostError, "boom");
    },
  });

  assert.equal(result.status, VmStatus.FAULT);
  if (result.status === VmStatus.FAULT) {
    assert.equal(result.error.code, ErrorCode.HostError);
  }
});
