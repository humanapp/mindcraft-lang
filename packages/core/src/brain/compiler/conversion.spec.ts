/**
 * Conversion tests -- verifies that the parser/type-checker correctly applies
 * implicit type conversions when tile argument types don't match their slots.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List } from "@mindcraft-lang/core";
import {
  CoreParameterId,
  CoreTypeIds,
  type EnumSymbolDef,
  type EnumValue,
  type ExecutionContext,
  getBrainServices,
  mkActionDescriptor,
  mkCallDef,
  NativeType,
  type NumberValue,
  param,
  registerCoreBrainComponents,
  type StringValue,
  ValueDict,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import { parseRule } from "@mindcraft-lang/core/brain/compiler";
import { BrainTileActuatorDef, BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";

before(() => {
  registerCoreBrainComponents();
});

function ensureEnumType(name: string, symbols: List<EnumSymbolDef>, defaultKey?: string): string {
  const registry = getBrainServices().types;
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

function execEnumConversion(fromType: string, toType: string, input: EnumValue) {
  const conversion = getBrainServices().conversions.get(fromType, toType);
  assert.ok(conversion, `Expected conversion ${fromType} -> ${toType}`);

  const args = new ValueDict();
  args.set(0, input);

  return conversion.fn.exec(mkCtx(), { t: NativeType.Map, typeId: "", v: args });
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
    const fnEntry = getBrainServices().functions.register(
      actuatorId,
      false,
      { exec: () => VOID_VALUE },
      actuatorCallDef
    );

    const sayTile = new BrainTileActuatorDef(actuatorId, mkActionDescriptor("actuator", fnEntry), {});
    const literal = new BrainTileLiteralDef(literalType, literalValue);

    const tiles = List.from([sayTile as unknown, literal as unknown]) as List<never>;
    const emptyTiles = List.empty<never>();
    const catalogs = List.from([getBrainServices().tiles]);

    const result = parseRule(tiles, emptyTiles, catalogs);
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

    const path = getBrainServices().conversions.findBestPath(typeId, CoreTypeIds.String, 1);
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

    const numberPath = getBrainServices().conversions.findBestPath(typeId, CoreTypeIds.Number, 1);
    assert.ok(numberPath);
    assert.equal(numberPath.size(), 1);

    const stringPath = getBrainServices().conversions.findBestPath(typeId, CoreTypeIds.String, 1);
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

    const path = getBrainServices().conversions.findBestPath(typeId, CoreTypeIds.Number, 1);
    assert.equal(path, undefined);
  });

  test("empty enums do not expose enum conversions", () => {
    const typeId = ensureEnumType("ConversionSpecEmptyEnum", List.empty<EnumSymbolDef>());

    const stringPath = getBrainServices().conversions.findBestPath(typeId, CoreTypeIds.String, 1);
    const numberPath = getBrainServices().conversions.findBestPath(typeId, CoreTypeIds.Number, 1);

    assert.equal(stringPath, undefined);
    assert.equal(numberPath, undefined);
  });
});
