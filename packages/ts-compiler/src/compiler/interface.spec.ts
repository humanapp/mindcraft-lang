import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, MapValue, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BrainServices,
  CoreTypeIds,
  HandleTable,
  isStructValue,
  mkNumberValue,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  runtime,
  type StructTypeDef,
  type StructValue,
  type Value,
  ValueDict,
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

describe("interface declarations", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("basic interface registers as struct type with correct fields", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Point {
  x: number;
  y: number;
}

export default Sensor({
  name: "iface-basic",
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

  test("interface with optional field registers nullable type", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Config {
  name: string;
  timeout?: number;
}

export default Sensor({
  name: "iface-optional",
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

  test("interface-typed object literal compiles and executes", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Point {
  x: number;
  y: number;
}

export default Sensor({
  name: "iface-obj-lit",
  onExecute(ctx: Context): number {
    const p: Point = { x: 3, y: 4 };
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
      assert.equal((runResult.result as NumberValue).v, 7);
    }
  });

  test("interface with nested struct field", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Vec2 {
  x: number;
  y: number;
}

interface Entity {
  pos: Vec2;
  name: string;
}

export default Sensor({
  name: "iface-nested",
  onExecute(ctx: Context): number {
    const v: Vec2 = { x: 1, y: 2 };
    const e: Entity = { pos: v, name: "test" };
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
      assert.equal((runResult.result as NumberValue).v, 3);
    }
  });

  test("generic interface is silently skipped (no rejection diagnostic)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Container<T> {
  value: T;
}

export default Sensor({
  name: "iface-generic",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, []);
  });

  test("interface colliding with ambient type emits diagnostic", () => {
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

interface AmbientPoint {
  x: number;
  y: number;
}

export default Sensor({
  name: "iface-ambient-collision",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    const collisionDiag = result.diagnostics.find((d) => d.code === LoweringDiagCode.InterfaceCollidesWithAmbientType);
    assert.ok(collisionDiag, "should emit InterfaceCollidesWithAmbientType diagnostic");
  });

  test("interface with index signature emits diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface StringMap {
  [key: string]: number;
}

export default Sensor({
  name: "iface-index-sig",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    const indexDiag = result.diagnostics.find((d) => d.code === LoweringDiagCode.UnsupportedInterfaceMember);
    assert.ok(indexDiag, "should emit UnsupportedInterfaceMember diagnostic for index signatures");
  });

  test("interface with call signature emits diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Callable {
  (x: number): string;
}

export default Sensor({
  name: "iface-call-sig",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    const callDiag = result.diagnostics.find((d) => d.code === LoweringDiagCode.UnsupportedInterfaceMember);
    assert.ok(callDiag, "should emit UnsupportedInterfaceMember diagnostic for call signatures");
  });

  test("interface with boolean and string fields", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Settings {
  enabled: boolean;
  label: string;
  count: number;
}

export default Sensor({
  name: "iface-multi-type",
  onExecute(ctx: Context): number {
    const s: Settings = { enabled: true, label: "test", count: 42 };
    return s.count;
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
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });
});
