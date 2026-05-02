import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  type BooleanValue,
  type BrainServices,
  ContextTypeIds,
  CoreTypeIds,
  type EnumValue,
  type ExecutionContext,
  HandleTable,
  isEnumValue,
  isListValue,
  isMapValue,
  isStructValue,
  type ListValue,
  type MapValue,
  mkNativeStructValue,
  mkNumberValue,
  mkStringValue,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  Op,
  runtime,
  type Scheduler,
  type StringValue,
  type StructTypeDef,
  type StructValue,
  type Value,
  ValueDict,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { buildCallDef } from "./call-def-builder.js";
import { compileUserTile } from "./compile.js";
import { CompileDiagCode, LoweringDiagCode, ValidatorDiagCode } from "./diag-codes.js";
import type { UserAuthoredProgram } from "./types.js";

let services: BrainServices;

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

function mkArgsList(entries: Record<number, Value>): List<Value> {
  const args = List.empty<Value>();
  for (const [key, value] of Object.entries(entries)) {
    const idx = Number(key);
    while (args.size() <= idx) {
      args.push(NIL_VALUE);
    }
    args.set(idx, value);
  }
  return args;
}

function runActivation(prog: UserAuthoredProgram, handles: HandleTable, callsiteVars?: List<Value>): void {
  if (prog.activationFuncId === undefined) {
    return;
  }

  const vm = new runtime.VM(services, prog, handles);
  const fiber = vm.spawnFiber(1, prog.activationFuncId, List.empty<Value>(), mkCtx());
  if (callsiteVars) {
    fiber.callsiteVars = callsiteVars;
  }
  fiber.instrBudget = 1000;

  const result = vm.runFiber(fiber, mkScheduler());
  assert.equal(result.status, VmStatus.DONE);
}
describe("lowering + emission", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("sync sensor with comparison compiles and executes correctly (true case)", () => {
    const source = `
import { Sensor, optional, param, type Context } from "mindcraft";

export default Sensor({
  name: "is-close",
  args: [
    optional(param("distance", { type: "number", default: 5 })),
  ],
  onExecute(ctx: Context, args: { distance: number }): boolean {
    return args.distance < 10;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const args = mkArgsList({ 0: mkNumberValue(3) });
    const fiber = vm.spawnFiber(1, 0, args, ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result, "expected a return value");
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("sync sensor with comparison compiles and executes correctly (false case)", () => {
    const source = `
import { Sensor, optional, param, type Context } from "mindcraft";

export default Sensor({
  name: "is-close",
  args: [
    optional(param("distance", { type: "number", default: 5 })),
  ],
  onExecute(ctx: Context, args: { distance: number }): boolean {
    return args.distance < 10;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const args = mkArgsList({ 0: mkNumberValue(15) });
    const fiber = vm.spawnFiber(1, 0, args, ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test("sensor returning number literal", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "constant",
  onExecute(ctx: Context): number {
    return 42;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("sensor returning boolean literal true", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "always-true",
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("sensor returning string literal", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "greeting",
  onExecute(ctx: Context): string {
    return "hello";
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as StringValue).v, "hello");
    }
  });

  test("sensor with arithmetic expression", () => {
    const source = `
import { Sensor, param, type Context } from "mindcraft";

export default Sensor({
  name: "compute",
  args: [
    param("x", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { x: number }): number {
    return args.x + 10;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const args = mkArgsList({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, 0, args, mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 15);
    }
  });

  test("program metadata is correct", () => {
    const source = `
import { Sensor, optional, param, type Context } from "mindcraft";

export default Sensor({
  name: "is-close",
  args: [
    optional(param("distance", { type: "number", default: 5 })),
  ],
  onExecute(ctx: Context, args: { distance: number }): boolean {
    return args.distance < 10;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.program);

    const prog = result.program!;
    assert.equal(prog.kind, "sensor");
    assert.equal(prog.name, "is-close");
    assert.equal(prog.entryFuncId, 0);
    assert.equal(prog.numStateSlots, 0);
    assert.ok(prog.outputType);
    assert.ok(prog.revisionId);
    assert.equal(prog.activationFuncId, undefined);
    assert.equal(prog.functions.size(), 1);
    assert.ok(prog.constantPools.values.size() > 0);
  });

  test("invalid output type produces diagnostic for unregistered type", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

type BadType = number | string;

export default Sensor({
  name: "bad-type",
  onExecute(ctx: Context): BadType {
    return 1;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, CompileDiagCode.UnknownOutputType);
  });

  test("app-defined output type resolves via registry", () => {
    const types = services.types;
    const actorRefTypeId = mkTypeId(NativeType.Struct, "ActorRef");
    if (!types.get(actorRefTypeId)) {
      types.addStructType("ActorRef", {
        fields: List.from([{ name: "id", typeId: mkTypeId(NativeType.Number, "number") }]),
      });
    }
    const appAmbient = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type ActorRef } from "mindcraft";

export default Sensor({
  name: "nearest",
  onExecute(ctx: Context): ActorRef {
    return { id: 0 };
  },
});
`;
    const result = compileUserTile(source, {
      ambientSource: appAmbient,
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
    assert.equal(result.program!.outputType, "struct:<ActorRef>");
  });

  test("app-defined output type resolves without explicit ambientSource", () => {
    const source = `
import { Sensor, type Context, type ActorRef } from "mindcraft";

export default Sensor({
  name: "nearest",
  onExecute(ctx: Context): ActorRef {
    return { id: 0 };
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
    assert.equal(result.program!.outputType, "struct:<ActorRef>");
  });
});

describe("buildCallDef", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("empty params produces empty bag", () => {
    const callDef = buildCallDef("test-tile", []);
    assert.equal(callDef.callSpec.type, "bag");
    assert.equal(callDef.argSlots.size(), 0);
  });

  test("one required param produces correct callDef", () => {
    const callDef = buildCallDef("my-sensor", [{ kind: "param", name: "range", type: "number", anonymous: false }]);
    assert.equal(callDef.callSpec.type, "bag");
    assert.equal(callDef.argSlots.size(), 1);
    const slot = callDef.argSlots.get(0)!;
    assert.equal(slot.slotId, 0);
    assert.equal(slot.argSpec.tileId, "tile.parameter->user.my-sensor.range");
  });

  test("one optional param is wrapped in optional", () => {
    const callDef = buildCallDef("my-sensor", [
      { kind: "optional", item: { kind: "param", name: "range", type: "number", defaultValue: 5, anonymous: false } },
    ]);
    assert.equal(callDef.callSpec.type, "bag");
    assert.equal(callDef.argSlots.size(), 1);
    const slot = callDef.argSlots.get(0)!;
    assert.equal(slot.slotId, 0);
    assert.equal(slot.argSpec.tileId, "tile.parameter->user.my-sensor.range");
  });

  test("anonymous param uses anon tile id", () => {
    const callDef = buildCallDef("chase", [{ kind: "param", name: "target", type: "ActorRef", anonymous: true }]);
    assert.equal(callDef.argSlots.size(), 1);
    const slot = callDef.argSlots.get(0)!;
    assert.equal(slot.argSpec.tileId, "tile.parameter->anon.ActorRef");
    assert.equal(slot.argSpec.anonymous, true);
  });

  test("mixed required, optional, and anonymous params", () => {
    const callDef = buildCallDef("chase", [
      { kind: "param", name: "target", type: "ActorRef", anonymous: true },
      { kind: "optional", item: { kind: "param", name: "speed", type: "number", defaultValue: 1, anonymous: false } },
    ]);
    assert.equal(callDef.argSlots.size(), 2);

    const slot0 = callDef.argSlots.get(0)!;
    assert.equal(slot0.slotId, 0);
    assert.equal(slot0.argSpec.tileId, "tile.parameter->anon.ActorRef");
    assert.equal(slot0.argSpec.anonymous, true);

    const slot1 = callDef.argSlots.get(1)!;
    assert.equal(slot1.slotId, 1);
    assert.equal(slot1.argSpec.tileId, "tile.parameter->user.chase.speed");
  });
});
