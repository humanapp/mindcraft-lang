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
describe("destructuring", () => {
  before(async () => {
    services = __test__createBrainServices();

    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");

    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vec2TypeId)) {
      types.addStructType("Vector2", {
        fields: List.from([
          { name: "x", typeId: numTypeId },
          { name: "y", typeId: numTypeId },
        ]),
      });
    }
  });

  test("object destructuring: const { x, y } = { x: 1, y: 2 }", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "obj-destructure",
  onExecute(ctx: Context): number {
    const pos: Vector2 = { x: 1, y: 2 };
    const { x, y } = pos;
    return x + y;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 3);
    }
  });

  test("array destructuring: const [a, b] = [10, 20]", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "arr-destructure",
  onExecute(ctx: Context): number {
    const arr: number[] = [10, 20];
    const [a, b] = arr;
    return a + b;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 30);
    }
  });

  test("nested object destructuring: const { inner: { x, y } } = obj", () => {
    const types = services.types;
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    const entityTypeId = mkTypeId(NativeType.Struct, "Entity");
    if (!types.get(entityTypeId)) {
      types.addStructType("Entity", {
        fields: List.from([{ name: "pos", typeId: vec2TypeId }]),
      });
    }
    const ambientSource = buildAmbientDeclarations(services.types);

    const source = `
import { Sensor, type Context, type Vector2, type Entity } from "mindcraft";

export default Sensor({
  name: "nested-obj-destructure",
  onExecute(ctx: Context): number {
    const entity: Entity = { pos: { x: 10, y: 20 } };
    const { pos: { x, y } } = entity;
    return x + y;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 30);
    }
  });

  test("nested array-in-object destructuring: const { pos: [x, y] } = entity", () => {
    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const numListTypeId = types.instantiate("List", List.from([numTypeId]));
    const coordTypeId = mkTypeId(NativeType.Struct, "Coord");
    if (!types.get(coordTypeId)) {
      types.addStructType("Coord", {
        fields: List.from([{ name: "pos", typeId: numListTypeId }]),
      });
    }
    const ambientSource = buildAmbientDeclarations(services.types);

    const source = `
import { Sensor, type Context, type Coord } from "mindcraft";

export default Sensor({
  name: "nested-arr-in-obj",
  onExecute(ctx: Context): number {
    const entity: Coord = { pos: [3, 4] };
    const { pos: [x, y] } = entity;
    return x + y;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 7);
    }
  });

  test("mixed nesting: object containing array", () => {
    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const numListTypeId = types.instantiate("List", List.from([numTypeId]));
    const pairHolderTypeId = mkTypeId(NativeType.Struct, "PairHolder");
    if (!types.get(pairHolderTypeId)) {
      types.addStructType("PairHolder", {
        fields: List.from([{ name: "items", typeId: numListTypeId }]),
      });
    }
    const ambientSource = buildAmbientDeclarations(services.types);

    const source = `
import { Sensor, type Context, type PairHolder } from "mindcraft";

export default Sensor({
  name: "mixed-nesting",
  onExecute(ctx: Context): number {
    const data: PairHolder = { items: [100, 200] };
    const { items: [first, second] } = data;
    return first + second;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 300);
    }
  });

  test("three levels of nesting: array in object in object", () => {
    const types = services.types;
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    const entityTypeId = mkTypeId(NativeType.Struct, "Entity");
    const wrapperTypeId = mkTypeId(NativeType.Struct, "Wrapper");
    if (!types.get(wrapperTypeId)) {
      types.addStructType("Wrapper", {
        fields: List.from([{ name: "entity", typeId: entityTypeId }]),
      });
    }
    const ambientSource = buildAmbientDeclarations(services.types);

    const source = `
import { Sensor, type Context, type Vector2, type Entity, type Wrapper } from "mindcraft";

export default Sensor({
  name: "deep-nesting",
  onExecute(ctx: Context): number {
    const w: Wrapper = { entity: { pos: { x: 5, y: 6 } } };
    const { entity: { pos: { x, y } } } = w;
    return x + y;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 11);
    }
  });

  test("array rest pattern: const [first, ...rest] = arr", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "rest-destructure",
  onExecute(ctx: Context): number {
    const arr: number[] = [1, 2, 3, 4];
    const [first, ...rest] = arr;
    return first + rest[0] + rest[1] + rest[2];
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

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 10);
    }
  });

  test("array rest pattern: const [a, b, ...tail] = arr", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "rest-tail",
  onExecute(ctx: Context): number {
    const arr: number[] = [10, 20, 30, 40, 50];
    const [a, b, ...tail] = arr;
    return a + b + tail.length;
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

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 33);
    }
  });

  test("array rest pattern: const [...all] = arr copies the array", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "rest-all",
  onExecute(ctx: Context): number {
    const arr: number[] = [5, 10, 15];
    const [...all] = arr;
    return all[0] + all[1] + all[2];
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

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 30);
    }
  });

  test("object rest pattern: const { x, ...rest } = obj extracts x", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "obj-rest",
  onExecute(ctx: Context): number {
    const obj: Vector2 = { x: 10, y: 20 };
    const { x, ...rest } = obj;
    return x;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 10);
    }
  });

  test("object rest pattern: rest contains remaining fields", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "obj-rest-remaining",
  onExecute(ctx: Context): Vector2 {
    const obj: Vector2 = { x: 3, y: 7 };
    const { x, ...rest } = obj;
    return rest as unknown as Vector2;
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
      assert.ok(runResult.result);
      assert.ok(isStructValue(runResult.result), "expected struct value for rest");
      const rest = runResult.result as StructValue;
      assert.equal((rest.v?.get("y") as NumberValue).v, 7, "rest should contain y=7");
      assert.equal(rest.v?.get("x"), undefined, "rest should not contain x");
    }
  });

  test("nested destructuring with rest on inner struct: const { pos: { x, ...posRest } } = entity", () => {
    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    const entityTypeId = mkTypeId(NativeType.Struct, "Entity");
    if (!types.get(entityTypeId)) {
      types.addStructType("Entity", {
        fields: List.from([{ name: "pos", typeId: vec2TypeId }]),
      });
    }
    const ambientSource = buildAmbientDeclarations(services.types);

    const source = `
import { Sensor, type Context, type Vector2, type Entity } from "mindcraft";

export default Sensor({
  name: "nested-rest-inner",
  onExecute(ctx: Context): number {
    const entity: Entity = { pos: { x: 5, y: 15 } };
    const { pos: { x, ...posRest } } = entity;
    return x;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 5);
    }
  });

  test("rest on outer struct with 3 fields: const { name, ...rest } = player", () => {
    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    const playerTypeId = mkTypeId(NativeType.Struct, "Player");
    if (!types.get(playerTypeId)) {
      types.addStructType("Player", {
        fields: List.from([
          { name: "name", typeId: strTypeId },
          { name: "pos", typeId: vec2TypeId },
          { name: "health", typeId: numTypeId },
        ]),
      });
    }
    const ambientSource = buildAmbientDeclarations(services.types);

    const source = `
import { Sensor, type Context, type Vector2, type Player } from "mindcraft";

export default Sensor({
  name: "rest-outer-3-fields",
  onExecute(ctx: Context): Player {
    const player: Player = { name: "alice", pos: { x: 1, y: 2 }, health: 100 };
    const { name, ...rest } = player;
    return rest as unknown as Player;
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
      assert.ok(runResult.result);
      assert.ok(isStructValue(runResult.result), "expected struct for rest");
      const rest = runResult.result as StructValue;
      assert.equal(rest.v?.get("name"), undefined, "rest should not contain name");
      const pos = rest.v?.get("pos");
      assert.ok(pos && isStructValue(pos), "rest should contain pos as struct");
      assert.equal((rest.v?.get("health") as NumberValue).v, 100, "rest should contain health=100");
    }
  });

  test("nested destructure + rest at outer level: const { pos: { x }, ...rest } = player", () => {
    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    const playerTypeId = mkTypeId(NativeType.Struct, "Player");
    if (!types.get(playerTypeId)) {
      types.addStructType("Player", {
        fields: List.from([
          { name: "name", typeId: strTypeId },
          { name: "pos", typeId: vec2TypeId },
          { name: "health", typeId: numTypeId },
        ]),
      });
    }
    const ambientSource = buildAmbientDeclarations(services.types);

    const source = `
import { Sensor, type Context, type Vector2, type Player } from "mindcraft";

export default Sensor({
  name: "nested-plus-outer-rest",
  onExecute(ctx: Context): number {
    const player: Player = { name: "bob", pos: { x: 42, y: 99 }, health: 75 };
    const { pos: { x }, ...rest } = player;
    return x;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("property access on object rest variable: rest.y after const { x, ...rest } = obj", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "rest-prop-access",
  onExecute(ctx: Context): number {
    const obj: Vector2 = { x: 10, y: 20 };
    const { x, ...rest } = obj;
    return rest.y;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 20);
    }
  });

  test("property access on rest variable from 3-field struct: rest.health after const { name, ...rest } = player", () => {
    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    const playerTypeId = mkTypeId(NativeType.Struct, "Player");
    if (!types.get(playerTypeId)) {
      types.addStructType("Player", {
        fields: List.from([
          { name: "name", typeId: strTypeId },
          { name: "pos", typeId: vec2TypeId },
          { name: "health", typeId: numTypeId },
        ]),
      });
    }
    const ambientSource = buildAmbientDeclarations(services.types);

    const source = `
import { Sensor, type Context, type Vector2, type Player } from "mindcraft";

export default Sensor({
  name: "rest-prop-access-3-field",
  onExecute(ctx: Context): number {
    const player: Player = { name: "alice", pos: { x: 1, y: 2 }, health: 100 };
    const { name, ...rest } = player;
    return rest.health;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 100);
    }
  });

  test("computed property name in destructuring: const { ['x']: val } = obj", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "computed-key-literal",
  onExecute(ctx: Context): number {
    const obj: Vector2 = { x: 42, y: 99 };
    const { ["x"]: val } = obj;
    return val;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("computed property name with variable key: const key = 'y'; const { [key]: val } = obj", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "computed-key-variable",
  onExecute(ctx: Context): number {
    const obj: Vector2 = { x: 10, y: 55 };
    const key = "y";
    const { [key]: val } = obj;
    return val;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 55);
    }
  });

  test("computed property name combined with rest pattern: const { ['x']: val, ...rest } = obj", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "computed-key-rest",
  onExecute(ctx: Context): number {
    const obj: Vector2 = { x: 1, y: 2 };
    const { ["x"]: val, ...rest } = obj;
    return val + rest.y;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 3);
    }
  });

  test("object destructuring with default value uses default when field is present", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "default-destructure",
  onExecute(ctx: Context): number {
    const obj: Vector2 = { x: 3, y: 10 };
    const { x = 5, y = 0 } = obj;
    return x + y;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 13);
    }
  });

  test("object destructuring with rename: const { x: posX } = pos", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "rename-destructure",
  onExecute(ctx: Context): number {
    const pos: Vector2 = { x: 42, y: 7 };
    const { x: posX, y: posY } = pos;
    return posX + posY;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 49);
    }
  });

  test("array destructuring with omitted elements: const [, b] = arr", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "omitted-destructure",
  onExecute(ctx: Context): number {
    const arr: number[] = [10, 20, 30];
    const [, b, c] = arr;
    return b + c;
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
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 50);
    }
  });

  test("helper function with object destructuring in parameter: function f({ x, y }: Point)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);

    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

function sum({ x, y }: Vector2): number {
  return x + y;
}

export default Sensor({
  name: "param-obj-destructure",
  onExecute(ctx: Context): number {
    const pos: Vector2 = { x: 10, y: 20 };
    return sum(pos);
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

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 30);
    }
  });

  test("helper function with array destructuring in parameter: function f([a, b]: number[])", () => {
    const ambientSource = buildAmbientDeclarations(services.types);

    const source = `
import { Sensor, type Context } from "mindcraft";

function sum([a, b]: number[]): number {
  return a + b;
}

export default Sensor({
  name: "param-arr-destructure",
  onExecute(ctx: Context): number {
    const nums: number[] = [3, 7];
    return sum(nums);
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

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 10);
    }
  });

  test("closure with object destructuring in parameter: ({ x }: Point) => x", () => {
    const ambientSource = buildAmbientDeclarations(services.types);

    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

function apply(fn: (p: Vector2) => number, p: Vector2): number {
  return fn(p);
}

export default Sensor({
  name: "closure-param-destructure",
  onExecute(ctx: Context): number {
    const pos: Vector2 = { x: 5, y: 15 };
    return apply(({ x, y }: Vector2): number => x + y, pos);
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

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 20);
    }
  });

  test("closure with destructured param that also captures an outer variable", () => {
    const ambientSource = buildAmbientDeclarations(services.types);

    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

function apply(fn: (p: Vector2) => number, p: Vector2): number {
  return fn(p);
}

export default Sensor({
  name: "closure-destructure-capture",
  onExecute(ctx: Context): number {
    const offset = 100;
    const pos: Vector2 = { x: 3, y: 7 };
    return apply(({ x, y }: Vector2): number => x + y + offset, pos);
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

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 110);
    }
  });

  test("destructuring in onExecute parameter position produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);

    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "onexec-destructure",
  onExecute({ time }: Context): number {
    return time;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "expected diagnostics for onExecute destructuring");
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.DestructuringInOnExecuteNotSupported),
      `expected onExecute destructuring error, got: ${JSON.stringify(result.diagnostics)}`
    );
  });
});
