import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import { getBrainServices, mkTypeId, NativeType, registerCoreBrainComponents } from "@mindcraft-lang/core/brain";
import { buildAmbientDeclarations } from "./ambient.js";
import { compileUserTile, initCompiler } from "./compile.js";

describe("buildAmbientDeclarations", () => {
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
  });

  test("generates plain interface for user-creatable struct", () => {
    const types = getBrainServices().types;
    const vecId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vecId)) {
      types.addStructType("Vector2", {
        fields: List.from([
          { name: "x", typeId: mkTypeId(NativeType.Number, "number") },
          { name: "y", typeId: mkTypeId(NativeType.Number, "number") },
        ]),
      });
    }

    const ambient = buildAmbientDeclarations();
    assert.ok(ambient.includes("export interface Vector2 {"), "should contain Vector2 interface");
    assert.ok(ambient.includes("x: number;"), "should contain x field");
    assert.ok(ambient.includes("y: number;"), "should contain y field");
    assert.ok(!ambient.includes("readonly __brand"), "user-creatable struct should not have brand");
    assert.ok(ambient.includes("Vector2: Vector2;"), "should have MindcraftTypeMap entry");
  });

  test("generates branded interface for native-backed struct", () => {
    const types = getBrainServices().types;
    const actorRefId = mkTypeId(NativeType.Struct, "ActorRef");
    if (!types.get(actorRefId)) {
      types.addStructType("ActorRef", {
        fields: List.from([
          { name: "id", typeId: mkTypeId(NativeType.Number, "number") },
          { name: "energy pct", typeId: mkTypeId(NativeType.Number, "number") },
        ]),
        fieldGetter: () => undefined,
      });
    }

    const ambient = buildAmbientDeclarations();
    assert.ok(ambient.includes("export interface ActorRef {"), "should contain ActorRef interface");
    assert.ok(ambient.includes("readonly __brand: unique symbol;"), "native-backed should have brand");
    assert.ok(ambient.includes("readonly id: number;"), "fields should be readonly");
    assert.ok(ambient.includes('readonly "energy pct": number;'), "spaced field name should be quoted");
    assert.ok(ambient.includes("ActorRef: ActorRef;"), "should have MindcraftTypeMap entry");
  });

  test("branded struct prevents object literal assignment (TS type error)", () => {
    const ambient = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type ActorRef } from "mindcraft";

export default Sensor({
  name: "test-brand",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const a: ActorRef = { id: 1, "energy pct": 0.5 };
    return true;
  },
});
`;
    const result = compileUserTile(source, { ambientSource: ambient });
    assert.ok(result.diagnostics.length > 0, "should have diagnostics due to brand mismatch");
  });

  test("native-backed struct param compiles to LOAD_LOCAL/STORE_LOCAL", () => {
    const ambient = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type ActorRef } from "mindcraft";

export default Sensor({
  name: "test-param-assign",
  output: "number",
  params: {
    target: { type: "ActorRef" },
  },
  onExecute(ctx: Context, params: { target: ActorRef }): number {
    let t: ActorRef = params.target;
    return 1;
  },
});
`;
    const result = compileUserTile(source, { ambientSource: ambient });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");
  });

  test("struct fields referencing other struct types resolve correctly", () => {
    const types = getBrainServices().types;
    const posId = mkTypeId(NativeType.Struct, "Position");
    if (!types.get(posId)) {
      types.addStructType("Position", {
        fields: List.from([
          { name: "x", typeId: mkTypeId(NativeType.Number, "number") },
          { name: "y", typeId: mkTypeId(NativeType.Number, "number") },
        ]),
      });
    }
    const entityId = mkTypeId(NativeType.Struct, "Entity");
    if (!types.get(entityId)) {
      types.addStructType("Entity", {
        fields: List.from([
          { name: "name", typeId: mkTypeId(NativeType.String, "string") },
          { name: "pos", typeId: posId },
        ]),
      });
    }

    const ambient = buildAmbientDeclarations();
    assert.ok(ambient.includes("export interface Entity {"), "should contain Entity interface");
    assert.ok(ambient.includes("pos: Position;"), "struct field should reference Position type");
  });

  test("strongly-typed number adds MindcraftTypeMap entry", () => {
    const types = getBrainServices().types;
    const healthId = mkTypeId(NativeType.Number, "health");
    if (!types.get(healthId)) {
      types.addNumberType("health");
    }

    const ambient = buildAmbientDeclarations();
    assert.ok(ambient.includes("health: number;"), "should map health to number");
  });

  test("enum type generates string union", () => {
    const types = getBrainServices().types;
    const dirId = mkTypeId(NativeType.Enum, "Direction");
    if (!types.get(dirId)) {
      types.addEnumType("Direction", {
        symbols: List.from([
          { key: "north", label: "North" },
          { key: "south", label: "South" },
          { key: "east", label: "East" },
        ]),
        defaultKey: "north",
      });
    }

    const ambient = buildAmbientDeclarations();
    assert.ok(
      ambient.includes('export type Direction = "north" | "south" | "east";'),
      "should generate string union from enum keys"
    );
    assert.ok(ambient.includes("Direction: Direction;"), "should have MindcraftTypeMap entry");
  });

  test("list type generates Array alias", () => {
    const types = getBrainServices().types;
    const listId = mkTypeId(NativeType.List, "NumberList");
    if (!types.get(listId)) {
      types.addListType("NumberList", {
        elementTypeId: mkTypeId(NativeType.Number, "number"),
      });
    }

    const ambient = buildAmbientDeclarations();
    assert.ok(ambient.includes("export type NumberList = Array<number>;"), "should generate Array type alias");
    assert.ok(ambient.includes("NumberList: NumberList;"), "should have MindcraftTypeMap entry");
  });

  test("core types are not duplicated in MindcraftTypeMap", () => {
    const ambient = buildAmbientDeclarations();
    const matches = ambient.match(/boolean: boolean;/g);
    assert.equal(matches?.length, 1, "boolean should appear exactly once in MindcraftTypeMap");
  });

  test("function type emits arrow syntax in typeDefToTs", () => {
    const types = getBrainServices().types;
    const fnId = types.getOrCreateFunctionType({
      paramTypeIds: List.from([mkTypeId(NativeType.Number, "number")]),
      returnTypeId: mkTypeId(NativeType.Number, "number"),
    });
    const def = types.get(fnId)!;
    assert.ok(def);
    assert.equal(def.autoInstantiated, true);
    const ambient = buildAmbientDeclarations();
    assert.ok(!ambient.includes(def.name), "auto-instantiated function types should not appear in ambient output");
  });
});
