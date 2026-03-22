import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { stream } from "@mindcraft-lang/core";
import {
  CoreTypeIds,
  CoreTypeNames,
  getBrainServices,
  mkTypeId,
  NativeType,
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
