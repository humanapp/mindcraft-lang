/**
 * Pins the edit point's position pivot: how each position around a placed tile
 * is armed, that the position an arming expresses round-trips, and that the
 * three positions ask the suggestion oracle three different questions through
 * the insertion context each one builds.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@wendoo/core/brain";
import { CoreControlFlowId, mkControlFlowTileId, RuleSide } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { buildInsertionContext } from "@wendoo/core/brain/language-service";
import { BrainDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import { BrainTileLiteralDef } from "@wendoo/core/brain/tiles";
import { CoreTypeIds } from "@wendoo/core/runtime";
import { armEditPoint, type EditPointPosition, editPointPositionOf, kEditPointPositions } from "./edit-point";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

function coreTile(tileId: string): IBrainTileDef {
  const tileDef = services.edit.tiles.get(tileId);
  assert.ok(tileDef, `core tile not registered: ${tileId}`);
  return tileDef;
}

function numberLiteralTile(brain: BrainDef, value: number): IBrainTileDef {
  const tileDef = new BrainTileLiteralDef(CoreTypeIds.Number, value, {}, services);
  const existing = brain.catalog().get(tileDef.tileId);
  if (existing) return existing;
  brain.catalog().registerTileDef(tileDef);
  return tileDef;
}

/** A rule whose WHEN side holds the given tiles, built through the real model API. */
function ruleWithWhenTiles(brain: BrainDef, tiles: readonly IBrainTileDef[]): BrainRuleDef {
  const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
  for (const tileDef of tiles) {
    rule.when().appendTile(tileDef);
  }
  return rule;
}

describe("the pivot's positions", () => {
  test("it offers before, replace, and after, in that order", () => {
    assert.deepEqual([...kEditPointPositions], ["before", "replace", "after"]);
  });
});

describe("armEditPoint", () => {
  test("replace addresses the anchor tile", () => {
    assert.deepEqual(armEditPoint("replace", 1, 3), { mode: "replace", tileIndex: 1 });
  });

  test("before inserts at the anchor tile's own index", () => {
    assert.deepEqual(armEditPoint("before", 1, 3), { mode: "insert", tileIndex: 1 });
  });

  test("after an interior tile inserts at the index past it", () => {
    assert.deepEqual(armEditPoint("after", 1, 3), { mode: "insert", tileIndex: 2 });
  });

  test("after the last tile is the side's end, which appends", () => {
    assert.deepEqual(armEditPoint("after", 2, 3), { mode: "append" });
  });

  test("after the only tile of a one-tile side appends", () => {
    assert.deepEqual(armEditPoint("after", 0, 1), { mode: "append" });
  });

  test("before the first tile inserts at the head of the side", () => {
    assert.deepEqual(armEditPoint("before", 0, 3), { mode: "insert", tileIndex: 0 });
  });
});

describe("editPointPositionOf", () => {
  test("every position round-trips through its own arming", () => {
    for (const tileCount of [1, 2, 4]) {
      for (let anchor = 0; anchor < tileCount; anchor++) {
        for (const position of kEditPointPositions) {
          assert.equal(
            editPointPositionOf(armEditPoint(position, anchor, tileCount), anchor),
            position,
            `position ${position} at anchor ${anchor} of ${tileCount}`
          );
        }
      }
    }
  });

  test("an insert addressing the tile past the anchor reads as after", () => {
    assert.equal(editPointPositionOf({ mode: "insert", tileIndex: 3 }, 2), "after");
  });

  test("an append reads as after, whatever the anchor", () => {
    assert.equal(editPointPositionOf({ mode: "append" }, 0), "after");
  });
});

describe("the offering each position asks for", () => {
  /** The insertion context the strip builds for `position` on the anchor tile of a WHEN side. */
  function contextFor(rule: BrainRuleDef, position: EditPointPosition, anchorTileIndex: number) {
    const tiles = rule.when().tiles();
    const arming = armEditPoint(position, anchorTileIndex, tiles.size());
    if (arming.mode === "insert") {
      return buildInsertionContext({
        side: RuleSide.When,
        existingTiles: tiles.slice(0, arming.tileIndex),
        ruleDef: rule,
      });
    }
    return buildInsertionContext({
      side: RuleSide.When,
      expr: rule.when().expr(),
      replaceTileIndex: arming.mode === "replace" ? arming.tileIndex : undefined,
      existingTiles: tiles,
      ruleDef: rule,
    });
  }

  test("before truncates the tiles at the anchor and replace does not", () => {
    const brain = BrainDef.emptyBrainDef(services);
    const openParen = mkControlFlowTileId(CoreControlFlowId.OpenParen);
    const rule = ruleWithWhenTiles(brain, [coreTile(openParen), coreTile(openParen), numberLiteralTile(brain, 7)]);
    rule.typecheck();

    // Inserting before the second paren sees only the first: one paren open.
    assert.equal(contextFor(rule, "before", 1).unclosedParenDepth, 1);
    // Replacing it sees every tile but the replaced one: still one paren open.
    assert.equal(contextFor(rule, "replace", 1).unclosedParenDepth, 1);
    // Inserting after it sees both parens.
    assert.equal(contextFor(rule, "after", 1).unclosedParenDepth, 2);
  });

  test("replace names the anchor as the slot it excludes, and the others name none", () => {
    const brain = BrainDef.emptyBrainDef(services);
    const rule = ruleWithWhenTiles(brain, [numberLiteralTile(brain, 1), numberLiteralTile(brain, 2)]);
    rule.typecheck();

    assert.equal(contextFor(rule, "replace", 0).replaceTileIndex, 0);
    assert.equal(contextFor(rule, "before", 0).replaceTileIndex, undefined);
    assert.equal(contextFor(rule, "after", 0).replaceTileIndex, undefined);
  });

  test("after the last tile asks the question the side's end asks", () => {
    const brain = BrainDef.emptyBrainDef(services);
    const rule = ruleWithWhenTiles(brain, [numberLiteralTile(brain, 4)]);
    rule.typecheck();
    const atEnd = contextFor(rule, "after", 0);
    const appended = buildInsertionContext({
      side: RuleSide.When,
      expr: rule.when().expr(),
      existingTiles: rule.when().tiles(),
      ruleDef: rule,
    });

    assert.equal(atEnd.replaceTileIndex, appended.replaceTileIndex);
    assert.equal(atEnd.expr, appended.expr);
    assert.equal(atEnd.unclosedParenDepth, appended.unclosedParenDepth);
  });
});
