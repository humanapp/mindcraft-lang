import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List } from "@mindcraft-lang/core";
import {
  type BooleanValue,
  type BrainServices,
  type BrainSyncFunctionEntry,
  CoreOpId,
  CoreTypeIds,
  CoreTypeNames,
  type EnumSymbolDef,
  type EnumTypeDef,
  type ExecutionContext,
  type FunctionTypeDef,
  type ListTypeDef,
  type MapTypeDef,
  type MapValue,
  mkTypeId,
  NativeType,
  type NullableTypeDef,
  nativeTypeToString,
  type StructTypeDef,
  type UnionTypeDef,
  ValueDict,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";

let services: BrainServices;

function ensureEnumType(name: string, symbols: List<EnumSymbolDef>, defaultKey?: string): string {
  const registry = services.types;
  const existing = registry.resolveByName(name);
  if (existing) {
    return existing;
  }
  return registry.addEnumType(name, { symbols, defaultKey });
}

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

function mkBinaryArgs(
  left: { t: NativeType.Enum; typeId: string; v: string },
  right: { t: NativeType.Enum; typeId: string; v: string }
): MapValue {
  const values = new ValueDict();
  values.set(0, left);
  values.set(1, right);
  return { t: NativeType.Map, typeId: "", v: values };
}

function callEnumEqualityOperator(opId: string, typeId: string, leftKey: string, rightKey: string): boolean {
  const resolution = services.operatorOverloads.resolve(opId, [typeId, typeId]);
  assert.ok(resolution, `operator ${opId} for ${typeId} was not registered`);

  const entry = resolution.overload.fnEntry;
  assert.equal(entry.isAsync, false);

  const result = (entry as BrainSyncFunctionEntry).fn.exec(
    mkCtx(),
    mkBinaryArgs({ t: NativeType.Enum, typeId, v: leftKey }, { t: NativeType.Enum, typeId, v: rightKey })
  );

  assert.equal(result.t, NativeType.Boolean);
  return (result as BooleanValue).v;
}

describe("NativeType.Any", () => {
  test("NativeType.Any has value 9", () => {
    assert.equal(NativeType.Any, 9);
  });

  test("nativeTypeToString returns 'any' for NativeType.Any", () => {
    assert.equal(nativeTypeToString(NativeType.Any), "any");
  });

  test("CoreTypeNames.Any is 'any'", () => {
    assert.equal(CoreTypeNames.Any, "any");
  });

  test("CoreTypeIds.Any matches expected format", () => {
    assert.equal(CoreTypeIds.Any, "any:<any>");
  });
});

describe("AnyCodec", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("stringify produces correct output for each type", () => {
    const anyDef = services.types.get(CoreTypeIds.Any);
    assert.ok(anyDef);
    assert.equal(anyDef.codec.stringify(undefined), "nil");
    assert.equal(anyDef.codec.stringify(true), "true");
    assert.equal(anyDef.codec.stringify(false), "false");
    assert.equal(anyDef.codec.stringify(42), "42");
    assert.equal(anyDef.codec.stringify("hello"), "hello");
  });
});

describe("registerCoreTypes registers Any and AnyList", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("Any type is registered", () => {
    const anyDef = services.types.get(CoreTypeIds.Any);
    assert.ok(anyDef);
    assert.equal(anyDef.coreType, NativeType.Any);
    assert.equal(anyDef.name, CoreTypeNames.Any);
  });

  test("AnyList type is registered", () => {
    const anyListTypeId = services.types.resolveByName("AnyList");
    assert.ok(anyListTypeId);
    const def = services.types.get(anyListTypeId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.List);
    assert.equal(def.typeId, mkTypeId(NativeType.List, "AnyList"));
  });
});

describe("enum type registration", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("string enum preserves explicit underlying values", () => {
    const typeId = ensureEnumType(
      "TypeSystemSpecStringEnum",
      List.from([
        { key: "On", label: "On", value: "on" },
        { key: "Off", label: "Off", value: "off" },
      ]),
      "On"
    );

    const registry = services.types;
    const symbol = registry.getEnumSymbol(typeId, "On");
    assert.ok(symbol);
    assert.equal(symbol.value, "on");

    const def = registry.get(typeId) as EnumTypeDef;
    assert.equal(def.codec.stringify("On"), "on");
  });

  test("numeric enum preserves explicit underlying values", () => {
    const typeId = ensureEnumType(
      "TypeSystemSpecNumericEnum",
      List.from([
        { key: "Up", label: "Up", value: 0 },
        { key: "Down", label: "Down", value: 1 },
      ]),
      "Up"
    );

    const registry = services.types;
    const symbol = registry.getEnumSymbol(typeId, "Up");
    assert.ok(symbol);
    assert.equal(symbol.value, 0);

    const def = registry.get(typeId) as EnumTypeDef;
    assert.equal(def.codec.stringify("Up"), "0");
  });

  test("enum values are required", () => {
    const registry = services.types;
    const malformedSymbol = { key: "North", label: "North" } as EnumSymbolDef;

    assert.throws(() => {
      registry.addEnumType("TypeSystemSpecMissingEnumValue", {
        symbols: List.from([malformedSymbol]),
        defaultKey: "North",
      });
    }, /unsupported value/);
  });

  test("empty enums can be registered without defaultKey", () => {
    const typeId = ensureEnumType("TypeSystemSpecEmptyEnum", List.empty<EnumSymbolDef>());

    const registry = services.types;
    const def = registry.get(typeId) as EnumTypeDef;
    assert.equal(def.symbols.size(), 0);
    assert.equal(def.defaultKey, undefined);

    const resolution = services.operatorOverloads.resolve(CoreOpId.EqualTo, [typeId, typeId]);
    assert.equal(resolution, undefined);
  });

  test("empty enums reject defaultKey", () => {
    const registry = services.types;

    assert.throws(() => {
      registry.addEnumType("TypeSystemSpecEmptyEnumWithDefault", {
        symbols: List.empty<EnumSymbolDef>(),
        defaultKey: "North",
      });
    }, /cannot specify defaultKey without symbols/);
  });

  test("non-empty enums require defaultKey", () => {
    const registry = services.types;

    assert.throws(() => {
      registry.addEnumType("TypeSystemSpecMissingDefaultKey", {
        symbols: List.from([{ key: "North", label: "North", value: "north" }]),
      });
    }, /requires defaultKey/);
  });

  test("heterogeneous enum values are rejected", () => {
    const registry = services.types;
    assert.throws(() => {
      registry.addEnumType("TypeSystemSpecHeterogeneousEnum", {
        symbols: List.from([
          { key: "Zero", label: "Zero", value: 0 },
          { key: "One", label: "One", value: "one" },
        ]),
        defaultKey: "Zero",
      });
    }, /mixes string and number values/);
  });

  test("duplicate numeric values are allowed and compare equal", () => {
    const typeId = ensureEnumType(
      "TypeSystemSpecAliasNumericEnum",
      List.from([
        { key: "A", label: "A", value: 0 },
        { key: "B", label: "B", value: 0 },
      ]),
      "A"
    );

    assert.equal(callEnumEqualityOperator(CoreOpId.EqualTo, typeId, "A", "B"), true);
    assert.equal(callEnumEqualityOperator(CoreOpId.NotEqualTo, typeId, "A", "B"), false);
  });
});

describe("addNullableType", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("returns a TypeId like 'number:<number?>' with nullable: true", () => {
    const registry = services.types;
    const nullableId = registry.addNullableType(CoreTypeIds.Number);
    assert.equal(nullableId, "number:<number?>");
    const def = registry.get(nullableId);
    assert.ok(def);
    assert.equal(def.nullable, true);
    assert.equal(def.coreType, NativeType.Number);
    assert.equal((def as NullableTypeDef).baseTypeId, CoreTypeIds.Number);
  });

  test("calling addNullableType twice returns the same TypeId (idempotent)", () => {
    const registry = services.types;
    const first = registry.addNullableType(CoreTypeIds.String);
    const second = registry.addNullableType(CoreTypeIds.String);
    assert.equal(first, second);
  });

  test("throws if the base TypeId is not registered", () => {
    const registry = services.types;
    assert.throws(() => {
      registry.addNullableType("nonexistent:<fake>");
    });
  });

  test("addNullableType on an already-nullable type returns the input TypeId", () => {
    const registry = services.types;
    const nullableNumber = registry.addNullableType(CoreTypeIds.Number);
    const doubleNullable = registry.addNullableType(nullableNumber);
    assert.equal(doubleNullable, nullableNumber);
  });

  test("nullable boolean produces correct TypeId", () => {
    const registry = services.types;
    const nullableBool = registry.addNullableType(CoreTypeIds.Boolean);
    assert.equal(nullableBool, "boolean:<boolean?>");
    const def = registry.get(nullableBool);
    assert.ok(def);
    assert.equal(def.nullable, true);
  });
});

describe("NullableCodec", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("stringify returns 'nil' for nil, delegates for non-nil", () => {
    const registry = services.types;
    const nullableId = registry.addNullableType(CoreTypeIds.Number);
    const def = registry.get(nullableId)!;
    assert.equal(def.codec.stringify(undefined), "nil");
    assert.equal(def.codec.stringify(42), "42");
  });
});

describe("registerConstructor", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("List and Map constructors are registered after registerCoreTypes", () => {
    const registry = services.types;
    const listTypeId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    assert.ok(listTypeId);
    const mapTypeId = registry.instantiate("Map", List.from([CoreTypeIds.Number]));
    assert.ok(mapTypeId);
  });

  test("duplicate constructor registration throws", () => {
    const registry = services.types;
    assert.throws(() => {
      registry.registerConstructor({
        name: "List",
        arity: 1,
        coreType: NativeType.List,
        construct: () => ({}) as never,
      });
    });
  });
});

describe("instantiate", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("instantiate('List', [CoreTypeIds.Number]) returns a valid TypeId", () => {
    const registry = services.types;
    const typeId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    assert.ok(typeId);
    const def = registry.get(typeId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.List);
    assert.equal((def as ListTypeDef).elementTypeId, CoreTypeIds.Number);
  });

  test("calling instantiate twice returns the same TypeId (memoized)", () => {
    const registry = services.types;
    const first = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    const second = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    assert.equal(first, second);
  });

  test("instantiate('List', [CoreTypeIds.String]) returns a different TypeId from number", () => {
    const registry = services.types;
    const numList = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    const strList = registry.instantiate("List", List.from([CoreTypeIds.String]));
    assert.notEqual(numList, strList);
  });

  test("instantiate('Map', [CoreTypeIds.Number]) works", () => {
    const registry = services.types;
    const typeId = registry.instantiate("Map", List.from([CoreTypeIds.Number]));
    assert.ok(typeId);
    const def = registry.get(typeId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.Map);
    assert.equal((def as MapTypeDef).valueTypeId, CoreTypeIds.Number);
  });

  test("instantiate with unknown constructor name throws", () => {
    const registry = services.types;
    assert.throws(() => {
      registry.instantiate("Unknown", List.from([CoreTypeIds.Number]));
    });
  });

  test("instantiate with wrong arity throws", () => {
    const registry = services.types;
    assert.throws(() => {
      registry.instantiate("List", List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    });
  });

  test("existing addListType still works alongside constructors", () => {
    const registry = services.types;
    const explicitId = registry.resolveByName("AnyList");
    assert.ok(explicitId);
    const instantiatedId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    assert.notEqual(explicitId, instantiatedId);
  });

  test("TypeDef from instantiated type has autoInstantiated flag", () => {
    const registry = services.types;
    const typeId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    const def = registry.get(typeId);
    assert.ok(def);
    assert.equal(def.autoInstantiated, true);
  });

  test("nested instantiation works (List<List<number>>)", () => {
    const registry = services.types;
    const innerTypeId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    const outerTypeId = registry.instantiate("List", List.from([innerTypeId]));
    assert.ok(outerTypeId);
    const def = registry.get(outerTypeId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.List);
    assert.equal((def as ListTypeDef).elementTypeId, innerTypeId);
  });
});

describe("NativeType.Union", () => {
  test("NativeType.Union has value 10", () => {
    assert.equal(NativeType.Union, 10);
  });

  test("nativeTypeToString returns 'union' for NativeType.Union", () => {
    assert.equal(nativeTypeToString(NativeType.Union), "union");
  });
});

describe("getOrCreateUnionType", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("returns a stable TypeId with coreType Union", () => {
    const registry = services.types;
    const unionId = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    assert.ok(unionId);
    const def = registry.get(unionId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.Union);
  });

  test("reversed order returns the same TypeId (order-independent)", () => {
    const registry = services.types;
    const id1 = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const id2 = registry.getOrCreateUnionType(List.from([CoreTypeIds.String, CoreTypeIds.Number]));
    assert.equal(id1, id2);
  });

  test("nested union flattening works", () => {
    const registry = services.types;
    const innerUnion = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const outerUnion = registry.getOrCreateUnionType(List.from([innerUnion, CoreTypeIds.Boolean]));
    const def = registry.get(outerUnion) as UnionTypeDef;
    assert.ok(def);
    assert.equal(def.memberTypeIds.size(), 3);
  });

  test("single-member collapse returns the member TypeId directly", () => {
    const registry = services.types;
    const result = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number]));
    assert.equal(result, CoreTypeIds.Number);
  });

  test("nullable subsumption: [Number, Nil] returns addNullableType result", () => {
    const registry = services.types;
    const unionResult = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.Nil]));
    const nullableResult = registry.addNullableType(CoreTypeIds.Number);
    assert.equal(unionResult, nullableResult);
  });

  test("throws for zero members", () => {
    const registry = services.types;
    assert.throws(() => {
      registry.getOrCreateUnionType(List.from([]));
    });
  });

  test("throws for unregistered member TypeId", () => {
    const registry = services.types;
    assert.throws(() => {
      registry.getOrCreateUnionType(List.from(["fake:<fake>"]));
    });
  });

  test("deduplicates identical members", () => {
    const registry = services.types;
    const result = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.Number]));
    assert.equal(result, CoreTypeIds.Number);
  });

  test("memberTypeIds on def are sorted and deduplicated", () => {
    const registry = services.types;
    const unionId = registry.getOrCreateUnionType(
      List.from([CoreTypeIds.String, CoreTypeIds.Boolean, CoreTypeIds.Number])
    );
    const def = registry.get(unionId) as UnionTypeDef;
    assert.ok(def);
    const ids: string[] = [];
    def.memberTypeIds.forEach((id) => {
      ids.push(id);
    });
    const sorted = [...ids].sort();
    assert.deepEqual(ids, sorted);
  });

  test("flattens nullable members into [base, Nil]", () => {
    const registry = services.types;
    const nullableNum = registry.addNullableType(CoreTypeIds.Number);
    const unionId = registry.getOrCreateUnionType(List.from([nullableNum, CoreTypeIds.String]));
    const def = registry.get(unionId) as UnionTypeDef;
    assert.ok(def);
    const ids: string[] = [];
    def.memberTypeIds.forEach((id) => {
      ids.push(id);
    });
    assert.ok(ids.includes(CoreTypeIds.Number));
    assert.ok(ids.includes(CoreTypeIds.String));
    assert.ok(ids.includes(CoreTypeIds.Nil));
  });
});

describe("UnionCodec", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("stringify delegates to the correct member codec", () => {
    const registry = services.types;
    const unionId = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const def = registry.get(unionId)!;
    assert.equal(def.codec.stringify(42), "42");
    assert.equal(def.codec.stringify("hello"), "hello");
  });

  test("autoInstantiated flag is set on union types", () => {
    const registry = services.types;
    const unionId = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const def = registry.get(unionId)!;
    assert.equal(def.autoInstantiated, true);
  });
});

describe("getOrCreateFunctionType", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("returns a stable TypeId for the same signature", () => {
    const registry = services.types;
    const shape = { paramTypeIds: List.from([CoreTypeIds.Number]), returnTypeId: CoreTypeIds.Number };
    const id1 = registry.getOrCreateFunctionType(shape);
    const id2 = registry.getOrCreateFunctionType(shape);
    assert.equal(id1, id2);
  });

  test("different signatures produce different TypeIds", () => {
    const registry = services.types;
    const id1 = registry.getOrCreateFunctionType({
      paramTypeIds: List.from([CoreTypeIds.Number]),
      returnTypeId: CoreTypeIds.Number,
    });
    const id2 = registry.getOrCreateFunctionType({
      paramTypeIds: List.from([CoreTypeIds.String]),
      returnTypeId: CoreTypeIds.Boolean,
    });
    assert.notEqual(id1, id2);
  });

  test("def has coreType Function and autoInstantiated flag", () => {
    const registry = services.types;
    const id = registry.getOrCreateFunctionType({
      paramTypeIds: List.from([CoreTypeIds.Number, CoreTypeIds.String]),
      returnTypeId: CoreTypeIds.Boolean,
    });
    const def = registry.get(id)!;
    assert.ok(def);
    assert.equal(def.coreType, NativeType.Function);
    assert.equal(def.autoInstantiated, true);
  });

  test("def carries paramTypeIds and returnTypeId", () => {
    const registry = services.types;
    const id = registry.getOrCreateFunctionType({
      paramTypeIds: List.from([CoreTypeIds.Number]),
      returnTypeId: CoreTypeIds.String,
    });
    const def = registry.get(id) as FunctionTypeDef;
    assert.ok(def);
    assert.equal(def.paramTypeIds.size(), 1);
    assert.equal(def.paramTypeIds.get(0), CoreTypeIds.Number);
    assert.equal(def.returnTypeId, CoreTypeIds.String);
  });

  test("zero-parameter function type works", () => {
    const registry = services.types;
    const id = registry.getOrCreateFunctionType({
      paramTypeIds: List.from([]),
      returnTypeId: CoreTypeIds.Number,
    });
    const def = registry.get(id) as FunctionTypeDef;
    assert.ok(def);
    assert.equal(def.paramTypeIds.size(), 0);
    assert.equal(def.returnTypeId, CoreTypeIds.Number);
  });
});

describe("isStructurallyCompatible", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("same TypeId is always compatible", () => {
    const registry = services.types;
    const typeA = registry.addStructType("IdenticalA", {
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number },
        { name: "y", typeId: CoreTypeIds.Number },
      ]),
    });
    const typeB = registry.addStructType("IdenticalB", {
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number },
        { name: "y", typeId: CoreTypeIds.Number },
      ]),
    });
    assert.equal(registry.isStructurallyCompatible(typeA, typeB), true);
    assert.equal(registry.isStructurallyCompatible(typeB, typeA), true);
  });

  test("struct with extra fields is compatible with struct with fewer fields", () => {
    const registry = services.types;
    const point2D = registry.addStructType("Point2D", {
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number },
        { name: "y", typeId: CoreTypeIds.Number },
      ]),
    });
    const point3D = registry.addStructType("Point3D", {
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number },
        { name: "y", typeId: CoreTypeIds.Number },
        { name: "z", typeId: CoreTypeIds.Number },
      ]),
    });
    assert.equal(registry.isStructurallyCompatible(point3D, point2D), true);
    assert.equal(registry.isStructurallyCompatible(point2D, point3D), false);
  });

  test("struct missing a required field is NOT compatible", () => {
    const registry = services.types;
    const withName = registry.addStructType("WithName", {
      fields: List.from([
        { name: "name", typeId: CoreTypeIds.String },
        { name: "age", typeId: CoreTypeIds.Number },
      ]),
    });
    const withoutName = registry.addStructType("WithoutName", {
      fields: List.from([{ name: "age", typeId: CoreTypeIds.Number }]),
    });
    assert.equal(registry.isStructurallyCompatible(withoutName, withName), false);
  });

  test("nominal struct is NOT compatible with any other struct", () => {
    const registry = services.types;
    const screenCoord = registry.addStructType("ScreenCoord", {
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number },
        { name: "y", typeId: CoreTypeIds.Number },
      ]),
      nominal: true,
    });
    const worldCoord = registry.addStructType("WorldCoord", {
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number },
        { name: "y", typeId: CoreTypeIds.Number },
      ]),
      nominal: true,
    });
    const plainCoord = registry.addStructType("PlainCoord", {
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number },
        { name: "y", typeId: CoreTypeIds.Number },
      ]),
    });
    assert.equal(registry.isStructurallyCompatible(screenCoord, worldCoord), false);
    assert.equal(registry.isStructurallyCompatible(worldCoord, screenCoord), false);
    assert.equal(registry.isStructurallyCompatible(plainCoord, screenCoord), false);
    assert.equal(registry.isStructurallyCompatible(screenCoord, plainCoord), false);
  });

  test("recursive compatibility for nested struct fields", () => {
    const registry = services.types;
    const innerA = registry.addStructType("InnerA", {
      fields: List.from([
        { name: "val", typeId: CoreTypeIds.Number },
        { name: "label", typeId: CoreTypeIds.String },
      ]),
    });
    const innerB = registry.addStructType("InnerB", {
      fields: List.from([
        { name: "val", typeId: CoreTypeIds.Number },
        { name: "label", typeId: CoreTypeIds.String },
      ]),
    });
    const outerA = registry.addStructType("OuterA", {
      fields: List.from([{ name: "inner", typeId: innerA }]),
    });
    const outerB = registry.addStructType("OuterB", {
      fields: List.from([{ name: "inner", typeId: innerB }]),
    });
    assert.equal(registry.isStructurallyCompatible(outerA, outerB), true);
  });

  test("recursive incompatibility for nested struct fields with different types", () => {
    const registry = services.types;
    const innerC = registry.addStructType("InnerC", {
      fields: List.from([{ name: "val", typeId: CoreTypeIds.Number }]),
    });
    const innerD = registry.addStructType("InnerD", {
      fields: List.from([{ name: "val", typeId: CoreTypeIds.String }]),
    });
    const outerC = registry.addStructType("OuterC", {
      fields: List.from([{ name: "inner", typeId: innerC }]),
    });
    const outerD = registry.addStructType("OuterD", {
      fields: List.from([{ name: "inner", typeId: innerD }]),
    });
    assert.equal(registry.isStructurallyCompatible(outerC, outerD), false);
  });

  test("non-struct types return false", () => {
    const registry = services.types;
    assert.equal(registry.isStructurallyCompatible(CoreTypeIds.Number, CoreTypeIds.String), false);
    assert.equal(registry.isStructurallyCompatible(CoreTypeIds.Number, CoreTypeIds.Number), true);
  });

  test("unknown type IDs return false", () => {
    const registry = services.types;
    assert.equal(registry.isStructurallyCompatible("nonexistent:a", "nonexistent:b"), false);
  });
});

describe("removeUserTypes", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("removes enum types with module-qualified names and clears derived artifacts", () => {
    const registry = services.types;
    const typeId = registry.addEnumType("/user-enum.ts::TrafficLight", {
      symbols: List.from([
        { key: "stop", label: "Stop", value: 0 },
        { key: "go", label: "Go", value: 1 },
      ]),
      defaultKey: "stop",
    });

    assert.ok(registry.get(typeId));
    assert.ok(registry.resolveByName("/user-enum.ts::TrafficLight"));
    assert.ok(services.conversions.get(typeId, CoreTypeIds.String));
    assert.ok(services.conversions.get(typeId, CoreTypeIds.Number));
    assert.ok(services.operatorOverloads.resolve(CoreOpId.EqualTo, [typeId, typeId]));
    assert.ok(services.operatorOverloads.resolve(CoreOpId.NotEqualTo, [typeId, typeId]));

    registry.removeUserTypes();

    assert.equal(registry.get(typeId), undefined);
    assert.equal(registry.resolveByName("/user-enum.ts::TrafficLight"), undefined);
    assert.equal(services.conversions.get(typeId, CoreTypeIds.String), undefined);
    assert.equal(services.conversions.get(typeId, CoreTypeIds.Number), undefined);
    assert.equal(services.operatorOverloads.resolve(CoreOpId.EqualTo, [typeId, typeId]), undefined);
    assert.equal(services.operatorOverloads.resolve(CoreOpId.NotEqualTo, [typeId, typeId]), undefined);
  });

  test("removes struct types with module-qualified names (contains ::)", () => {
    const registry = services.types;
    const typeId = registry.addStructType("/user-code.ts::UserClass", {
      fields: List.from([{ name: "x", typeId: CoreTypeIds.Number }]),
    });
    assert.ok(registry.get(typeId));
    assert.ok(registry.resolveByName("/user-code.ts::UserClass"));

    registry.removeUserTypes();

    assert.equal(registry.get(typeId), undefined);
    assert.equal(registry.resolveByName("/user-code.ts::UserClass"), undefined);
  });

  test("preserves struct types with bare names (no ::)", () => {
    const registry = services.types;
    const hostId = registry.addStructType("AppVector2RM", {
      fields: List.from([{ name: "x", typeId: CoreTypeIds.Number }]),
    });
    assert.ok(registry.get(hostId));

    registry.removeUserTypes();

    assert.ok(registry.get(hostId));
    assert.ok(registry.resolveByName("AppVector2RM"));
  });

  test("preserves enum types with bare names (no ::)", () => {
    const registry = services.types;
    const hostId = registry.addEnumType("HostStatusRM", {
      symbols: List.from([
        { key: "ready", label: "Ready", value: "ready" },
        { key: "busy", label: "Busy", value: "busy" },
      ]),
      defaultKey: "ready",
    });

    registry.removeUserTypes();

    assert.ok(registry.get(hostId));
    assert.ok(registry.resolveByName("HostStatusRM"));
    assert.ok(services.conversions.get(hostId, CoreTypeIds.String));
    assert.ok(services.operatorOverloads.resolve(CoreOpId.EqualTo, [hostId, hostId]));
  });

  test("does not remove non-struct types", () => {
    const registry = services.types;
    assert.ok(registry.get(CoreTypeIds.Number));
    assert.ok(registry.get(CoreTypeIds.String));
    assert.ok(registry.get(CoreTypeIds.Boolean));

    registry.removeUserTypes();

    assert.ok(registry.get(CoreTypeIds.Number));
    assert.ok(registry.get(CoreTypeIds.String));
    assert.ok(registry.get(CoreTypeIds.Boolean));
  });
});
