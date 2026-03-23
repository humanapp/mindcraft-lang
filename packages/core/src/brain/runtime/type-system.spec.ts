import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List, stream } from "@mindcraft-lang/core";
import {
  CoreTypeIds,
  CoreTypeNames,
  type FunctionTypeDef,
  getBrainServices,
  type ListTypeDef,
  type MapTypeDef,
  mkTypeId,
  NativeType,
  type NullableTypeDef,
  nativeTypeToString,
  registerCoreBrainComponents,
  type UnionTypeDef,
} from "@mindcraft-lang/core/brain";

const { MemoryStream } = stream;

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
    registerCoreBrainComponents();
  });

  test("round-trips nil through encode/decode", () => {
    const anyDef = getBrainServices().types.get(CoreTypeIds.Any);
    assert.ok(anyDef);
    const s = new MemoryStream();
    anyDef.codec.encode(s, undefined);
    s.resetRead();
    const decoded = anyDef.codec.decode(s);
    assert.equal(decoded, undefined);
  });

  test("round-trips boolean through encode/decode", () => {
    const anyDef = getBrainServices().types.get(CoreTypeIds.Any);
    assert.ok(anyDef);
    const s = new MemoryStream();
    anyDef.codec.encode(s, true);
    s.resetRead();
    const decoded = anyDef.codec.decode(s);
    assert.equal(decoded, true);
  });

  test("round-trips number through encode/decode", () => {
    const anyDef = getBrainServices().types.get(CoreTypeIds.Any);
    assert.ok(anyDef);
    const s = new MemoryStream();
    anyDef.codec.encode(s, 42.5);
    s.resetRead();
    const decoded = anyDef.codec.decode(s);
    assert.equal(decoded, 42.5);
  });

  test("round-trips string through encode/decode", () => {
    const anyDef = getBrainServices().types.get(CoreTypeIds.Any);
    assert.ok(anyDef);
    const s = new MemoryStream();
    anyDef.codec.encode(s, "hello");
    s.resetRead();
    const decoded = anyDef.codec.decode(s);
    assert.equal(decoded, "hello");
  });

  test("stringify produces correct output for each type", () => {
    const anyDef = getBrainServices().types.get(CoreTypeIds.Any);
    assert.ok(anyDef);
    assert.equal(anyDef.codec.stringify(undefined), "nil");
    assert.equal(anyDef.codec.stringify(true), "true");
    assert.equal(anyDef.codec.stringify(false), "false");
    assert.equal(anyDef.codec.stringify(42), "42");
    assert.equal(anyDef.codec.stringify("hello"), "hello");
  });

  test("encode throws for unsupported types", () => {
    const anyDef = getBrainServices().types.get(CoreTypeIds.Any);
    assert.ok(anyDef);
    const s = new MemoryStream();
    assert.throws(() => {
      anyDef.codec.encode(s, { some: "object" });
    });
  });
});

describe("registerCoreTypes registers Any and AnyList", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("Any type is registered", () => {
    const anyDef = getBrainServices().types.get(CoreTypeIds.Any);
    assert.ok(anyDef);
    assert.equal(anyDef.coreType, NativeType.Any);
    assert.equal(anyDef.name, CoreTypeNames.Any);
  });

  test("AnyList type is registered", () => {
    const anyListTypeId = getBrainServices().types.resolveByName("AnyList");
    assert.ok(anyListTypeId);
    const def = getBrainServices().types.get(anyListTypeId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.List);
    assert.equal(def.typeId, mkTypeId(NativeType.List, "AnyList"));
  });
});

describe("addNullableType", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("returns a TypeId like 'number:<number?>' with nullable: true", () => {
    const registry = getBrainServices().types;
    const nullableId = registry.addNullableType(CoreTypeIds.Number);
    assert.equal(nullableId, "number:<number?>");
    const def = registry.get(nullableId);
    assert.ok(def);
    assert.equal(def.nullable, true);
    assert.equal(def.coreType, NativeType.Number);
    assert.equal((def as NullableTypeDef).baseTypeId, CoreTypeIds.Number);
  });

  test("calling addNullableType twice returns the same TypeId (idempotent)", () => {
    const registry = getBrainServices().types;
    const first = registry.addNullableType(CoreTypeIds.String);
    const second = registry.addNullableType(CoreTypeIds.String);
    assert.equal(first, second);
  });

  test("throws if the base TypeId is not registered", () => {
    const registry = getBrainServices().types;
    assert.throws(() => {
      registry.addNullableType("nonexistent:<fake>");
    });
  });

  test("addNullableType on an already-nullable type returns the input TypeId", () => {
    const registry = getBrainServices().types;
    const nullableNumber = registry.addNullableType(CoreTypeIds.Number);
    const doubleNullable = registry.addNullableType(nullableNumber);
    assert.equal(doubleNullable, nullableNumber);
  });

  test("nullable boolean produces correct TypeId", () => {
    const registry = getBrainServices().types;
    const nullableBool = registry.addNullableType(CoreTypeIds.Boolean);
    assert.equal(nullableBool, "boolean:<boolean?>");
    const def = registry.get(nullableBool);
    assert.ok(def);
    assert.equal(def.nullable, true);
  });
});

describe("NullableCodec", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("round-trips a non-nil number value", () => {
    const registry = getBrainServices().types;
    const nullableId = registry.addNullableType(CoreTypeIds.Number);
    const def = registry.get(nullableId)!;
    const s = new MemoryStream();
    def.codec.encode(s, 42.5);
    s.resetRead();
    const decoded = def.codec.decode(s);
    assert.equal(decoded, 42.5);
  });

  test("round-trips a nil value (writes 0, reads back undefined)", () => {
    const registry = getBrainServices().types;
    const nullableId = registry.addNullableType(CoreTypeIds.Number);
    const def = registry.get(nullableId)!;
    const s = new MemoryStream();
    def.codec.encode(s, undefined);
    s.resetRead();
    const decoded = def.codec.decode(s);
    assert.equal(decoded, undefined);
  });

  test("stringify returns 'nil' for nil, delegates for non-nil", () => {
    const registry = getBrainServices().types;
    const nullableId = registry.addNullableType(CoreTypeIds.Number);
    const def = registry.get(nullableId)!;
    assert.equal(def.codec.stringify(undefined), "nil");
    assert.equal(def.codec.stringify(42), "42");
  });

  test("round-trips a non-nil string value", () => {
    const registry = getBrainServices().types;
    const nullableId = registry.addNullableType(CoreTypeIds.String);
    const def = registry.get(nullableId)!;
    const s = new MemoryStream();
    def.codec.encode(s, "hello");
    s.resetRead();
    const decoded = def.codec.decode(s);
    assert.equal(decoded, "hello");
  });

  test("encode writes 1-byte flag 0 for nil and 1 for present", () => {
    const registry = getBrainServices().types;
    const nullableId = registry.addNullableType(CoreTypeIds.Boolean);
    const def = registry.get(nullableId)!;

    const sNil = new MemoryStream();
    def.codec.encode(sNil, undefined);
    sNil.resetRead();
    assert.equal(sNil.readU8(), 0);

    const sPresent = new MemoryStream();
    def.codec.encode(sPresent, true);
    sPresent.resetRead();
    assert.equal(sPresent.readU8(), 1);
  });
});

describe("registerConstructor", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("List and Map constructors are registered after registerCoreTypes", () => {
    const registry = getBrainServices().types;
    const listTypeId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    assert.ok(listTypeId);
    const mapTypeId = registry.instantiate("Map", List.from([CoreTypeIds.Number]));
    assert.ok(mapTypeId);
  });

  test("duplicate constructor registration throws", () => {
    const registry = getBrainServices().types;
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
    registerCoreBrainComponents();
  });

  test("instantiate('List', [CoreTypeIds.Number]) returns a valid TypeId", () => {
    const registry = getBrainServices().types;
    const typeId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    assert.ok(typeId);
    const def = registry.get(typeId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.List);
    assert.equal((def as ListTypeDef).elementTypeId, CoreTypeIds.Number);
  });

  test("calling instantiate twice returns the same TypeId (memoized)", () => {
    const registry = getBrainServices().types;
    const first = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    const second = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    assert.equal(first, second);
  });

  test("instantiate('List', [CoreTypeIds.String]) returns a different TypeId from number", () => {
    const registry = getBrainServices().types;
    const numList = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    const strList = registry.instantiate("List", List.from([CoreTypeIds.String]));
    assert.notEqual(numList, strList);
  });

  test("instantiate('Map', [CoreTypeIds.Number]) works", () => {
    const registry = getBrainServices().types;
    const typeId = registry.instantiate("Map", List.from([CoreTypeIds.Number]));
    assert.ok(typeId);
    const def = registry.get(typeId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.Map);
    assert.equal((def as MapTypeDef).valueTypeId, CoreTypeIds.Number);
  });

  test("instantiate with unknown constructor name throws", () => {
    const registry = getBrainServices().types;
    assert.throws(() => {
      registry.instantiate("Unknown", List.from([CoreTypeIds.Number]));
    });
  });

  test("instantiate with wrong arity throws", () => {
    const registry = getBrainServices().types;
    assert.throws(() => {
      registry.instantiate("List", List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    });
  });

  test("existing addListType still works alongside constructors", () => {
    const registry = getBrainServices().types;
    const explicitId = registry.resolveByName("AnyList");
    assert.ok(explicitId);
    const instantiatedId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    assert.notEqual(explicitId, instantiatedId);
  });

  test("TypeDef from instantiated type has autoInstantiated flag", () => {
    const registry = getBrainServices().types;
    const typeId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    const def = registry.get(typeId);
    assert.ok(def);
    assert.equal(def.autoInstantiated, true);
  });

  test("ListCodec from instantiated type round-trips values", () => {
    const registry = getBrainServices().types;
    const typeId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    const def = registry.get(typeId)!;
    const s = new MemoryStream();
    const values = List.from([42, 7, 13]);
    def.codec.encode(s, values);
    s.resetRead();
    const decoded = def.codec.decode(s) as List<number>;
    assert.equal(decoded.size(), 3);
    assert.equal(decoded.get(0), 42);
    assert.equal(decoded.get(1), 7);
    assert.equal(decoded.get(2), 13);
  });

  test("nested instantiation works (List<List<number>>)", () => {
    const registry = getBrainServices().types;
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
    registerCoreBrainComponents();
  });

  test("returns a stable TypeId with coreType Union", () => {
    const registry = getBrainServices().types;
    const unionId = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    assert.ok(unionId);
    const def = registry.get(unionId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.Union);
  });

  test("reversed order returns the same TypeId (order-independent)", () => {
    const registry = getBrainServices().types;
    const id1 = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const id2 = registry.getOrCreateUnionType(List.from([CoreTypeIds.String, CoreTypeIds.Number]));
    assert.equal(id1, id2);
  });

  test("nested union flattening works", () => {
    const registry = getBrainServices().types;
    const innerUnion = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const outerUnion = registry.getOrCreateUnionType(List.from([innerUnion, CoreTypeIds.Boolean]));
    const def = registry.get(outerUnion) as UnionTypeDef;
    assert.ok(def);
    assert.equal(def.memberTypeIds.size(), 3);
  });

  test("single-member collapse returns the member TypeId directly", () => {
    const registry = getBrainServices().types;
    const result = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number]));
    assert.equal(result, CoreTypeIds.Number);
  });

  test("nullable subsumption: [Number, Nil] returns addNullableType result", () => {
    const registry = getBrainServices().types;
    const unionResult = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.Nil]));
    const nullableResult = registry.addNullableType(CoreTypeIds.Number);
    assert.equal(unionResult, nullableResult);
  });

  test("throws for zero members", () => {
    const registry = getBrainServices().types;
    assert.throws(() => {
      registry.getOrCreateUnionType(List.from([]));
    });
  });

  test("throws for unregistered member TypeId", () => {
    const registry = getBrainServices().types;
    assert.throws(() => {
      registry.getOrCreateUnionType(List.from(["fake:<fake>"]));
    });
  });

  test("deduplicates identical members", () => {
    const registry = getBrainServices().types;
    const result = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.Number]));
    assert.equal(result, CoreTypeIds.Number);
  });

  test("memberTypeIds on def are sorted and deduplicated", () => {
    const registry = getBrainServices().types;
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
    const registry = getBrainServices().types;
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
    registerCoreBrainComponents();
  });

  test("round-trips a number value through number | string union", () => {
    const registry = getBrainServices().types;
    const unionId = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const def = registry.get(unionId)!;
    const s = new MemoryStream();
    def.codec.encode(s, 42.5);
    s.resetRead();
    const decoded = def.codec.decode(s);
    assert.equal(decoded, 42.5);
  });

  test("round-trips a string value through number | string union", () => {
    const registry = getBrainServices().types;
    const unionId = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const def = registry.get(unionId)!;
    const s = new MemoryStream();
    def.codec.encode(s, "hello");
    s.resetRead();
    const decoded = def.codec.decode(s);
    assert.equal(decoded, "hello");
  });

  test("encode throws for a value type not in the union", () => {
    const registry = getBrainServices().types;
    const unionId = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const def = registry.get(unionId)!;
    const s = new MemoryStream();
    assert.throws(() => {
      def.codec.encode(s, true);
    });
  });

  test("stringify delegates to the correct member codec", () => {
    const registry = getBrainServices().types;
    const unionId = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const def = registry.get(unionId)!;
    assert.equal(def.codec.stringify(42), "42");
    assert.equal(def.codec.stringify("hello"), "hello");
  });

  test("encode writes discriminant byte followed by value", () => {
    const registry = getBrainServices().types;
    const unionId = registry.getOrCreateUnionType(List.from([CoreTypeIds.Boolean, CoreTypeIds.Number]));
    const def = registry.get(unionId)!;
    const s = new MemoryStream();
    def.codec.encode(s, true);
    s.resetRead();
    const discriminant = s.readU8();
    assert.ok(discriminant >= 0);
    const decoded = s.readBool();
    assert.equal(decoded, true);
  });

  test("autoInstantiated flag is set on union types", () => {
    const registry = getBrainServices().types;
    const unionId = registry.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const def = registry.get(unionId)!;
    assert.equal(def.autoInstantiated, true);
  });
});

describe("getOrCreateFunctionType", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("returns a stable TypeId for the same signature", () => {
    const registry = getBrainServices().types;
    const shape = { paramTypeIds: List.from([CoreTypeIds.Number]), returnTypeId: CoreTypeIds.Number };
    const id1 = registry.getOrCreateFunctionType(shape);
    const id2 = registry.getOrCreateFunctionType(shape);
    assert.equal(id1, id2);
  });

  test("different signatures produce different TypeIds", () => {
    const registry = getBrainServices().types;
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
    const registry = getBrainServices().types;
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
    const registry = getBrainServices().types;
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
    const registry = getBrainServices().types;
    const id = registry.getOrCreateFunctionType({
      paramTypeIds: List.from([]),
      returnTypeId: CoreTypeIds.Number,
    });
    const def = registry.get(id) as FunctionTypeDef;
    assert.ok(def);
    assert.equal(def.paramTypeIds.size(), 0);
    assert.equal(def.returnTypeId, CoreTypeIds.Number);
  });

  test("codec is non-serializable (throws on encode)", () => {
    const registry = getBrainServices().types;
    const id = registry.getOrCreateFunctionType({
      paramTypeIds: List.from([CoreTypeIds.Number]),
      returnTypeId: CoreTypeIds.Number,
    });
    const def = registry.get(id)!;
    const s = new MemoryStream();
    assert.throws(() => def.codec.encode(s, {}));
  });
});
