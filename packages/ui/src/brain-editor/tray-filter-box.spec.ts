/**
 * Pins the tray's filter box as an opt-in: a position armed from the tile row
 * opens on its chips, with the box rendered but not shown and the position row
 * standing the control that shows it. Pins with it the key the closed box
 * serves for the tray -- Delete, which takes out the tile the position was
 * opened on -- and that a position armed from a rule's sentence stands no such
 * control, its box being inline at the caret.
 *
 * Structural assertions only: every value asserted here is a marker attribute,
 * an id reference, a state flag, or a class token carrying the box's
 * visibility. Labels and placeholders are display prose and are never asserted.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainCommandHistory, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ArmedTargetController, ArmedTargetProvider, type ArmedTileTarget } from "./ArmedTargetContext";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainRuleEditor } from "./BrainRuleEditor";
import type { CaretPosition } from "./caret-run";
import { composerTrayToken } from "./composer-input-model";
import { makeBrain as makeRuleBrain, makeSensor } from "./test-only-rule-fixtures";

let services: BrainServices;

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
};

before(() => {
  services = __test__createBrainServices();
});

/** A brain whose first rule holds `whenTiles` on its WHEN side. */
function makeBrain(whenTiles: readonly IBrainTileDef[]) {
  return makeRuleBrain(services, whenTiles, []);
}

function renderRuleCard(ruleDef: BrainRuleDef, target: ArmedTileTarget | null): string {
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
        createElement(BrainRuleEditor, {
          ruleDef,
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
    entry: "tray",
    onTileSelected: () => true,
  };
}

/** The target the add-tile control arms at the end of `side`. */
function appendTarget(ruleDef: BrainRuleDef, side: RuleSide): ArmedTileTarget {
  return { ruleDef, side, mode: "append", entry: "tray", onTileSelected: () => true };
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

/** How many times `pattern` occurs in `markup`. */
function countOf(markup: string, pattern: string): number {
  return markup.split(pattern).length - 1;
}

/** The opening tag of the control that shows the tray's filter box, or undefined when the panel stands none. */
function searchTag(markup: string): string | undefined {
  return /<button[^>]*data-strip-search=""[^>]*>/.exec(markup)?.[0];
}

/** The value of `attribute` on `tag`, or undefined when the tag does not carry it. */
function attributeOf(tag: string | undefined, attribute: string): string | undefined {
  return tag === undefined ? undefined : new RegExp(`\\s${attribute}="([^"]*)"`).exec(tag)?.[1];
}

/** The class tokens of the element wrapping the tray's filter box. */
function boxWrapperClasses(markup: string): string[] {
  const wrapper = /<div class="([^"]*)"><span[^>]*><input[^>]*data-strip-filter="tray"/.exec(markup);
  assert.ok(wrapper, "the tray renders its filter box inside a wrapper");
  return wrapper[1].split(" ");
}

describe("the tray's filter box is opt-in", () => {
  test("a position armed on a placed tile stands the control, reporting the box closed", () => {
    const { ruleDef } = makeBrain([makeSensor(services, "tray-box-tile")]);
    const markup = renderRuleCard(ruleDef, tileTarget(ruleDef, RuleSide.When, 0));
    const search = searchTag(markup);
    assert.ok(search, "the position row stands the control");
    assert.equal(attributeOf(search, "aria-expanded"), "false");
  });

  test("a position armed at a side's end stands it too", () => {
    const { ruleDef } = makeBrain([]);
    assert.ok(searchTag(renderRuleCard(ruleDef, appendTarget(ruleDef, RuleSide.When))));
  });

  test("the control names the box it shows", () => {
    const { ruleDef } = makeBrain([makeSensor(services, "tray-box-controls")]);
    const markup = renderRuleCard(ruleDef, tileTarget(ruleDef, RuleSide.When, 0));
    const controls = attributeOf(searchTag(markup), "aria-controls");
    assert.ok(controls, "the control points at the box");
    assert.ok(
      new RegExp(`<input[^>]*\\sid="${controls}"[^>]*data-strip-filter="tray"`).test(markup),
      "and the box it points at is the tray's"
    );
  });

  test("the box is rendered while it is closed, so the keyboard has somewhere to type", () => {
    const { ruleDef } = makeBrain([makeSensor(services, "tray-box-rendered")]);
    const markup = renderRuleCard(ruleDef, tileTarget(ruleDef, RuleSide.When, 0));
    assert.equal(countOf(markup, 'data-strip-filter="tray"'), 1);
    assert.ok(boxWrapperClasses(markup).includes("sr-only"), "and it is out of sight until it is shown");
  });

  test("a caret of a rule's sentence stands no such control", () => {
    const { ruleDef } = makeBrain([makeSensor(services, "tray-box-sentence")]);
    const markup = renderRuleCard(ruleDef, wordTarget(ruleDef, RuleSide.When, 0));
    assert.equal(searchTag(markup), undefined);
    assert.equal(countOf(markup, 'data-strip-filter="sentence"'), 1, "the caret hosts the box itself");
  });

  test("no armed position stands it, since the panel it belongs to stands nowhere", () => {
    const { ruleDef } = makeBrain([makeSensor(services, "tray-box-unarmed")]);
    assert.equal(searchTag(renderRuleCard(ruleDef, null)), undefined);
  });
});

describe("the closed box serves Delete for the tray", () => {
  const element: CaretPosition = { kind: "element", side: RuleSide.When, tileIndex: 1 };

  test("Delete takes out the tile the position was opened on", () => {
    assert.deepEqual(composerTrayToken("Delete", "tray-armed", element), { kind: "delete-element", position: element });
  });

  test("an open box keeps the key, which edits the text in it", () => {
    assert.equal(composerTrayToken("Delete", "tray-filtering", element), undefined);
  });

  test("every mode but the tray's own leaves the key alone", () => {
    for (const mode of ["grid-selection", "rule-held", "tray-filtering", "composing", "text-literal"] as const) {
      assert.equal(composerTrayToken("Delete", mode, element), undefined, `the tray takes Delete in ${mode}`);
    }
  });

  test("a position standing on no placed tile has no tile to take out", () => {
    assert.equal(composerTrayToken("Delete", "tray-armed", undefined), undefined);
  });

  test("every other key is left alone", () => {
    for (const key of ["Backspace", "Enter", "d", " ", "ArrowDown", "Escape"]) {
      assert.equal(composerTrayToken(key, "tray-armed", element), undefined, `the tray takes ${JSON.stringify(key)}`);
    }
  });
});
