/**
 * Characterization suite for the armed-target matching predicates: an armed
 * target addresses exactly one owner -- the append picker of one rule, or the
 * insert/replace picker of one tile position -- and no other.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@wendoo/core/brain";
import { RuleSide } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import {
  type ArmedTileTarget,
  armedTargetForRule,
  isAppendTargetForRule,
  isTileTargetForTile,
} from "./ArmedTargetContext";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

function twoRules(): { ruleA: BrainRuleDef; ruleB: BrainRuleDef } {
  const brain = BrainDef.emptyBrainDef(services);
  const page = brain.pages().get(0) as BrainPageDef;
  return { ruleA: page.children().get(0) as BrainRuleDef, ruleB: page.appendNewRule() };
}

function appendTarget(ruleDef: BrainRuleDef, side: RuleSide): ArmedTileTarget {
  return { ruleDef, side, mode: "append", onTileSelected: () => true };
}

function tileTarget(
  ruleDef: BrainRuleDef,
  side: RuleSide,
  mode: "insert" | "replace",
  tileIndex: number
): ArmedTileTarget {
  return { ruleDef, side, mode, tileIndex, onTileSelected: () => true };
}

describe("armedTargetForRule", () => {
  test("hands the armed rule its own target, by identity", () => {
    const { ruleA } = twoRules();
    const target = appendTarget(ruleA, RuleSide.When);
    assert.equal(armedTargetForRule(target, ruleA), target);
    assert.equal(armedTargetForRule(tileTarget(ruleA, RuleSide.Do, "replace", 0), ruleA)?.mode, "replace");
  });

  test("hands every other rule the same null, whichever rule is armed and whether any is", () => {
    const { ruleA, ruleB } = twoRules();
    const readings = [
      armedTargetForRule(null, ruleB),
      armedTargetForRule(appendTarget(ruleA, RuleSide.When), ruleB),
      armedTargetForRule(tileTarget(ruleA, RuleSide.Do, "insert", 0), ruleB),
      armedTargetForRule(tileTarget(ruleA, RuleSide.When, "replace", 2), ruleB),
    ];
    for (const reading of readings) {
      assert.equal(reading, null);
    }
  });
});

describe("isAppendTargetForRule", () => {
  test("matches only the armed rule", () => {
    const { ruleA, ruleB } = twoRules();
    const target = appendTarget(ruleA, RuleSide.When);
    assert.equal(isAppendTargetForRule(target, ruleA), true);
    assert.equal(isAppendTargetForRule(target, ruleB), false);
  });

  test("does not match a null target or a tile-mode target", () => {
    const { ruleA } = twoRules();
    assert.equal(isAppendTargetForRule(null, ruleA), false);
    assert.equal(isAppendTargetForRule(tileTarget(ruleA, RuleSide.Do, "insert", 0), ruleA), false);
    assert.equal(isAppendTargetForRule(tileTarget(ruleA, RuleSide.Do, "replace", 0), ruleA), false);
  });
});

describe("isTileTargetForTile", () => {
  test("matches the armed tile position for both insert and replace modes", () => {
    const { ruleA } = twoRules();
    for (const mode of ["insert", "replace"] as const) {
      const target = tileTarget(ruleA, RuleSide.Do, mode, 2);
      assert.equal(isTileTargetForTile(target, ruleA, RuleSide.Do, 2), true);
    }
  });

  test("does not match a different rule, side, or tile index", () => {
    const { ruleA, ruleB } = twoRules();
    const target = tileTarget(ruleA, RuleSide.Do, "insert", 2);
    assert.equal(isTileTargetForTile(target, ruleB, RuleSide.Do, 2), false);
    assert.equal(isTileTargetForTile(target, ruleA, RuleSide.When, 2), false);
    assert.equal(isTileTargetForTile(target, ruleA, RuleSide.Do, 1), false);
  });

  test("does not match a null target or an append-mode target", () => {
    const { ruleA } = twoRules();
    assert.equal(isTileTargetForTile(null, ruleA, RuleSide.When, 0), false);
    assert.equal(isTileTargetForTile(appendTarget(ruleA, RuleSide.When), ruleA, RuleSide.When, 0), false);
  });
});

describe("isTileTargetForTile for an edit point", () => {
  /** The target an edit point on `anchorTileIndex` arms when its pivot addresses `tileIndex`. */
  function editPointTarget(
    ruleDef: BrainRuleDef,
    anchorTileIndex: number,
    mode: "insert" | "replace" | "append",
    tileIndex?: number
  ): ArmedTileTarget {
    return { ruleDef, side: RuleSide.When, mode, tileIndex, anchorTileIndex, onTileSelected: () => true };
  }

  test("matches the anchor tile while the pivot inserts before it", () => {
    const { ruleA } = twoRules();
    const target = editPointTarget(ruleA, 1, "insert", 1);
    assert.equal(isTileTargetForTile(target, ruleA, RuleSide.When, 1), true);
  });

  test("matches the anchor tile, not the one the insert addresses, while the pivot inserts after it", () => {
    const { ruleA } = twoRules();
    const target = editPointTarget(ruleA, 1, "insert", 2);
    assert.equal(isTileTargetForTile(target, ruleA, RuleSide.When, 1), true);
    assert.equal(isTileTargetForTile(target, ruleA, RuleSide.When, 2), false);
  });

  test("still matches the anchor tile once the pivot's last position appends", () => {
    const { ruleA } = twoRules();
    const target = editPointTarget(ruleA, 2, "append");
    assert.equal(isTileTargetForTile(target, ruleA, RuleSide.When, 2), true);
  });

  test("matches no tile of another rule or side", () => {
    const { ruleA, ruleB } = twoRules();
    const target = editPointTarget(ruleA, 0, "replace", 0);
    assert.equal(isTileTargetForTile(target, ruleB, RuleSide.When, 0), false);
    assert.equal(isTileTargetForTile(target, ruleA, RuleSide.Do, 0), false);
  });
});
