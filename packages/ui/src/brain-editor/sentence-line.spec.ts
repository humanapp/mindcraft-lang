/**
 * Pins the sentence line's rendered shape: one sentence element per rule that
 * projects segments, source-tile indices on word segments and on nothing else,
 * the variable register marker, and no element at all for an empty rule.
 *
 * Structural assertions only: every value asserted here is an attribute the
 * later phases address a word by, or a marker derived from a tile's kind.
 * Sentence wording belongs to the core projection's goldens.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { mkVariableTileId, RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainCommandHistory, BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import {
  BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileSensorDef,
  BrainTileVariableDef,
} from "@mindcraft-lang/core/brain/tiles";
import { bag, CoreTypeIds, mkActionDescriptor, mkCallDef, NIL_VALUE } from "@mindcraft-lang/core/runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainRuleEditor } from "./BrainRuleEditor";
import { BrainRuleSentence } from "./BrainRuleSentence";

let services: BrainServices;
let nextFnId = 4800;

function makeSensor(sensorId: string, label: string): BrainTileSensorDef {
  const fnId = nextFnId;
  nextFnId += 1;
  const fnEntry = services.runtime.functions.register(
    fnId,
    `${sensorId}#${fnId}`,
    false,
    { exec: () => NIL_VALUE },
    mkCallDef(bag())
  );
  return new BrainTileSensorDef(sensorId, mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Boolean), {
    metadata: { label },
  });
}

function makeActuator(actuatorId: string, label: string): BrainTileActuatorDef {
  const fnId = nextFnId;
  nextFnId += 1;
  const fnEntry = services.runtime.functions.register(
    fnId,
    `${actuatorId}#${fnId}`,
    false,
    { exec: () => NIL_VALUE },
    mkCallDef(bag())
  );
  return new BrainTileActuatorDef(actuatorId, mkActionDescriptor("actuator", fnEntry), { metadata: { label } });
}

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
};

/** A brain whose first rule holds `whenTiles` and `doTiles`. */
function makeBrain(whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]) {
  const brainDef = BrainDef.emptyBrainDef(services, "sentence-line");
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  const ruleDef = pageDef.children().get(0) as BrainRuleDef;
  for (const tileDef of whenTiles) ruleDef.when().appendTile(tileDef);
  for (const tileDef of doTiles) ruleDef.do().appendTile(tileDef);
  return { brainDef, pageDef, ruleDef };
}

function renderSentence(ruleDef: BrainRuleDef): string {
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: editorConfig },
      createElement(BrainRuleSentence, { ruleDef, updateCounter: 0 })
    )
  );
}

function renderRuleCard(ruleDef: BrainRuleDef, pageDef: BrainPageDef): string {
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: editorConfig },
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
  );
}

/** How many times `pattern` occurs in `markup`. */
function countOf(markup: string, pattern: string): number {
  return markup.split(pattern).length - 1;
}

/** The `data-sentence-tile-index` values of `markup`, in document order. */
function sourceIndices(markup: string): number[] {
  return [...markup.matchAll(/data-sentence-tile-index="(\d+)"/g)].map((match) => Number(match[1]));
}

before(() => {
  services = __test__createBrainServices();
});

describe("sentence line rendering", () => {
  test("a rule card renders exactly one sentence element", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("line-see", "see")], [makeActuator("line-move", "move")]);
    assert.equal(countOf(renderRuleCard(ruleDef, pageDef), "data-rule-sentence="), 1);
  });

  test("an empty rule renders no sentence element", () => {
    const { ruleDef, pageDef } = makeBrain([], []);
    assert.equal(countOf(renderRuleCard(ruleDef, pageDef), "data-rule-sentence="), 0);
    assert.equal(renderSentence(ruleDef), "");
  });

  test("word segments carry the index of the tile they render", () => {
    const { ruleDef } = makeBrain([makeSensor("line-hear", "hear")], [makeActuator("line-say", "say")]);
    const indices = sourceIndices(renderSentence(ruleDef));
    assert.ok(indices.length >= 2, "the sentence renders a word for each side");
    assert.deepEqual([...new Set(indices)].sort(), [0, 1]);
  });

  test("a word's source index addresses its tile in the rule's flattened order", () => {
    const whenTile = makeSensor("line-index-when", "hear");
    const doTile = makeActuator("line-index-do", "say");
    const { ruleDef } = makeBrain([whenTile], [doTile]);
    const indices = sourceIndices(renderSentence(ruleDef));
    const flattened = [
      { side: RuleSide.When, tileDef: whenTile },
      { side: RuleSide.Do, tileDef: doTile },
    ];
    for (const index of indices) {
      assert.ok(flattened[index], `index ${index} addresses a tile of the rule`);
    }
  });

  test("glue segments carry no source index", () => {
    const { ruleDef } = makeBrain([makeSensor("line-glue", "hear")], []);
    const markup = renderSentence(ruleDef);
    const spans = countOf(markup, "<span");
    assert.ok(spans > sourceIndices(markup).length, "the sentence renders glue spans alongside its words");
  });

  test("a variable-sourced word carries the variable register marker", () => {
    const varTile = new BrainTileVariableDef(mkVariableTileId("speedy"), "speedy", CoreTypeIds.Number, "speedy");
    const { ruleDef } = makeBrain([varTile], []);
    assert.equal(countOf(renderSentence(ruleDef), 'data-sentence-register="variable"'), 1);
  });

  test("a numeric literal word carries the literal register marker", () => {
    const literal = new BrainTileLiteralDef(CoreTypeIds.Number, 3, {}, services);
    const { ruleDef } = makeBrain([literal], []);
    assert.equal(countOf(renderSentence(ruleDef), 'data-sentence-register="literal"'), 1);
  });

  test("a text literal word carries the literal register marker too", () => {
    const literal = new BrainTileLiteralDef(CoreTypeIds.String, "go left", {}, services);
    const { ruleDef } = makeBrain([literal], []);
    assert.equal(countOf(renderSentence(ruleDef), 'data-sentence-register="literal"'), 1);
  });

  test("a word sourced from neither a variable nor a value literal carries no register marker", () => {
    const { ruleDef } = makeBrain([makeSensor("line-register", "hear")], []);
    assert.equal(countOf(renderSentence(ruleDef), "data-sentence-register="), 0);
  });

  test("the sentence element belongs to the rule it reads", () => {
    const { ruleDef } = makeBrain([makeSensor("line-owner", "hear")], []);
    assert.ok(renderSentence(ruleDef).includes(`data-rule-sentence="${ruleDef.id()}"`));
  });
});
