import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BrainServices,
  CoreTypeIds,
  HandleTable,
  isStructValue,
  mkNumberValue,
  NativeType,
  type NumberValue,
  runtime,
  type StructTypeDef,
  type StructValue,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { UserTileProject } from "./project.js";
import type { UserAuthoredProgram } from "./types.js";

let services: BrainServices;

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

function compileProject(files: Record<string, string>) {
  const ambientSource = buildAmbientDeclarations(services.types);
  const project = new UserTileProject({ ambientSource, services });
  project.setFiles(new Map(Object.entries(files)));
  return project.compileAll();
}

function runAndGetResult(prog: UserAuthoredProgram): Value {
  const handles = new HandleTable(100);
  const vm = new runtime.VM(services, prog, handles);
  const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
  fiber.instrBudget = 5000;
  const result = vm.runFiber(fiber, mkScheduler());
  assert.equal(result.status, VmStatus.DONE);
  if (result.status !== VmStatus.DONE) throw new Error("unreachable");
  return result.result!;
}

describe("cross-file: imported interfaces", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("entry-point uses an interface exported from a helper", () => {
    const result = compileProject({
      "helpers/types.ts": `
export interface Point {
  x: number;
  y: number;
}
`,
      "sensors/check.ts": `
import { Sensor, type Context } from "mindcraft";
import { Point } from "../helpers/types";

export default Sensor({
  name: "iface-basic",
  output: "number",
  onExecute(ctx: Context): number {
    const p: Point = { x: 10, y: 20 };
    return p.x + p.y;
  }
});
`,
    });

    const sensorResult = result.results.get("sensors/check.ts");
    assert.ok(sensorResult, "sensor should compile");
    assert.deepEqual(sensorResult.diagnostics, []);
    assert.ok(sensorResult.program);

    const value = runAndGetResult(sensorResult.program);
    assert.equal((value as NumberValue).v, 30);
  });

  test("multiple entry-points share an imported interface", () => {
    const result = compileProject({
      "helpers/types.ts": `
export interface Vec2 {
  x: number;
  y: number;
}
`,
      "sensors/a.ts": `
import { Sensor, type Context } from "mindcraft";
import { Vec2 } from "../helpers/types";

export default Sensor({
  name: "vec-a",
  output: "number",
  onExecute(ctx: Context): number {
    const v: Vec2 = { x: 1, y: 2 };
    return v.x;
  }
});
`,
      "sensors/b.ts": `
import { Sensor, type Context } from "mindcraft";
import { Vec2 } from "../helpers/types";

export default Sensor({
  name: "vec-b",
  output: "number",
  onExecute(ctx: Context): number {
    const v: Vec2 = { x: 3, y: 4 };
    return v.y;
  }
});
`,
    });

    const aResult = result.results.get("sensors/a.ts");
    assert.ok(aResult?.program);
    assert.deepEqual(aResult.diagnostics, []);
    assert.equal((runAndGetResult(aResult.program) as NumberValue).v, 1);

    const bResult = result.results.get("sensors/b.ts");
    assert.ok(bResult?.program);
    assert.deepEqual(bResult.diagnostics, []);
    assert.equal((runAndGetResult(bResult.program) as NumberValue).v, 4);
  });
});

describe("cross-file: imported type aliases", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("entry-point uses a type alias exported from a helper", () => {
    const result = compileProject({
      "helpers/types.ts": `
export type Config = {
  speed: number;
  label: string;
};
`,
      "sensors/check.ts": `
import { Sensor, type Context } from "mindcraft";
import { Config } from "../helpers/types";

export default Sensor({
  name: "config-check",
  output: "number",
  onExecute(ctx: Context): number {
    const c: Config = { speed: 42, label: "fast" };
    return c.speed;
  }
});
`,
    });

    const sensorResult = result.results.get("sensors/check.ts");
    assert.ok(sensorResult, "sensor should compile");
    assert.deepEqual(sensorResult.diagnostics, []);
    assert.ok(sensorResult.program);

    const value = runAndGetResult(sensorResult.program);
    assert.equal((value as NumberValue).v, 42);
  });
});

describe("cross-file: nested imported types", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("imported interface references another imported interface", () => {
    const result = compileProject({
      "helpers/types.ts": `
export interface Inner {
  value: number;
}

export interface Outer {
  inner: Inner;
  label: string;
}
`,
      "sensors/check.ts": `
import { Sensor, type Context } from "mindcraft";
import { Outer, Inner } from "../helpers/types";

export default Sensor({
  name: "nested-check",
  output: "number",
  onExecute(ctx: Context): number {
    const i: Inner = { value: 99 };
    const o: Outer = { inner: i, label: "test" };
    return o.inner.value;
  }
});
`,
    });

    const sensorResult = result.results.get("sensors/check.ts");
    assert.ok(sensorResult, "sensor should compile");
    assert.deepEqual(sensorResult.diagnostics, []);
    assert.ok(sensorResult.program);

    const value = runAndGetResult(sensorResult.program);
    assert.equal((value as NumberValue).v, 99);
  });
});

describe("cross-file: interface with method signature", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("imported interface with method signature compiles", () => {
    const result = compileProject({
      "helpers/types.ts": `
export interface Handler {
  name: string;
  process(x: number): number;
}
`,
      "sensors/check.ts": `
import { Sensor, type Context } from "mindcraft";
import { Handler } from "../helpers/types";

export default Sensor({
  name: "handler-check",
  output: "number",
  onExecute(ctx: Context): number {
    const h: Handler = {
      name: "doubler",
      process(x: number): number { return x * 2; },
    };
    return h.process(5);
  }
});
`,
    });

    const sensorResult = result.results.get("sensors/check.ts");
    assert.ok(sensorResult, "sensor should compile");
    assert.deepEqual(sensorResult.diagnostics, []);
    assert.ok(sensorResult.program);

    const value = runAndGetResult(sensorResult.program);
    assert.equal((value as NumberValue).v, 10);
  });
});
