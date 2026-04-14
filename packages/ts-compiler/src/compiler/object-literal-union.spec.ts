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

function ensureSetup() {
  if (!services) {
    services = __test__createBrainServices();
    ambientSource = buildAmbientDeclarations(services.types);
  }
}

describe("Object literal - union contextual type", () => {
  before(() => ensureSetup());

  test("struct type in union with null", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Point { x: number; y: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const p: Point | null = { x: 10, y: 20 };
    return p!.x + p!.y;
  },
});
`);
    assert.equal(v, 30);
  });

  test("struct type in union with undefined", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Point { x: number; y: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const p: Point | undefined = { x: 3, y: 7 };
    return p!.x + p!.y;
  },
});
`);
    assert.equal(v, 10);
  });

  test("struct type in union with null and undefined", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Point { x: number; y: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const p: Point | null | undefined = { x: 5, y: 15 };
    return p!.x + p!.y;
  },
});
`);
    assert.equal(v, 20);
  });

  test("map type in union with null", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const m: Record<string, number> | null = { a: 10, b: 20 };
    return m!["a"] + m!["b"];
  },
});
`);
    assert.equal(v, 30);
  });

  test("struct in union with null -- spread works", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Point { x: number; y: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const base: Point = { x: 1, y: 2 };
    const p: Point | null = { ...base, x: 99 };
    return p!.x + p!.y;
  },
});
`);
    assert.equal(v, 101);
  });

  test("struct in union with null -- shorthand works", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Point { x: number; y: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const x = 42;
    const y = 58;
    const p: Point | null = { x, y };
    return p!.x + p!.y;
  },
});
`);
    assert.equal(v, 100);
  });
});
