import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, runtime } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/runtime";
import {
  HandleTable,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";
import { compileUserTile } from "./compile.js";

let services: BrainServices;

function toVmServices(b: BrainServices) {
  return __test__createPlatformServices({ runtime: { functions: b.runtime.functions, types: b.runtime.types } })
    .runtime;
}

function mkCtx(): ExecutionContext {
  return {
    services: __test__createPlatformServices(),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
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

function sensorReturningNumber(body: string): string {
  return `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "buffer-test",
  onExecute(ctx: Context): number {
    ${body}
  },
});
`;
}

function compileAndRun(source: string): Value {
  const result = compileUserTile(source, { services });
  assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program, "expected program");

  const prog = result.program!;
  const handles = new HandleTable(100);
  const vm = new runtime.VM(prog, toVmServices(services), { handles });
  const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
  fiber.instrBudget = 1000;

  const runResult = vm.runFiber(fiber, mkScheduler());
  assert.equal(runResult.status, VmStatus.DONE);
  assert.ok(runResult.result, "expected a return value");
  return runResult.result!;
}

function compileAndRunNumber(body: string): number {
  const result = compileAndRun(sensorReturningNumber(body));
  assert.equal(result.t, NativeType.Number);
  return (result as NumberValue).v;
}

describe("Buffer constructors and accessors", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("Buffer.from([10, 20, 30]).length()", () => {
    assert.equal(compileAndRunNumber("return Buffer.from([10, 20, 30]).length();"), 3);
  });

  test("Buffer.from(...).get(i) reads the byte at i", () => {
    assert.equal(compileAndRunNumber("return Buffer.from([10, 20, 30]).get(1);"), 20);
  });

  test("Buffer.from masks each element to a byte (0-255)", () => {
    assert.equal(compileAndRunNumber("return Buffer.from([256, 511]).get(0);"), 0);
    assert.equal(compileAndRunNumber("return Buffer.from([256, 511]).get(1);"), 255);
  });

  test("Buffer.fromHex parses two hex digits per byte", () => {
    assert.equal(compileAndRunNumber('return Buffer.fromHex("00ff7f").length();'), 3);
    assert.equal(compileAndRunNumber('return Buffer.fromHex("00ff7f").get(1);'), 255);
  });

  test("Buffer.fromString uses latin1 char codes", () => {
    assert.equal(compileAndRunNumber('return Buffer.fromString("ABC").length();'), 3);
    assert.equal(compileAndRunNumber('return Buffer.fromString("ABC").get(0);'), 65);
  });

  test("Buffer.from([]).length() is 0", () => {
    assert.equal(compileAndRunNumber("return Buffer.from([]).length();"), 0);
  });
});
