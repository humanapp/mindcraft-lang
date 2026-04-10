import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BooleanValue,
  type BrainServices,
  HandleTable,
  isListValue,
  isMapValue,
  type ListValue,
  type MapValue,
  mkTypeId,
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
import { LoweringDiagCode } from "./diag-codes.js";

let ambientSource: string;
let services: BrainServices;

function ensureSetup(): void {
  if (!ambientSource) {
    services = __test__createBrainServices();

    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");

    const numMapName = "NumberMap";
    const numMapTypeId = mkTypeId(NativeType.Map, numMapName);
    if (!types.get(numMapTypeId)) {
      types.addMapType(numMapName, { valueTypeId: numTypeId });
    }

    const strMapName = "StringMap";
    const strMapTypeId = mkTypeId(NativeType.Map, strMapName);
    if (!types.get(strMapTypeId)) {
      types.addMapType(strMapName, { valueTypeId: strTypeId });
    }

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
import { Sensor, type Context, type NumberMap } from "mindcraft";

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
import { Sensor, type Context, type NumberMap } from "mindcraft";

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
import { Sensor, type Context, type NumberMap, type StringMap } from "mindcraft";

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

describe("map bracket assignment", () => {
  before(() => {
    ensureSetup();
  });

  test("map[key] = value assigns a new entry", () => {
    const v = compileAndRunNumber(`
      const m: NumberMap = { a: 1 };
      m["b"] = 2;
      return m["b"];
    `);
    assert.equal(v, 2);
  });

  test("map[key] = value overwrites existing entry", () => {
    const v = compileAndRunNumber(`
      const m: NumberMap = { a: 1 };
      m["a"] = 99;
      return m["a"];
    `);
    assert.equal(v, 99);
  });

  test("compound assignment map[key] += value", () => {
    const v = compileAndRunNumber(`
      const m: NumberMap = { a: 10 };
      m["a"] += 5;
      return m["a"];
    `);
    assert.equal(v, 15);
  });

  test("compound assignment map[key] -= value", () => {
    const v = compileAndRunNumber(`
      const m: NumberMap = { a: 10 };
      m["a"] -= 3;
      return m["a"];
    `);
    assert.equal(v, 7);
  });
});

describe("map .has()", () => {
  before(() => {
    ensureSetup();
  });

  test(".has() returns true for existing key", () => {
    const v = compileAndRunBoolean(`
      const m: NumberMap = { a: 1, b: 2 };
      return m.has("a");
    `);
    assert.equal(v, true);
  });

  test(".has() returns false for missing key", () => {
    const v = compileAndRunBoolean(`
      const m: NumberMap = { a: 1 };
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
      const m: NumberMap = { a: 1, b: 2 };
      m.delete("a");
      return m.has("a");
    `);
    assert.equal(v, false);
  });

  test(".delete() does not affect other keys", () => {
    const v = compileAndRunNumber(`
      const m: NumberMap = { a: 1, b: 2 };
      m.delete("a");
      return m["b"];
    `);
    assert.equal(v, 2);
  });
});

describe("map .set()", () => {
  before(() => {
    ensureSetup();
  });

  test(".set() adds a new entry", () => {
    const v = compileAndRunNumber(`
      const m: NumberMap = { a: 1 };
      m.set("b", 42);
      return m["b"];
    `);
    assert.equal(v, 42);
  });
});

describe("map .size", () => {
  before(() => {
    ensureSetup();
  });

  test(".size returns number of entries", () => {
    const v = compileAndRunNumber(`
      const m: NumberMap = { a: 1, b: 2, c: 3 };
      return m.size;
    `);
    assert.equal(v, 3);
  });

  test(".size updates after mutations", () => {
    const v = compileAndRunNumber(`
      const m: NumberMap = { a: 1 };
      m["b"] = 2;
      m["c"] = 3;
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
      const m: NumberMap = { a: 1, b: 2, c: 3 };
      return m.keys().length;
    `);
    assert.equal(v, 3);
  });
});

describe("map .values()", () => {
  before(() => {
    ensureSetup();
  });

  test(".values().length returns number of values", () => {
    const v = compileAndRunNumber(`
      const m: NumberMap = { a: 10, b: 20 };
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
      const m: NumberMap = { a: 1, b: 2, c: 3 };
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
      const m: NumberMap = { a: 1, b: 2, c: 3 };
      m.clear();
      return m.size;
    `);
    assert.equal(v, 0);
  });
});

describe("map unsupported method diagnostic", () => {
  before(() => {
    ensureSetup();
  });

  test("unsupported map method produces diagnostic", () => {
    const source = sensorReturningNumber(`
      const m: NumberMap = { a: 1 };
      m.entries();
      return 0;
    `);
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.diagnostics[0].code, LoweringDiagCode.UnsupportedMapMethod);
  });
});
