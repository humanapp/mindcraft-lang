import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, runtime } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/runtime";
import { CoreFuncId, HandleTable, NativeType, NIL_VALUE, Op, type Value, VmStatus } from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";
import { compileUserTile } from "./compile.js";

let services: BrainServices;

function toVmServices(b: BrainServices) {
  return __test__createPlatformServices({ runtime: { functions: b.runtime.functions, types: b.runtime.types } })
    .runtime;
}

/** A standalone execution context with no enclosing rule (currentRuleFuncId undefined). */
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

function mkScheduler(): Scheduler {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  };
}

const WHEN_RESULT_SENSOR = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "when-result-reader",
  onExecute(ctx: Context): number {
    const result = ctx.getWhenResult();
    return typeof result === "number" ? result : -1;
  },
});
`;

describe("ctx.getWhenResult()", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("lowers to a HOST_CALL of Context.getWhenResult with only the receiver argument", () => {
    const compiled = compileUserTile(WHEN_RESULT_SENSOR, { services });
    assert.deepStrictEqual(compiled.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(compiled.diagnostics)}`);
    assert.ok(compiled.program, "expected a compiled program");

    let hostCall: { a?: number; b?: number } | undefined;
    compiled.program!.functions.forEach((fn) => {
      fn.code.forEach((instr) => {
        if (instr.op === Op.HOST_CALL && instr.a === CoreFuncId.ContextGetWhenResult) {
          hostCall = instr;
        }
      });
    });
    assert.ok(hostCall, "expected a HOST_CALL to Context.getWhenResult");
    assert.equal(hostCall.b, 1, "the struct receiver is the only argument (arg 0)");
  });

  test("returns nil when there is no enclosing rule (no WHEN result captured)", () => {
    const compiled = compileUserTile(WHEN_RESULT_SENSOR, { services });
    assert.deepStrictEqual(compiled.diagnostics, []);
    assert.ok(compiled.program);

    const prog = compiled.program!;
    const vm = new runtime.VM(prog, toVmServices(services), { handles: new HandleTable(100) });
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;
    const runResult = vm.runFiber(fiber, mkScheduler());

    assert.equal(runResult.status, VmStatus.DONE);
    // getWhenResult read nil, so the `typeof number` guard failed and the sensor returned -1.
    assert.ok(runResult.result);
    assert.equal(runResult.result!.t, NativeType.Number);
    assert.equal((runResult.result as { v: number }).v, -1);
  });
});
