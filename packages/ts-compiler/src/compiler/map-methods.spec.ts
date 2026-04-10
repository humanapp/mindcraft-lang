import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BooleanValue,
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

let ambientSource: string;
let services: BrainServices;

function ensureSetup(): void {
  if (!ambientSource) {
    services = __test__createBrainServices();
    ambientSource = buildAmbientDeclarations(services.types);
  }
}

function mkCtx(): ExecutionContext {
  return {
    brain: undefined as never,
    getVariable: () => undefined,
    setVariable: () => {},
    clearVariable: () => {},
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
  name: "map-test",
  output: "number",
  onExecute(ctx: Context): number {
    ${body}
  },
});
`;
}

function sensorReturningBoolean(body: string): string {
  return `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "map-test",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    ${body}
  },
});
`;
}

function sensorReturningString(body: string): string {
  return `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "map-test",
  output: "string",
  onExecute(ctx: Context): string {
    ${body}
  },
});
`;
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

function compileAndRunNumber(body: string): number {
  const result = compileAndRun(sensorReturningNumber(body));
  assert.equal(result.t, NativeType.Number);
  return (result as NumberValue).v;
}

function compileAndRunBoolean(body: string): boolean {
  const result = compileAndRun(sensorReturningBoolean(body));
  assert.equal(result.t, NativeType.Boolean);
  return (result as BooleanValue).v;
}

function compileAndRunString(body: string): string {
  const result = compileAndRun(sensorReturningString(body));
  assert.equal(result.t, NativeType.String);
  return (result as StringValue).v;
}

describe("new Map() constructor", () => {
  before(() => {
    ensureSetup();
  });

  test("new Map() creates empty map", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>();
      return m.size;
    `);
    assert.equal(v, 0);
  });

  test("new Map([...]) creates map with entries", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>([["a", 1], ["b", 2]]);
      return m.size;
    `);
    assert.equal(v, 2);
  });
});

describe("map .get()", () => {
  before(() => {
    ensureSetup();
  });

  test(".get() returns value for existing key", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>([["a", 10]]);
      return m.get("a")!;
    `);
    assert.equal(v, 10);
  });
});

describe("map .set()", () => {
  before(() => {
    ensureSetup();
  });

  test(".set() adds a new entry", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>();
      m.set("b", 42);
      return m.get("b")!;
    `);
    assert.equal(v, 42);
  });

  test(".set() overwrites existing entry", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>([["a", 1]]);
      m.set("a", 99);
      return m.get("a")!;
    `);
    assert.equal(v, 99);
  });
});

describe("map .has()", () => {
  before(() => {
    ensureSetup();
  });

  test(".has() returns true for existing key", () => {
    const v = compileAndRunBoolean(`
      const m = new Map<string, number>([["a", 1], ["b", 2]]);
      return m.has("a");
    `);
    assert.equal(v, true);
  });

  test(".has() returns false for missing key", () => {
    const v = compileAndRunBoolean(`
      const m = new Map<string, number>([["a", 1]]);
      return m.has("z");
    `);
    assert.equal(v, false);
  });
});

describe("map .delete()", () => {
  before(() => {
    ensureSetup();
  });

  test(".delete() removes key, .has() returns false afterwards", () => {
    const v = compileAndRunBoolean(`
      const m = new Map<string, number>([["a", 1], ["b", 2]]);
      m.delete("a");
      return m.has("a");
    `);
    assert.equal(v, false);
  });

  test(".delete() does not affect other keys", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>([["a", 1], ["b", 2]]);
      m.delete("a");
      return m.get("b")!;
    `);
    assert.equal(v, 2);
  });
});

describe("map .size", () => {
  before(() => {
    ensureSetup();
  });

  test(".size returns number of entries", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
      return m.size;
    `);
    assert.equal(v, 3);
  });

  test(".size updates after mutations", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>([["a", 1]]);
      m.set("b", 2);
      m.set("c", 3);
      return m.size;
    `);
    assert.equal(v, 3);
  });
});

describe("map .keys()", () => {
  before(() => {
    ensureSetup();
  });

  test(".keys().length returns number of keys", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
      return m.keys().length;
    `);
    assert.equal(v, 3);
  });

  test("const k = m.keys(); k.length works via variable", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>([["a", 1], ["b", 2]]);
      const k = m.keys();
      return k.length;
    `);
    assert.equal(v, 2);
  });
});

describe("map .values()", () => {
  before(() => {
    ensureSetup();
  });

  test(".values().length returns number of values", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>([["a", 10], ["b", 20]]);
      return m.values().length;
    `);
    assert.equal(v, 2);
  });
});

describe("map .forEach()", () => {
  before(() => {
    ensureSetup();
  });

  test(".forEach() iterates over all entries", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
      const result: number[] = [];
      m.forEach((value: number, key: string) => {
        result.push(value);
      });
      return result.length;
    `);
    assert.equal(v, 3);
  });
});

describe("map .clear()", () => {
  before(() => {
    ensureSetup();
  });

  test(".clear() removes all entries", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
      m.clear();
      return m.size;
    `);
    assert.equal(v, 0);
  });
});

describe("map for...of m.keys()", () => {
  before(() => {
    ensureSetup();
  });

  test("for...of m.keys() iterates over keys", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
      let sum = 0;
      for (const k of m.keys()) {
        sum = sum + m.get(k)!;
      }
      return sum;
    `);
    assert.equal(v, 6);
  });
});

describe("map unsupported method diagnostic", () => {
  before(() => {
    ensureSetup();
  });

  test("calling unknown method on map produces TS error", () => {
    const source = sensorReturningNumber(`
      const m = new Map<string, number>([["a", 1]]);
      m.entries();
      return 0;
    `);
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "expected at least one diagnostic");
  });
});

describe("Map<number, V> constructor", () => {
  before(() => {
    ensureSetup();
  });

  test("new Map<number, string>() creates empty map", () => {
    const v = compileAndRunNumber(`
      const m = new Map<number, string>();
      return m.size;
    `);
    assert.equal(v, 0);
  });

  test("new Map<number, string>([[k, v]]) creates map with entries", () => {
    const v = compileAndRunNumber(`
      const m = new Map<number, string>([[1, "a"], [2, "b"]]);
      return m.size;
    `);
    assert.equal(v, 2);
  });
});

describe("Map<number, V> get/set/has/delete", () => {
  before(() => {
    ensureSetup();
  });

  test(".get() with number key returns value", () => {
    const v = compileAndRunString(`
      const m = new Map<number, string>([[1, "hello"]]);
      return m.get(1)!;
    `);
    assert.equal(v, "hello");
  });

  test(".set() with number key adds entry", () => {
    const v = compileAndRunString(`
      const m = new Map<number, string>();
      m.set(42, "answer");
      return m.get(42)!;
    `);
    assert.equal(v, "answer");
  });

  test(".has() with number key returns true for existing key", () => {
    const v = compileAndRunBoolean(`
      const m = new Map<number, string>([[7, "seven"]]);
      return m.has(7);
    `);
    assert.equal(v, true);
  });

  test(".has() with number key returns false for missing key", () => {
    const v = compileAndRunBoolean(`
      const m = new Map<number, string>([[7, "seven"]]);
      return m.has(99);
    `);
    assert.equal(v, false);
  });

  test(".delete() with number key removes entry", () => {
    const v = compileAndRunBoolean(`
      const m = new Map<number, string>([[1, "a"], [2, "b"]]);
      m.delete(1);
      return m.has(1);
    `);
    assert.equal(v, false);
  });
});

describe("Map<number, V> .keys()", () => {
  before(() => {
    ensureSetup();
  });

  test(".keys() returns list of number keys", () => {
    const v = compileAndRunNumber(`
      const m = new Map<number, string>([[10, "a"], [20, "b"], [30, "c"]]);
      return m.keys().length;
    `);
    assert.equal(v, 3);
  });

  test(".keys() values are numbers usable in arithmetic", () => {
    const v = compileAndRunNumber(`
      const m = new Map<number, string>([[10, "a"], [20, "b"], [30, "c"]]);
      let sum = 0;
      for (const k of m.keys()) {
        sum = sum + k;
      }
      return sum;
    `);
    assert.equal(v, 60);
  });
});

describe("Map<number, V> for...of keys", () => {
  before(() => {
    ensureSetup();
  });

  test("for...of m.keys() iterates and can look up values", () => {
    const v = compileAndRunNumber(`
      const m = new Map<number, string>([[1, "ab"], [2, "cde"]]);
      let totalLen = 0;
      for (const k of m.keys()) {
        totalLen = totalLen + m.get(k)!.length;
      }
      return totalLen;
    `);
    assert.equal(v, 5);
  });
});

describe("Map<string, V> for...in", () => {
  before(() => {
    ensureSetup();
  });

  test("for...in iterates over string-keyed map", () => {
    const v = compileAndRunNumber(`
      const m = new Map<string, number>([["a", 10], ["b", 20], ["c", 30]]);
      let sum = 0;
      for (const k in m) {
        sum = sum + m.get(k)!;
      }
      return sum;
    `);
    assert.equal(v, 60);
  });
});
