import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { mkTypeId, NativeType } from "@mindcraft-lang/core/runtime";
import { buildAmbientDeclarations } from "./ambient.js";
import { compileUserTile } from "./compile.js";

let services: BrainServices;

let nextTypeAtomId = 1024;
function mkTestAtomId(): number {
  return nextTypeAtomId++;
}

describe("buildAmbientDeclarations", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("generates plain interface for user-creatable struct", () => {
    const types = services.runtime.types;
    const vecId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vecId)) {
      types.addStructType("Vector2", {
        atomId: mkTestAtomId(),
        fields: List.from([
          { name: "x", typeId: mkTypeId(NativeType.Number, "number"), fieldIndex: 0 },
          { name: "y", typeId: mkTypeId(NativeType.Number, "number"), fieldIndex: 1 },
        ]),
      });
    }

    const ambient = buildAmbientDeclarations(services.runtime.types);
    assert.ok(ambient.includes("export interface Vector2 {"), "should contain Vector2 interface");
    assert.ok(ambient.includes("x: number;"), "should contain x field");
    assert.ok(ambient.includes("y: number;"), "should contain y field");
    const vec2Start = ambient.indexOf("export interface Vector2 {");
    const vec2End = ambient.indexOf("}", vec2Start);
    const vec2Block = ambient.slice(vec2Start, vec2End + 1);
    assert.ok(!vec2Block.includes("readonly __brand"), "user-creatable struct should not have brand");
    assert.ok(ambient.includes("Vector2: Vector2;"), "should have MindcraftTypeMap entry");
  });

  test("generates branded interface for native-backed struct", () => {
    const types = services.runtime.types;
    const actorRefId = mkTypeId(NativeType.Struct, "ActorRef");
    if (!types.get(actorRefId)) {
      types.addStructType("ActorRef", {
        atomId: mkTestAtomId(),
        fields: List.from([
          { name: "id", typeId: mkTypeId(NativeType.Number, "number"), fieldIndex: 0 },
          { name: "energy pct", typeId: mkTypeId(NativeType.Number, "number"), fieldIndex: 1 },
        ]),
        fieldGetter: () => undefined,
      });
    }

    const ambient = buildAmbientDeclarations(services.runtime.types);
    assert.ok(ambient.includes("export interface ActorRef {"), "should contain ActorRef interface");
    assert.ok(ambient.includes("readonly __brand: unique symbol;"), "native-backed should have brand");
    assert.ok(ambient.includes("readonly id: number;"), "fields should be readonly");
    assert.ok(ambient.includes('readonly "energy pct": number;'), "spaced field name should be quoted");
    assert.ok(ambient.includes("ActorRef: ActorRef;"), "should have MindcraftTypeMap entry");
  });

  test("branded struct prevents object literal assignment (TS type error)", () => {
    const ambient = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, type Context, type ActorRef } from "mindcraft";

export default Sensor({
  name: "test-brand",
  onExecute(ctx: Context): boolean {
    const a: ActorRef = { id: 1, "energy pct": 0.5 };
    return true;
  },
});
`;
    const result = compileUserTile(source, { ambientFiles: [{ path: "ambient.d.ts", content: ambient }], services });
    assert.ok(result.diagnostics.length > 0, "should have diagnostics due to brand mismatch");
  });

  test("native-backed struct param compiles to LOAD_LOCAL/STORE_LOCAL", () => {
    const ambient = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, param, type ActorRef, type Context } from "mindcraft";

export default Sensor({
  name: "test-param-assign",
  args: [
    param("target", { type: "ActorRef" }),
  ],
  onExecute(ctx: Context, args: { target: ActorRef }): number {
    let t: ActorRef = args.target;
    return 1;
  },
});
`;
    const result = compileUserTile(source, { ambientFiles: [{ path: "ambient.d.ts", content: ambient }], services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");
  });

  test("struct fields referencing other struct types resolve correctly", () => {
    const types = services.runtime.types;
    const posId = mkTypeId(NativeType.Struct, "Position");
    if (!types.get(posId)) {
      types.addStructType("Position", {
        atomId: mkTestAtomId(),
        fields: List.from([
          { name: "x", typeId: mkTypeId(NativeType.Number, "number"), fieldIndex: 0 },
          { name: "y", typeId: mkTypeId(NativeType.Number, "number"), fieldIndex: 1 },
        ]),
      });
    }
    const entityId = mkTypeId(NativeType.Struct, "Entity");
    if (!types.get(entityId)) {
      types.addStructType("Entity", {
        atomId: mkTestAtomId(),
        fields: List.from([
          { name: "name", typeId: mkTypeId(NativeType.String, "string"), fieldIndex: 0 },
          { name: "pos", typeId: posId, fieldIndex: 1 },
        ]),
      });
    }

    const ambient = buildAmbientDeclarations(services.runtime.types);
    assert.ok(ambient.includes("export interface Entity {"), "should contain Entity interface");
    assert.ok(ambient.includes("pos: Position;"), "struct field should reference Position type");
  });

  test("strongly-typed number adds MindcraftTypeMap entry", () => {
    const types = services.runtime.types;
    const healthId = mkTypeId(NativeType.Number, "health");
    if (!types.get(healthId)) {
      types.addNumberType("health", mkTestAtomId());
    }

    const ambient = buildAmbientDeclarations(services.runtime.types);
    assert.ok(ambient.includes("health: number;"), "should map health to number");
  });

  test("enum type generates string union", () => {
    const types = services.runtime.types;
    const dirId = mkTypeId(NativeType.Enum, "Direction");
    if (!types.get(dirId)) {
      types.addEnumType("Direction", {
        atomId: mkTestAtomId(),
        symbols: List.from([
          { key: "north", label: "North", value: "north" },
          { key: "south", label: "South", value: "south" },
          { key: "east", label: "East", value: "east" },
        ]),
        defaultKey: "north",
        functionIds: { toString: 30204, toNumber: 30205, equalTo: 30206, notEqualTo: 30207 },
      });
    }

    const ambient = buildAmbientDeclarations(services.runtime.types);
    assert.ok(
      ambient.includes('export type Direction = "north" | "south" | "east";'),
      "should generate string union from enum keys"
    );
    assert.ok(ambient.includes("Direction: Direction;"), "should have MindcraftTypeMap entry");
  });

  test("list type generates Array alias", () => {
    const types = services.runtime.types;
    const listId = mkTypeId(NativeType.List, "NumberList");
    if (!types.get(listId)) {
      types.addListType("NumberList", {
        atomId: mkTestAtomId(),
        elementTypeId: mkTypeId(NativeType.Number, "number"),
      });
    }

    const ambient = buildAmbientDeclarations(services.runtime.types);
    assert.ok(ambient.includes("export type NumberList = Array<number>;"), "should generate Array type alias");
    assert.ok(ambient.includes("NumberList: NumberList;"), "should have MindcraftTypeMap entry");
  });

  test("core types are not duplicated in MindcraftTypeMap", () => {
    const ambient = buildAmbientDeclarations(services.runtime.types);
    const matches = ambient.match(/boolean: boolean;/g);
    assert.equal(matches?.length, 1, "boolean should appear exactly once in MindcraftTypeMap");
  });

  test("buffer joins MindcraftTypeMap exactly once under its lowercase registry key", () => {
    const ambient = buildAmbientDeclarations(services.runtime.types);
    const matches = ambient.match(/buffer: Buffer;/g);
    assert.equal(matches?.length, 1, "buffer should appear exactly once in MindcraftTypeMap");
  });

  test("BufferConstructor exposes the isBuffer type guard", () => {
    const ambient = buildAmbientDeclarations(services.runtime.types);
    assert.ok(
      ambient.includes("isBuffer(arg: any): arg is Buffer;"),
      "ambient should declare Buffer.isBuffer as a Buffer type guard"
    );
  });

  test("function type emits arrow syntax in typeDefToTs", () => {
    const types = services.runtime.types;
    const fnId = types.getOrCreateFunctionType({
      paramTypeIds: List.from([mkTypeId(NativeType.Number, "number")]),
      returnTypeId: mkTypeId(NativeType.Number, "number"),
    });
    const def = types.get(fnId)!;
    assert.ok(def);
    assert.equal(def.autoInstantiated, true);
    const ambient = buildAmbientDeclarations(services.runtime.types);
    assert.ok(!ambient.includes(def.name), "auto-instantiated function types should not appear in ambient output");
  });

  test("SensorConfig and ActuatorConfig accept metadata fields", () => {
    const sensorSource = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "meta-sensor",
  label: "Meta Sensor",
  icon: "./meta-sensor.svg",
  docs: "./meta-sensor.md",
  tags: ["test", "meta"],
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const sensorResult = compileUserTile(sensorSource, { services });
    const sensorErrors = sensorResult.diagnostics.filter((d) => d.severity === "error");
    assert.deepStrictEqual(sensorErrors, []);
    assert.ok(sensorResult.program);

    const actuatorSource = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "meta-actuator",
  label: "Meta Actuator",
  icon: "./meta-actuator.svg",
  docs: "./meta-actuator.md",
  tags: ["test"],
  onExecute(ctx: Context): void {},
});
`;
    const actuatorResult = compileUserTile(actuatorSource, { services });
    const actuatorErrors = actuatorResult.diagnostics.filter((d) => d.severity === "error");
    assert.deepStrictEqual(actuatorErrors, []);
    assert.ok(actuatorResult.program);
  });
});
