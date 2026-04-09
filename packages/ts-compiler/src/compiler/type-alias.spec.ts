import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BrainServices,
  CoreTypeIds,
  HandleTable,
  NativeType,
  type NumberValue,
  runtime,
  type StructTypeDef,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { compileUserTile } from "./compile.js";
import { LoweringDiagCode } from "./diag-codes.js";

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

describe("type alias declarations", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("basic object type alias registers as struct type", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

type Point = {
  x: number;
  y: number;
};

export default Sensor({
  name: "talias-basic",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);

    const registry = services.types;
    const typeId = registry.resolveByName("/user-code.ts::Point");
    assert.ok(typeId, "Point struct type should be registered");
    const def = registry.get(typeId!);
    assert.ok(def, "Point type def should exist");
    assert.equal(def!.coreType, NativeType.Struct);

    const fieldNames: string[] = [];
    const structDef = def as StructTypeDef;
    structDef.fields.forEach((f) => {
      fieldNames.push(f.name);
    });
    assert.ok(fieldNames.includes("x"), "should have field x");
    assert.ok(fieldNames.includes("y"), "should have field y");
  });

  test("type alias with optional field registers nullable type", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

type Config = {
  name: string;
  timeout?: number;
};

export default Sensor({
  name: "talias-optional",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);

    const registry = services.types;
    const typeId = registry.resolveByName("/user-code.ts::Config");
    assert.ok(typeId, "Config struct type should be registered");
    const structDef = registry.get(typeId!) as StructTypeDef;

    let nameFieldTypeId: string | undefined;
    let timeoutFieldTypeId: string | undefined;
    structDef.fields.forEach((f) => {
      if (f.name === "name") nameFieldTypeId = f.typeId;
      if (f.name === "timeout") timeoutFieldTypeId = f.typeId;
    });

    assert.equal(nameFieldTypeId, CoreTypeIds.String, "name should be string");
    assert.ok(timeoutFieldTypeId, "timeout field should exist");
    const timeoutDef = registry.get(timeoutFieldTypeId!);
    assert.ok(timeoutDef, "timeout type def should exist");
    assert.equal(timeoutDef!.nullable, true, "timeout should be nullable");
  });

  test("type alias object literal compiles and executes", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

type Point = {
  x: number;
  y: number;
};

export default Sensor({
  name: "talias-obj-lit",
  output: "number",
  onExecute(ctx: Context): number {
    const p: Point = { x: 5, y: 8 };
    return p.x + p.y;
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
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 13);
    }
  });

  test("type alias with nested struct field", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

type Vec2 = {
  x: number;
  y: number;
};

type Entity = {
  pos: Vec2;
  name: string;
};

export default Sensor({
  name: "talias-nested",
  output: "number",
  onExecute(ctx: Context): number {
    const v: Vec2 = { x: 10, y: 20 };
    const e: Entity = { pos: v, name: "hello" };
    return e.pos.x + e.pos.y;
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
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 30);
    }
  });

  test("generic type alias emits diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

type Container<T> = {
  value: T;
};

export default Sensor({
  name: "talias-generic",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "should have diagnostics");
    assert.equal(result.diagnostics[0].code, LoweringDiagCode.GenericTypeAliasNotSupported);
  });

  test("type alias colliding with ambient type emits diagnostic", () => {
    const types = services.types;
    types.addStructType("AmbientPoint", {
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number },
        { name: "y", typeId: CoreTypeIds.Number },
      ]),
    });
    const ambientSource = buildAmbientDeclarations(types);
    const source = `
import { Sensor, type Context } from "mindcraft";

type AmbientPoint = {
  x: number;
  y: number;
};

export default Sensor({
  name: "talias-collision",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    const collisionDiag = result.diagnostics.find((d) => d.code === LoweringDiagCode.TypeAliasCollidesWithAmbientType);
    assert.ok(collisionDiag, "should emit TypeAliasCollidesWithAmbientType diagnostic");
  });

  test("non-object type alias is silently skipped", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

type StringOrNumber = string | number;
type MyString = string;
type NumArray = number[];

export default Sensor({
  name: "talias-non-object",
  output: "number",
  onExecute(ctx: Context): number {
    return 42;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);

    const registry = services.types;
    assert.equal(registry.resolveByName("/user-code.ts::StringOrNumber"), undefined);
    assert.equal(registry.resolveByName("/user-code.ts::MyString"), undefined);
    assert.equal(registry.resolveByName("/user-code.ts::NumArray"), undefined);
  });
});
