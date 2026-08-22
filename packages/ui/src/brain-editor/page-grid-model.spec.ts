/**
 * Pins the page's selection grid: the cells a real brain's rules stand, in
 * reading order, the steps the arrow keys take across them, and the one position
 * the tile row and the sentence both read. The rules are built through the real
 * brain model and their add-tile controls answered by the real suggestion
 * oracle.
 *
 * Structural assertions only: every value asserted here is a cell, a cell key, a
 * column index, or a decision.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, type ReadonlyList } from "@wendoo/core";
import type { BrainServices, ITileCatalog } from "@wendoo/core/brain";
import { RuleSide } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import { caretRun, composerEntryCaret } from "./caret-run";
import {
  decidePageGridKey,
  decidePageKey,
  kAppendRuleCell,
  type PageGridCell,
  type PageGridCursor,
  type PageGridKeyPress,
  pageGridCellAfterComposing,
  pageGridCellKey,
  pageGridRows,
  type RuleCellDescriptor,
  resolvePageGridCursor,
  ruleMoveDirections,
} from "./page-grid-model";
import { makeActuator, makeSensor } from "./test-only-rule-fixtures";
import { sideOffersAppendedTile } from "./tile-offering";

let services: BrainServices;
let catalogs: ReadonlyList<ITileCatalog>;

before(() => {
  services = __test__createBrainServices();
  catalogs = List.from<ITileCatalog>([services.edit.tiles]).asReadonly();
});

/** A brain page holding `count` rules, none of them holding a tile yet. */
function makePage(count: number): { pageDef: BrainPageDef; rules: BrainRuleDef[] } {
  const brainDef = BrainDef.emptyBrainDef(services);
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  const rules = [pageDef.children().get(0) as BrainRuleDef];
  while (rules.length < count) rules.push(pageDef.appendNewRule());
  return { pageDef, rules };
}

/**
 * What `ruleDef` contributes to the grid, with both add-tile answers taken from
 * the oracle and the sentence row the settled rule always reads.
 */
function describeRule(ruleDef: BrainRuleDef): RuleCellDescriptor {
  return {
    ruleId: ruleDef.ruleId(),
    whenTileCount: ruleDef.when().tiles().size(),
    doTileCount: ruleDef.do().tiles().size(),
    whenAppendable: sideOffersAppendedTile({ ruleDef, side: RuleSide.When, catalogs, services }),
    doAppendable: sideOffersAppendedTile({ ruleDef, side: RuleSide.Do, catalogs, services }),
    hasSentence: true,
  };
}

/**
 * A page of three rules: one complete on both sides, one complete on WHEN with
 * an empty DO, and one holding no tiles at all.
 */
function makeMixedPage() {
  const { rules } = makePage(3);
  const [both, whenOnly, bare] = rules;
  both.when().appendTile(makeSensor(services, "grid-both-see"));
  both.do().appendTile(makeActuator(services, "grid-both-move"));
  both.typecheck();
  whenOnly.when().appendTile(makeSensor(services, "grid-when-see"));
  whenOnly.typecheck();
  return { both, whenOnly, bare, rows: pageGridRows(rules.map(describeRule)) };
}

/** The cursor resting on `cell`, which the grid must hold. */
function cursorAt(rows: readonly (readonly PageGridCell[])[], cell: PageGridCell): PageGridCursor {
  const cursor = resolvePageGridCursor(rows, cell);
  assert.ok(cursor !== undefined && pageGridCellKey(cursor.cell) === pageGridCellKey(cell));
  return cursor;
}

/** Where `key` takes `cursor`, or undefined when the grid refuses the key. */
function step(
  rows: readonly (readonly PageGridCell[])[],
  cursor: PageGridCursor,
  key: string
): PageGridCursor | undefined {
  const result = decidePageGridKey(rows, cursor, key, "on-cell");
  return result.kind === "move" ? result.cursor : undefined;
}

describe("the cells a page stands", () => {
  test("a rule reads its handle, then each side's tiles and add-tile control, then its sentence", () => {
    const { bare, rows } = makeMixedPage();
    assert.deepEqual(rows[4], [
      { kind: "handle", ruleId: bare.ruleId() },
      { kind: "append", ruleId: bare.ruleId(), side: RuleSide.When },
      { kind: "append", ruleId: bare.ruleId(), side: RuleSide.Do },
    ]);
    assert.deepEqual(rows[5], [{ kind: "sentence", ruleId: bare.ruleId() }]);
  });

  test("a side the oracle offers nothing at stands no cell", () => {
    const { both, rows } = makeMixedPage();
    assert.deepEqual(rows[0], [
      { kind: "handle", ruleId: both.ruleId() },
      { kind: "tile", ruleId: both.ruleId(), side: RuleSide.When, tileIndex: 0 },
      { kind: "tile", ruleId: both.ruleId(), side: RuleSide.Do, tileIndex: 0 },
    ]);
  });

  test("the two sides answer independently", () => {
    const { whenOnly, rows } = makeMixedPage();
    assert.deepEqual(rows[2], [
      { kind: "handle", ruleId: whenOnly.ruleId() },
      { kind: "tile", ruleId: whenOnly.ruleId(), side: RuleSide.When, tileIndex: 0 },
      { kind: "append", ruleId: whenOnly.ruleId(), side: RuleSide.Do },
    ]);
  });

  test("a rule reading no sentence contributes one row", () => {
    const { rules } = makePage(1);
    const rows = pageGridRows([{ ...describeRule(rules[0]), hasSentence: false }]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0][0].kind, "handle");
    assert.deepEqual(rows[1], [kAppendRuleCell]);
  });

  test("every cell of the page is addressed by its own key", () => {
    const { rows } = makeMixedPage();
    const keys = rows.flat().map(pageGridCellKey);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("the row the page's add-rule control stands", () => {
  test("a page holding no rules stands it alone", () => {
    assert.deepEqual(pageGridRows([]), [[kAppendRuleCell]]);
  });

  test("a page of one rule stands it past that rule's two rows", () => {
    const { rules } = makePage(1);
    const rows = pageGridRows([describeRule(rules[0])]);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[2], [kAppendRuleCell]);
  });

  test("a page of several rules stands one of it, at the end", () => {
    const { rules } = makePage(3);
    const rows = pageGridRows(rules.map(describeRule));
    assert.equal(rows.length, 7);
    assert.deepEqual(rows[6], [kAppendRuleCell]);
    assert.equal(rows.filter((row) => row[0].kind === "append-rule").length, 1);
  });
});

describe("stepping across the page", () => {
  test("right and left walk the row the cursor stands in", () => {
    const { both, rows } = makeMixedPage();
    const handle = cursorAt(rows, { kind: "handle", ruleId: both.ruleId() });
    const whenTile = step(rows, handle, "ArrowRight");
    assert.deepEqual(whenTile?.cell, { kind: "tile", ruleId: both.ruleId(), side: RuleSide.When, tileIndex: 0 });
    assert.deepEqual(step(rows, whenTile as PageGridCursor, "ArrowLeft")?.cell, handle.cell);
  });

  test("right steps over the side whose add-tile control stands no cell", () => {
    const { both, rows } = makeMixedPage();
    const whenTile = cursorAt(rows, { kind: "tile", ruleId: both.ruleId(), side: RuleSide.When, tileIndex: 0 });
    assert.deepEqual(step(rows, whenTile, "ArrowRight")?.cell, {
      kind: "tile",
      ruleId: both.ruleId(),
      side: RuleSide.Do,
      tileIndex: 0,
    });
  });

  test("down leaves a rule's tiles for its sentence, and its sentence for the next rule", () => {
    const { both, whenOnly, rows } = makeMixedPage();
    const handle = cursorAt(rows, { kind: "handle", ruleId: both.ruleId() });
    const sentence = step(rows, handle, "ArrowDown");
    assert.deepEqual(sentence?.cell, { kind: "sentence", ruleId: both.ruleId() });
    assert.deepEqual(step(rows, sentence as PageGridCursor, "ArrowDown")?.cell, {
      kind: "handle",
      ruleId: whenOnly.ruleId(),
    });
  });

  test("up retraces the same steps", () => {
    const { whenOnly, both, rows } = makeMixedPage();
    const nextHandle = cursorAt(rows, { kind: "handle", ruleId: whenOnly.ruleId() });
    assert.deepEqual(step(rows, nextHandle, "ArrowUp")?.cell, { kind: "sentence", ruleId: both.ruleId() });
  });

  test("a step off either end of a row is refused", () => {
    const { both, rows } = makeMixedPage();
    const handle = cursorAt(rows, { kind: "handle", ruleId: both.ruleId() });
    assert.equal(step(rows, handle, "ArrowLeft"), undefined);
    const lastTile = cursorAt(rows, { kind: "tile", ruleId: both.ruleId(), side: RuleSide.Do, tileIndex: 0 });
    assert.equal(step(rows, lastTile, "ArrowRight"), undefined);
  });

  test("a step off the top or the bottom of the page is refused", () => {
    const { both, rows } = makeMixedPage();
    assert.equal(step(rows, cursorAt(rows, { kind: "handle", ruleId: both.ruleId() }), "ArrowUp"), undefined);
    assert.equal(step(rows, cursorAt(rows, kAppendRuleCell), "ArrowDown"), undefined);
  });

  test("down from the last rule reaches the add-rule control, and up returns", () => {
    const { bare, rows } = makeMixedPage();
    const lastSentence = cursorAt(rows, { kind: "sentence", ruleId: bare.ruleId() });
    const appendRule = step(rows, lastSentence, "ArrowDown") as PageGridCursor;
    assert.deepEqual(appendRule.cell, kAppendRuleCell);
    assert.deepEqual(step(rows, appendRule, "ArrowUp")?.cell, lastSentence.cell);
  });

  test("the add-rule control stands its row alone, so neither side step moves", () => {
    const { rows } = makeMixedPage();
    const appendRule = cursorAt(rows, kAppendRuleCell);
    assert.equal(step(rows, appendRule, "ArrowLeft"), undefined);
    assert.equal(step(rows, appendRule, "ArrowRight"), undefined);
  });

  test("a key the grid does not walk by is refused", () => {
    const { both, rows } = makeMixedPage();
    const handle = cursorAt(rows, { kind: "handle", ruleId: both.ruleId() });
    for (const key of ["Enter", " ", "Home", "Tab", "a"]) {
      assert.equal(decidePageGridKey(rows, handle, key, "on-cell").kind, "inert");
    }
  });
});

describe("the column vertical movement holds", () => {
  test("a shorter row rests at its last cell and gives the column back on the next step", () => {
    const { both, whenOnly, rows } = makeMixedPage();
    const lastTile = cursorAt(rows, { kind: "tile", ruleId: both.ruleId(), side: RuleSide.Do, tileIndex: 0 });
    assert.equal(lastTile.desiredColumn, 2);
    const sentence = step(rows, lastTile, "ArrowDown") as PageGridCursor;
    assert.deepEqual(sentence.cell, { kind: "sentence", ruleId: both.ruleId() });
    assert.equal(sentence.desiredColumn, 2);
    const returned = step(rows, sentence, "ArrowDown") as PageGridCursor;
    assert.deepEqual(returned.cell, { kind: "append", ruleId: whenOnly.ruleId(), side: RuleSide.Do });
    assert.equal(returned.desiredColumn, 2);
  });

  test("a step along a row takes the column it lands in", () => {
    const { both, rows } = makeMixedPage();
    const lastTile = cursorAt(rows, { kind: "tile", ruleId: both.ruleId(), side: RuleSide.Do, tileIndex: 0 });
    const back = step(rows, lastTile, "ArrowLeft") as PageGridCursor;
    assert.equal(back.desiredColumn, 1);
    assert.equal((step(rows, back, "ArrowDown") as PageGridCursor).desiredColumn, 1);
  });
});

describe("what the grid leaves alone", () => {
  test("a key pressed inside a cell belongs to the control there", () => {
    const { whenOnly, rows } = makeMixedPage();
    const sentence = cursorAt(rows, { kind: "sentence", ruleId: whenOnly.ruleId() });
    for (const key of ["ArrowUp", "ArrowDown"]) {
      assert.equal(decidePageGridKey(rows, sentence, key, "inside-cell").kind, "inert");
      assert.equal(decidePageGridKey(rows, sentence, key, "on-cell").kind, "move");
    }
  });

  test("a cursor the page no longer holds moves nothing", () => {
    const { rows } = makeMixedPage();
    const gone: PageGridCursor = { cell: { kind: "handle", ruleId: "gone" }, desiredColumn: 0 };
    assert.equal(decidePageGridKey(rows, gone, "ArrowDown", "on-cell").kind, "inert");
  });
});

describe("where the selection rests", () => {
  test("the editor opens on the first rule's handle, whatever that rule holds", () => {
    const { both, rows } = makeMixedPage();
    assert.deepEqual(resolvePageGridCursor(rows).cell, { kind: "handle", ruleId: both.ruleId() });

    const { rules } = makePage(1);
    const bareRows = pageGridRows([{ ...describeRule(rules[0]), hasSentence: false }]);
    assert.deepEqual(resolvePageGridCursor(bareRows).cell, { kind: "handle", ruleId: rules[0].ruleId() });
  });

  test("a cell the page has lost falls back to its own rule's handle", () => {
    const { whenOnly, rows } = makeMixedPage();
    const lost: PageGridCell = { kind: "tile", ruleId: whenOnly.ruleId(), side: RuleSide.Do, tileIndex: 4 };
    assert.deepEqual(resolvePageGridCursor(rows, lost).cell, { kind: "handle", ruleId: whenOnly.ruleId() });
  });

  test("a rule the page has lost falls back to the first cell", () => {
    const { both, rows } = makeMixedPage();
    assert.deepEqual(resolvePageGridCursor(rows, { kind: "sentence", ruleId: "gone" }).cell, {
      kind: "handle",
      ruleId: both.ruleId(),
    });
  });

  test("a page holding no rules rests on its add-rule control, the only cell it stands", () => {
    const rows = pageGridRows([]);
    assert.deepEqual(resolvePageGridCursor(rows).cell, kAppendRuleCell);
    assert.deepEqual(rows.flat(), [kAppendRuleCell]);
  });

  test("the add-rule control the page still stands keeps the selection", () => {
    const { rows } = makeMixedPage();
    assert.deepEqual(resolvePageGridCursor(rows, kAppendRuleCell).cell, kAppendRuleCell);
  });
});

describe("the tile row and the sentence reading one position", () => {
  test("a tile cell taken into the sentence and back returns to the cell it started on", () => {
    const { both } = makeMixedPage();
    const run = caretRun(both);

    for (const cell of [
      { kind: "tile", ruleId: both.ruleId(), side: RuleSide.When, tileIndex: 0 },
      { kind: "tile", ruleId: both.ruleId(), side: RuleSide.Do, tileIndex: 0 },
    ] satisfies PageGridCell[]) {
      const caret = composerEntryCaret(run, { kind: "element", side: cell.side, tileIndex: cell.tileIndex });
      assert.deepEqual(caret, { kind: "element", side: cell.side, tileIndex: cell.tileIndex });
      assert.deepEqual(pageGridCellAfterComposing(both.ruleId(), caret), cell);
    }
  });

  test("a caret resting in a gap rests the selection on the rule's sentence", () => {
    const { both } = makeMixedPage();
    const run = caretRun(both);

    for (const remembered of [undefined, { kind: "gap", side: RuleSide.When, tileIndex: 0 } as const]) {
      const caret = composerEntryCaret(run, remembered);
      assert.equal(caret.kind, "gap");
      assert.deepEqual(pageGridCellAfterComposing(both.ruleId(), caret), { kind: "sentence", ruleId: both.ruleId() });
    }
  });

  test("a rule standing at no caret at all rests the selection on its sentence", () => {
    const { bare } = makeMixedPage();
    assert.deepEqual(pageGridCellAfterComposing(bare.ruleId(), undefined), { kind: "sentence", ruleId: bare.ruleId() });
  });
});

describe("the steps a rule can take", () => {
  test("each move the model would carry out reads as one direction, in reading order", () => {
    assert.deepEqual(ruleMoveDirections({ canMoveUp: true, canMoveDown: true, canIndent: true, canOutdent: true }), [
      "up",
      "down",
      "outdent",
      "indent",
    ]);
  });

  test("the page's first rule offers neither up nor indent, having nothing above it", () => {
    const { rules } = makePage(3);
    const first = rules[0];
    assert.deepEqual(
      ruleMoveDirections({
        canMoveUp: first.canMoveUp(),
        canMoveDown: first.canMoveDown(),
        canIndent: first.canIndent(),
        canOutdent: first.canOutdent(),
      }),
      ["down"]
    );
  });

  test("the page's last rule offers no down", () => {
    const { rules } = makePage(3);
    const last = rules[2];
    assert.deepEqual(
      ruleMoveDirections({
        canMoveUp: last.canMoveUp(),
        canMoveDown: last.canMoveDown(),
        canIndent: last.canIndent(),
        canOutdent: last.canOutdent(),
      }),
      ["up", "indent"]
    );
  });

  test("a rule at the outermost indent offers no outdent, and offers one once nested", () => {
    const { rules } = makePage(3);
    const nested = rules[2];
    assert.equal(nested.canOutdent(), false);
    nested.indent();
    assert.equal(nested.canOutdent(), true);
    assert.deepEqual(
      ruleMoveDirections({
        canMoveUp: nested.canMoveUp(),
        canMoveDown: nested.canMoveDown(),
        canIndent: nested.canIndent(),
        canOutdent: nested.canOutdent(),
      }),
      ["outdent"]
    );
  });
});

describe("who the arrow keys belong to", () => {
  const onCell = (key: string, withCommand = false): PageGridKeyPress => ({ key, withCommand, placement: "on-cell" });

  /** The four arrow keys and the step each one takes a rule by. */
  const arrowMoves = [
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["ArrowLeft", "outdent"],
    ["ArrowRight", "indent"],
  ] as const;

  /** The three rules of a page, and the cursor resting on the second one's handle. */
  function handleCursor() {
    const { rules } = makePage(3);
    const rows = pageGridRows(rules.map(describeRule));
    return { rules, rows, cursor: cursorAt(rows, { kind: "handle", ruleId: rules[1].ruleId() }) };
  }

  test("with no rule held the arrows move the selection", () => {
    const { rows, cursor } = handleCursor();
    for (const key of ["ArrowUp", "ArrowDown", "ArrowRight"]) {
      assert.equal(decidePageKey(rows, cursor, onCell(key), undefined).kind, "select");
    }
  });

  test("with a rule held the same arrows move that rule and the selection stays put", () => {
    const { rules, rows, cursor } = handleCursor();
    const held = rules[1].ruleId();
    for (const [key, direction] of arrowMoves) {
      assert.deepEqual(decidePageKey(rows, cursor, onCell(key), held), { kind: "move-rule", ruleId: held, direction });
    }
  });

  test("with no rule held the modified arrows move the rule the selection stands on", () => {
    const { rules, rows, cursor } = handleCursor();
    for (const [key, direction] of arrowMoves) {
      assert.deepEqual(decidePageKey(rows, cursor, onCell(key, true), undefined), {
        kind: "move-rule",
        ruleId: rules[1].ruleId(),
        direction,
      });
    }
  });

  test("every cell of a rule moves that one rule", () => {
    const { rules, rows } = handleCursor();
    for (const cell of [
      { kind: "sentence", ruleId: rules[2].ruleId() },
      { kind: "append", ruleId: rules[2].ruleId(), side: RuleSide.When },
    ] satisfies PageGridCell[]) {
      assert.deepEqual(decidePageKey(rows, cursorAt(rows, cell), onCell("ArrowUp", true), undefined), {
        kind: "move-rule",
        ruleId: rules[2].ruleId(),
        direction: "up",
      });
    }
  });

  test("a modified arrow held over the add-rule control is consumed, moving nothing", () => {
    const { rows } = handleCursor();
    const appendRule = cursorAt(rows, kAppendRuleCell);
    for (const [key] of arrowMoves) {
      assert.deepEqual(decidePageKey(rows, appendRule, onCell(key, true), undefined), { kind: "consume" });
    }
  });

  test("a step the rule cannot take is refused by the capabilities the move reads", () => {
    const { rules, rows } = handleCursor();
    const first = cursorAt(rows, { kind: "handle", ruleId: rules[0].ruleId() });
    assert.deepEqual(decidePageKey(rows, first, onCell("ArrowUp", true), undefined), {
      kind: "move-rule",
      ruleId: rules[0].ruleId(),
      direction: "up",
    });
    assert.equal(
      ruleMoveDirections({
        canMoveUp: rules[0].canMoveUp(),
        canMoveDown: rules[0].canMoveDown(),
        canIndent: rules[0].canIndent(),
        canOutdent: rules[0].canOutdent(),
      }).includes("up"),
      false
    );
  });

  test("Enter sets the held rule down and Escape gives it back", () => {
    const { rules, rows, cursor } = handleCursor();
    assert.deepEqual(decidePageKey(rows, cursor, onCell("Enter"), rules[1].ruleId()), { kind: "drop" });
    assert.deepEqual(decidePageKey(rows, cursor, onCell("Escape"), rules[1].ruleId()), { kind: "cancel" });
  });

  test("neither key does anything with no rule held", () => {
    const { rows, cursor } = handleCursor();
    for (const key of ["Enter", "Escape"]) {
      assert.equal(decidePageKey(rows, cursor, onCell(key), undefined).kind, "inert");
    }
  });

  test("a held rule leaves every other key alone, the insertion chord included", () => {
    const { rules, rows, cursor } = handleCursor();
    for (const press of [onCell("Delete"), onCell("c", true), onCell("Enter", true), onCell("a")]) {
      assert.equal(decidePageKey(rows, cursor, press, rules[1].ruleId()).kind, "inert");
    }
  });

  test("a key arriving from inside a cell reaches neither the held rule nor the selection", () => {
    const { rules, rows, cursor } = handleCursor();
    for (const withCommand of [false, true]) {
      const inside: PageGridKeyPress = { key: "ArrowUp", withCommand, placement: "inside-cell" };
      assert.equal(decidePageKey(rows, cursor, inside, rules[1].ruleId()).kind, "inert");
      assert.equal(decidePageKey(rows, cursor, inside, undefined).kind, "inert");
    }
  });
});
