/**
 * Repeated arg-slot gathering. A `repeat` call-spec slot can be filled by more
 * than one tile. For an anonymous or named-parameter slot the repeated values
 * are gathered into one `List<T>`; for a modifier slot the occurrences are
 * counted into a number. These tests pin both shapes (and confirm the
 * modifier-count path is unaffected by the list-gather for anon/param slots).
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List, type ReadonlyList } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__appendTile, __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import {
  BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileModifierDef,
  BrainTileParameterDef,
} from "@mindcraft-lang/core/brain/tiles";
import {
  bag,
  CoreTypeIds,
  type ExecutionContext,
  extractNumberValue,
  isListValue,
  mkActionDescriptor,
  mkCallDef,
  mod,
  param,
  repeated,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/runtime";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

let nextFnId = 41000;
let nextActionId = 42000;

/**
 * Registers a host actuator with `callDef`, builds a single-rule brain whose DO
 * side is the actuator followed by `slotTiles`, runs one think, and returns the
 * value the actuator received in arg slot 0.
 */
function runActuatorAndReadSlot0(
  callDef: ReturnType<typeof mkCallDef>,
  slotTiles: readonly unknown[]
): Value | undefined {
  const actuatorId = `test.repeated.${nextFnId}`;
  const fnEntry = services.runtime.functions.register(
    nextFnId++,
    actuatorId,
    false,
    { exec: () => VOID_VALUE },
    callDef
  );
  const action = mkActionDescriptor("actuator", fnEntry);
  let received: Value | undefined;
  services.runtime.actions.register({
    binding: "host",
    id: nextActionId++,
    descriptor: action,
    execSync: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
      received = args.get(0);
      return VOID_VALUE;
    },
  });
  const actuator = new BrainTileActuatorDef(actuatorId, action);

  const brainDef = new BrainDef(services);
  const pageResult = brainDef.appendNewPage();
  assert.ok(pageResult.success);
  const rule = pageResult.value!.page.children().get(0)!;
  __test__appendTile(rule.do(), actuator as never);
  for (const tile of slotTiles) {
    __test__appendTile(rule.do(), tile as never);
  }

  const brain = brainDef.compile();
  brain.initialize();
  brain.startup();
  brain.think(16);
  return received;
}

function mkNumberLiteral(value: number): BrainTileLiteralDef {
  return new BrainTileLiteralDef(CoreTypeIds.Number, value, {}, services);
}

describe("Repeated arg slots", () => {
  test("repeated anonymous slot gathers its values into a List", () => {
    const paramId = "repeated-anon-num";
    services.edit.tiles.registerTileDef(new BrainTileParameterDef(paramId, CoreTypeIds.Number));
    const callDef = mkCallDef(repeated(param(paramId, { anonymous: true }), { min: 0 }));

    const slot0 = runActuatorAndReadSlot0(callDef, [mkNumberLiteral(10), mkNumberLiteral(20)]);

    assert.ok(isListValue(slot0), "the repeated anonymous slot should be a List");
    assert.equal(slot0.v.size(), 2);
    assert.equal(extractNumberValue(slot0.v.get(0)), 10);
    assert.equal(extractNumberValue(slot0.v.get(1)), 20);
  });

  test("repeated named parameter slot gathers its values into a List", () => {
    const paramId = "repeated-named-num";
    const paramTile = new BrainTileParameterDef(paramId, CoreTypeIds.Number);
    services.edit.tiles.registerTileDef(paramTile);
    const callDef = mkCallDef(bag(repeated(param(paramId), { min: 0 })));

    const slot0 = runActuatorAndReadSlot0(callDef, [paramTile, mkNumberLiteral(7), paramTile, mkNumberLiteral(8)]);

    assert.ok(isListValue(slot0), "the repeated named parameter slot should be a List");
    assert.equal(slot0.v.size(), 2);
    assert.equal(extractNumberValue(slot0.v.get(0)), 7);
    assert.equal(extractNumberValue(slot0.v.get(1)), 8);
  });

  test("repeated modifier slot counts its occurrences (not a List)", () => {
    const modifierId = "repeated-mod-flag";
    const modTile = new BrainTileModifierDef(modifierId);
    services.edit.tiles.registerTileDef(modTile);
    const callDef = mkCallDef(bag(repeated(mod(modifierId), { min: 0, max: 3 })));

    const slot0 = runActuatorAndReadSlot0(callDef, [modTile, modTile]);

    assert.ok(!isListValue(slot0), "a repeated modifier slot must remain a count, not a List");
    assert.equal(extractNumberValue(slot0), 2);
  });
});
