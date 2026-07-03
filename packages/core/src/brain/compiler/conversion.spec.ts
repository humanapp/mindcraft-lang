/**
 * Conversion tests -- verifies that the parser/type-checker correctly applies
 * implicit type conversions when tile argument types don't match their slots.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { parseRule } from "@mindcraft-lang/core/brain/compiler";
import { BrainTileActuatorDef, BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";
import {
  type Conversion,
  CoreParameterId,
  CoreTypeIds,
  conversionFnName,
  type EnumFunctionIds,
  type EnumSymbolDef,
  type EnumValue,
  type ExecutionContext,
  isBytecodeConversion,
  mkActionDescriptor,
  mkCallDef,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  param,
  type StringValue,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";

let nextTestFnId = 2000;

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

let nextEnumFnId = 20000;

function mkEnumFunctionIds(): EnumFunctionIds {
  const base = nextEnumFnId;
  nextEnumFnId += 4;
  return { toString: base, toNumber: base + 1, equalTo: base + 2, notEqualTo: base + 3 };
}

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
  return registry.addEnumType(name, { atomId: mkTestAtomId(), symbols, defaultKey, functionIds: mkEnumFunctionIds() });
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

function execEnumConversion(fromType: string, toType: string, input: EnumValue) {
  const conversion = services.shared.conversions.get(fromType, toType);
  assert.ok(conversion, `Expected conversion ${fromType} -> ${toType}`);
  assert.ok(!isBytecodeConversion(conversion), `Expected a host-fn conversion ${fromType} -> ${toType}`);

  return conversion.fn.exec(mkCtx(), List.from([input as Value]));
}

function testConversion(
  label: string,
  actuatorCallDef: ReturnType<typeof mkCallDef>,
  literalType: string,
  literalValue: unknown,
  expectConversion: boolean,
  expectedToType?: string
): void {
  test(label, () => {
    const actuatorId = `test.conv.${Date.now()}.${Math.random()}`;
    const fnEntry = services.runtime.functions.register(
      nextTestFnId++,
      actuatorId,
      false,
      { exec: () => VOID_VALUE },
      actuatorCallDef
    );

    const sayTile = new BrainTileActuatorDef(actuatorId, mkActionDescriptor("actuator", fnEntry), {});
    const literal = new BrainTileLiteralDef(literalType, literalValue, {}, services);

    const tiles = List.from([sayTile as unknown, literal as unknown]) as List<never>;
    const emptyTiles = List.empty<never>();
    const catalogs = List.from([services.edit.tiles]);

    const result = parseRule(tiles, emptyTiles, catalogs, services.shared.conversions, services.runtime.types);
    const expr = result.parseResult.exprs.get(0);

    assert.equal(expr.kind, "actuator", "Expected actuator expression");
    if (expr.kind !== "actuator") return;

    assert.ok(expr.anons.size() > 0, "Expected anonymous slot");
    if (expr.anons.size() === 0) return;

    const anon = expr.anons.get(0);
    const typeInfo = result.typeInfo.typeEnv.get(anon.expr.nodeId);

    assert.ok(typeInfo !== undefined, "No TypeInfo found for anonymous slot expression");
    if (!typeInfo) return;

    const hasConversion = typeInfo.conversion !== undefined;

    if (expectConversion) {
      assert.ok(hasConversion, "Expected conversion but none applied");
      if (hasConversion && expectedToType) {
        assert.equal(
          typeInfo.conversion!.toType,
          expectedToType,
          `Expected conversion target ${expectedToType}, got ${typeInfo.conversion!.toType}`
        );
      }
    } else {
      assert.ok(
        !hasConversion,
        `Expected no conversion but got: ${typeInfo.conversion?.fromType} -> ${typeInfo.conversion?.toType}`
      );
    }
  });
}

describe("Conversion: action call arguments", () => {
  const AnonString = param(CoreParameterId.AnonymousString, { anonymous: true });
  const stringCallDef = mkCallDef(AnonString);

  testConversion(
    "Number literal -> AnonString slot (should convert Number->String)",
    stringCallDef,
    CoreTypeIds.Number,
    42,
    true,
    CoreTypeIds.String
  );

  testConversion(
    "String literal -> AnonString slot (no conversion needed)",
    stringCallDef,
    CoreTypeIds.String,
    "hello",
    false
  );

  testConversion(
    "Boolean literal -> AnonString slot (should convert Boolean->String)",
    stringCallDef,
    CoreTypeIds.Boolean,
    true,
    true,
    CoreTypeIds.String
  );

  const AnonNumber = param(CoreParameterId.AnonymousNumber, { anonymous: true });
  const numberCallDef = mkCallDef(AnonNumber);

  testConversion(
    "String literal -> AnonNumber slot (should convert String->Number)",
    numberCallDef,
    CoreTypeIds.String,
    "99",
    true,
    CoreTypeIds.Number
  );

  testConversion(
    "Boolean literal -> AnonNumber slot (should convert Boolean->Number)",
    numberCallDef,
    CoreTypeIds.Boolean,
    true,
    true,
    CoreTypeIds.Number
  );
});

describe("Conversion: bytecode-backed registrations", () => {
  const fromType = mkTypeId(NativeType.Struct, "ConversionSpecFakeFrom");
  const toType = mkTypeId(NativeType.Struct, "ConversionSpecFakeTo");

  function mkBytecodeConversion(): Conversion {
    return {
      binding: "bytecode",
      fromType,
      toType,
      cost: 2,
      descriptor: {
        key: "user.conversion.convspec00000001",
        kind: "conversion",
        callDef: mkCallDef(param("anon.number", { anonymous: true })),
        isAsync: false,
        outputType: toType,
      },
    };
  }

  test("registers and resolves by pair without a host-function registration", () => {
    const conv = services.shared.conversions.register(mkBytecodeConversion());
    try {
      assert.ok(isBytecodeConversion(conv));

      const found = services.shared.conversions.get(fromType, toType);
      assert.ok(found);
      assert.ok(isBytecodeConversion(found));
      assert.equal(found.descriptor.key, "user.conversion.convspec00000001");

      assert.equal(
        services.runtime.functions.get(conversionFnName(fromType, toType)),
        undefined,
        "a bytecode conversion registers no host function"
      );

      const path = services.shared.conversions.findBestPath(fromType, toType, 1);
      assert.ok(path);
      assert.equal(path.size(), 1);
    } finally {
      services.shared.conversions.remove(fromType, toType);
    }
  });

  test("a second registration of an already-held pair throws", () => {
    services.shared.conversions.register(mkBytecodeConversion());
    try {
      assert.throws(() => services.shared.conversions.register(mkBytecodeConversion()), /already exists/);
    } finally {
      services.shared.conversions.remove(fromType, toType);
    }
  });

  test("remove drops the pair and forEach no longer visits it", () => {
    services.shared.conversions.register(mkBytecodeConversion());
    let visits = 0;
    services.shared.conversions.forEach((conv) => {
      if (conv.fromType === fromType && conv.toType === toType) visits++;
    });
    assert.equal(visits, 1);

    assert.equal(services.shared.conversions.remove(fromType, toType), true);
    assert.equal(services.shared.conversions.get(fromType, toType), undefined);

    visits = 0;
    services.shared.conversions.forEach((conv) => {
      if (conv.fromType === fromType && conv.toType === toType) visits++;
    });
    assert.equal(visits, 0);
  });
});

describe("Conversion: enum values", () => {
  test("string enum registers a direct enum-to-string conversion", () => {
    const typeId = ensureEnumType(
      "ConversionSpecStringEnum",
      List.from([
        { key: "On", label: "On", value: "on" },
        { key: "Off", label: "Off", value: "off" },
      ]),
      "On"
    );

    const path = services.shared.conversions.findBestPath(typeId, CoreTypeIds.String, 1);
    assert.ok(path);
    assert.equal(path.size(), 1);

    const result = execEnumConversion(typeId, CoreTypeIds.String, {
      t: NativeType.Enum,
      typeId,
      v: "On",
    });

    assert.equal(result.t, NativeType.String);
    assert.equal((result as StringValue).v, "on");
  });

  test("numeric enum registers direct enum-to-number and enum-to-string conversions", () => {
    const typeId = ensureEnumType(
      "ConversionSpecNumericEnum",
      List.from([
        { key: "Up", label: "Up", value: 0 },
        { key: "Down", label: "Down", value: 1 },
      ]),
      "Up"
    );

    const numberPath = services.shared.conversions.findBestPath(typeId, CoreTypeIds.Number, 1);
    assert.ok(numberPath);
    assert.equal(numberPath.size(), 1);

    const stringPath = services.shared.conversions.findBestPath(typeId, CoreTypeIds.String, 1);
    assert.ok(stringPath);
    assert.equal(stringPath.size(), 1);

    const numberResult = execEnumConversion(typeId, CoreTypeIds.Number, {
      t: NativeType.Enum,
      typeId,
      v: "Up",
    });
    assert.equal(numberResult.t, NativeType.Number);
    assert.equal((numberResult as NumberValue).v, 0);

    const stringResult = execEnumConversion(typeId, CoreTypeIds.String, {
      t: NativeType.Enum,
      typeId,
      v: "Down",
    });
    assert.equal(stringResult.t, NativeType.String);
    assert.equal((stringResult as StringValue).v, "1");
  });

  test("string enum does not expose enum-to-number conversion", () => {
    const typeId = ensureEnumType(
      "ConversionSpecNoNumericEnum",
      List.from([
        { key: "North", label: "North", value: "north" },
        { key: "South", label: "South", value: "south" },
      ]),
      "North"
    );

    const path = services.shared.conversions.findBestPath(typeId, CoreTypeIds.Number, 1);
    assert.equal(path, undefined);
  });

  test("empty enums do not expose enum conversions", () => {
    const typeId = ensureEnumType("ConversionSpecEmptyEnum", List.empty<EnumSymbolDef>());

    const stringPath = services.shared.conversions.findBestPath(typeId, CoreTypeIds.String, 1);
    const numberPath = services.shared.conversions.findBestPath(typeId, CoreTypeIds.Number, 1);

    assert.equal(stringPath, undefined);
    assert.equal(numberPath, undefined);
  });
});
