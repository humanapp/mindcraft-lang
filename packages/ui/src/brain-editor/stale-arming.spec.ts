/**
 * Pins the editor against an arming whose tile the rule no longer holds. A
 * person's edit may leave a modifier standing on a host with no slot for it,
 * that state is a legal document, and every surface must go on reading it: the
 * rule card renders with the modifier armed, the removal that takes it out
 * lands, and undo puts it back where it stood.
 *
 * The four steps walked here are the ones a person walks: place a sensor, its
 * object and a distance modifier; replace the sensor with one taking no
 * modifier; arm the modifier as a tap on it does; and take it out as Delete on
 * the page's selection does.
 *
 * Structural assertions only: tile ids, tile counts and marker attributes.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@wendoo/core/brain";
import { RuleSide } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import {
  BrainCommandHistory,
  type BrainRuleDef,
  RemoveTileCommand,
  ReplaceTileCommand,
} from "@wendoo/core/brain/model";
import { BrainTileModifierDef } from "@wendoo/core/brain/tiles";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ArmedTargetController, ArmedTargetProvider, type ArmedTileTarget } from "./ArmedTargetContext";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainRuleEditor } from "./BrainRuleEditor";
import { decidePageGridOperation } from "./page-grid-model";
import { makeBrain, makeObjectSensor, makeSensor } from "./test-only-rule-fixtures";

let services: BrainServices;

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
};

before(() => {
  services = __test__createBrainServices();
});

/** The tile ids of `side`, in place order. */
function tileIds(ruleDef: BrainRuleDef, side: RuleSide): string[] {
  return ruleDef
    .side(side)
    .tiles()
    .toArray()
    .map((tileDef) => tileDef.tileId);
}

function renderRuleCard(ruleDef: BrainRuleDef, target: ArmedTileTarget | null, commandHistory: BrainCommandHistory) {
  const controller: ArmedTargetController = {
    target,
    arm: () => {},
    disarm: () => {},
    mode: null,
    reportMode: () => {},
  };
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: editorConfig },
      createElement(
        ArmedTargetProvider,
        { value: controller },
        createElement(BrainRuleEditor, { ruleDef, lineNumber: 1, ruleCount: 1, revision: "", commandHistory })
      )
    )
  );
}

/** The target a tap on the tile at `tileIndex` of the WHEN side arms. */
function tapTarget(ruleDef: BrainRuleDef, tileIndex: number): ArmedTileTarget {
  return {
    ruleDef,
    side: RuleSide.When,
    mode: "replace",
    tileIndex,
    anchorTileIndex: tileIndex,
    entry: "tray",
    onTileSelected: () => true,
  };
}

/** Whether the offering panel stands its removal control. */
function offersRemoval(markup: string): boolean {
  return markup.includes('data-strip-delete=""');
}

/** The rule and its history after step two of the recipe, with the tile ids it stands. */
interface OrphanedModifierFixture {
  readonly ruleDef: BrainRuleDef;
  readonly commandHistory: BrainCommandHistory;
  /** The WHEN side's tile ids as the replacement leaves them, in place order. */
  readonly placed: readonly string[];
}

let fixtureCount = 0;

describe("a modifier left standing on a host that takes none", () => {
  /**
   * The WHEN side after a sensor taking a modifier has been replaced by one
   * taking none, with the object and the distance modifier still standing.
   */
  function makeOrphanedModifier(): OrphanedModifierFixture {
    fixtureCount += 1;
    const suffix = `stale-arming-${fixtureCount}`;
    const objectTile: IBrainTileDef = new BrainTileModifierDef(`${suffix}-carnivore`, {
      metadata: { label: "carnivore" },
    });
    const distanceTile: IBrainTileDef = new BrainTileModifierDef(`${suffix}-nearby`, {
      metadata: { label: "nearby" },
    });
    const { ruleDef } = makeBrain(
      services,
      [makeObjectSensor(services, `${suffix}-see`), objectTile, distanceTile],
      []
    );
    const bumpTile = makeSensor(services, `${suffix}-bump`);
    const commandHistory = new BrainCommandHistory();
    commandHistory.executeCommand(new ReplaceTileCommand(ruleDef, RuleSide.When, 0, bumpTile));
    return {
      ruleDef,
      commandHistory,
      placed: [bumpTile.tileId, objectTile.tileId, distanceTile.tileId],
    };
  }

  test("the replacement lands, leaving the modifier where the person put it", () => {
    const { ruleDef, placed } = makeOrphanedModifier();
    assert.deepEqual(tileIds(ruleDef, RuleSide.When), placed);
  });

  test("the rule card renders with the modifier armed", () => {
    const { ruleDef, commandHistory } = makeOrphanedModifier();
    const markup = renderRuleCard(ruleDef, tapTarget(ruleDef, 2), commandHistory);
    assert.ok(offersRemoval(markup), "the offering stands the removal of the armed tile");
  });

  test("Delete on the page's selection takes the modifier out and undo puts it back", () => {
    const { ruleDef, commandHistory, placed } = makeOrphanedModifier();
    const armed = tapTarget(ruleDef, 2);
    const cell = { kind: "tile", ruleId: ruleDef.ruleId(), side: RuleSide.When, tileIndex: 2 } as const;
    const operation = decidePageGridOperation(cell, { key: "Delete", withCommand: false, placement: "on-cell" });
    assert.deepEqual(operation, { verb: "delete", subject: { ...cell } });

    commandHistory.executeCommand(new RemoveTileCommand(ruleDef, RuleSide.When, 2));
    assert.deepEqual(tileIds(ruleDef, RuleSide.When), placed.slice(0, 2), "the modifier alone goes");

    const markup = renderRuleCard(ruleDef, armed, commandHistory);
    assert.equal(offersRemoval(markup), false, "the arming addresses no tile, so the panel offers no removal");

    commandHistory.undo();
    assert.deepEqual(tileIds(ruleDef, RuleSide.When), placed, "undo puts it back in place");
    assert.ok(offersRemoval(renderRuleCard(ruleDef, armed, commandHistory)), "and the arming reads it again");
  });
});
