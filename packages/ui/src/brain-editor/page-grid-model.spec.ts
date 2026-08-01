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
import { List, type ReadonlyList } from "@mindcraft-lang/core";
import type { BrainServices, ITileCatalog } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { caretRun, composerEntryCaret } from "./caret-run";
import { sideOffersAppendedTile } from "./insertion-context";
import {
  decidePageGridKey,
  type PageGridCell,
  type PageGridCursor,
  pageGridCellAfterComposing,
  pageGridCellKey,
  pageGridRows,
  type RuleCellDescriptor,
  resolvePageGridCursor,
} from "./page-grid-model";
import { makeActuator, makeSensor } from "./test-only-rule-fixtures";

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
    ruleId: ruleDef.id(),
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
      { kind: "handle", ruleId: bare.id() },
      { kind: "append", ruleId: bare.id(), side: RuleSide.When },
      { kind: "append", ruleId: bare.id(), side: RuleSide.Do },
    ]);
    assert.deepEqual(rows[5], [{ kind: "sentence", ruleId: bare.id() }]);
  });

  test("a side the oracle offers nothing at stands no cell", () => {
    const { both, rows } = makeMixedPage();
    assert.deepEqual(rows[0], [
      { kind: "handle", ruleId: both.id() },
      { kind: "tile", ruleId: both.id(), side: RuleSide.When, tileIndex: 0 },
      { kind: "tile", ruleId: both.id(), side: RuleSide.Do, tileIndex: 0 },
    ]);
  });

  test("the two sides answer independently", () => {
    const { whenOnly, rows } = makeMixedPage();
    assert.deepEqual(rows[2], [
      { kind: "handle", ruleId: whenOnly.id() },
      { kind: "tile", ruleId: whenOnly.id(), side: RuleSide.When, tileIndex: 0 },
      { kind: "append", ruleId: whenOnly.id(), side: RuleSide.Do },
    ]);
  });

  test("a rule reading no sentence contributes one row", () => {
    const { rules } = makePage(1);
    const rows = pageGridRows([{ ...describeRule(rules[0]), hasSentence: false }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][0].kind, "handle");
  });

  test("every cell of the page is addressed by its own key", () => {
    const { rows } = makeMixedPage();
    const keys = rows.flat().map(pageGridCellKey);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("stepping across the page", () => {
  test("right and left walk the row the cursor stands in", () => {
    const { both, rows } = makeMixedPage();
    const handle = cursorAt(rows, { kind: "handle", ruleId: both.id() });
    const whenTile = step(rows, handle, "ArrowRight");
    assert.deepEqual(whenTile?.cell, { kind: "tile", ruleId: both.id(), side: RuleSide.When, tileIndex: 0 });
    assert.deepEqual(step(rows, whenTile as PageGridCursor, "ArrowLeft")?.cell, handle.cell);
  });

  test("right steps over the side whose add-tile control stands no cell", () => {
    const { both, rows } = makeMixedPage();
    const whenTile = cursorAt(rows, { kind: "tile", ruleId: both.id(), side: RuleSide.When, tileIndex: 0 });
    assert.deepEqual(step(rows, whenTile, "ArrowRight")?.cell, {
      kind: "tile",
      ruleId: both.id(),
      side: RuleSide.Do,
      tileIndex: 0,
    });
  });

  test("down leaves a rule's tiles for its sentence, and its sentence for the next rule", () => {
    const { both, whenOnly, rows } = makeMixedPage();
    const handle = cursorAt(rows, { kind: "handle", ruleId: both.id() });
    const sentence = step(rows, handle, "ArrowDown");
    assert.deepEqual(sentence?.cell, { kind: "sentence", ruleId: both.id() });
    assert.deepEqual(step(rows, sentence as PageGridCursor, "ArrowDown")?.cell, {
      kind: "handle",
      ruleId: whenOnly.id(),
    });
  });

  test("up retraces the same steps", () => {
    const { whenOnly, both, rows } = makeMixedPage();
    const nextHandle = cursorAt(rows, { kind: "handle", ruleId: whenOnly.id() });
    assert.deepEqual(step(rows, nextHandle, "ArrowUp")?.cell, { kind: "sentence", ruleId: both.id() });
  });

  test("a step off either end of a row is refused", () => {
    const { both, rows } = makeMixedPage();
    const handle = cursorAt(rows, { kind: "handle", ruleId: both.id() });
    assert.equal(step(rows, handle, "ArrowLeft"), undefined);
    const lastTile = cursorAt(rows, { kind: "tile", ruleId: both.id(), side: RuleSide.Do, tileIndex: 0 });
    assert.equal(step(rows, lastTile, "ArrowRight"), undefined);
  });

  test("a step off the top or the bottom of the page is refused", () => {
    const { both, bare, rows } = makeMixedPage();
    assert.equal(step(rows, cursorAt(rows, { kind: "handle", ruleId: both.id() }), "ArrowUp"), undefined);
    assert.equal(step(rows, cursorAt(rows, { kind: "sentence", ruleId: bare.id() }), "ArrowDown"), undefined);
  });

  test("a key the grid does not walk by is refused", () => {
    const { both, rows } = makeMixedPage();
    const handle = cursorAt(rows, { kind: "handle", ruleId: both.id() });
    for (const key of ["Enter", " ", "Home", "Tab", "a"]) {
      assert.equal(decidePageGridKey(rows, handle, key, "on-cell").kind, "inert");
    }
  });
});

describe("the column vertical movement holds", () => {
  test("a shorter row rests at its last cell and gives the column back on the next step", () => {
    const { both, whenOnly, rows } = makeMixedPage();
    const lastTile = cursorAt(rows, { kind: "tile", ruleId: both.id(), side: RuleSide.Do, tileIndex: 0 });
    assert.equal(lastTile.desiredColumn, 2);
    const sentence = step(rows, lastTile, "ArrowDown") as PageGridCursor;
    assert.deepEqual(sentence.cell, { kind: "sentence", ruleId: both.id() });
    assert.equal(sentence.desiredColumn, 2);
    const returned = step(rows, sentence, "ArrowDown") as PageGridCursor;
    assert.deepEqual(returned.cell, { kind: "append", ruleId: whenOnly.id(), side: RuleSide.Do });
    assert.equal(returned.desiredColumn, 2);
  });

  test("a step along a row takes the column it lands in", () => {
    const { both, rows } = makeMixedPage();
    const lastTile = cursorAt(rows, { kind: "tile", ruleId: both.id(), side: RuleSide.Do, tileIndex: 0 });
    const back = step(rows, lastTile, "ArrowLeft") as PageGridCursor;
    assert.equal(back.desiredColumn, 1);
    assert.equal((step(rows, back, "ArrowDown") as PageGridCursor).desiredColumn, 1);
  });
});

describe("what the grid leaves alone", () => {
  test("a key pressed inside a cell belongs to the control there", () => {
    const { whenOnly, rows } = makeMixedPage();
    const sentence = cursorAt(rows, { kind: "sentence", ruleId: whenOnly.id() });
    for (const key of ["ArrowUp", "ArrowDown"]) {
      assert.equal(decidePageGridKey(rows, sentence, key, "inside-cell").kind, "inert");
      assert.equal(decidePageGridKey(rows, sentence, key, "on-cell").kind, "move");
    }
  });

  test("a cursor the page no longer holds moves nothing", () => {
    const { rows } = makeMixedPage();
    const gone: PageGridCursor = { cell: { kind: "handle", ruleId: -1 }, desiredColumn: 0 };
    assert.equal(decidePageGridKey(rows, gone, "ArrowDown", "on-cell").kind, "inert");
  });
});

describe("where the selection rests", () => {
  test("the editor opens on the first rule's handle, whatever that rule holds", () => {
    const { both, rows } = makeMixedPage();
    assert.deepEqual(resolvePageGridCursor(rows)?.cell, { kind: "handle", ruleId: both.id() });

    const { rules } = makePage(1);
    const bareRows = pageGridRows([{ ...describeRule(rules[0]), hasSentence: false }]);
    assert.deepEqual(resolvePageGridCursor(bareRows)?.cell, { kind: "handle", ruleId: rules[0].id() });
  });

  test("a cell the page has lost falls back to its own rule's handle", () => {
    const { whenOnly, rows } = makeMixedPage();
    const lost: PageGridCell = { kind: "tile", ruleId: whenOnly.id(), side: RuleSide.Do, tileIndex: 4 };
    assert.deepEqual(resolvePageGridCursor(rows, lost)?.cell, { kind: "handle", ruleId: whenOnly.id() });
  });

  test("a rule the page has lost falls back to the first cell", () => {
    const { both, rows } = makeMixedPage();
    assert.deepEqual(resolvePageGridCursor(rows, { kind: "sentence", ruleId: -1 })?.cell, {
      kind: "handle",
      ruleId: both.id(),
    });
  });

  test("a page holding no cells rests nowhere", () => {
    assert.equal(resolvePageGridCursor(pageGridRows([])), undefined);
  });
});

describe("the tile row and the sentence reading one position", () => {
  test("a tile cell taken into the sentence and back returns to the cell it started on", () => {
    const { both } = makeMixedPage();
    const run = caretRun(both);

    for (const cell of [
      { kind: "tile", ruleId: both.id(), side: RuleSide.When, tileIndex: 0 },
      { kind: "tile", ruleId: both.id(), side: RuleSide.Do, tileIndex: 0 },
    ] satisfies PageGridCell[]) {
      const caret = composerEntryCaret(run, { kind: "element", side: cell.side, tileIndex: cell.tileIndex });
      assert.deepEqual(caret, { kind: "element", side: cell.side, tileIndex: cell.tileIndex });
      assert.deepEqual(pageGridCellAfterComposing(both.id(), caret), cell);
    }
  });

  test("a caret resting in a gap rests the selection on the rule's sentence", () => {
    const { both } = makeMixedPage();
    const run = caretRun(both);

    for (const remembered of [undefined, { kind: "gap", side: RuleSide.When, tileIndex: 0 } as const]) {
      const caret = composerEntryCaret(run, remembered);
      assert.equal(caret.kind, "gap");
      assert.deepEqual(pageGridCellAfterComposing(both.id(), caret), { kind: "sentence", ruleId: both.id() });
    }
  });

  test("a rule standing at no caret at all rests the selection on its sentence", () => {
    const { bare } = makeMixedPage();
    assert.deepEqual(pageGridCellAfterComposing(bare.id(), undefined), { kind: "sentence", ruleId: bare.id() });
  });
});
