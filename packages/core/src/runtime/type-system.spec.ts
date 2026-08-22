import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List, type ReadonlyList } from "@wendoo-lang/core";
import type { BrainServices } from "@wendoo-lang/core/brain";
import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import {
  type BooleanValue,
  type BrainSyncFunctionEntry,
  CoreFuncId,
  CoreOpId,
  CoreTypeAtomId,
  CoreTypeIds,
  CoreTypeNames,
  type EnumSymbolDef,
  type EnumTypeDef,
  type ExecutionContext,
  type FunctionTypeDef,
  type ListTypeDef,
  type MapTypeDef,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NullableTypeDef,
  nativeTypeToString,
  type StructTypeDef,
  TARGET_TYPE_ATOM_BASE,
  type UnionTypeDef,
  type Value,
} from "@wendoo-lang/core/runtime";
import { __test__createPlatformServices } from "@wendoo-lang/core/runtime/__test__";

let services: BrainServices;

let nextTypeAtomId = 20000;

function mkTestAtomId(): number {
  return nextTypeAtomId++;
}

function ensureEnumType(name: string, symbols: List<EnumSymbolDef>, defaultKey?: string): string {
  const registry = services.runtime.types;
  const existing = registry.resolveByName(name);
  if (existing) {
    return existing;
  }
  return registry.addEnumType(name, { atomId: mkTestAtomId(), symbols, defaultKey });
}

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    services: __test__createPlatformServices(),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
    ...overrides,
  };
}

function mkBinaryArgs(
  left: { t: NativeType.Enum; typeId: string; v: string },
  right: { t: NativeType.Enum; typeId: string; v: string }
): ReadonlyList<Value> {
  return List.from([left as Value, right as Value]);
}

function callEnumEqualityOperator(opId: string, typeId: string, leftKey: string, rightKey: string): boolean {
  const resolution = services.edit.operatorOverloads.resolve(opId, [typeId, typeId]);
  assert.ok(resolution, `operator ${opId} for ${typeId} was not registered`);

  const entry = resolution.overload.fnEntry;
  assert.ok(entry, `operator ${opId} for ${typeId} must have a host function`);
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
    const anyDef = services.runtime.types.get(CoreTypeIds.Any);
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
    const anyDef = services.runtime.types.get(CoreTypeIds.Any);
    assert.ok(anyDef);
    assert.equal(anyDef.coreType, NativeType.Any);
    assert.equal(anyDef.name, CoreTypeNames.Any);
  });

  test("AnyList type is registered", () => {
    const anyListTypeId = services.runtime.types.resolveByName("AnyList");
    assert.ok(anyListTypeId);
    const def = services.runtime.types.get(anyListTypeId);
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

    const registry = services.runtime.types;
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

    const registry = services.runtime.types;
    const symbol = registry.getEnumSymbol(typeId, "Up");
    assert.ok(symbol);
    assert.equal(symbol.value, 0);

    const def = registry.get(typeId) as EnumTypeDef;
    assert.equal(def.codec.stringify("Up"), "0");
  });

  test("enum values are required", () => {
    const registry = services.runtime.types;
    const malformedSymbol = { key: "North", label: "North" } as EnumSymbolDef;

    assert.throws(() => {
      registry.addEnumType("TypeSystemSpecMissingEnumValue", {
        atomId: mkTestAtomId(),
        symbols: List.from([malformedSymbol]),
        defaultKey: "North",
      });
    }, /unsupported value/);
  });

  test("empty enums can be registered without defaultKey", () => {
    const typeId = ensureEnumType("TypeSystemSpecEmptyEnum", List.empty<EnumSymbolDef>());

    const registry = services.runtime.types;
    const def = registry.get(typeId) as EnumTypeDef;
    assert.equal(def.symbols.size(), 0);
    assert.equal(def.defaultKey, undefined);

    const resolution = services.edit.operatorOverloads.resolve(CoreOpId.EqualTo, [typeId, typeId]);
    assert.equal(resolution, undefined);
  });

  test("empty enums reject defaultKey", () => {
    const registry = services.runtime.types;

    assert.throws(() => {
      registry.addEnumType("TypeSystemSpecEmptyEnumWithDefault", {
        atomId: mkTestAtomId(),
        symbols: List.empty<EnumSymbolDef>(),
        defaultKey: "North",
      });
    }, /cannot specify defaultKey without symbols/);
  });

  test("non-empty enums require defaultKey", () => {
    const registry = services.runtime.types;

    assert.throws(() => {
      registry.addEnumType("TypeSystemSpecMissingDefaultKey", {
        atomId: mkTestAtomId(),
        symbols: List.from([{ key: "North", label: "North", value: "north" }]),
      });
    }, /requires defaultKey/);
  });

  test("heterogeneous enum values are rejected", () => {
    const registry = services.runtime.types;
    assert.throws(() => {
      registry.addEnumType("TypeSystemSpecHeterogeneousEnum", {
        atomId: mkTestAtomId(),
        symbols: List.from([
          { key: "Zero", label: "Zero", value: 0 },
          { key: "One", label: "One", value: "one" },
        ]),
        defaultKey: "Zero",
      });
    }, /mixes string and number values/);
  });

  test("enum equality is symbol identity: same key equal, distinct keys unequal", () => {
    const typeId = ensureEnumType(
      "TypeSystemSpecAliasNumericEnum",
      List.from([
        { key: "A", label: "A", value: 0 },
        { key: "B", label: "B", value: 0 },
      ]),
      "A"
    );

    assert.equal(callEnumEqualityOperator(CoreOpId.EqualTo, typeId, "A", "A"), true);
    assert.equal(callEnumEqualityOperator(CoreOpId.NotEqualTo, typeId, "A", "A"), false);
    assert.equal(callEnumEqualityOperator(CoreOpId.EqualTo, typeId, "A", "B"), false);
    assert.equal(callEnumEqualityOperator(CoreOpId.NotEqualTo, typeId, "A", "B"), true);
  });

  test("enum equality overloads reference the shared core enum funcIds", () => {
    const typeId = ensureEnumType(
      "TypeSystemSpecSharedFuncIdEnum",
      List.from([{ key: "Only", label: "Only", value: 0 }]),
      "Only"
    );

    const eq = services.edit.operatorOverloads.resolve(CoreOpId.EqualTo, [typeId, typeId]);
    const ne = services.edit.operatorOverloads.resolve(CoreOpId.NotEqualTo, [typeId, typeId]);
    assert.equal(eq?.overload.fnEntry?.id, CoreFuncId.OpEqualToEnum);
    assert.equal(ne?.overload.fnEntry?.id, CoreFuncId.OpNotEqualToEnum);
  });
});

describe("addNullableType", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("returns a TypeId like 'number:<number?>' with nullable: true", () => {
    const registry = services.runtime.types;
    const nullableId = registry.addNullableType(CoreTypeIds.Number);
    assert.equal(nullableId, "number:<number?>");
    const def = registry.get(nullableId);
    assert.ok(def);
    assert.equal(def.nullable, true);
    assert.equal(def.coreType, NativeType.Number);
    assert.equal((def as NullableTypeDef).baseTypeId, CoreTypeIds.Number);
  });

  test("calling addNullableType twice returns the same TypeId (idempotent)", () => {
    const registry = services.runtime.types;
    const first = registry.addNullableType(CoreTypeIds.String);
    const second = registry.addNullableType(CoreTypeIds.String);
    assert.equal(first, second);
  });

  test("throws if the base TypeId is not registered", () => {
    const registry = services.runtime.types;
    assert.throws(() => {
      registry.addNullableType("nonexistent:<fake>");
    });
  });

  test("addNullableType on an already-nullable type returns the input TypeId", () => {
    const registry = services.runtime.types;
    const nullableNumber = registry.addNullableType(CoreTypeIds.Number);
    const doubleNullable = registry.addNullableType(nullableNumber);
    assert.equal(doubleNullable, nullableNumber);
  });

  test("nullable boolean produces correct TypeId", () => {
    const registry = services.runtime.types;
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
    const registry = services.runtime.types;
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
    const registry = services.runtime.types;
    const listTypeId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    assert.ok(listTypeId);
    const mapTypeId = registry.instantiate("Map", List.from([CoreTypeIds.String, CoreTypeIds.Number]));
    assert.ok(mapTypeId);
  });

  test("duplicate constructor registration throws", () => {
    const registry = services.runtime.types;
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
    const registry = services.runtime.types;
    const typeId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    assert.ok(typeId);
    const def = registry.get(typeId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.List);
    assert.equal((def as ListTypeDef).elementTypeId, CoreTypeIds.Number);
  });

  test("calling instantiate twice returns the same TypeId (memoized)", () => {
    const registry = services.runtime.types;
    const first = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    const second = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    assert.equal(first, second);
  });

  test("instantiate('List', [CoreTypeIds.String]) returns a different TypeId from number", () => {
    const registry = services.runtime.types;
    const numList = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    const strList = registry.instantiate("List", List.from([CoreTypeIds.String]));
    assert.notEqual(numList, strList);
  });

  test("instantiate('Map', [CoreTypeIds.String, CoreTypeIds.Number]) works", () => {
    const registry = services.runtime.types;
    const typeId = registry.instantiate("Map", List.from([CoreTypeIds.String, CoreTypeIds.Number]));
    assert.ok(typeId);
    const def = registry.get(typeId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.Map);
    assert.equal((def as MapTypeDef).keyTypeId, CoreTypeIds.String);
    assert.equal((def as MapTypeDef).valueTypeId, CoreTypeIds.Number);
  });

  test("instantiate with unknown constructor name throws", () => {
    const registry = services.runtime.types;
    assert.throws(() => {
      registry.instantiate("Unknown", List.from([CoreTypeIds.Number]));
    });
  });

  test("instantiate with wrong arity throws", () => {
    const registry = services.runtime.types;
    assert.throws(() => {
      registry.instantiate("List", List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    });
  });

  test("existing addListType still works alongside constructors", () => {
    const registry = services.runtime.types;
    const explicitId = registry.resolveByName("AnyList");
    assert.ok(explicitId);
    const instantiatedId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    assert.notEqual(explicitId, instantiatedId);
  });

  test("TypeDef from instantiated type has autoInstantiated flag", () => {
    const registry = services.runtime.types;
    const typeId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    const def = registry.get(typeId);
    assert.ok(def);
    assert.equal(def.autoInstantiated, true);
  });

  test("nested instantiation works (List<List<number>>)", () => {
    const registry = services.runtime.types;
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
    const registry = services.runtime.types;
    const unionId = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    assert.ok(unionId);
    const def = registry.get(unionId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.Union);
  });

  test("reversed order returns the same TypeId (order-independent)", () => {
    const registry = services.runtime.types;
    const id1 = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const id2 = registry.getOrCreateUnionType(List.from([CoreTypeIds.String, CoreTypeIds.Number]));
    assert.equal(id1, id2);
  });

  test("nested union flattening works", () => {
    const registry = services.runtime.types;
    const innerUnion = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const outerUnion = registry.getOrCreateUnionType(List.from([innerUnion, CoreTypeIds.Boolean]));
    const def = registry.get(outerUnion) as UnionTypeDef;
    assert.ok(def);
    assert.equal(def.memberTypeIds.size(), 3);
  });

  test("single-member collapse returns the member TypeId directly", () => {
    const registry = services.runtime.types;
    const result = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number]));
    assert.equal(result, CoreTypeIds.Number);
  });

  test("nullable subsumption: [Number, Nil] returns addNullableType result", () => {
    const registry = services.runtime.types;
    const unionResult = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.Nil]));
    const nullableResult = registry.addNullableType(CoreTypeIds.Number);
    assert.equal(unionResult, nullableResult);
  });

  test("throws for zero members", () => {
    const registry = services.runtime.types;
    assert.throws(() => {
      registry.getOrCreateUnionType(List.from([]));
    });
  });

  test("throws for unregistered member TypeId", () => {
    const registry = services.runtime.types;
    assert.throws(() => {
      registry.getOrCreateUnionType(List.from(["fake:<fake>"]));
    });
  });

  test("deduplicates identical members", () => {
    const registry = services.runtime.types;
    const result = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.Number]));
    assert.equal(result, CoreTypeIds.Number);
  });

  test("memberTypeIds on def are sorted and deduplicated", () => {
    const registry = services.runtime.types;
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
    const registry = services.runtime.types;
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
    const registry = services.runtime.types;
    const unionId = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const def = registry.get(unionId)!;
    assert.equal(def.codec.stringify(42), "42");
    assert.equal(def.codec.stringify("hello"), "hello");
  });

  test("autoInstantiated flag is set on union types", () => {
    const registry = services.runtime.types;
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
    const registry = services.runtime.types;
    const shape = { paramTypeIds: List.from([CoreTypeIds.Number]), returnTypeId: CoreTypeIds.Number };
    const id1 = registry.getOrCreateFunctionType(shape);
    const id2 = registry.getOrCreateFunctionType(shape);
    assert.equal(id1, id2);
  });

  test("different signatures produce different TypeIds", () => {
    const registry = services.runtime.types;
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
    const registry = services.runtime.types;
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
    const registry = services.runtime.types;
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
    const registry = services.runtime.types;
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

describe("struct field optional flag", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("addStructType preserves the optional flag on the stored field def", () => {
    const registry = services.runtime.types;
    const typeId = registry.addStructType("OptsA", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "loud", typeId: CoreTypeIds.Boolean, fieldIndex: 0 },
        { name: "immediately", typeId: CoreTypeIds.Boolean, fieldIndex: 1, optional: true },
      ]),
    });
    const def = registry.get(typeId) as StructTypeDef;
    assert.equal(def.fields.get(0)!.optional, undefined, "a plain field carries no optional flag");
    assert.equal(def.fields.get(1)!.optional, true, "the optional field carries optional: true");
  });

  test("optional coexists with readOnly on the same field", () => {
    const registry = services.runtime.types;
    const typeId = registry.addStructType("OptsB", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "tag", typeId: CoreTypeIds.String, fieldIndex: 0, readOnly: true, optional: true }]),
    });
    const def = registry.get(typeId) as StructTypeDef;
    assert.equal(def.fields.get(0)!.readOnly, true);
    assert.equal(def.fields.get(0)!.optional, true);
  });

  test("addStructFields carries the optional flag on extension fields", () => {
    const registry = services.runtime.types;
    const typeId = registry.addStructType("OptsC", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "base", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
    });
    registry.addStructFields(
      typeId,
      List.from([{ name: "extra", typeId: CoreTypeIds.Number, fieldIndex: 1, optional: true }])
    );
    const def = registry.get(typeId) as StructTypeDef;
    assert.equal(def.fields.get(1)!.name, "extra");
    assert.equal(def.fields.get(1)!.optional, true);
  });

  test("finalizeStructType carries the optional flag", () => {
    const registry = services.runtime.types;
    const typeId = registry.reserveStructType("OptsD");
    registry.finalizeStructType(typeId, {
      fields: List.from([
        { name: "a", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "b", typeId: CoreTypeIds.Number, fieldIndex: 1, optional: true },
      ]),
    });
    const def = registry.get(typeId) as StructTypeDef;
    assert.equal(def.fields.get(1)!.optional, true);
  });
});

describe("isStructurallyCompatible", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("same TypeId is always compatible", () => {
    const registry = services.runtime.types;
    const typeA = registry.addStructType("IdenticalA", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "y", typeId: CoreTypeIds.Number, fieldIndex: 1 },
      ]),
    });
    const typeB = registry.addStructType("IdenticalB", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "y", typeId: CoreTypeIds.Number, fieldIndex: 1 },
      ]),
    });
    assert.equal(registry.isStructurallyCompatible(typeA, typeB), true);
    assert.equal(registry.isStructurallyCompatible(typeB, typeA), true);
  });

  test("struct with extra fields is compatible with struct with fewer fields", () => {
    const registry = services.runtime.types;
    const point2D = registry.addStructType("Point2D", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "y", typeId: CoreTypeIds.Number, fieldIndex: 1 },
      ]),
    });
    const point3D = registry.addStructType("Point3D", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "y", typeId: CoreTypeIds.Number, fieldIndex: 1 },
        { name: "z", typeId: CoreTypeIds.Number, fieldIndex: 2 },
      ]),
    });
    assert.equal(registry.isStructurallyCompatible(point3D, point2D), true);
    assert.equal(registry.isStructurallyCompatible(point2D, point3D), false);
  });

  test("struct missing a required field is NOT compatible", () => {
    const registry = services.runtime.types;
    const withName = registry.addStructType("WithName", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "name", typeId: CoreTypeIds.String, fieldIndex: 0 },
        { name: "age", typeId: CoreTypeIds.Number, fieldIndex: 1 },
      ]),
    });
    const withoutName = registry.addStructType("WithoutName", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "age", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
    });
    assert.equal(registry.isStructurallyCompatible(withoutName, withName), false);
  });

  test("nominal struct is NOT compatible with any other struct", () => {
    const registry = services.runtime.types;
    const screenCoord = registry.addStructType("ScreenCoord", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "y", typeId: CoreTypeIds.Number, fieldIndex: 1 },
      ]),
      nominal: true,
    });
    const worldCoord = registry.addStructType("WorldCoord", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "y", typeId: CoreTypeIds.Number, fieldIndex: 1 },
      ]),
      nominal: true,
    });
    const plainCoord = registry.addStructType("PlainCoord", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "y", typeId: CoreTypeIds.Number, fieldIndex: 1 },
      ]),
    });
    assert.equal(registry.isStructurallyCompatible(screenCoord, worldCoord), false);
    assert.equal(registry.isStructurallyCompatible(worldCoord, screenCoord), false);
    assert.equal(registry.isStructurallyCompatible(plainCoord, screenCoord), false);
    assert.equal(registry.isStructurallyCompatible(screenCoord, plainCoord), false);
  });

  test("recursive compatibility for nested struct fields", () => {
    const registry = services.runtime.types;
    const innerA = registry.addStructType("InnerA", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "val", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "label", typeId: CoreTypeIds.String, fieldIndex: 1 },
      ]),
    });
    const innerB = registry.addStructType("InnerB", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "val", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "label", typeId: CoreTypeIds.String, fieldIndex: 1 },
      ]),
    });
    const outerA = registry.addStructType("OuterA", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "inner", typeId: innerA, fieldIndex: 0 }]),
    });
    const outerB = registry.addStructType("OuterB", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "inner", typeId: innerB, fieldIndex: 0 }]),
    });
    assert.equal(registry.isStructurallyCompatible(outerA, outerB), true);
  });

  test("recursive incompatibility for nested struct fields with different types", () => {
    const registry = services.runtime.types;
    const innerC = registry.addStructType("InnerC", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "val", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
    });
    const innerD = registry.addStructType("InnerD", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "val", typeId: CoreTypeIds.String, fieldIndex: 0 }]),
    });
    const outerC = registry.addStructType("OuterC", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "inner", typeId: innerC, fieldIndex: 0 }]),
    });
    const outerD = registry.addStructType("OuterD", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "inner", typeId: innerD, fieldIndex: 0 }]),
    });
    assert.equal(registry.isStructurallyCompatible(outerC, outerD), false);
  });

  test("non-struct types return false", () => {
    const registry = services.runtime.types;
    assert.equal(registry.isStructurallyCompatible(CoreTypeIds.Number, CoreTypeIds.String), false);
    assert.equal(registry.isStructurallyCompatible(CoreTypeIds.Number, CoreTypeIds.Number), true);
  });

  test("unknown type IDs return false", () => {
    const registry = services.runtime.types;
    assert.equal(registry.isStructurallyCompatible("nonexistent:a", "nonexistent:b"), false);
  });
});

describe("removeUserTypes", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("removes enum types with module-qualified names and clears derived artifacts", () => {
    const registry = services.runtime.types;
    const typeId = registry.withOwner("dynamic", () =>
      registry.addEnumType("/user-enum.ts::TrafficLight", {
        symbols: List.from([
          { key: "stop", label: "Stop", value: 0 },
          { key: "go", label: "Go", value: 1 },
        ]),
        defaultKey: "stop",
      })
    );

    assert.ok(registry.get(typeId));
    assert.ok(registry.resolveByName("/user-enum.ts::TrafficLight"));
    assert.ok(services.shared.conversions.get(typeId, CoreTypeIds.String));
    assert.ok(services.shared.conversions.get(typeId, CoreTypeIds.Number));
    assert.ok(services.edit.operatorOverloads.resolve(CoreOpId.EqualTo, [typeId, typeId]));
    assert.ok(services.edit.operatorOverloads.resolve(CoreOpId.NotEqualTo, [typeId, typeId]));

    registry.removeUserTypes();

    assert.equal(registry.get(typeId), undefined);
    assert.equal(registry.resolveByName("/user-enum.ts::TrafficLight"), undefined);
    assert.equal(services.shared.conversions.get(typeId, CoreTypeIds.String), undefined);
    assert.equal(services.shared.conversions.get(typeId, CoreTypeIds.Number), undefined);
    assert.equal(services.edit.operatorOverloads.resolve(CoreOpId.EqualTo, [typeId, typeId]), undefined);
    assert.equal(services.edit.operatorOverloads.resolve(CoreOpId.NotEqualTo, [typeId, typeId]), undefined);
  });

  test("removes struct types with module-qualified names", () => {
    const registry = services.runtime.types;
    const typeId = registry.withOwner("dynamic", () =>
      registry.addStructType("/user-code.ts::UserClass", {
        fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
      })
    );
    assert.ok(registry.get(typeId));
    assert.ok(registry.resolveByName("/user-code.ts::UserClass"));

    registry.removeUserTypes();

    assert.equal(registry.get(typeId), undefined);
    assert.equal(registry.resolveByName("/user-code.ts::UserClass"), undefined);
  });

  test("preserves struct types with bare names (no ::)", () => {
    const registry = services.runtime.types;
    const hostId = registry.addStructType("AppVector2RM", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
    });
    assert.ok(registry.get(hostId));

    registry.removeUserTypes();

    assert.ok(registry.get(hostId));
    assert.ok(registry.resolveByName("AppVector2RM"));
  });

  test("preserves enum types with bare names (no ::)", () => {
    const registry = services.runtime.types;
    const hostId = registry.addEnumType("HostStatusRM", {
      atomId: mkTestAtomId(),
      symbols: List.from([
        { key: "ready", label: "Ready", value: "ready" },
        { key: "busy", label: "Busy", value: "busy" },
      ]),
      defaultKey: "ready",
    });

    registry.removeUserTypes();

    assert.ok(registry.get(hostId));
    assert.ok(registry.resolveByName("HostStatusRM"));
    assert.ok(services.shared.conversions.get(hostId, CoreTypeIds.String));
    assert.ok(services.edit.operatorOverloads.resolve(CoreOpId.EqualTo, [hostId, hostId]));
  });

  test("does not remove non-struct types", () => {
    const registry = services.runtime.types;
    assert.ok(registry.get(CoreTypeIds.Number));
    assert.ok(registry.get(CoreTypeIds.String));
    assert.ok(registry.get(CoreTypeIds.Boolean));

    registry.removeUserTypes();

    assert.ok(registry.get(CoreTypeIds.Number));
    assert.ok(registry.get(CoreTypeIds.String));
    assert.ok(registry.get(CoreTypeIds.Boolean));
  });

  test("a namespace argument removes only that project's types", () => {
    const registry = services.runtime.types;
    const projectA = registry.withOwner("dynamic", () =>
      registry.addStructType("project-a:/main.ts::Vec", {
        fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
      })
    );
    const projectB = registry.withOwner("dynamic", () =>
      registry.addStructType("project-b:/main.ts::Vec", {
        fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
      })
    );

    registry.removeUserTypes("project-a");

    assert.equal(registry.get(projectA), undefined);
    assert.equal(registry.resolveByName("project-a:/main.ts::Vec"), undefined);
    assert.ok(registry.get(projectB));
    assert.equal(registry.resolveByName("project-b:/main.ts::Vec"), projectB);

    registry.removeUserTypes("project-b");
    assert.equal(registry.get(projectB), undefined);
  });

  test("an alias resolves to the aliased type and follows it through removal", () => {
    const registry = services.runtime.types;
    const typeId = registry.withOwner("dynamic", () =>
      registry.addStructType("project-c:/main.ts::Vec", {
        fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
      })
    );

    registry.addTypeNameAlias("project-c::Vec", typeId);
    assert.equal(registry.resolveByName("project-c::Vec"), typeId);
    assert.equal(registry.resolveByName("project-c:/main.ts::Vec"), typeId, "the private name keeps resolving");

    registry.removeUserTypes("project-c");
    assert.equal(registry.resolveByName("project-c::Vec"), undefined, "the alias is dropped with its target");
    assert.equal(registry.resolveByName("project-c:/main.ts::Vec"), undefined);
  });

  test("an alias to another project's type survives removing an unrelated namespace", () => {
    const registry = services.runtime.types;
    const typeId = registry.withOwner("dynamic", () =>
      registry.addStructType("project-d:/main.ts::Vec", {
        fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
      })
    );
    const otherId = registry.withOwner("dynamic", () =>
      registry.addStructType("project-e:/main.ts::Vec", {
        fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
      })
    );
    registry.addTypeNameAlias("project-d::Vec", typeId);

    registry.removeUserTypes("project-e");

    assert.equal(registry.get(otherId), undefined);
    assert.equal(registry.resolveByName("project-d::Vec"), typeId);

    registry.removeUserTypes("project-d");
    assert.equal(registry.resolveByName("project-d::Vec"), undefined);
  });

  test("a namespace argument clears that project's enum artifacts and no other's", () => {
    const registry = services.runtime.types;
    const mkEnum = (name: string) =>
      registry.withOwner("dynamic", () =>
        registry.addEnumType(name, {
          symbols: List.from([
            { key: "on", label: "On", value: 0 },
            { key: "off", label: "Off", value: 1 },
          ]),
          defaultKey: "on",
        })
      );
    const enumA = mkEnum("project-a:/mode.ts::Mode");
    const enumB = mkEnum("project-b:/mode.ts::Mode");

    registry.removeUserTypes("project-a");

    assert.equal(services.shared.conversions.get(enumA, CoreTypeIds.String), undefined);
    assert.equal(services.edit.operatorOverloads.resolve(CoreOpId.EqualTo, [enumA, enumA]), undefined);
    assert.ok(services.shared.conversions.get(enumB, CoreTypeIds.String));
    assert.ok(services.edit.operatorOverloads.resolve(CoreOpId.EqualTo, [enumB, enumB]));
  });

  test("a namespace argument removes derived structural names referencing that namespace", () => {
    const registry = services.runtime.types;
    const base = registry.withOwner("dynamic", () =>
      registry.addStructType("project-a:/main.ts::Inner", {
        fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
      })
    );
    const derivedName = `{p:${base}}`;
    const derived = registry.withOwner("dynamic", () =>
      registry.addStructType(derivedName, {
        fields: List.from([{ name: "p", typeId: base, fieldIndex: 0 }]),
      })
    );

    registry.removeUserTypes("project-a");

    assert.equal(registry.get(base), undefined);
    assert.equal(registry.get(derived), undefined);
    assert.equal(registry.resolveByName(derivedName), undefined);
  });
});

describe("StructTypeDef.fields[i].fieldIndex", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("addStructType stores author-assigned fieldIndex", () => {
    const registry = services.runtime.types;
    const typeId = registry.addStructType("FieldIndexA", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "y", typeId: CoreTypeIds.Number, fieldIndex: 1 },
        { name: "label", typeId: CoreTypeIds.String, fieldIndex: 2 },
      ]),
    });
    const def = registry.get(typeId) as StructTypeDef;
    assert.equal(def.fields.size(), 3);
    for (let i = 0; i < def.fields.size(); i++) {
      assert.equal(def.fields.get(i).fieldIndex, i, `field ${i} fieldIndex mismatch`);
    }
    assert.equal(def.fieldIndexByName.get("x"), 0);
    assert.equal(def.fieldIndexByName.get("y"), 1);
    assert.equal(def.fieldIndexByName.get("label"), 2);
  });

  test("finalizeStructType stores author-assigned fieldIndex on the reserved type", () => {
    const registry = services.runtime.types;
    const typeId = registry.reserveStructType("FieldIndexB");
    registry.finalizeStructType(typeId, {
      fields: List.from([
        { name: "a", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "b", typeId: CoreTypeIds.String, fieldIndex: 1 },
      ]),
    });
    const def = registry.get(typeId) as StructTypeDef;
    for (let i = 0; i < def.fields.size(); i++) {
      assert.equal(def.fields.get(i).fieldIndex, i);
    }
    assert.equal(def.fieldIndexByName.get("a"), 0);
    assert.equal(def.fieldIndexByName.get("b"), 1);
  });

  test("addStructFields stores author-assigned fieldIndex extending the struct", () => {
    const registry = services.runtime.types;
    const typeId = registry.addStructType("FieldIndexC", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "first", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
    });
    registry.addStructFields(
      typeId,
      List.from([
        { name: "second", typeId: CoreTypeIds.Number, fieldIndex: 1 },
        { name: "third", typeId: CoreTypeIds.String, fieldIndex: 2 },
      ])
    );
    const def = registry.get(typeId) as StructTypeDef;
    assert.equal(def.fields.size(), 3);
    for (let i = 0; i < def.fields.size(); i++) {
      assert.equal(def.fields.get(i).fieldIndex, i);
    }
    assert.equal(def.fields.get(0).name, "first");
    assert.equal(def.fields.get(1).name, "second");
    assert.equal(def.fields.get(2).name, "third");
    assert.equal(def.fieldIndexByName.get("first"), 0);
    assert.equal(def.fieldIndexByName.get("second"), 1);
    assert.equal(def.fieldIndexByName.get("third"), 2);
  });

  test("forEach iteration order matches fieldIndex", () => {
    const registry = services.runtime.types;
    const typeId = registry.addStructType("FieldIndexD", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "alpha", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "beta", typeId: CoreTypeIds.Number, fieldIndex: 1 },
        { name: "gamma", typeId: CoreTypeIds.Number, fieldIndex: 2 },
      ]),
    });
    const def = registry.get(typeId) as StructTypeDef;
    let expected = 0;
    def.fields.forEach((field, i) => {
      assert.equal(i, expected);
      assert.equal(field.fieldIndex, expected);
      expected++;
    });
    assert.equal(expected, 3);
  });

  test("rejects a duplicate fieldIndex within a struct", () => {
    const registry = services.runtime.types;
    assert.throws(() =>
      registry.addStructType("DupFieldId", {
        atomId: mkTestAtomId(),
        fields: List.from([
          { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
          { name: "y", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        ]),
      })
    );
  });

  test("rejects a negative fieldIndex", () => {
    const registry = services.runtime.types;
    assert.throws(() =>
      registry.addStructType("NegFieldId", {
        atomId: mkTestAtomId(),
        fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: -1 }]),
      })
    );
  });

  test("rejects addStructFields whose fieldIndex collides with an existing field", () => {
    const registry = services.runtime.types;
    const typeId = registry.addStructType("CollideFieldId", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "first", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
    });
    assert.throws(() =>
      registry.addStructFields(typeId, List.from([{ name: "second", typeId: CoreTypeIds.Number, fieldIndex: 0 }]))
    );
  });

  test("allows a sparse fieldIndex (a retired field leaves a hole)", () => {
    const registry = services.runtime.types;
    const typeId = registry.addStructType("SparseFieldId", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "first", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "third", typeId: CoreTypeIds.Number, fieldIndex: 2 },
      ]),
    });
    const def = registry.get(typeId) as StructTypeDef;
    assert.equal(def.fieldIndexByName.get("first"), 0);
    assert.equal(def.fieldIndexByName.get("third"), 2);
  });
});

describe("type-atom ids", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("core types register under their declared atom ids", () => {
    const registry = services.runtime.types;
    assert.equal(registry.resolveByAtomId(CoreTypeAtomId.Number), CoreTypeIds.Number);
    assert.equal(registry.resolveByAtomId(CoreTypeAtomId.String), CoreTypeIds.String);
    assert.equal(registry.get(CoreTypeIds.Boolean)?.atomId, CoreTypeAtomId.Boolean);
  });

  test("resolveByAtomId returns undefined for an unassigned atom id", () => {
    const registry = services.runtime.types;
    assert.equal(registry.resolveByAtomId(999), undefined);
  });

  test("a target registration without an atomId is rejected", () => {
    const registry = services.runtime.types;
    assert.throws(() => registry.addStructType("AtomMissing", { fields: List.empty() }), /requires an atomId/);
  });

  test("a core registration without an atomId is rejected", () => {
    const registry = services.runtime.types;
    assert.throws(
      () => registry.withOwner("core", () => registry.addStructType("AtomMissingCore", { fields: List.empty() })),
      /requires an atomId/
    );
  });

  test("a dynamic registration with an atomId is rejected", () => {
    const registry = services.runtime.types;
    assert.throws(
      () =>
        registry.withOwner("dynamic", () =>
          registry.addStructType("/user.ts::AtomForbidden", { atomId: mkTestAtomId(), fields: List.empty() })
        ),
      /must not declare an atomId/
    );
  });

  test("a dynamic registration without an atomId succeeds", () => {
    const registry = services.runtime.types;
    const typeId = registry.withOwner("dynamic", () =>
      registry.addStructType("/user.ts::AtomFree", { fields: List.empty() })
    );
    assert.equal(registry.get(typeId)?.atomId, undefined);
  });

  test("a duplicate atomId is rejected", () => {
    const registry = services.runtime.types;
    const atomId = mkTestAtomId();
    registry.addStructType("AtomFirst", { atomId, fields: List.empty() });
    assert.throws(() => registry.addStructType("AtomSecond", { atomId, fields: List.empty() }), /reuses atomId/);
  });

  test("a negative atomId is rejected", () => {
    const registry = services.runtime.types;
    assert.throws(
      () => registry.addStructType("AtomNegative", { atomId: -1, fields: List.empty() }),
      /non-negative integer/
    );
  });

  test("a non-integer atomId is rejected", () => {
    const registry = services.runtime.types;
    assert.throws(
      () => registry.addStructType("AtomFractional", { atomId: 1024.5, fields: List.empty() }),
      /non-negative integer/
    );
  });

  test("a core atomId at or above TARGET_TYPE_ATOM_BASE is rejected", () => {
    const registry = services.runtime.types;
    assert.throws(
      () =>
        registry.withOwner("core", () =>
          registry.addStructType("AtomCoreHigh", { atomId: TARGET_TYPE_ATOM_BASE, fields: List.empty() })
        ),
      /outside the core range/
    );
  });

  test("a target atomId below TARGET_TYPE_ATOM_BASE is rejected", () => {
    const registry = services.runtime.types;
    assert.throws(
      () => registry.addStructType("AtomTargetLow", { atomId: 512, fields: List.empty() }),
      /below the target range base/
    );
  });

  test("withOwner restores the previous owner after the body returns", () => {
    const registry = services.runtime.types;
    registry.withOwner("dynamic", () => {
      registry.addStructType("/user.ts::AtomNested", { fields: List.empty() });
    });
    // Back under the default target owner, an atom-less registration throws again.
    assert.throws(() => registry.addStructType("AtomAfterNesting", { fields: List.empty() }), /requires an atomId/);
  });

  test("reserveStructType registers a program-local struct without an atomId", () => {
    const registry = services.runtime.types;
    const typeId = registry.reserveStructType("/user.ts::AtomReserved");
    registry.finalizeStructType(typeId, { fields: List.empty() });
    assert.equal(registry.get(typeId)?.atomId, undefined);
  });

  test("finalizeStructType rejects a shape carrying an atomId", () => {
    const registry = services.runtime.types;
    const typeId = registry.reserveStructType("/user.ts::AtomFinalize");
    assert.throws(
      () => registry.finalizeStructType(typeId, { atomId: mkTestAtomId(), fields: List.empty() }),
      /must not declare an atomId/
    );
  });

  test("an enum registers its atomId alongside its symbols", () => {
    const registry = services.runtime.types;
    const atomId = mkTestAtomId();
    const typeId = registry.addEnumType("AtomEnum", {
      atomId,
      symbols: List.from([
        { key: "a", label: "A", value: "a" },
        { key: "b", label: "B", value: "b" },
      ]),
      defaultKey: "a",
    });
    assert.equal(registry.get(typeId)?.atomId, atomId);
    assert.equal(registry.resolveByAtomId(atomId), typeId);
  });
});
