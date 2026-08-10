/**
 * Pins which rules a move of the page's selection concerns. A rule reads its own
 * selection from `ruleSelectionCell`, so the rules that read a different value
 * across a move are exactly the rules that have anything to repaint.
 *
 * The cases below fix that reach in both directions: a move between two rules
 * concerns those two and no other, and a move within one rule concerns only it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { kAppendRuleCell, type PageGridCell } from "./page-grid-model";
import { ruleSelectionCell } from "./page-grid-selection";

/** The ids of the rules a page holds, in the order they stand. */
const kRuleIds = ["r1", "r2", "r3"] as const;

/** The rules reading a different selection across a move from `before` to `after`. */
function concernedRules(before: PageGridCell | undefined, after: PageGridCell | undefined): string[] {
  return kRuleIds.filter((ruleId) => ruleSelectionCell(before, ruleId) !== ruleSelectionCell(after, ruleId));
}

describe("ruleSelectionCell", () => {
  test("gives the rule holding the cell the cell itself", () => {
    const cell: PageGridCell = { kind: "handle", ruleId: "r2" };
    assert.equal(ruleSelectionCell(cell, "r2"), cell);
  });

  test("gives every other rule nothing", () => {
    const cell: PageGridCell = { kind: "tile", ruleId: "r2", side: RuleSide.Do, tileIndex: 0 };
    assert.equal(ruleSelectionCell(cell, "r1"), undefined);
    assert.equal(ruleSelectionCell(cell, "r3"), undefined);
  });

  test("gives every rule nothing for the page's own add-rule control", () => {
    for (const ruleId of kRuleIds) assert.equal(ruleSelectionCell(kAppendRuleCell, ruleId), undefined);
  });

  test("gives every rule nothing while the selection rests nowhere", () => {
    for (const ruleId of kRuleIds) assert.equal(ruleSelectionCell(undefined, ruleId), undefined);
  });

  test("a move between two rules concerns those two and no other", () => {
    const from: PageGridCell = { kind: "handle", ruleId: "r1" };
    const to: PageGridCell = { kind: "handle", ruleId: "r3" };
    assert.deepEqual(concernedRules(from, to), ["r1", "r3"]);
  });

  test("a move within one rule concerns only that rule", () => {
    const from: PageGridCell = { kind: "handle", ruleId: "r2" };
    const to: PageGridCell = { kind: "tile", ruleId: "r2", side: RuleSide.When, tileIndex: 0 };
    assert.deepEqual(concernedRules(from, to), ["r2"]);
  });

  test("a move onto the page's add-rule control concerns only the rule it leaves", () => {
    assert.deepEqual(concernedRules({ kind: "sentence", ruleId: "r3" }, kAppendRuleCell), ["r3"]);
  });

  test("re-reading the same cell concerns no rule at all", () => {
    const cell: PageGridCell = { kind: "append", ruleId: "r2", side: RuleSide.When };
    assert.deepEqual(concernedRules(cell, cell), []);
  });
});
