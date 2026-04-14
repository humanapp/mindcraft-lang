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

describe("Explicit type arguments at call sites", () => {
  before(() => ensureSetup());

  test("explicit type arg on identity function", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

function identity<T>(value: T): T {
  return value;
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    return identity<number>(42);
  },
});
`);
    assert.equal(v, 42);
  });

  test("explicit type arg on generic list function", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

function first<T>(items: T[]): T {
  return items[0];
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    return first<number>([10, 20, 30]);
  },
});
`);
    assert.equal(v, 10);
  });
});

describe("Utility types at concrete usage sites", () => {
  before(() => ensureSetup());

  test("Partial of a concrete interface", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Point {
  x: number;
  y: number;
}

function getX(p: Partial<Point>): number {
  return p.x ?? 0;
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    const p: Partial<Point> = { x: 7 };
    return getX(p);
  },
});
`;
    const v = compileAndRunNumber(source);
    assert.equal(v, 7);
  });

  test("Required of a concrete interface", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Config {
  width: number;
  height: number;
}

function area(c: Required<Config>): number {
  return c.width * c.height;
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    return area({ width: 3, height: 4 });
  },
});
`;
    const v = compileAndRunNumber(source);
    assert.equal(v, 12);
  });

  test("Pick of a concrete interface", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

interface FullRecord {
  name: string;
  age: number;
  score: number;
}

function getScore(r: Pick<FullRecord, "score">): number {
  return r.score;
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    return getScore({ score: 99 });
  },
});
`;
    const v = compileAndRunNumber(source);
    assert.equal(v, 99);
  });
});

describe("Generic interface - concrete instantiation", () => {
  before(() => ensureSetup());

  test("generic interface used with concrete type creates struct", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface Container<T> {
  value: T;
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    const c: Container<number> = { value: 42 };
    return c.value;
  },
});
`);
    assert.equal(v, 42);
  });

  test("generic interface with string type argument", () => {
    const v = compileAndRunString(`
import { Sensor, type Context } from "mindcraft";

interface Wrapper<T> {
  inner: T;
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): string {
    const w: Wrapper<string> = { inner: "hello" };
    return w.inner;
  },
});
`);
    assert.equal(v, "hello");
  });

  test("generic interface with two type parameters", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface Pair<A, B> {
  first: A;
  second: B;
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    const p: Pair<number, string> = { first: 10, second: "hi" };
    return p.first + p.second.length;
  },
});
`);
    assert.equal(v, 12);
  });

  test("same generic interface with different type args produces distinct types", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface Box<T> {
  item: T;
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    const numBox: Box<number> = { item: 5 };
    const strBox: Box<string> = { item: "abc" };
    return numBox.item + strBox.item.length;
  },
});
`);
    assert.equal(v, 8);
  });

  test("generic interface as function parameter type", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface Container<T> {
  value: T;
}

function unwrap(c: Container<number>): number {
  return c.value;
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    return unwrap({ value: 77 });
  },
});
`);
    assert.equal(v, 77);
  });

  test("generic interface as function return type", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

interface Container<T> {
  value: T;
}

function wrap(n: number): Container<number> {
  return { value: n };
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    const c = wrap(55);
    return c.value;
  },
});
`);
    assert.equal(v, 55);
  });
});

describe("Generic type alias - concrete instantiation", () => {
  before(() => ensureSetup());

  test("generic type alias used with concrete type", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

type Container<T> = {
  value: T;
};

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    const c: Container<number> = { value: 33 };
    return c.value;
  },
});
`);
    assert.equal(v, 33);
  });

  test("generic type alias with two type parameters", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

type Entry<K, V> = {
  key: K;
  val: V;
};

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    const e: Entry<string, number> = { key: "x", val: 7 };
    return e.val + e.key.length;
  },
});
`);
    assert.equal(v, 8);
  });

  test("generic type alias as function parameter", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

type Holder<T> = {
  data: T;
};

function extract(h: Holder<number>): number {
  return h.data;
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    return extract({ data: 88 });
  },
});
`);
    assert.equal(v, 88);
  });
});

describe("Generic class - concrete instantiation", () => {
  before(() => ensureSetup());

  test("generic class with concrete type argument", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

class Box<T> {
  value: T;
  constructor(v: T) {
    this.value = v;
  }
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    const b = new Box<number>(42);
    return b.value;
  },
});
`);
    assert.equal(v, 42);
  });

  test("generic class with method returning T", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

class Holder<T> {
  item: T;
  constructor(item: T) {
    this.item = item;
  }
  get(): T {
    return this.item;
  }
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    const h = new Holder<number>(99);
    return h.get();
  },
});
`);
    assert.equal(v, 99);
  });

  test("generic class with multiple type parameters", () => {
    const v = compileAndRunNumber(`
import { Sensor, type Context } from "mindcraft";

class Pair<A, B> {
  left: A;
  right: B;
  constructor(a: A, b: B) {
    this.left = a;
    this.right = b;
  }
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    const p = new Pair<number, string>(10, "abc");
    return p.left + p.right.length;
  },
});
`);
    assert.equal(v, 13);
  });
});

describe("keyof on concrete types", () => {
  before(() => ensureSetup());

  test("keyof used in type annotation compiles", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Point {
  x: number;
  y: number;
}

function getKey(): keyof Point {
  return "x";
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): string {
    return getKey();
  },
});
`;
    const v = compileAndRunString(source);
    assert.equal(v, "x");
  });
});

describe("Concrete index access types", () => {
  before(() => ensureSetup());

  test("index access on interface resolves to concrete type", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Record {
  score: number;
  name: string;
}

function getScore(): Record["score"] {
  return 42;
}

export default Sensor({
  name: "gen-test",
  onExecute(ctx: Context): number {
    return getScore();
  },
});
`;
    const v = compileAndRunNumber(source);
    assert.equal(v, 42);
  });
});
