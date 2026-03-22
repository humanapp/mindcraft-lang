import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { stream } from "@mindcraft-lang/core";
import {
  CoreTypeIds,
  CoreTypeNames,
  getBrainServices,
  mkTypeId,
  NativeType,
  type NullableTypeDef,
  nativeTypeToString,
  registerCoreBrainComponents,
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
