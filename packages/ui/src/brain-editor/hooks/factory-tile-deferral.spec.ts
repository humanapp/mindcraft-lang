/**
 * Characterization suite for the tile selection flow's factory deferral.
 *
 * Pins that selecting a variable or literal factory tile returns false (the
 * picker stays open), does not run the selection action, and hands the same
 * pending action to the matching deferral effect -- so the command eventually
 * executed for the manufactured tile is the same AddTileCommand a direct
 * selection would execute.
 *
 * Pins with it where the picker stands once that manufactured tile has been
 * placed: composing on at the caret for a placement made in a rule's sentence,
 * and ended for one made anywhere else.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@wendoo/core/brain";
import {
  CoreLiteralFactoryId,
  CoreVariableFactoryId,
  mkLiteralFactoryTileId,
  mkVariableFactoryTileId,
  RuleSide,
} from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { AddTileCommand, BrainCommandHistory, BrainDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import type { BrainTileFactoryDef, BrainTileVariableDef } from "@wendoo/core/brain/tiles";
import type { CaretPosition } from "../caret-run";
import { composeAfterTileCreation, routeTileSelection, type TileSelectionDeferralEffects } from "./useTileSelection";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

function coreTile(tileId: string): IBrainTileDef {
  const tileDef = services.edit.tiles.get(tileId);
  assert.ok(tileDef, `core tile not registered: ${tileId}`);
  return tileDef;
}

function variableFactoryTile(): BrainTileFactoryDef {
  return coreTile(mkVariableFactoryTileId(CoreVariableFactoryId.Number)) as BrainTileFactoryDef;
}

function literalFactoryTile(): BrainTileFactoryDef {
  return coreTile(mkLiteralFactoryTileId(CoreLiteralFactoryId.Number)) as BrainTileFactoryDef;
}

interface RecordedDeferral {
  kind: "variable" | "literal";
  factoryTileDef: BrainTileFactoryDef;
  action: (tileDef: IBrainTileDef) => void;
}

function recordingEffects(record: RecordedDeferral[]): TileSelectionDeferralEffects {
  return {
    deferVariableCreation: (factoryTileDef, action) => {
      record.push({ kind: "variable", factoryTileDef, action });
    },
    deferLiteralCreation: (factoryTileDef, action) => {
      record.push({ kind: "literal", factoryTileDef, action });
    },
  };
}

describe("routeTileSelection", () => {
  test("a variable factory tile defers: returns false, action not run, pending action preserved", () => {
    const deferrals: RecordedDeferral[] = [];
    const actionCalls: IBrainTileDef[] = [];
    const action = (tileDef: IBrainTileDef) => {
      actionCalls.push(tileDef);
    };

    const completed = routeTileSelection(variableFactoryTile(), action, recordingEffects(deferrals));

    assert.equal(completed, false);
    assert.equal(actionCalls.length, 0);
    assert.equal(deferrals.length, 1);
    assert.equal(deferrals[0].kind, "variable");
    assert.equal(deferrals[0].factoryTileDef, variableFactoryTile());
    assert.equal(deferrals[0].action, action, "the pending action is the same function the caller supplied");
  });

  test("a literal factory tile defers to the literal effect", () => {
    const deferrals: RecordedDeferral[] = [];
    const completed = routeTileSelection(literalFactoryTile(), () => {}, recordingEffects(deferrals));

    assert.equal(completed, false);
    assert.equal(deferrals.length, 1);
    assert.equal(deferrals[0].kind, "literal");
    assert.equal(deferrals[0].factoryTileDef, literalFactoryTile());
  });

  test("a non-factory tile runs the action immediately and completes", () => {
    const deferrals: RecordedDeferral[] = [];
    const actionCalls: IBrainTileDef[] = [];
    const brain = BrainDef.emptyBrainDef(services);
    const varTile = manufactureNumberVariable(brain, "score");

    const completed = routeTileSelection(
      varTile,
      (tileDef) => {
        actionCalls.push(tileDef);
      },
      recordingEffects(deferrals)
    );

    assert.equal(completed, true);
    assert.deepEqual(actionCalls, [varTile]);
    assert.equal(deferrals.length, 0);
  });

  test("the deferred action executes the same AddTileCommand as a direct selection", () => {
    // Direct path: the manufactured variable tile is selected directly.
    const directBrain = BrainDef.emptyBrainDef(services);
    const directRule = firstRule(directBrain);
    const directHistory = new BrainCommandHistory();
    const directVar = manufactureNumberVariable(directBrain, "score");
    routeTileSelection(
      directVar,
      (tile) => {
        directHistory.executeCommand(new AddTileCommand(directRule, RuleSide.Do, tile));
      },
      recordingEffects([])
    );

    // Deferred path: the factory tile is selected, the action is parked, then
    // invoked with the manufactured tile once the variable exists.
    const deferredBrain = BrainDef.emptyBrainDef(services);
    const deferredRule = firstRule(deferredBrain);
    const deferredHistory = new BrainCommandHistory();
    const deferrals: RecordedDeferral[] = [];
    const completed = routeTileSelection(
      variableFactoryTile(),
      (tile) => {
        deferredHistory.executeCommand(new AddTileCommand(deferredRule, RuleSide.Do, tile));
      },
      recordingEffects(deferrals)
    );
    assert.equal(completed, false);
    assert.equal(deferredHistory.canUndo(), false, "no command runs until the tile is manufactured");

    const deferredVar = manufactureNumberVariable(deferredBrain, "score");
    deferrals[0].action(deferredVar);

    assert.equal(deferredHistory.canUndo(), true);
    // Both paths appended exactly their manufactured variable tile.
    assert.equal(directRule.do().tiles().size(), 1);
    assert.equal(directRule.do().tiles().get(0), directVar);
    assert.equal(deferredRule.do().tiles().size(), 1);
    assert.equal(deferredRule.do().tiles().get(0), deferredVar);
    deferredHistory.undo();
    assert.equal(deferredRule.do().tiles().size(), 0, "the deferred command undoes like a direct one");
  });
});

describe("where a placed created tile leaves the picker", () => {
  const caret: CaretPosition = { kind: "gap", side: RuleSide.When, tileIndex: 1 };

  test("a placement made in a rule's sentence carries composition on at the caret it left", () => {
    assert.deepEqual(composeAfterTileCreation("sentence", caret), caret);
  });

  test("a placement made from the tray ends the selection", () => {
    assert.equal(composeAfterTileCreation("tray", caret), undefined);
  });

  test("so does one made through an arming that names no entry point", () => {
    assert.equal(composeAfterTileCreation(undefined, caret), undefined);
  });

  test("a sentence arming standing at no caret ends it too, having nowhere to carry on", () => {
    assert.equal(composeAfterTileCreation("sentence", undefined), undefined);
  });
});

function firstRule(brain: BrainDef): BrainRuleDef {
  return brain.pages().get(0).children().get(0) as BrainRuleDef;
}

/** Manufacture a number variable tile through its factory and register it in the brain's catalog. */
function manufactureNumberVariable(brain: BrainDef, varName: string): BrainTileVariableDef {
  const factory = variableFactoryTile();
  const tileDef = factory.manufacture(factory, { name: varName }) as BrainTileVariableDef;
  brain.catalog().registerTileDef(tileDef);
  return tileDef;
}
