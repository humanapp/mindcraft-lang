/**
 * Pins the edit point's rendered surface: the position pivot the strip shows
 * for a target armed on a placed tile from the tray and shows for no other
 * target, the pivot marking the armed position, which of the two controls that
 * row stands for the anchor tile -- its documentation directly, or its menu --
 * the ring staying on the anchor tile through every position, and the sentence
 * carrying a word per tile with a caret in each word boundary the composer's
 * input does not stand in.
 *
 * Structural assertions only: every value asserted here is a role, a state
 * flag, or a marker attribute. Pivot labels and caret names are display prose
 * and are never asserted.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainCommandHistory, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";
import { CoreTypeIds } from "@mindcraft-lang/core/runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ArmedTargetController, ArmedTargetProvider, type ArmedTileTarget } from "./ArmedTargetContext";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainRuleEditor } from "./BrainRuleEditor";
import {
  makeActuator as makeActuatorTile,
  makeBrain as makeRuleBrain,
  makeSensor as makeSensorTile,
} from "./test-only-rule-fixtures";

let services: BrainServices;

function makeSensor(sensorId: string) {
  return makeSensorTile(services, sensorId);
}

function makeActuator(actuatorId: string) {
  return makeActuatorTile(services, actuatorId);
}

/** A number literal tile, whose menu offers its display format alongside its documentation. */
function makeNumericLiteral(value: number) {
  return new BrainTileLiteralDef(CoreTypeIds.Number, value, {}, services);
}

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
};

/** A host wiring up tile documentation, which every tile's menu then offers an entry of. */
const documentingConfig: BrainEditorConfig = { ...editorConfig, onTileDocs: () => {} };

/** Marks the control the position row stands to open the anchor tile's menu. */
const kTileMenuControl = "data-strip-tile-menu=";

/** Marks the control the position row stands to open the anchor tile's documentation directly. */
const kTileDocsControl = "data-strip-tile-docs=";

/** A brain whose first rule holds `whenTiles` and `doTiles`. */
function makeBrain(whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]) {
  return makeRuleBrain(services, whenTiles, doTiles);
}

function renderRuleCard(ruleDef: BrainRuleDef, target?: ArmedTileTarget): string {
  return renderCardWith(editorConfig, ruleDef, target);
}

/** The card as `config` renders it, with `target` armed. */
function renderCardWith(config: BrainEditorConfig, ruleDef: BrainRuleDef, target?: ArmedTileTarget): string {
  const controller: ArmedTargetController = { target: target ?? null, arm: () => {}, disarm: () => {} };
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config },
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

/** How many times `pattern` occurs in `markup`. */
function countOf(markup: string, pattern: string): number {
  return markup.split(pattern).length - 1;
}

/** The value of `attribute` on the element carrying `marker`. */
function attributeOf(markup: string, marker: string, attribute: string): string | undefined {
  const start = markup.indexOf(marker);
  if (start < 0) return undefined;
  const tagStart = markup.lastIndexOf("<", start);
  const tagEnd = markup.indexOf(">", start);
  return new RegExp(`${attribute}="([^"]+)"`).exec(markup.slice(tagStart, tagEnd))?.[1];
}

/** The opening tags of `markup` carrying `data-edit-point-position`, in document order. */
function pivotTags(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*data-edit-point-position="[a-z]+"[^>]*>/g)].map((match) => match[0]);
}

before(() => {
  services = __test__createBrainServices();
});

describe("the position pivot", () => {
  test("a target armed on a placed tile shows it", () => {
    const { ruleDef } = makeBrain([makeSensor("pivot-see")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "replace",
      tileIndex: 0,
      anchorTileIndex: 0,
      onTileSelected: () => true,
    };
    assert.equal(countOf(renderRuleCard(ruleDef, target), "data-edit-point-pivot="), 1);
  });

  test("a target armed from the add-tile button shows none", () => {
    const { ruleDef } = makeBrain([makeSensor("pivot-hear")], []);
    const target: ArmedTileTarget = { ruleDef, side: RuleSide.When, mode: "append", onTileSelected: () => true };
    assert.equal(countOf(renderRuleCard(ruleDef, target), "data-edit-point-pivot="), 0);
  });

  test("it offers all three positions, one of them checked", () => {
    const { ruleDef } = makeBrain([makeSensor("pivot-smell")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "replace",
      tileIndex: 0,
      anchorTileIndex: 0,
      onTileSelected: () => true,
    };
    const tags = pivotTags(renderRuleCard(ruleDef, target));
    assert.equal(tags.length, 3);
    assert.equal(tags.filter((tag) => tag.includes('aria-pressed="true"')).length, 1);
  });

  test("an insert addressing the anchor reads as the before position", () => {
    const { ruleDef } = makeBrain([makeSensor("pivot-before-a"), makeSensor("pivot-before-b")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "insert",
      tileIndex: 1,
      anchorTileIndex: 1,
      onTileSelected: () => true,
    };
    assert.equal(
      attributeOf(renderRuleCard(ruleDef, target), "data-edit-point-pivot=", "data-edit-point-pivot"),
      "before"
    );
  });

  test("an append armed on the last tile reads as the after position", () => {
    const { ruleDef } = makeBrain([makeSensor("pivot-after")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "append",
      anchorTileIndex: 0,
      onTileSelected: () => true,
    };
    const markup = renderRuleCard(ruleDef, target);
    assert.equal(attributeOf(markup, "data-edit-point-pivot=", "data-edit-point-pivot"), "after");
  });

  test("a tile offering only its documentation stands the control opening it, and no menu", () => {
    const { ruleDef } = makeBrain([makeSensor("pivot-menu")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "replace",
      tileIndex: 0,
      anchorTileIndex: 0,
      onTileSelected: () => true,
    };
    const markup = renderCardWith(documentingConfig, ruleDef, target);
    assert.equal(countOf(markup, kTileDocsControl), 1);
    assert.equal(countOf(markup, kTileMenuControl), 0);
  });

  test("a tile offering more than its documentation stands the menu instead", () => {
    const { ruleDef } = makeBrain([makeNumericLiteral(7)], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "replace",
      tileIndex: 0,
      anchorTileIndex: 0,
      onTileSelected: () => true,
    };
    const markup = renderCardWith(documentingConfig, ruleDef, target);
    assert.equal(countOf(markup, kTileMenuControl), 1);
    assert.equal(countOf(markup, kTileDocsControl), 0);
  });

  test("a tile whose menu offers nothing stands no such control", () => {
    const { ruleDef } = makeBrain([makeSensor("pivot-menu-empty")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "replace",
      tileIndex: 0,
      anchorTileIndex: 0,
      onTileSelected: () => true,
    };
    const markup = renderRuleCard(ruleDef, target);
    assert.equal(countOf(markup, kTileMenuControl), 0);
    assert.equal(countOf(markup, kTileDocsControl), 0);
  });

  test("a target standing on no placed tile stands none either", () => {
    const { ruleDef } = makeBrain([makeSensor("pivot-menu-append")], []);
    const target: ArmedTileTarget = { ruleDef, side: RuleSide.When, mode: "append", onTileSelected: () => true };
    const markup = renderCardWith(documentingConfig, ruleDef, target);
    assert.equal(countOf(markup, kTileMenuControl), 0);
    assert.equal(countOf(markup, kTileDocsControl), 0);
  });

  test("the anchor tile carries the armed description through the position that appends", () => {
    const { ruleDef } = makeBrain([makeSensor("pivot-anchor")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "append",
      anchorTileIndex: 0,
      onTileSelected: () => true,
    };
    const markup = renderRuleCard(ruleDef, target);
    const tileTag = /<button[^>]*data-scrollable[^>]*>/.exec(markup)?.[0];
    assert.ok(tileTag, "the card renders the placed tile");
    const describedBy = /aria-describedby="([^"]+)"/.exec(tileTag)?.[1];
    assert.ok(describedBy, "the armed tile names its description");
    assert.equal(countOf(markup, `id="${describedBy}"`), 1);
  });
});

describe("the sentence as an editing surface", () => {
  test("a settled sentence renders a caret in each of its word boundaries", () => {
    const { ruleDef } = makeBrain([makeSensor("caret-see")], [makeActuator("caret-move")]);
    const markup = renderRuleCard(ruleDef);
    assert.equal(countOf(markup, "data-sentence-caret="), 2, "one caret opens each of the two tiles' words");
  });

  test("each caret names the tile it inserts before", () => {
    const { ruleDef } = makeBrain([makeSensor("caret-index-see")], [makeActuator("caret-index-move")]);
    const markup = renderRuleCard(ruleDef);
    const indices = [...markup.matchAll(/data-sentence-caret="(\d+)"/g)].map((match) => Number(match[1]));
    assert.deepEqual(indices, [0, 1]);
  });

  test("a rule under composition keeps a caret in every boundary but the armed one", () => {
    const { ruleDef } = makeBrain([makeSensor("caret-composing")], [makeActuator("caret-composing-move")]);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.Do,
      mode: "replace",
      tileIndex: 0,
      anchorTileIndex: 0,
      caret: { kind: "element", side: RuleSide.Do, tileIndex: 0 },
      entry: "sentence",
      onTileSelected: () => true,
    };
    const markup = renderRuleCard(ruleDef, target);
    const indices = [...markup.matchAll(/data-sentence-caret="(\d+)"/g)].map((match) => Number(match[1]));
    assert.deepEqual(indices, [0], "the armed tile's boundary hosts the input, and the other keeps its caret");
  });

  test("a rule armed at the end of its line keeps every caret", () => {
    const { ruleDef } = makeBrain([makeSensor("caret-append")], [makeActuator("caret-append-move")]);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.Do,
      mode: "append",
      caret: { kind: "gap", side: RuleSide.Do, tileIndex: 1 },
      entry: "sentence",
      onTileSelected: () => true,
    };
    const markup = renderRuleCard(ruleDef, target);
    assert.equal(countOf(markup, "data-sentence-caret="), 2);
  });

  test("a target armed from the sentence shows no position pivot", () => {
    const { ruleDef } = makeBrain([makeSensor("caret-no-pivot")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "replace",
      tileIndex: 0,
      anchorTileIndex: 0,
      caret: { kind: "element", side: RuleSide.When, tileIndex: 0 },
      entry: "sentence",
      onTileSelected: () => true,
    };
    assert.equal(countOf(renderRuleCard(ruleDef, target), "data-edit-point-pivot="), 0);
  });

  test("a caret takes no layout width, so the settled line reads as its own text", () => {
    const { ruleDef } = makeBrain([makeSensor("caret-flow")], []);
    const caretTag = /<button[^>]*data-sentence-caret="\d+"[^>]*>/.exec(renderRuleCard(ruleDef))?.[0];
    assert.ok(caretTag, "the settled line renders a caret");
    const tokens = /class="([^"]*)"/.exec(caretTag)?.[1].split(" ") ?? [];
    assert.ok(tokens.includes("absolute"), "the caret is out of the line's flow");
    for (const inFlow of ["inline-block", "inline-flex", "block", "relative", "static"]) {
      assert.ok(!tokens.includes(inFlow), `the caret takes no ${inFlow} box in the line`);
    }
  });

  test("a settled word is a control, and keeps the source index it is addressed by", () => {
    const { ruleDef } = makeBrain([makeSensor("caret-word")], []);
    const markup = renderRuleCard(ruleDef);
    assert.ok(countOf(markup, "data-sentence-tile-index=") >= 1, "the sentence reads a word for the tile");
    const wordTags = [...markup.matchAll(/<button[^>]*data-sentence-tile-index="\d+"[^>]*>/g)];
    assert.equal(wordTags.length, countOf(markup, "data-sentence-tile-index="));
  });
});
