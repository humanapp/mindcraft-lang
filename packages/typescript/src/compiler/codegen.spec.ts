import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  type ExecutionContext,
  getBrainServices,
  HandleTable,
  type MapValue,
  mkNumberValue,
  mkStringValue,
  NativeType,
  registerCoreBrainComponents,
  runtime,
  type Scheduler,
  type Value,
  ValueDict,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { buildAmbientSource } from "./ambient.js";
import { buildCallDef } from "./call-def-builder.js";
import { compileUserTile, initCompiler } from "./compile.js";

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    brain: undefined as never,
    getVariable: () => undefined,
    setVariable: () => {},
    clearVariable: () => {},
    fiberId: 0,
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

function mkArgsMap(entries: Record<number, Value>): MapValue {
  const dict = new ValueDict();
  for (const [key, value] of Object.entries(entries)) {
    dict.set(Number(key), value);
  }
  return { t: NativeType.Map, typeId: "map:<args>", v: dict };
}

function hostFnResolver(name: string): number | undefined {
  return getBrainServices().functions.get(name)?.id;
}

describe("phase 3: lowering + emission", () => {
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
  });

  test("sync sensor with comparison compiles and executes correctly (true case)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "is-close",
  output: "boolean",
  params: {
    distance: { type: "number", default: 5 },
  },
  onExecute(ctx: Context, params: { distance: number }): boolean {
    return params.distance < 10;
  },
});
`;
    const result = compileUserTile(source, { resolveHostFn: hostFnResolver });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(3) });
    const fiber = vm.spawnFiber(1, 0, List.from([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result, "expected a return value");
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as { v: boolean }).v, true);
    }
  });

  test("sync sensor with comparison compiles and executes correctly (false case)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "is-close",
  output: "boolean",
  params: {
    distance: { type: "number", default: 5 },
  },
  onExecute(ctx: Context, params: { distance: number }): boolean {
    return params.distance < 10;
  },
});
`;
    const result = compileUserTile(source, { resolveHostFn: hostFnResolver });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(15) });
    const fiber = vm.spawnFiber(1, 0, List.from([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as { v: boolean }).v, false);
    }
  });

  test("sensor returning number literal", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "constant",
  output: "number",
  onExecute(ctx: Context): number {
    return 42;
  },
});
`;
    const result = compileUserTile(source, { resolveHostFn: hostFnResolver });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as { v: number }).v, 42);
    }
  });

  test("sensor returning boolean literal true", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "always-true",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const result = compileUserTile(source, { resolveHostFn: hostFnResolver });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as { v: boolean }).v, true);
    }
  });

  test("sensor returning string literal", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "greeting",
  output: "string",
  onExecute(ctx: Context): string {
    return "hello";
  },
});
`;
    const result = compileUserTile(source, { resolveHostFn: hostFnResolver });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as { v: string }).v, "hello");
    }
  });

  test("sensor with arithmetic expression", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "compute",
  output: "number",
  params: {
    x: { type: "number" },
  },
  onExecute(ctx: Context, params: { x: number }): number {
    return params.x + 10;
  },
});
`;
    const result = compileUserTile(source, { resolveHostFn: hostFnResolver });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const args = mkArgsMap({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, 0, List.from([args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as { v: number }).v, 15);
    }
  });

  test("program metadata is correct", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "is-close",
  output: "boolean",
  params: {
    distance: { type: "number", default: 5 },
  },
  onExecute(ctx: Context, params: { distance: number }): boolean {
    return params.distance < 10;
  },
});
`;
    const result = compileUserTile(source, { resolveHostFn: hostFnResolver });
    assert.ok(result.program);

    const prog = result.program!;
    assert.equal(prog.kind, "sensor");
    assert.equal(prog.name, "is-close");
    assert.equal(prog.entryFuncId, 0);
    assert.equal(prog.numCallsiteVars, 0);
    assert.ok(prog.outputType);
    assert.ok(prog.programRevisionId);
    assert.equal(prog.functions.size(), 1);
    assert.ok(prog.constants.size() > 0);
  });

  test("invalid output type produces diagnostic when resolveTypeId returns undefined", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "bad-type",
  output: "number",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const result = compileUserTile(source, {
      resolveHostFn: hostFnResolver,
      resolveTypeId: () => undefined,
    });
    assert.equal(result.diagnostics.length, 1);
    assert.ok(result.diagnostics[0].message.includes("Unknown output type"));
  });

  test("app-defined output type resolves via resolveTypeId", () => {
    const appAmbient = buildAmbientSource(["actorRef: unknown;"]);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nearest",
  output: "actorRef",
  onExecute(ctx: Context): unknown {
    return 0;
  },
});
`;
    const result = compileUserTile(source, {
      ambientSource: appAmbient,
      resolveHostFn: hostFnResolver,
      resolveTypeId: (name) => {
        if (name === "actorRef") return "struct:<actorRef>";
        if (name === "boolean") return "boolean:<boolean>";
        if (name === "number") return "number:<number>";
        if (name === "string") return "string:<string>";
        return undefined;
      },
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
    assert.equal(result.program!.outputType, "struct:<actorRef>");
  });

  test("app-defined output type without ambient injection produces TS error", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nearest",
  output: "actorRef",
  onExecute(ctx: Context): unknown {
    return null;
  },
});
`;
    const result = compileUserTile(source, { resolveHostFn: hostFnResolver });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(
      result.diagnostics.some((d) => d.message.includes("actorRef")),
      `Expected diagnostic mentioning actorRef but got: ${JSON.stringify(result.diagnostics)}`
    );
  });
});

describe("buildCallDef", () => {
  before(() => {
    if (!getBrainServices) return;
    try {
      getBrainServices();
    } catch {
      registerCoreBrainComponents();
    }
  });

  test("empty params produces empty bag", () => {
    const callDef = buildCallDef("test-tile", []);
    assert.equal(callDef.callSpec.type, "bag");
    assert.equal(callDef.argSlots.size(), 0);
  });

  test("one required param produces correct callDef", () => {
    const callDef = buildCallDef("my-sensor", [{ name: "range", type: "number", required: true, anonymous: false }]);
    assert.equal(callDef.callSpec.type, "bag");
    assert.equal(callDef.argSlots.size(), 1);
    const slot = callDef.argSlots.get(0)!;
    assert.equal(slot.slotId, 0);
    assert.equal(slot.argSpec.tileId, "tile.parameter->user.my-sensor.range");
  });

  test("one optional param is wrapped in optional", () => {
    const callDef = buildCallDef("my-sensor", [
      { name: "range", type: "number", defaultValue: 5, required: false, anonymous: false },
    ]);
    assert.equal(callDef.callSpec.type, "bag");
    assert.equal(callDef.argSlots.size(), 1);
    const slot = callDef.argSlots.get(0)!;
    assert.equal(slot.slotId, 0);
    assert.equal(slot.argSpec.tileId, "tile.parameter->user.my-sensor.range");
  });

  test("anonymous param uses anon tile id", () => {
    const callDef = buildCallDef("chase", [{ name: "target", type: "actorRef", required: true, anonymous: true }]);
    assert.equal(callDef.argSlots.size(), 1);
    const slot = callDef.argSlots.get(0)!;
    assert.equal(slot.argSpec.tileId, "tile.parameter->anon.actorRef");
    assert.equal(slot.argSpec.anonymous, true);
  });

  test("mixed required, optional, and anonymous params", () => {
    const callDef = buildCallDef("chase", [
      { name: "target", type: "actorRef", required: true, anonymous: true },
      { name: "speed", type: "number", defaultValue: 1, required: false, anonymous: false },
    ]);
    assert.equal(callDef.argSlots.size(), 2);

    const slot0 = callDef.argSlots.get(0)!;
    assert.equal(slot0.slotId, 0);
    assert.equal(slot0.argSpec.tileId, "tile.parameter->anon.actorRef");
    assert.equal(slot0.argSpec.anonymous, true);

    const slot1 = callDef.argSlots.get(1)!;
    assert.equal(slot1.slotId, 1);
    assert.equal(slot1.argSpec.tileId, "tile.parameter->user.chase.speed");
  });
});
