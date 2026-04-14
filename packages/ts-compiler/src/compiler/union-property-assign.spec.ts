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

describe("Union property assignment", () => {
  before(() => ensureSetup());

  test("simple assignment on A | B", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Cat { name: string; legs: number; }
interface Dog { name: string; legs: number; }
function getPet(): Cat | Dog {
  const c: Cat = { name: "Rex", legs: 4 };
  return c;
}
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const pet: Cat | Dog = getPet();
    pet.legs = 8;
    return pet.legs;
  },
});
`);
    assert.equal(v, 8);
  });

  test("simple assignment on A | null", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Point { x: number; y: number; }
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const p: Point | null = { x: 1, y: 2 };
    p!.x = 99;
    return p!.x;
  },
});
`);
    assert.equal(v, 99);
  });

  test("compound assignment += on union", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Stats { hp: number; mp: number; }
interface Buffs { hp: number; mp: number; }
function getStats(): Stats | Buffs {
  const s: Stats = { hp: 10, mp: 5 };
  return s;
}
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const s: Stats | Buffs = getStats();
    s.hp += 20;
    return s.hp;
  },
});
`);
    assert.equal(v, 30);
  });

  test("assignment on union from function return", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Cat { name: string; speed: number; }
interface Dog { name: string; speed: number; }
function getPet(): Cat | Dog {
  const c: Cat = { name: "Kitty", speed: 5 };
  return c;
}
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const pet: Cat | Dog = getPet();
    pet.speed = 42;
    return pet.speed;
  },
});
`);
    assert.equal(v, 42);
  });

  test("assignment to shared field on different struct shapes", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";
interface Circle { radius: number; kind: string; }
interface Square { side: number; kind: string; }
function getShape(): Circle | Square {
  const c: Circle = { radius: 10, kind: "circle" };
  return c;
}
export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const shape: Circle | Square = getShape();
    shape.kind = "modified";
    return 1;
  },
});
`);
    assert.equal(v, 1);
  });
});
