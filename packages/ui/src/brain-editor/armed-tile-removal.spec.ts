/**
 * Pins the offering's removal control: it stands exactly while the position
 * pivot stands and the armed position addresses a placed tile, so it is offered
 * for a position armed in the tile row and at no caret of a rule's sentence, and
 * nowhere else -- not in a gap, and not on a rule holding no tiles. Pins with it
 * that the control is its own control, outside the pivot's set of positions;
 * that it is rendered before the pivot, so a pivot that leaves takes only
 * content standing after the control; and that the row the control stands in is
 * rendered whether or not the control is.
 *
 * Structural assertions only: every value asserted here is a role, a marker
 * attribute, or the touch size of the control. Its label is display prose and
 * is never asserted.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainCommandHistory, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ArmedTargetController, ArmedTargetProvider, type ArmedTileTarget } from "./ArmedTargetContext";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainRuleEditor } from "./BrainRuleEditor";
import { makeActuator, makeBrain as makeRuleBrain, makeSensor } from "./test-only-rule-fixtures";

let services: BrainServices;

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
};

before(() => {
  services = __test__createBrainServices();
});

/** A brain whose first rule holds `whenTiles` and `doTiles`. */
function makeBrain(whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]) {
  return makeRuleBrain(services, whenTiles, doTiles);
}

function renderRuleCard(ruleDef: BrainRuleDef, pageDef: BrainPageDef, target: ArmedTileTarget | null): string {
  const controller: ArmedTargetController = { target, arm: () => {}, disarm: () => {} };
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: editorConfig },
      createElement(
        ArmedTargetProvider,
        { value: controller },
        createElement(BrainRuleEditor, {
          ruleDef,
          index: 0,
          pageDef,
          lineNumber: 1,
          ruleCount: 1,
          updateCounter: 0,
          commandHistory: new BrainCommandHistory(),
        })
      )
    )
  );
}

/** The target a tap on the tile at `tileIndex` of `side` arms in the tile row. */
function tileTarget(ruleDef: BrainRuleDef, side: RuleSide, tileIndex: number): ArmedTileTarget {
  return {
    ruleDef,
    side,
    mode: "replace",
    tileIndex,
    anchorTileIndex: tileIndex,
    onTileSelected: () => true,
  };
}

/** The target the position pivot arms for the gap before the tile at `tileIndex`, opened on that tile. */
function pivotBeforeTarget(ruleDef: BrainRuleDef, side: RuleSide, tileIndex: number): ArmedTileTarget {
  return {
    ruleDef,
    side,
    mode: "insert",
    tileIndex,
    anchorTileIndex: tileIndex,
    onTileSelected: () => true,
  };
}

/** The target the position pivot arms past the last tile of `side`, opened on that tile. */
function pivotAfterLastTarget(ruleDef: BrainRuleDef, side: RuleSide): ArmedTileTarget {
  return {
    ruleDef,
    side,
    mode: "append",
    anchorTileIndex: ruleDef.side(side).tiles().size() - 1,
    onTileSelected: () => true,
  };
}

/** The target a tap on the word reading the tile at `tileIndex` of `side` arms. */
function wordTarget(ruleDef: BrainRuleDef, side: RuleSide, tileIndex: number): ArmedTileTarget {
  return {
    ruleDef,
    side,
    mode: "replace",
    tileIndex,
    caret: { kind: "element", side, tileIndex },
    entry: "sentence",
    onTileSelected: () => true,
  };
}

/** The target a tap on the gap before the tile at `tileIndex` of `side` arms. */
function gapTarget(ruleDef: BrainRuleDef, side: RuleSide, tileIndex: number): ArmedTileTarget {
  return {
    ruleDef,
    side,
    mode: "insert",
    tileIndex,
    caret: { kind: "gap", side, tileIndex },
    entry: "sentence",
    onTileSelected: () => true,
  };
}

/** The target a tap at the end of `side` arms. */
function endTarget(ruleDef: BrainRuleDef, side: RuleSide): ArmedTileTarget {
  return {
    ruleDef,
    side,
    mode: "append",
    caret: { kind: "gap", side, tileIndex: ruleDef.side(side).tiles().size() },
    entry: "sentence",
    onTileSelected: () => true,
  };
}

/** How many times `pattern` occurs in `markup`. */
function countOf(markup: string, pattern: string): number {
  return markup.split(pattern).length - 1;
}

/** The opening tag of the removal control, or undefined when the panel offers none. */
function removalTag(markup: string): string | undefined {
  return /<button[^>]*data-strip-delete=""[^>]*>/.exec(markup)?.[0];
}

describe("removing the tile the armed position stands on", () => {
  test("a position armed in the tile row offers the removal", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor(services, "removal-tray-see")], []);
    const markup = renderRuleCard(ruleDef, pageDef, tileTarget(ruleDef, RuleSide.When, 0));
    assert.ok(removalTag(markup), "the panel offers the removal");
  });

  test("no caret of a rule's sentence offers it, since no pivot stands at one", () => {
    const { ruleDef, pageDef } = makeBrain(
      [makeSensor(services, "removal-word-see"), makeSensor(services, "removal-word-hear")],
      [makeActuator(services, "removal-word-move")]
    );
    const carets: readonly ArmedTileTarget[] = [
      wordTarget(ruleDef, RuleSide.When, 0),
      gapTarget(ruleDef, RuleSide.When, 1),
      endTarget(ruleDef, RuleSide.When),
      wordTarget(ruleDef, RuleSide.Do, 0),
      endTarget(ruleDef, RuleSide.Do),
    ];
    for (const target of carets) {
      const markup = renderRuleCard(ruleDef, pageDef, target);
      assert.equal(removalTag(markup), undefined, "the caret offers no removal");
      assert.equal(countOf(markup, "data-edit-point-pivot="), 0, "and no pivot stands at it");
    }
  });

  test("it is a control of its own, outside the pivot's positions", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor(services, "removal-not-a-pivot")], []);
    const markup = renderRuleCard(ruleDef, pageDef, tileTarget(ruleDef, RuleSide.When, 0));
    assert.equal(countOf(markup, "data-edit-point-position="), 3, "the pivot keeps its three positions");
    assert.equal(countOf(removalTag(markup) ?? "", "data-edit-point-position="), 0);
  });

  test("it is rendered before the position pivot", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor(services, "removal-before-pivot")], []);
    const markup = renderRuleCard(ruleDef, pageDef, tileTarget(ruleDef, RuleSide.When, 0));
    const removal = markup.indexOf('data-strip-delete=""');
    const pivot = markup.indexOf("data-edit-point-pivot=");
    assert.ok(removal >= 0, "the panel offers the removal");
    assert.ok(pivot >= 0, "the panel shows the pivot");
    assert.ok(removal < pivot, "the removal stands ahead of the pivot");
  });

  test("a pivot standing in a gap offers no removal", () => {
    const { ruleDef, pageDef } = makeBrain(
      [makeSensor(services, "removal-gap-see"), makeSensor(services, "removal-gap-hear")],
      []
    );
    const markup = renderRuleCard(ruleDef, pageDef, pivotBeforeTarget(ruleDef, RuleSide.When, 1));
    assert.equal(countOf(markup, "data-edit-point-pivot="), 1, "the pivot stands there");
    assert.equal(removalTag(markup), undefined, "and the gap it stands in offers no removal");
  });

  test("a pivot standing at a side's end offers no removal", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor(services, "removal-end-see")], []);
    const markup = renderRuleCard(ruleDef, pageDef, pivotAfterLastTarget(ruleDef, RuleSide.When));
    assert.equal(countOf(markup, "data-edit-point-pivot="), 1, "the pivot stands there");
    assert.equal(removalTag(markup), undefined, "and the side's end offers no removal");
  });

  test("a rule holding no tiles offers no removal wherever it is armed", () => {
    const { ruleDef, pageDef } = makeBrain([], []);
    assert.equal(removalTag(renderRuleCard(ruleDef, pageDef, endTarget(ruleDef, RuleSide.When))), undefined);
    assert.equal(removalTag(renderRuleCard(ruleDef, pageDef, null)), undefined, "and none while nothing is armed");
  });

  test("the row it stands in is rendered whether or not it is", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor(services, "removal-row-see")], []);
    const onElement = renderRuleCard(ruleDef, pageDef, tileTarget(ruleDef, RuleSide.When, 0));
    const inGap = renderRuleCard(ruleDef, pageDef, pivotAfterLastTarget(ruleDef, RuleSide.When));
    assert.ok(removalTag(onElement), "a position on a tile offers the removal");
    assert.equal(removalTag(inGap), undefined, "a position in a gap offers none");
    assert.equal(countOf(onElement, "data-strip-position-row="), 1);
    assert.equal(countOf(inGap, "data-strip-position-row="), 1, "and the row stands in both");
  });

  test("the control is finger-sized", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor(services, "removal-touch-size")], []);
    const markup = renderRuleCard(ruleDef, pageDef, tileTarget(ruleDef, RuleSide.When, 0));
    const tokens = /class="([^"]*)"/.exec(removalTag(markup) ?? "")?.[1].split(" ") ?? [];
    assert.ok(tokens.includes("min-h-11"), "the control keeps a touch-sized height");
  });
});
