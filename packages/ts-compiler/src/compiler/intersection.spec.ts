import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BrainServices,
  CoreTypeIds,
  HandleTable,
  isStructValue,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  runtime,
  type StringValue,
  type StructValue,
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

describe("Intersection types - named type alias", () => {
  before(() => ensureSetup());

  test("named intersection of two interfaces", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface A { a: number; }
interface B { b: number; }
type AB = A & B;

export default Sensor({
  name: "inter-test",
  onExecute(ctx: Context): number {
    const x: AB = { a: 1, b: 2 };
    return x.a;
  },
});
`);
    assert.equal(v, 1);
  });

  test("named intersection can access fields from both constituents", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface Base { x: number; }
interface Extra { y: number; }
type Combined = Base & Extra;

export default Sensor({
  name: "inter-test",
  onExecute(ctx: Context): number {
    const c: Combined = { x: 10, y: 20 };
    return c.x + c.y;
  },
});
`);
    assert.equal(v, 30);
  });

  test("named intersection of overlapping interfaces merges fields", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface Left { shared: number; a: number; }
interface Right { shared: number; b: number; }
type Both = Left & Right;

export default Sensor({
  name: "inter-test",
  onExecute(ctx: Context): number {
    const x: Both = { shared: 42, a: 1, b: 2 };
    return x.shared + x.a + x.b;
  },
});
`);
    assert.equal(v, 45);
  });
});

describe("Intersection types - anonymous intersection", () => {
  before(() => ensureSetup());

  test("anonymous intersection as parameter type", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface A2 { a: number; }
interface B2 { b: number; }

function sum(x: A2 & B2): number {
  return x.a + x.b;
}

export default Sensor({
  name: "inter-test",
  onExecute(ctx: Context): number {
    const v: A2 & B2 = { a: 3, b: 7 };
    return sum(v);
  },
});
`);
    assert.equal(v, 10);
  });

  test("anonymous intersection as variable type", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface P { p: number; }
interface Q { q: number; }

export default Sensor({
  name: "inter-test",
  onExecute(ctx: Context): number {
    const x: P & Q = { p: 5, q: 15 };
    return x.p + x.q;
  },
});
`);
    assert.equal(v, 20);
  });

  test("anonymous intersection as return type", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface M { m: number; }
interface N { n: number; }

function make(): M & N {
  return { m: 100, n: 200 };
}

export default Sensor({
  name: "inter-test",
  onExecute(ctx: Context): number {
    const v = make();
    return v.m + v.n;
  },
});
`);
    assert.equal(v, 300);
  });
});

describe("Intersection types - branded/phantom types", () => {
  before(() => ensureSetup());

  test("number branded type compiles (brand is erased)", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

type UserId = number & { __brand: "UserId" };

export default Sensor({
  name: "inter-test",
  onExecute(ctx: Context): number {
    const x: UserId = 42 as UserId;
    return x as number;
  },
});
`);
    assert.equal(v, 42);
  });

  test("string branded type compiles (brand is erased)", () => {
    const v = compileAndRunString(`
import { Sensor, type Context } from "mindcraft";

type Email = string & { __tag: "Email" };

export default Sensor({
  name: "inter-test",
  onExecute(ctx: Context): string {
    const x: Email = "a@b.com" as Email;
    return x as string;
  },
});
`);
    assert.equal(v, "a@b.com");
  });
});

describe("Intersection types - three-way intersection", () => {
  before(() => ensureSetup());

  test("three interfaces intersected", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface X { x: number; }
interface Y { y: number; }
interface Z { z: number; }
type XYZ = X & Y & Z;

export default Sensor({
  name: "inter-test",
  onExecute(ctx: Context): number {
    const v: XYZ = { x: 1, y: 2, z: 3 };
    return v.x + v.y + v.z;
  },
});
`);
    assert.equal(v, 6);
  });
});

describe("Intersection types - with generic constituents", () => {
  before(() => ensureSetup());

  test("intersection of generic interface instantiation", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface Box<T> { value: T; }
interface Named { name: string; }
type NamedBox = Box<number> & Named;

export default Sensor({
  name: "inter-test",
  onExecute(ctx: Context): number {
    const nb: NamedBox = { value: 99, name: "test" };
    return nb.value;
  },
});
`);
    assert.equal(v, 99);
  });
});

describe("Intersection types - for-in iteration", () => {
  before(() => ensureSetup());

  test("for-in over intersection struct iterates all keys", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface F1 { a: number; }
interface F2 { b: number; }
type ForInBoth = F1 & F2;

export default Sensor({
  name: "inter-test",
  onExecute(ctx: Context): number {
    const v: ForInBoth = { a: 10, b: 20 };
    let total = 0;
    for (const k in v) {
      total = total + 1;
    }
    return total;
  },
});
`);
    assert.equal(v, 2);
  });
});

describe("Intersection types - object literal as intersection", () => {
  before(() => ensureSetup());

  test("object literal contextually typed as intersection", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface G { g: number; }
interface H { h: number; }

function consume(v: G & H): number {
  return v.g + v.h;
}

export default Sensor({
  name: "inter-test",
  onExecute(ctx: Context): number {
    return consume({ g: 4, h: 6 });
  },
});
`);
    assert.equal(v, 10);
  });
});
