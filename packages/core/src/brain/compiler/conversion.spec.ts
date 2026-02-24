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
  getBrainServices,
  mkCallDef,
  param,
  registerCoreBrainComponents,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import { parseRule } from "@mindcraft-lang/core/brain/compiler";
import { BrainTileActuatorDef, BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";

before(() => {
  registerCoreBrainComponents();
});

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

    const sayTile = new BrainTileActuatorDef(actuatorId, fnEntry, {});
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
