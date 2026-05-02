import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BrainServices,
  HandleTable,
  isStructValue,
  type MapValue,
  mkNativeStructValue,
  mkNumberValue,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  runtime,
  type StructValue,
  type Value,
  ValueDict,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { compileUserTile } from "./compile.js";
import { CompileDiagCode, LoweringDiagCode } from "./diag-codes.js";

let services: BrainServices;

function mkCtx(): ExecutionContext {
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
  };
}

function mkScheduler(): Scheduler {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  };
}

describe("struct field assignment", () => {
  before(() => {
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

    const entityTypeId = mkTypeId(NativeType.Struct, "Entity");
    if (!types.get(entityTypeId)) {
      types.addStructType("Entity", {
        fields: List.from([
          { name: "position", typeId: vec2TypeId },
          { name: "health", typeId: numTypeId },
        ]),
      });
    }
  });

  test("simple field assignment on a plain struct", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "set-field",
  onExecute(ctx: Context): number {
    const v: Vector2 = { x: 1, y: 2 };
    v.x = 10;
    return v.x;
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
    assert.ok(runResult.result);
    assert.equal((runResult.result as NumberValue).v, 10);
  });

  test("field assignment on a nested struct field", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Entity, type Vector2 } from "mindcraft";

export default Sensor({
  name: "set-nested",
  onExecute(ctx: Context): number {
    const e: Entity = { position: { x: 0, y: 0 }, health: 50 };
    e.health = 99;
    return e.health;
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
    assert.ok(runResult.result);
    assert.equal((runResult.result as NumberValue).v, 99);
  });

  test("struct field assignment to another struct value", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Entity, type Vector2 } from "mindcraft";

export default Sensor({
  name: "set-struct-field",
  onExecute(ctx: Context): Vector2 {
    const e: Entity = { position: { x: 1, y: 2 }, health: 10 };
    e.position = { x: 30, y: 40 };
    return e.position;
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
    assert.ok(runResult.result);
    assert.ok(isStructValue(runResult.result!));
    const pos = runResult.result as StructValue;
    assert.equal((pos.v?.get("x") as NumberValue).v, 30);
    assert.equal((pos.v?.get("y") as NumberValue).v, 40);
  });
});

describe("struct field assignment with fieldSetter", () => {
  let setterCalls: Array<{ field: string; value: Value }>;

  before(() => {
    services = __test__createBrainServices();
    setterCalls = [];

    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");

    const nativeTypeId = mkTypeId(NativeType.Struct, "NativeWidget");
    if (!types.get(nativeTypeId)) {
      types.addStructType("NativeWidget", {
        fields: List.from([
          { name: "value", typeId: numTypeId },
          { name: "id", typeId: numTypeId, readOnly: true },
        ]),
        fieldGetter: (source, fieldName) => {
          const data = source.native as { value: number; id: number };
          if (fieldName === "value") return mkNumberValue(data.value);
          if (fieldName === "id") return mkNumberValue(data.id);
          return undefined;
        },
        fieldSetter: (source, fieldName, val) => {
          if (fieldName === "value") {
            (source.native as { value: number }).value = (val as NumberValue).v;
            setterCalls.push({ field: fieldName, value: val });
            return true;
          }
          return false;
        },
      });
    }
  });

  test("assignment triggers fieldSetter on a native-backed struct", () => {
    setterCalls = [];
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, param, type Context, type NativeWidget } from "mindcraft";

export default Sensor({
  name: "native-set",
  args: [
    param("w", { type: "NativeWidget" }),
  ],
  onExecute(ctx: Context, args: { w: NativeWidget }): number {
    args.w.value = 42;
    return args.w.value;
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

    const nativeWidget = mkNativeStructValue(mkTypeId(NativeType.Struct, "NativeWidget"), { value: 0, id: 7 });
    const args = List.from<Value>([nativeWidget]);
    const fiber = vm.spawnFiber(1, 0, args, ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    assert.ok(runResult.result);
    assert.equal((runResult.result as NumberValue).v, 42);
    assert.equal(setterCalls.length, 1);
    assert.equal(setterCalls[0].field, "value");
  });
});

describe("struct field assignment diagnostics", () => {
  before(() => {
    services = __test__createBrainServices();

    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");

    const readOnlyTypeId = mkTypeId(NativeType.Struct, "Sensor_ReadOnly");
    if (!types.get(readOnlyTypeId)) {
      types.addStructType("Sensor_ReadOnly", {
        fields: List.from([
          { name: "value", typeId: numTypeId, readOnly: true },
          { name: "mutable", typeId: numTypeId },
        ]),
        fieldGetter: () => mkNumberValue(0),
      });
    }
  });

  test("assigning to a readOnly field produces a diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, param, type Context, type Sensor_ReadOnly } from "mindcraft";

export default Sensor({
  name: "ro-assign",
  args: [
    param("s", { type: "Sensor_ReadOnly" }),
  ],
  onExecute(ctx: Context, args: { s: Sensor_ReadOnly }): number {
    args.s.value = 5;
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "Expected a diagnostic");
    assert.ok(
      result.diagnostics.some(
        (d) => d.code === CompileDiagCode.TypeScriptError || d.code === LoweringDiagCode.ReadOnlyFieldAssignment
      ),
      `Expected readonly assignment error, got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("assigning to a writable field on a struct with readOnly fields compiles without error", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, param, type Context, type Sensor_ReadOnly } from "mindcraft";

export default Sensor({
  name: "mutable-assign",
  args: [
    param("s", { type: "Sensor_ReadOnly" }),
  ],
  onExecute(ctx: Context, args: { s: Sensor_ReadOnly }): number {
    args.s.mutable = 7;
    return args.s.mutable;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });
});

describe("struct field compound assignment", () => {
  before(() => {
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

  test("compound += on a struct field", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "compound-field",
  onExecute(ctx: Context): number {
    const v: Vector2 = { x: 10, y: 20 };
    v.x += 5;
    return v.x;
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
    assert.ok(runResult.result);
    assert.equal((runResult.result as NumberValue).v, 15);
  });

  test("compound -= on a struct field", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "compound-sub",
  onExecute(ctx: Context): number {
    const v: Vector2 = { x: 10, y: 20 };
    v.y -= 8;
    return v.y;
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
    assert.ok(runResult.result);
    assert.equal((runResult.result as NumberValue).v, 12);
  });

  test("compound *= on a struct field", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "compound-mul",
  onExecute(ctx: Context): number {
    const v: Vector2 = { x: 3, y: 4 };
    v.x *= 7;
    return v.x;
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
    assert.ok(runResult.result);
    assert.equal((runResult.result as NumberValue).v, 21);
  });
});

describe("struct field assignment integration", () => {
  let nativeState: { hp: number; armor: number; x: number; y: number };

  before(() => {
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

    const unitTypeId = mkTypeId(NativeType.Struct, "Unit");
    if (!types.get(unitTypeId)) {
      types.addStructType("Unit", {
        fields: List.from([
          { name: "hp", typeId: numTypeId },
          { name: "armor", typeId: numTypeId, readOnly: true },
          { name: "x", typeId: numTypeId },
          { name: "y", typeId: numTypeId },
        ]),
        fieldGetter: (source, fieldName) => {
          const data = source.native as typeof nativeState;
          if (fieldName === "hp") return mkNumberValue(data.hp);
          if (fieldName === "armor") return mkNumberValue(data.armor);
          if (fieldName === "x") return mkNumberValue(data.x);
          if (fieldName === "y") return mkNumberValue(data.y);
          return undefined;
        },
        fieldSetter: (source, fieldName, val) => {
          const data = source.native as typeof nativeState;
          const n = (val as NumberValue).v;
          if (fieldName === "hp") {
            data.hp = n;
            return true;
          }
          if (fieldName === "x") {
            data.x = n;
            return true;
          }
          if (fieldName === "y") {
            data.y = n;
            return true;
          }
          return false;
        },
      });
    }
  });

  test("param struct field reads, writes, compound ops, conditionals, loop, and struct return", () => {
    nativeState = { hp: 100, armor: 5, x: 0, y: 0 };

    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, param, type Context, type Unit, type Vector2 } from "mindcraft";

export default Sensor({
  name: "integration",
  args: [
    param("unit", { type: "Unit" }),
    param("damage", { type: "number" }),
    param("steps", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { unit: Unit; damage: number; steps: number }): Vector2 {
    const u = args.unit;

    // apply damage reduced by armor: hp -= max(damage - armor, 1)
    let effectiveDamage = args.damage - u.armor;
    if (effectiveDamage < 1) {
      effectiveDamage = 1;
    }
    u.hp -= effectiveDamage;

    // move diagonally for 'steps' iterations
    let i = 0;
    while (i < args.steps) {
      u.x += 3;
      u.y += 2;
      i += 1;
    }

    // if hp dropped below 50, halve remaining hp
    if (u.hp < 50) {
      u.hp = u.hp / 2;
    }

    // return final position as a plain struct
    const result: Vector2 = { x: u.x, y: u.y };
    return result;
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

    const unitStruct = mkNativeStructValue(mkTypeId(NativeType.Struct, "Unit"), nativeState);
    const args = List.from<Value>([unitStruct, mkNumberValue(60), mkNumberValue(4)]);
    const fiber = vm.spawnFiber(1, 0, args, ctx);
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    assert.ok(runResult.result);

    // damage = 60, armor = 5, effective = 55, hp: 100 - 55 = 45
    // 45 < 50, so hp = 45 / 2 = 22.5
    assert.equal(nativeState.hp, 22.5);

    // 4 steps: x += 3 each -> 12, y += 2 each -> 8
    assert.equal(nativeState.x, 12);
    assert.equal(nativeState.y, 8);

    // returned Vector2 should match final position
    assert.ok(isStructValue(runResult.result!));
    const pos = runResult.result as StructValue;
    assert.equal((pos.v?.get("x") as NumberValue).v, 12);
    assert.equal((pos.v?.get("y") as NumberValue).v, 8);
  });
});
