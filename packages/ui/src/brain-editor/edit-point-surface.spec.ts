/**
 * Pins the edit point's rendered surface: the position pivot the strip shows
 * for a target armed on a placed tile from the tray and shows for no other
 * target, the pivot marking the armed position, the ring staying on the anchor
 * tile through every position, and the sentence carrying a word per tile with a
 * caret in each word boundary the composer's input does not stand in.
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

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
};

/** A brain whose first rule holds `whenTiles` and `doTiles`. */
function makeBrain(whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]) {
  return makeRuleBrain(services, whenTiles, doTiles);
}

function renderRuleCard(ruleDef: BrainRuleDef, pageDef: BrainPageDef, target?: ArmedTileTarget): string {
  const controller: ArmedTargetController = { target: target ?? null, arm: () => {}, disarm: () => {} };
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
    const { ruleDef, pageDef } = makeBrain([makeSensor("pivot-see")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "replace",
      tileIndex: 0,
      anchorTileIndex: 0,
      onTileSelected: () => true,
    };
    assert.equal(countOf(renderRuleCard(ruleDef, pageDef, target), "data-edit-point-pivot="), 1);
  });

  test("a target armed from the add-tile button shows none", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("pivot-hear")], []);
    const target: ArmedTileTarget = { ruleDef, side: RuleSide.When, mode: "append", onTileSelected: () => true };
    assert.equal(countOf(renderRuleCard(ruleDef, pageDef, target), "data-edit-point-pivot="), 0);
  });

  test("it offers all three positions, one of them checked", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("pivot-smell")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "replace",
      tileIndex: 0,
      anchorTileIndex: 0,
      onTileSelected: () => true,
    };
    const tags = pivotTags(renderRuleCard(ruleDef, pageDef, target));
    assert.equal(tags.length, 3);
    assert.equal(tags.filter((tag) => tag.includes('aria-pressed="true"')).length, 1);
  });

  test("an insert addressing the anchor reads as the before position", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("pivot-before-a"), makeSensor("pivot-before-b")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "insert",
      tileIndex: 1,
      anchorTileIndex: 1,
      onTileSelected: () => true,
    };
    assert.equal(
      attributeOf(renderRuleCard(ruleDef, pageDef, target), "data-edit-point-pivot=", "data-edit-point-pivot"),
      "before"
    );
  });

  test("an append armed on the last tile reads as the after position", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("pivot-after")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "append",
      anchorTileIndex: 0,
      onTileSelected: () => true,
    };
    const markup = renderRuleCard(ruleDef, pageDef, target);
    assert.equal(attributeOf(markup, "data-edit-point-pivot=", "data-edit-point-pivot"), "after");
  });

  test("the anchor tile carries the armed description through the position that appends", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("pivot-anchor")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "append",
      anchorTileIndex: 0,
      onTileSelected: () => true,
    };
    const markup = renderRuleCard(ruleDef, pageDef, target);
    const tileTag = /<button[^>]*data-scrollable[^>]*>/.exec(markup)?.[0];
    assert.ok(tileTag, "the card renders the placed tile");
    const describedBy = /aria-describedby="([^"]+)"/.exec(tileTag)?.[1];
    assert.ok(describedBy, "the armed tile names its description");
    assert.equal(countOf(markup, `id="${describedBy}"`), 1);
  });
});

describe("the sentence as an editing surface", () => {
  test("a settled sentence renders a caret in each of its word boundaries", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("caret-see")], [makeActuator("caret-move")]);
    const markup = renderRuleCard(ruleDef, pageDef);
    assert.equal(countOf(markup, "data-sentence-caret="), 2, "one caret opens each of the two tiles' words");
  });

  test("each caret names the tile it inserts before", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("caret-index-see")], [makeActuator("caret-index-move")]);
    const markup = renderRuleCard(ruleDef, pageDef);
    const indices = [...markup.matchAll(/data-sentence-caret="(\d+)"/g)].map((match) => Number(match[1]));
    assert.deepEqual(indices, [0, 1]);
  });

  test("a rule under composition keeps a caret in every boundary but the armed one", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("caret-composing")], [makeActuator("caret-composing-move")]);
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
    const markup = renderRuleCard(ruleDef, pageDef, target);
    const indices = [...markup.matchAll(/data-sentence-caret="(\d+)"/g)].map((match) => Number(match[1]));
    assert.deepEqual(indices, [0], "the armed tile's boundary hosts the input, and the other keeps its caret");
  });

  test("a rule armed at the end of its line keeps every caret", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("caret-append")], [makeActuator("caret-append-move")]);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.Do,
      mode: "append",
      caret: { kind: "gap", side: RuleSide.Do, tileIndex: 1 },
      entry: "sentence",
      onTileSelected: () => true,
    };
    const markup = renderRuleCard(ruleDef, pageDef, target);
    assert.equal(countOf(markup, "data-sentence-caret="), 2);
  });

  test("a target armed from the sentence shows no position pivot", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("caret-no-pivot")], []);
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
    assert.equal(countOf(renderRuleCard(ruleDef, pageDef, target), "data-edit-point-pivot="), 0);
  });

  test("a caret takes no layout width, so the settled line reads as its own text", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("caret-flow")], []);
    const caretTag = /<button[^>]*data-sentence-caret="\d+"[^>]*>/.exec(renderRuleCard(ruleDef, pageDef))?.[0];
    assert.ok(caretTag, "the settled line renders a caret");
    const tokens = /class="([^"]*)"/.exec(caretTag)?.[1].split(" ") ?? [];
    assert.ok(tokens.includes("absolute"), "the caret is out of the line's flow");
    for (const inFlow of ["inline-block", "inline-flex", "block", "relative", "static"]) {
      assert.ok(!tokens.includes(inFlow), `the caret takes no ${inFlow} box in the line`);
    }
  });

  test("a settled word is a control, and keeps the source index it is addressed by", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("caret-word")], []);
    const markup = renderRuleCard(ruleDef, pageDef);
    assert.ok(countOf(markup, "data-sentence-tile-index=") >= 1, "the sentence reads a word for the tile");
    const wordTags = [...markup.matchAll(/<button[^>]*data-sentence-tile-index="\d+"[^>]*>/g)];
    assert.equal(wordTags.length, countOf(markup, "data-sentence-tile-index="));
  });
});
