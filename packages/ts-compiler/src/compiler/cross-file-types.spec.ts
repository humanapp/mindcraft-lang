import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, runtime } from "@wendoo-lang/core";
import type { BrainServices } from "@wendoo-lang/core/brain";
import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import type { ExecutionContext, Scheduler } from "@wendoo-lang/core/runtime";
import {
  CoreTypeIds,
  HandleTable,
  isStructValue,
  mkNumberValue,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  type StructTypeDef,
  type StructValue,
  type Value,
  VmStatus,
} from "@wendoo-lang/core/runtime";
import { __test__createPlatformServices } from "@wendoo-lang/core/runtime/__test__";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { UserTileProject } from "./project.js";
import type { UserAuthoredProgram } from "./types.js";

let services: BrainServices;

function toVmServices(b: BrainServices) {
  return __test__createPlatformServices({ runtime: { functions: b.runtime.functions, types: b.runtime.types } })
    .runtime;
}

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    services: __test__createPlatformServices(),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
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
  const ambientSource = buildAmbientDeclarations(services.runtime.types);
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
    services,
  });
  project.setFiles(new Map(Object.entries(files)));
  return project.compileAll();
}

function runAndGetResult(prog: UserAuthoredProgram): Value {
  const handles = new HandleTable(100);
  const vm = new runtime.VM(prog, toVmServices(services), { handles });
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
import { Sensor, type Context } from "wendoo";
import { Point } from "../helpers/types";

export default Sensor({
  name: "iface-basic",
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
import { Sensor, type Context } from "wendoo";
import { Vec2 } from "../helpers/types";

export default Sensor({
  name: "vec-a",
  onExecute(ctx: Context): number {
    const v: Vec2 = { x: 1, y: 2 };
    return v.x;
  }
});
`,
      "sensors/b.ts": `
import { Sensor, type Context } from "wendoo";
import { Vec2 } from "../helpers/types";

export default Sensor({
  name: "vec-b",
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
import { Sensor, type Context } from "wendoo";
import { Config } from "../helpers/types";

export default Sensor({
  name: "config-check",
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
import { Sensor, type Context } from "wendoo";
import { Outer, Inner } from "../helpers/types";

export default Sensor({
  name: "nested-check",
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
import { Sensor, type Context } from "wendoo";
import { Handler } from "../helpers/types";

export default Sensor({
  name: "handler-check",
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
