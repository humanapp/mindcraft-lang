/**
 * Pins the keys that act on the page's selection: which subject each cell
 * stands for, which verb each key asks of it, where the selection lands once
 * that subject leaves the page, and what the suggestion oracle answers about a
 * tile pasted onto the other side of a rule.
 *
 * Structural assertions only: every value asserted here is a cell, an
 * operation, a column index, or a decision. The rules are built through the
 * real brain model and every oracle answer comes from the real suggestion
 * oracle over the real core catalog.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, type ReadonlyList } from "@mindcraft-lang/core";
import type { BrainServices, IBrainTileDef, ITileCatalog } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import {
  AddRuleCommand,
  BrainCommandHistory,
  BrainDef,
  type BrainPageDef,
  type BrainRuleDef,
} from "@mindcraft-lang/core/brain/model";
import { CoreHostActions, mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/runtime";
import { positionOffersTile, sideOffersAppendedTile } from "./insertion-context";
import {
  decidePageGridGrab,
  decidePageGridOperation,
  kAppendRuleCell,
  type PageGridCell,
  type PageGridKeyPress,
  type PageGridOperation,
  type PageGridPosition,
  pageGridCellPosition,
  pageGridRows,
  type RuleCellDescriptor,
  resolvePageGridCursor,
} from "./page-grid-model";
import { makeBrain } from "./test-only-rule-fixtures";

let services: BrainServices;
let catalogs: ReadonlyList<ITileCatalog>;

before(() => {
  services = __test__createBrainServices();
  catalogs = List.from<ITileCatalog>([services.edit.tiles]).asReadonly();
});

/** A core tile def by id, failing loudly when the catalog does not hold it. */
function coreTile(tileId: string): IBrainTileDef {
  const tileDef = services.edit.tiles.get(tileId);
  assert.ok(tileDef, `core tile not registered: ${tileId}`);
  return tileDef;
}

/** A sensor the WHEN side of an empty rule takes. */
function whenSideTile(): IBrainTileDef {
  return coreTile(mkSensorTileId(CoreHostActions.Timeout.key));
}

/** An actuator the DO side of an empty rule takes. */
function doSideTile(): IBrainTileDef {
  return coreTile(mkActuatorTileId(CoreHostActions.SwitchPage.key));
}

const onCell = (key: string, withCommand = false): PageGridKeyPress => ({ key, withCommand, placement: "on-cell" });
const insideCell = (key: string, withCommand = false): PageGridKeyPress => ({
  key,
  withCommand,
  placement: "inside-cell",
});

const kRuleId = 7;
const handleCell: PageGridCell = { kind: "handle", ruleId: kRuleId };
const tileCell: PageGridCell = { kind: "tile", ruleId: kRuleId, side: RuleSide.When, tileIndex: 2 };
const appendCell: PageGridCell = { kind: "append", ruleId: kRuleId, side: RuleSide.Do };
const sentenceCell: PageGridCell = { kind: "sentence", ruleId: kRuleId };

/** What `press` asks of `cell`. */
function asked(cell: PageGridCell, press: PageGridKeyPress): PageGridOperation | undefined {
  return decidePageGridOperation(cell, press);
}

describe("the subject a cell stands for", () => {
  test("a tile cell stands its own tile", () => {
    assert.deepEqual(asked(tileCell, onCell("Delete")), {
      verb: "delete",
      subject: { kind: "tile", ruleId: kRuleId, side: RuleSide.When, tileIndex: 2 },
    });
  });

  test("a handle stands its whole rule", () => {
    assert.deepEqual(asked(handleCell, onCell("Delete")), {
      verb: "delete",
      subject: { kind: "rule", ruleId: kRuleId },
    });
  });

  test("an add-tile control stands the end of its side, which only a paste acts on", () => {
    assert.deepEqual(asked(appendCell, onCell("v", true)), {
      verb: "paste",
      subject: { kind: "side-end", ruleId: kRuleId, side: RuleSide.Do },
    });
    for (const key of ["Delete", "Backspace"]) assert.equal(asked(appendCell, onCell(key)), undefined);
    for (const key of ["c", "x"]) assert.equal(asked(appendCell, onCell(key, true)), undefined);
  });

  test("the sentence line stands no subject at all", () => {
    for (const press of [onCell("Delete"), onCell("c", true), onCell("x", true), onCell("v", true)]) {
      assert.equal(asked(sentenceCell, press), undefined);
    }
  });

  test("the page's add-rule control stands no subject at all", () => {
    for (const press of [onCell("Delete"), onCell("c", true), onCell("x", true), onCell("v", true)]) {
      assert.equal(asked(kAppendRuleCell, press), undefined);
    }
    assert.equal(asked(kAppendRuleCell, onCell("Enter", true)), undefined);
  });
});

describe("the clipboard keys act on the selected cell", () => {
  test("one key asks one verb, whichever subject the cell stands", () => {
    for (const [key, verb] of [
      ["c", "copy"],
      ["x", "cut"],
      ["v", "paste"],
    ] as const) {
      assert.deepEqual(asked(tileCell, onCell(key, true)), {
        verb,
        subject: { kind: "tile", ruleId: kRuleId, side: RuleSide.When, tileIndex: 2 },
      });
      assert.deepEqual(asked(handleCell, onCell(key, true)), { verb, subject: { kind: "rule", ruleId: kRuleId } });
    }
  });

  test("the same letters without the modifier are left alone", () => {
    for (const key of ["c", "x", "v"]) {
      assert.equal(asked(tileCell, onCell(key)), undefined);
      assert.equal(asked(handleCell, onCell(key)), undefined);
    }
  });

  test("both delete keys take the subject out", () => {
    for (const key of ["Delete", "Backspace"]) {
      assert.equal(asked(tileCell, onCell(key))?.verb, "delete");
      assert.equal(asked(handleCell, onCell(key))?.verb, "delete");
    }
  });
});

describe("the insertion chord", () => {
  test("a handle takes it and every other cell leaves it alone", () => {
    assert.deepEqual(asked(handleCell, onCell("Enter", true)), {
      verb: "insert-rule",
      subject: { kind: "rule", ruleId: kRuleId },
    });
    for (const cell of [tileCell, appendCell, sentenceCell]) {
      assert.equal(asked(cell, onCell("Enter", true)), undefined);
    }
  });

  test("Enter without the modifier is left alone", () => {
    assert.equal(asked(handleCell, onCell("Enter")), undefined);
  });
});

describe("what the keyboard resting inside a cell keeps", () => {
  test("every operating key belongs to the control there", () => {
    for (const cell of [handleCell, tileCell, appendCell]) {
      for (const press of [
        insideCell("Delete"),
        insideCell("Backspace"),
        insideCell("c", true),
        insideCell("x", true),
        insideCell("v", true),
        insideCell("Enter", true),
      ]) {
        assert.equal(decidePageGridOperation(cell, press), undefined);
      }
    }
  });

  test("the same keys on the cell itself act", () => {
    for (const press of [onCell("Delete"), onCell("c", true), onCell("x", true), onCell("v", true)]) {
      assert.notEqual(asked(tileCell, press), undefined);
    }
  });
});

describe("picking a rule up from its handle", () => {
  test("Enter and a space pick a rule up", () => {
    for (const key of ["Enter", " "]) {
      assert.equal(decidePageGridGrab(handleCell, onCell(key)), true);
    }
  });

  test("no other cell picks anything up", () => {
    for (const cell of [tileCell, appendCell, sentenceCell, kAppendRuleCell]) {
      assert.equal(decidePageGridGrab(cell, onCell("Enter")), false);
    }
  });

  test("the insertion chord and a key from inside the cell pick nothing up", () => {
    assert.equal(decidePageGridGrab(handleCell, onCell("Enter", true)), false);
    assert.equal(decidePageGridGrab(handleCell, insideCell("Enter")), false);
    assert.equal(decidePageGridGrab(handleCell, insideCell(" ")), false);
  });

  test("every other key on the handle picks nothing up", () => {
    for (const key of ["ArrowDown", "Delete", "Escape", "a"]) {
      assert.equal(decidePageGridGrab(handleCell, onCell(key)), false);
    }
  });
});

/** What `ruleDef` contributes to the grid, both add-tile answers taken from the oracle. */
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

/** A page of three rules, the first holding one tile on each side. */
function makeThreeRulePage(): { rules: BrainRuleDef[]; pageDef: BrainPageDef } {
  const brainDef = BrainDef.emptyBrainDef(services);
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  const rules = [pageDef.children().get(0) as BrainRuleDef, pageDef.appendNewRule(), pageDef.appendNewRule()];
  rules[0].when().appendTile(whenSideTile());
  rules[0].do().appendTile(doSideTile());
  rules[0].typecheck();
  return { rules, pageDef };
}

/** The rows of every rule but `dropped`, which stands for a rule taken out of the page. */
function rowsWithout(rules: readonly BrainRuleDef[], dropped?: BrainRuleDef) {
  return pageGridRows(rules.filter((ruleDef) => ruleDef !== dropped).map(describeRule));
}

describe("where the selection lands once its subject leaves", () => {
  test("a deleted tile hands the selection to whatever takes its place in the row", () => {
    const { rules } = makeThreeRulePage();
    const before = rowsWithout(rules);
    const gone: PageGridCell = { kind: "tile", ruleId: rules[0].id(), side: RuleSide.When, tileIndex: 0 };
    const place = pageGridCellPosition(before, gone) as PageGridPosition;

    rules[0].when().removeTileAtIndex(0);
    rules[0].typecheck();
    const after = rowsWithout(rules);

    const landed = resolvePageGridCursor(after, gone, place);
    assert.deepEqual(landed?.cell, { kind: "append", ruleId: rules[0].id(), side: RuleSide.When });
    assert.equal(landed?.desiredColumn, place.column);
    // Without the place held the selection falls back to the rule's handle.
    assert.deepEqual(resolvePageGridCursor(after, gone).cell, { kind: "handle", ruleId: rules[0].id() });
  });

  test("a deleted rule hands the selection to the rule that takes its row", () => {
    const { rules } = makeThreeRulePage();
    const before = rowsWithout(rules);
    const gone: PageGridCell = { kind: "handle", ruleId: rules[1].id() };
    const place = pageGridCellPosition(before, gone) as PageGridPosition;
    const after = rowsWithout(rules, rules[1]);

    assert.deepEqual(resolvePageGridCursor(after, gone, place).cell, { kind: "handle", ruleId: rules[2].id() });
  });

  test("the same deletion without a place held falls back to the page's first cell", () => {
    const { rules } = makeThreeRulePage();
    const gone: PageGridCell = { kind: "handle", ruleId: rules[1].id() };
    const after = rowsWithout(rules, rules[1]);

    assert.deepEqual(resolvePageGridCursor(after, gone).cell, { kind: "handle", ruleId: rules[0].id() });
  });

  test("the page's last rule hands the selection to the add-rule control that takes its row", () => {
    const { rules } = makeThreeRulePage();
    const before = rowsWithout(rules);
    const gone: PageGridCell = { kind: "handle", ruleId: rules[2].id() };
    const place = pageGridCellPosition(before, gone) as PageGridPosition;
    const after = rowsWithout(rules, rules[2]);

    assert.deepEqual(resolvePageGridCursor(after, gone, place).cell, kAppendRuleCell);
  });

  test("a place stands for nothing while the cell the selection rests on is still on the page", () => {
    const { rules } = makeThreeRulePage();
    const before = rowsWithout(rules);
    const kept: PageGridCell = { kind: "handle", ruleId: rules[1].id() };
    const place = pageGridCellPosition(before, kept) as PageGridPosition;
    const after = rowsWithout(rules, rules[0]);

    // The rule above it left, so the place it held now stands another rule's
    // cell; the selection follows the cell it rests on, not the place.
    assert.notDeepEqual(pageGridCellPosition(after, kept), place);
    assert.deepEqual(resolvePageGridCursor(after, kept, place).cell, kept);
  });
});

describe("the empty rule standing last on a page", () => {
  test("it is deleted, cut and picked up like any other rule", () => {
    const { rules } = makeThreeRulePage();
    const last = rules[rules.length - 1];
    assert.equal(last.isEmpty(true), true);
    const cell: PageGridCell = { kind: "handle", ruleId: last.id() };

    assert.equal(asked(cell, onCell("Delete"))?.verb, "delete");
    assert.equal(asked(cell, onCell("x", true))?.verb, "cut");
    assert.equal(decidePageGridGrab(cell, onCell("Enter")), true);
  });
});

describe("the page's add-rule control", () => {
  test("its command appends an empty rule at the end, and one undo takes it back", () => {
    const { rules, pageDef } = makeThreeRulePage();
    const history = new BrainCommandHistory();
    const before = pageDef.children().size();

    history.executeCommand(new AddRuleCommand(pageDef));
    assert.equal(pageDef.children().size(), before + 1);
    const appended = pageDef.children().get(before) as BrainRuleDef;
    assert.equal(appended.isEmpty(true), true);
    assert.equal(
      rules.some((ruleDef) => ruleDef.id() === appended.id()),
      false
    );

    history.undo();
    assert.equal(pageDef.children().size(), before);
  });

  test("the grid it appends to reads one more rule row pair", () => {
    const { rules, pageDef } = makeThreeRulePage();
    const before = rowsWithout(rules).length;
    new AddRuleCommand(pageDef).execute();
    const after = pageGridRows((pageDef.children().toArray() as BrainRuleDef[]).map(describeRule));
    assert.equal(after.length, before + 2);
    assert.deepEqual(after[after.length - 1], [kAppendRuleCell]);
  });
});

describe("a tile pasted onto the rule's other side", () => {
  test("the oracle offers each side's tile at that side and refuses it at the other", () => {
    const { ruleDef } = makeBrain(services, [], []);
    ruleDef.typecheck();
    const ask = (tileDef: IBrainTileDef, side: RuleSide) =>
      positionOffersTile({ ruleDef, side, tileIndex: 0, tileDef, catalogs, services });

    assert.equal(ask(whenSideTile(), RuleSide.When), true);
    assert.equal(ask(whenSideTile(), RuleSide.Do), false);
    assert.equal(ask(doSideTile(), RuleSide.Do), true);
    assert.equal(ask(doSideTile(), RuleSide.When), false);
  });

  test("a refused paste leaves the rule holding exactly what it held", () => {
    const { ruleDef } = makeBrain(services, [whenSideTile()], []);
    ruleDef.typecheck();
    const held = ruleDef
      .do()
      .tiles()
      .toArray()
      .map((tileDef) => tileDef.tileId);

    assert.equal(
      positionOffersTile({
        ruleDef,
        side: RuleSide.Do,
        tileIndex: 0,
        tileDef: whenSideTile(),
        catalogs,
        services,
      }),
      false
    );
    assert.deepEqual(
      ruleDef
        .do()
        .tiles()
        .toArray()
        .map((tileDef) => tileDef.tileId),
      held
    );
  });
});
