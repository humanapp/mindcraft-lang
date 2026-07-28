/**
 * Characterization suite for the armed-target matching predicates: an armed
 * target addresses exactly one owner -- the append picker of one rule, or the
 * insert/replace picker of one tile position -- and no other.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { type ArmedTileTarget, isAppendTargetForRule, isTileTargetForTile } from "./ArmedTargetContext";

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
