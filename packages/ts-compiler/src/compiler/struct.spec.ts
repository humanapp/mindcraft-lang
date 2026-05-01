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

function mkArgsMap(entries: Record<number, Value>): MapValue {
  const dict = new ValueDict();
  for (const [key, value] of Object.entries(entries)) {
    dict.set(Number(key), value);
  }
  return { t: NativeType.Map, typeId: "map:<args>", v: dict };
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
describe("struct literal compilation", () => {
  before(async () => {
    services = __test__createBrainServices();

    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vec2TypeId)) {
      types.addStructType("Vector2", {
        fields: List.from([
          { name: "x", typeId: numTypeId },
          { name: "y", typeId: numTypeId },
        ]),
      });
    }
    const entityTypeId = mkTypeId(NativeType.Struct, "Entity");
    if (!types.get(entityTypeId)) {
      types.addStructType("Entity", {
        fields: List.from([
          { name: "name", typeId: strTypeId },
          { name: "position", typeId: vec2TypeId },
        ]),
      });
    }
    const nativeTypeId = mkTypeId(NativeType.Struct, "NativeObj");
    if (!types.get(nativeTypeId)) {
      types.addStructType("NativeObj", {
        fields: List.from([{ name: "id", typeId: numTypeId }]),
        fieldGetter: () => undefined,
      });
    }
  });

  test("struct literal with type annotation compiles and executes", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "make-vec",
  onExecute(ctx: Context): Vector2 {
    const pos: Vector2 = { x: 10, y: 20 };
    return pos;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
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
      assert.ok(isStructValue(runResult.result!), "expected struct value");
      const struct = runResult.result as StructValue;
      assert.equal(struct.typeId, mkTypeId(NativeType.Struct, "Vector2"));
      assert.equal((struct.v?.get("x") as NumberValue).v, 10);
      assert.equal((struct.v?.get("y") as NumberValue).v, 20);
    }
  });

  test("struct literal as return value (contextual type from return annotation)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "make-vec-direct",
  onExecute(ctx: Context): Vector2 {
    return { x: 3, y: 7 };
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
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
      assert.ok(isStructValue(runResult.result!));
      const struct = runResult.result as StructValue;
      assert.equal((struct.v?.get("x") as NumberValue).v, 3);
      assert.equal((struct.v?.get("y") as NumberValue).v, 7);
    }
  });

  test("nested struct literal compiles and executes", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Entity, type Vector2 } from "mindcraft";

export default Sensor({
  name: "make-entity",
  onExecute(ctx: Context): Entity {
    const e: Entity = { name: "hero", position: { x: 5, y: 15 } };
    return e;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
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
      assert.ok(isStructValue(runResult.result!));
      const entity = runResult.result as StructValue;
      assert.equal((entity.v?.get("name") as StringValue).v, "hero");
      const pos = entity.v?.get("position") as StructValue;
      assert.ok(isStructValue(pos));
      assert.equal((pos.v?.get("x") as NumberValue).v, 5);
      assert.equal((pos.v?.get("y") as NumberValue).v, 15);
    }
  });

  test("native-backed struct object literal produces compile error", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NativeObj } from "mindcraft";

export default Sensor({
  name: "bad-native",
  onExecute(ctx: Context): number {
    const obj: NativeObj = { id: 1 };
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "expected diagnostics for native-backed struct");
  });

  test("untyped object literal compiles as anonymous struct", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "untyped-obj",
  onExecute(ctx: Context): number {
    const obj = { a: 1 };
    return obj.a;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program, "expected program");
  });
});

describe("property access chains + host calls", () => {
  before(async () => {
    services = __test__createBrainServices();

    const types = services.types;
    const fns = services.functions;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");

    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vec2TypeId)) {
      types.addStructType("Vector2", {
        fields: List.from([
          { name: "x", typeId: numTypeId },
          { name: "y", typeId: numTypeId },
        ]),
      });
    }

    const entityTypeId = mkTypeId(NativeType.Struct, "Entity");
    if (!types.get(entityTypeId)) {
      types.addStructType("Entity", {
        fields: List.from([
          { name: "name", typeId: strTypeId },
          { name: "position", typeId: vec2TypeId },
        ]),
      });
    }

    const emptyCallDef = {
      callSpec: { type: "bag" as const, items: [] },
      argSlots: List.empty<never>(),
    };

    const engineDef = types.get(ContextTypeIds.EngineContext);
    const engineMethods =
      engineDef && "methods" in engineDef ? (engineDef as { methods?: List<{ name: string }> }).methods : undefined;
    const hasQueryNearby = engineMethods?.some((m) => m.name === "queryNearby") ?? false;
    if (!hasQueryNearby) {
      types.addStructMethods(
        ContextTypeIds.EngineContext,
        List.from([
          {
            name: "queryNearby",
            params: List.from([
              { name: "position", typeId: vec2TypeId },
              { name: "range", typeId: numTypeId },
            ]),
            returnTypeId: CoreTypeIds.Any,
          },
        ])
      );
    }

    if (!fns.get("EngineContext.queryNearby")) {
      fns.register("EngineContext.queryNearby", false, { exec: () => NIL_VALUE }, emptyCallDef);
    }
  });

  test("struct property access compiles to GET_FIELD", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "get-x",
  onExecute(ctx: Context): number {
    const pos: Vector2 = { x: 42, y: 7 };
    return pos.x;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const execCtx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("chained struct property access (entity.position.x)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Entity, type Vector2 } from "mindcraft";

export default Sensor({
  name: "get-entity-x",
  onExecute(ctx: Context): number {
    const e: Entity = { name: "hero", position: { x: 99, y: 50 } };
    return e.position.x;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const execCtx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 99);
    }
  });

  test("ctx.time compiles to GET_FIELD", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "get-time",
  onExecute(ctx: Context): number {
    return ctx.time;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const execCtx = mkCtx({ time: 12345 });

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 12345);
    }
  });

  test("ctx.dt compiles to GET_FIELD", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "get-dt",
  onExecute(ctx: Context): number {
    return ctx.dt;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const execCtx = mkCtx({ dt: 16 });

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 16);
    }
  });

  test("ctx.brain.getVariable compiles to struct method call", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "get-var",
  onExecute(ctx: Context): number {
    const val = ctx.brain.getVariable("myVar");
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const variables = new Map<string, Value>();
    variables.set("myVar", mkNumberValue(999));
    const execCtx = mkCtx({
      getVariable: <T extends Value>(name: string) => variables.get(name) as T | undefined,
    });

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
  });

  test("ctx.brain.setVariable compiles to struct method call", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "set-var",
  onExecute(ctx: Context): number {
    ctx.brain.setVariable("myVar", 42);
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("ctx.engine.queryNearby compiles to struct method call", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "query",
  onExecute(ctx: Context): boolean {
    const pos: Vector2 = { x: 0, y: 0 };
    const result = ctx.engine.queryNearby(pos, 5);
    return true;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("unknown engine method produces compile error", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "bad-method",
  onExecute(ctx: Context): number {
    ctx.engine.nonExistent();
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "Expected compile error for unknown engine method");
  });

  test("params.speed still resolves to LoadLocal (regression)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, optional, param, type Context } from "mindcraft";

export default Sensor({
  name: "speed-check",
  args: [
    optional(param("speed", { type: "number", default: 10 })),
  ],
  onExecute(ctx: Context, args: { speed: number }): number {
    return args.speed;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const execCtx = mkCtx();

    const argsMap = mkArgsMap({ 0: mkNumberValue(25) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([argsMap]), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 25);
    }
  });

  test("list.length still resolves to ListLen (regression)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "list-len",
  onExecute(ctx: Context): number {
    const items: Array<number> = [1, 2, 3];
    return items.length;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const execCtx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 3);
    }
  });

  test("native-backed struct field access uses GET_FIELD (same bytecode)", () => {
    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const nativeActorId = mkTypeId(NativeType.Struct, "NativeActor");
    if (!types.get(nativeActorId)) {
      types.addStructType("NativeActor", {
        fields: List.from([{ name: "health", typeId: numTypeId }]),
        fieldGetter: (source, fieldName) => {
          if (fieldName === "health") return mkNumberValue(100);
          return undefined;
        },
      });
    }

    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, param, type Context, type NativeActor } from "mindcraft";

export default Sensor({
  name: "actor-health",
  args: [
    param("actor", { type: "NativeActor" }),
  ],
  onExecute(ctx: Context, args: { actor: NativeActor }): number {
    return args.actor.health;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("unknown struct field produces compile error (caught by TS checker)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "bad-field",
  onExecute(ctx: Context): number {
    const pos: Vector2 = { x: 1, y: 2 };
    return pos.z;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "Expected compile error for unknown struct field");
    assert.ok(
      result.diagnostics.some((d) => d.code === CompileDiagCode.TypeScriptError),
      `Expected TypeScriptError diagnostic, got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("ctx alias resolves ctx.time correctly", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "ctx-alias",
  onExecute(ctx: Context): number {
    const c = ctx;
    return c.time;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const execCtx = mkCtx({ time: 777 });

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 777);
    }
  });

  test("ctx alias resolves ctx.brain.getVariable correctly", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "ctx-alias-brain",
  onExecute(ctx: Context): number {
    const c = ctx;
    const val = c.brain.getVariable("myVar");
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });
});

describe("struct method calls", () => {
  before(async () => {
    services = __test__createBrainServices();

    const types = services.types;
    const fns = services.functions;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");
    const voidTypeId = mkTypeId(NativeType.Void, "void");

    const numListTypeId = mkTypeId(NativeType.List, "NumberList");
    if (!types.get(numListTypeId)) {
      types.addListType("NumberList", { elementTypeId: numTypeId });
    }

    const widgetTypeId = mkTypeId(NativeType.Struct, "Widget");
    if (!types.get(widgetTypeId)) {
      types.addStructType("Widget", {
        fields: List.from([{ name: "id", typeId: numTypeId }]),
        fieldGetter: (source, fieldName) => {
          if (fieldName === "id") return mkNumberValue((source.native as { id: number }).id);
          return undefined;
        },
        methods: List.from([
          {
            name: "getValue",
            params: List.from([{ name: "key", typeId: strTypeId }]),
            returnTypeId: numTypeId,
          },
          {
            name: "reset",
            params: List.empty<{ name: string; typeId: string }>(),
            returnTypeId: voidTypeId,
          },
          {
            name: "add",
            params: List.from([
              { name: "a", typeId: numTypeId },
              { name: "b", typeId: numTypeId },
            ]),
            returnTypeId: numTypeId,
          },
          {
            name: "fetchData",
            params: List.from([{ name: "url", typeId: strTypeId }]),
            returnTypeId: strTypeId,
            isAsync: true,
          },
        ]),
      });
    }

    const emptyCallDef = {
      callSpec: { type: "bag" as const, items: [] },
      argSlots: List.empty<never>(),
    };

    if (!fns.get("Widget.getValue")) {
      fns.register(
        "Widget.getValue",
        false,
        {
          exec: (_ctx: ExecutionContext, args: MapValue) => {
            const widget = (args.v.get(0) as StructValue).native as { id: number };
            const key = (args.v.get(1) as StringValue).v;
            if (key === "score") return mkNumberValue(widget.id * 10);
            return mkNumberValue(0);
          },
        },
        emptyCallDef
      );
    }

    if (!fns.get("Widget.reset")) {
      fns.register("Widget.reset", false, { exec: () => NIL_VALUE }, emptyCallDef);
    }

    if (!fns.get("Widget.add")) {
      fns.register(
        "Widget.add",
        false,
        {
          exec: (_ctx: ExecutionContext, args: MapValue) => {
            const a = (args.v.get(1) as NumberValue).v;
            const b = (args.v.get(2) as NumberValue).v;
            return mkNumberValue(a + b);
          },
        },
        emptyCallDef
      );
    }

    if (!fns.get("Widget.fetchData")) {
      fns.register(
        "Widget.fetchData",
        true,
        { exec: (_ctx: ExecutionContext, _args: MapValue, _handleId: number) => {} },
        emptyCallDef
      );
    }
  });

  test("struct method with one arg compiles to HostCallArgs with argc 2", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, param, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-get",
  args: [
    param("w", { type: "Widget" }),
  ],
  onExecute(ctx: Context, args: { w: Widget }): number {
    return args.w.getValue("score");
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("struct method with no args compiles to HostCallArgs with argc 1", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, param, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-reset",
  args: [
    param("w", { type: "Widget" }),
  ],
  onExecute(ctx: Context, args: { w: Widget }): number {
    args.w.reset();
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("struct method with multiple args compiles with correct argc", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, param, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-add",
  args: [
    param("w", { type: "Widget" }),
  ],
  onExecute(ctx: Context, args: { w: Widget }): number {
    return args.w.add(3, 4);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("unknown method name on struct produces compile diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, param, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-bad",
  args: [
    param("w", { type: "Widget" }),
  ],
  onExecute(ctx: Context, args: { w: Widget }): number {
    return args.w.nonExistent();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "Expected compile error for unknown struct method");
    assert.ok(
      result.diagnostics.some((d) => d.code === CompileDiagCode.TypeScriptError),
      `Expected TypeScriptError diagnostic, got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("end-to-end: struct method call executes and returns correct value", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, param, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-e2e",
  args: [
    param("w", { type: "Widget" }),
  ],
  onExecute(ctx: Context, args: { w: Widget }): number {
    return args.w.getValue("score");
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const execCtx = mkCtx();

    const widgetTypeId = mkTypeId(NativeType.Struct, "Widget");
    const widgetValue = mkNativeStructValue(widgetTypeId, { id: 7 });
    const argsMap = mkArgsMap({ 0: widgetValue });

    const fiber = vm.spawnFiber(1, 0, List.from<Value>([argsMap as Value]), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 70);
    }
  });

  test("end-to-end: struct method with multiple args returns correct value", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, param, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-add-e2e",
  args: [
    param("w", { type: "Widget" }),
  ],
  onExecute(ctx: Context, args: { w: Widget }): number {
    return args.w.add(10, 25);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const execCtx = mkCtx();

    const widgetTypeId = mkTypeId(NativeType.Struct, "Widget");
    const widgetValue = mkNativeStructValue(widgetTypeId, { id: 1 });
    const argsMap = mkArgsMap({ 0: widgetValue });

    const fiber = vm.spawnFiber(1, 0, List.from<Value>([argsMap as Value]), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 35);
    }
  });

  test("ambient declarations include method signatures for structs with methods", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    assert.ok(ambientSource.includes("getValue(key: string): number;"), "Expected getValue method signature");
    assert.ok(ambientSource.includes("reset(): void;"), "Expected reset method signature");
    assert.ok(ambientSource.includes("add(a: number, b: number): number;"), "Expected add method signature");
  });

  test("async method declaration generates Promise<T> return type in ambient output", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    assert.ok(
      ambientSource.includes("fetchData(url: string): Promise<string>;"),
      "Expected async method with Promise return type"
    );
  });

  test("calling async host function emits HOST_CALL_ARGS_ASYNC", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, param, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-fetch",
  args: [
    param("w", { type: "Widget" }),
  ],
  onExecute(ctx: Context, args: { w: Widget }): number {
    args.w.fetchData("http://example.com");
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const hasAsyncCall = prog.functions.some((fn) => fn.code.some((instr) => instr.op === Op.HOST_CALL_ARGS_ASYNC));
    assert.ok(hasAsyncCall, "Expected HOST_CALL_ARGS_ASYNC opcode in bytecode");

    const hasSyncCall = prog.functions.some((fn) => fn.code.some((instr) => instr.op === Op.HOST_CALL_ARGS));
    assert.ok(!hasSyncCall, "Expected no HOST_CALL_ARGS opcode for async method");
  });

  test("calling sync host function emits HOST_CALL_ARGS (not HOST_CALL_ARGS_ASYNC)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, param, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-get-sync",
  args: [
    param("w", { type: "Widget" }),
  ],
  onExecute(ctx: Context, args: { w: Widget }): number {
    return args.w.getValue("score");
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const hasSyncCall = prog.functions.some((fn) => fn.code.some((instr) => instr.op === Op.HOST_CALL_ARGS));
    assert.ok(hasSyncCall, "Expected HOST_CALL_ARGS opcode for sync method");

    const hasAsyncCall = prog.functions.some((fn) => fn.code.some((instr) => instr.op === Op.HOST_CALL_ARGS_ASYNC));
    assert.ok(!hasAsyncCall, "Expected no HOST_CALL_ARGS_ASYNC opcode for sync method");
  });

  test(".pop() removes and returns last element", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-pop",
  onExecute(ctx: Context): number {
    const nums: NumberList = [10, 20, 30];
    const last = nums.pop();
    return last as number;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 30);
    }
  });

  test(".pop() on empty list returns nil", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-pop-empty",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [];
    nums.pop();
    return nums;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      assert.equal((runResult.result as ListValue).v.size(), 0);
    }
  });

  test(".shift() removes and returns first element", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-shift",
  onExecute(ctx: Context): number {
    const nums: NumberList = [10, 20, 30];
    const first = nums.shift();
    return first as number;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 10);
    }
  });

  test(".unshift() adds element at beginning", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-unshift",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [2, 3];
    nums.unshift(1);
    return nums;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(0) as NumberValue).v, 1);
      assert.equal((list.v.get(1) as NumberValue).v, 2);
      assert.equal((list.v.get(2) as NumberValue).v, 3);
    }
  });

  test(".splice(1, 2) removes 2 elements at index 1", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-splice",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [10, 20, 30, 40, 50];
    const removed = nums.splice(1, 2);
    return removed;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const removed = runResult.result as ListValue;
      assert.equal(removed.v.size(), 2);
      assert.equal((removed.v.get(0) as NumberValue).v, 20);
      assert.equal((removed.v.get(1) as NumberValue).v, 30);
    }
  });

  test(".sort((a, b) => a - b) sorts ascending", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-asc",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [3, 1, 2];
    return nums.sort((a: number, b: number): number => a - b);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(0) as NumberValue).v, 1);
      assert.equal((list.v.get(1) as NumberValue).v, 2);
      assert.equal((list.v.get(2) as NumberValue).v, 3);
    }
  });

  test(".sort((a, b) => b - a) sorts descending", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-desc",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [3, 1, 2];
    return nums.sort((a: number, b: number): number => b - a);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(0) as NumberValue).v, 3);
      assert.equal((list.v.get(1) as NumberValue).v, 2);
      assert.equal((list.v.get(2) as NumberValue).v, 1);
    }
  });

  test(".sort() on already-sorted list is unchanged", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-sorted",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [1, 2, 3];
    return nums.sort((a: number, b: number): number => a - b);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(0) as NumberValue).v, 1);
      assert.equal((list.v.get(1) as NumberValue).v, 2);
      assert.equal((list.v.get(2) as NumberValue).v, 3);
    }
  });

  test(".sort() on single-element list is unchanged", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-single",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [42];
    return nums.sort((a: number, b: number): number => a - b);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 1);
      assert.equal((list.v.get(0) as NumberValue).v, 42);
    }
  });

  test(".sort() on empty list is unchanged", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-empty",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [];
    return nums.sort((a: number, b: number): number => a - b);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 0);
    }
  });

  test(".sort() without comparator emits diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-no-cmp",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [3, 1, 2];
    return nums.sort();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === LoweringDiagCode.SortRequiresComparatorFn));
  });

  test(".sort() mutates the original array", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-mutates",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [3, 1, 2];
    nums.sort((a: number, b: number): number => a - b);
    return nums;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(0) as NumberValue).v, 1);
      assert.equal((list.v.get(1) as NumberValue).v, 2);
      assert.equal((list.v.get(2) as NumberValue).v, 3);
    }
  });

  test("true ? 1 : 2 -> 1", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "ternary-true",
  onExecute(ctx: Context): number {
    return true ? 1 : 2;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 1);
    }
  });

  test("false ? 1 : 2 -> 2", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "ternary-false",
  onExecute(ctx: Context): number {
    return false ? 1 : 2;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 2);
    }
  });

  test("ternary with variable condition", () => {
    const source = `
import { Sensor, param, type Context } from "mindcraft";

export default Sensor({
  name: "ternary-var",
  args: [
    param("flag", { type: "boolean" }),
  ],
  onExecute(ctx: Context, args: { flag: boolean }): number {
    return args.flag ? 10 : 20;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    {
      const args = mkArgsMap({ 0: { t: NativeType.Boolean, v: true } as BooleanValue });
      const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
      fiber.instrBudget = 1000;
      const runResult = vm.runFiber(fiber, mkScheduler());
      assert.equal(runResult.status, VmStatus.DONE);
      if (runResult.status === VmStatus.DONE) {
        assert.equal((runResult.result as NumberValue).v, 10);
      }
    }
    {
      const args = mkArgsMap({ 0: { t: NativeType.Boolean, v: false } as BooleanValue });
      const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
      fiber.instrBudget = 1000;
      const runResult = vm.runFiber(fiber, mkScheduler());
      assert.equal(runResult.status, VmStatus.DONE);
      if (runResult.status === VmStatus.DONE) {
        assert.equal((runResult.result as NumberValue).v, 20);
      }
    }
  });

  test("nested ternary a ? (b ? 1 : 2) : 3", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "ternary-nested",
  onExecute(ctx: Context): number {
    const a = true;
    const b = false;
    return a ? (b ? 1 : 2) : 3;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 2);
    }
  });

  test("null ?? 42 -> 42", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nullish-null",
  onExecute(ctx: Context): number {
    const x: number | null = null;
    return x ?? 42;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("5 ?? 42 -> 5", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nullish-nonnull",
  onExecute(ctx: Context): number {
    const x: number | null = 5;
    return x ?? 42;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 5);
    }
  });

  test("undefined ?? 42 -> 42", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nullish-undef",
  onExecute(ctx: Context): number {
    const x: number | undefined = undefined;
    return x ?? 42;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("?? does not trigger on 0 (unlike ||)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nullish-zero",
  onExecute(ctx: Context): number {
    const x: number | null = 0;
    return x ?? 42;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 0);
    }
  });
});
