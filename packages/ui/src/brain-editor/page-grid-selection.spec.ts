/**
 * Pins which rules a move of the page's selection concerns, and which element a
 * caller from outside the page hands the keyboard to. A rule reads its own
 * selection from `ruleSelectionCell`, so the rules that read a different value
 * across a move are exactly the rules that have anything to repaint.
 *
 * The move cases fix that reach in both directions: a move between two rules
 * concerns those two and no other, and a move within one rule concerns only it.
 * The handoff cases install a stand-in root, so nothing here depends on a DOM
 * being present.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RuleSide } from "@wendoo-lang/core/brain";
import { kAppendRuleCell, kPageGridCellAttribute, type PageGridCell } from "./page-grid-model";
import { pageGridTabStop, ruleSelectionCell, takePageGridKeyboard } from "./page-grid-selection";

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

/** A stand-in cell, recording each time the keyboard was given to it. */
interface FakeCell {
  focused: number;
  focus: (options?: FocusOptions) => void;
}

/** A cell that counts the times it is handed the keyboard, and the options it was handed it with. */
function cell(): FakeCell & { lastOptions: FocusOptions | undefined } {
  const made = {
    focused: 0,
    lastOptions: undefined as FocusOptions | undefined,
    focus(options?: FocusOptions) {
      made.focused++;
      made.lastOptions = options;
    },
  };
  return made;
}

/** A stand-in root answering `tabStop` for any query, recording every selector it is queried with in `queried`. */
function rootWith(tabStop: FakeCell | null, queried: string[] = []) {
  return {
    querySelector: (selector: string) => {
      queried.push(selector);
      return tabStop;
    },
  } as unknown as ParentNode;
}

describe("the cell a caller from outside the page hands the keyboard to", () => {
  test("is the one cell of the grid carrying the page's tab stop", () => {
    const queried: string[] = [];
    pageGridTabStop(rootWith(null, queried));

    assert.equal(queried.length, 1);
    assert.match(queried[0]!, new RegExp(`\\[${kPageGridCellAttribute}\\]`));
    assert.match(queried[0]!, /\[tabindex="0"\]/);
  });

  test("is nothing at all for a root standing no such cell", () => {
    assert.equal(pageGridTabStop(rootWith(null)), null);
  });
});

describe("handing the keyboard to the page", () => {
  test("gives it to the cell the selection rests on, and says it was taken", () => {
    const tabStop = cell();

    assert.equal(takePageGridKeyboard(rootWith(tabStop)), true);
    assert.equal(tabStop.focused, 1);
  });

  test("moves the view none of the way to the cell it hands the keyboard to", () => {
    const tabStop = cell();
    takePageGridKeyboard(rootWith(tabStop));

    assert.equal(tabStop.lastOptions?.preventScroll, true);
  });

  test("says it was not taken where the page stands no cell to navigate from", () => {
    assert.equal(takePageGridKeyboard(rootWith(null)), false);
  });
});
