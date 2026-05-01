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

function ensureSetup() {
  if (!services) {
    services = __test__createBrainServices();
    ambientSource = buildAmbientDeclarations(services.types);
  }
}

describe("Object literal - spread (struct)", () => {
  before(() => ensureSetup());

  test("spread copies all fields", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Point { x: number; y: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const p: Point = { x: 10, y: 20 };
    const q: Point = { ...p };
    return q.x + q.y;
  },
});
`);
    assert.equal(v, 30);
  });

  test("spread with override", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Point { x: number; y: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const p: Point = { x: 10, y: 20 };
    const q: Point = { ...p, x: 99 };
    return q.x + q.y;
  },
});
`);
    assert.equal(v, 119);
  });

  test("spread from superset type", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Point { x: number; y: number; }
interface Point3D { x: number; y: number; z: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const p: Point3D = { x: 1, y: 2, z: 3 };
    const q: Point = { ...p };
    return q.x + q.y;
  },
});
`);
    assert.equal(v, 3);
  });

  test("spread with shorthand override", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Point { x: number; y: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const p: Point = { x: 10, y: 20 };
    const x = 42;
    const q: Point = { ...p, x };
    return q.x + q.y;
  },
});
`);
    assert.equal(v, 62);
  });

  test("multiple spreads", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Pair { a: number; b: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const p1: Pair = { a: 1, b: 2 };
    const p2: Pair = { a: 10, b: 20 };
    const merged: Pair = { ...p1, ...p2 };
    return merged.a + merged.b;
  },
});
`);
    assert.equal(v, 30);
  });

  test("spread from function return value", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Point { x: number; y: number; }
function makePoint(): Point {
  return { x: 5, y: 15 };
}
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const q: Point = { ...makePoint(), y: 100 };
    return q.x + q.y;
  },
});
`);
    assert.equal(v, 105);
  });
});

describe("Object literal - spread (map)", () => {
  before(() => ensureSetup());

  test("spread struct into map", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Scores { alice: number; bob: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const s: Scores = { alice: 10, bob: 20 };
    const m: Record<string, number> = { ...s, carol: 30 };
    return m["alice"] + m["bob"] + m["carol"];
  },
});
`);
    assert.equal(v, 60);
  });

  test("spread struct into map with override", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Scores { alice: number; bob: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const s: Scores = { alice: 10, bob: 20 };
    const m: Record<string, number> = { ...s, alice: 99 };
    return m["alice"] + m["bob"];
  },
});
`);
    assert.equal(v, 119);
  });
});
