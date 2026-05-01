import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BrainServices,
  HandleTable,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  runtime,
  type StringValue,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { compileUserTile } from "./compile.js";

let services: BrainServices;
let ambientSource: string;

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    brain: undefined as never,
    getVariable: () => undefined,
    setVariable: () => {},
    clearVariable: () => {},
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
    ...overrides,
  };
}

function mkScheduler(): Scheduler {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  };
}

function compileAndRun(source: string): Value {
  const result = compileUserTile(source, { ambientSource, services });
  assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program, "expected program");

  const prog = result.program!;
  const handles = new HandleTable(100);
  const vm = new runtime.VM(services, prog, handles);
  const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
  fiber.instrBudget = 10_000;

  const runResult = vm.runFiber(fiber, mkScheduler());
  assert.equal(runResult.status, VmStatus.DONE);
  assert.ok(runResult.result, "expected a return value");
  return runResult.result!;
}

function compileAndRunNumber(source: string): number {
  const result = compileAndRun(source);
  assert.equal(result.t, NativeType.Number);
  return (result as NumberValue).v;
}

function compileAndRunString(source: string): string {
  const result = compileAndRun(source);
  assert.equal(result.t, NativeType.String);
  return (result as StringValue).v;
}

function ensureSetup() {
  if (!services) {
    services = __test__createBrainServices();
    ambientSource = buildAmbientDeclarations(services.types);
  }
}

describe("Object literal - no contextual type (anonymous struct)", () => {
  before(() => ensureSetup());

  test("basic anonymous object literal", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const obj = { x: 10, y: 20 };
    return obj.x + obj.y;
  },
});
`);
    assert.equal(v, 30);
  });

  test("anonymous object with string field", () => {
    const v = compileAndRunString(`
import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "test",
  onExecute(ctx: Context): string {
    const obj = { greeting: "hello", name: "world" };
    return obj.greeting;
  },
});
`);
    assert.equal(v, "hello");
  });

  test("anonymous object with mixed types", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const obj = { count: 5, label: "items" };
    return obj.count;
  },
});
`);
    assert.equal(v, 5);
  });

  test("anonymous object with shorthand", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const a = 3;
    const b = 7;
    const obj = { a, b };
    return obj.a + obj.b;
  },
});
`);
    assert.equal(v, 10);
  });

  test("anonymous object with spread", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Point { x: number; y: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const p: Point = { x: 1, y: 2 };
    const obj = { ...p, z: 3 };
    return obj.x + obj.y + obj.z;
  },
});
`);
    assert.equal(v, 6);
  });

  test("anonymous object passed to function", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Pair { a: number; b: number; }
function sum(p: Pair): number {
  return p.a + p.b;
}
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    return sum({ a: 40, b: 2 });
  },
});
`);
    assert.equal(v, 42);
  });

  test("nested anonymous objects", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Inner { val: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const inner: Inner = { val: 99 };
    const outer = { data: inner, extra: 1 };
    return outer.data.val + outer.extra;
  },
});
`);
    assert.equal(v, 100);
  });

  test("reused anonymous struct shape", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const a = { x: 1, y: 2 };
    const b = { x: 10, y: 20 };
    return a.x + b.y;
  },
});
`);
    assert.equal(v, 21);
  });
});
