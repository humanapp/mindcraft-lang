import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BrainServices,
  HandleTable,
  NativeType,
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

describe("Object literal - shorthand properties (struct)", () => {
  before(() => ensureSetup());

  test("shorthand property creates struct field", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Point { x: number; y: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const x = 10;
    const y = 20;
    const p: Point = { x, y };
    return p.x + p.y;
  },
});
`);
    assert.equal(v, 30);
  });

  test("mixed shorthand and explicit properties", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Rect { x: number; y: number; w: number; h: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const x = 1;
    const h = 4;
    const r: Rect = { x, y: 2, w: 3, h };
    return r.x + r.y + r.w + r.h;
  },
});
`);
    assert.equal(v, 10);
  });

  test("shorthand from function parameter", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Named { name: string; age: number; }
function makeNamed(name: string, age: number): Named {
  return { name, age };
}
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const n = makeNamed("Alice", 30);
    return n.age;
  },
});
`);
    assert.equal(v, 30);
  });

  test("shorthand as function argument", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Vec2 { x: number; y: number; }
function sum(v: Vec2): number { return v.x + v.y; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const x = 5;
    const y = 7;
    return sum({ x, y });
  },
});
`);
    assert.equal(v, 12);
  });
});

describe("Object literal - shorthand properties (map)", () => {
  before(() => ensureSetup());

  test("shorthand property creates map entry", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const greeting = 42;
    const m: Record<string, number> = { greeting };
    return m["greeting"];
  },
});
`);
    assert.equal(v, 42);
  });

  test("mixed shorthand and explicit in map", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const a = 1;
    const m: Record<string, number> = { a, b: 2 };
    return m["a"] + m["b"];
  },
});
`);
    assert.equal(v, 3);
  });
});
