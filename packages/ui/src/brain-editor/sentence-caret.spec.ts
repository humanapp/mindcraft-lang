/**
 * Pins the sentence's rendering of caret state: one mark for a caret standing in
 * a gap and none for a caret resting on a tile, the focus treatment that tile's
 * words take in the tile's own hue and the box inside the word it is painted on,
 * the mark a pending replacement adds, the element the flash marking the
 * keyboard's return is painted on, the tappable structure the projection
 * supplies, and the filter box contributing no chrome and no width while nothing
 * is typed.
 *
 * Structural assertions only: marker attributes, counts, class tokens, and the
 * hue the host app resolves for the tile. The box's accessible name and every
 * word of the projection are display prose and are never asserted.
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
import { BrainRuleSentence } from "./BrainRuleSentence";
import type { CaretPosition } from "./caret-run";
import { makeActuator, makeBrain, makeObjectSensor, makeSensor } from "./test-only-rule-fixtures";

let services: BrainServices;

/** The hues the host app resolves every fixture tile in, one per rule side. */
const tileHues = { when: "#123456", do: "#abcdef" } as const;

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
  resolveTileVisual: () => ({ label: "", colorDef: { when: tileHues.when, do: tileHues.do } }),
};

before(() => {
  services = __test__createBrainServices();
});

function gap(side: RuleSide, tileIndex: number): CaretPosition {
  return { kind: "gap", side, tileIndex };
}

function element(side: RuleSide, tileIndex: number): CaretPosition {
  return { kind: "element", side, tileIndex };
}

/** The rule of a fresh brain holding `whenTiles` and `doTiles`. */
function ruleOf(whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]) {
  return makeBrain(services, whenTiles, doTiles);
}

/** The sentence line of `ruleDef`, hosting a caret at `caretPosition`. */
function renderLine(
  ruleDef: BrainRuleDef,
  options: { caretPosition?: CaretPosition; pending?: boolean; composing?: boolean } = {}
): string {
  const composing = options.composing ?? options.caretPosition !== undefined;
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: editorConfig },
      createElement(BrainRuleSentence, {
        ruleDef,
        updateCounter: 0,
        composerInput: composing ? createElement("input", { "data-test-composer-input": "" }) : undefined,
        caretPosition: options.caretPosition,
        pending: options.pending,
        placeCaret: () => {},
      })
    )
  );
}

/** The whole rule card, with `target` armed on it. */
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

/** The opening tag carrying `marker`, or undefined when `markup` has none. */
function tagWith(markup: string, marker: string): string | undefined {
  const at = markup.indexOf(marker);
  if (at < 0) return undefined;
  return markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
}

/** The inline style declared on the element carrying `marker`. */
function styleOf(markup: string, marker: string): string {
  const tag = tagWith(markup, marker);
  assert.ok(tag, `the line renders an element carrying ${marker}`);
  return /style="([^"]*)"/.exec(tag)?.[1] ?? "";
}

/** The `data-sentence-structure` values of `markup`, in document order. */
function structureIndices(markup: string): number[] {
  return [...markup.matchAll(/data-sentence-structure="(\d+)"/g)].map((match) => Number(match[1]));
}

describe("the caret's mark in the line", () => {
  test("a caret standing in a gap marks exactly one boundary", () => {
    const { ruleDef } = ruleOf([makeSensor(services, "mark-see")], [makeActuator(services, "mark-move")]);
    const markup = renderLine(ruleDef, { caretPosition: gap(RuleSide.Do, 0) });
    assert.equal(countOf(markup, "data-caret-mark"), 1);
    assert.equal(countOf(markup, "data-caret-focus"), 0);
  });

  test("every gap of the run marks one boundary and no more", () => {
    const { ruleDef } = ruleOf(
      [makeSensor(services, "mark-all-see"), makeSensor(services, "mark-all-hear")],
      [makeActuator(services, "mark-all-move")]
    );
    for (const position of [
      gap(RuleSide.When, 0),
      gap(RuleSide.When, 1),
      gap(RuleSide.When, 2),
      gap(RuleSide.Do, 0),
      gap(RuleSide.Do, 1),
    ]) {
      const markup = renderLine(ruleDef, { caretPosition: position });
      assert.equal(countOf(markup, "data-caret-mark"), 1, `${position.side}:${position.tileIndex}`);
    }
  });

  test("a caret resting on a tile marks no boundary", () => {
    const { ruleDef } = ruleOf([makeSensor(services, "mark-elem-see")], [makeActuator(services, "mark-elem-move")]);
    const markup = renderLine(ruleDef, { caretPosition: element(RuleSide.When, 0) });
    assert.equal(countOf(markup, "data-caret-mark"), 0);
  });

  test("the mark gives way to the text being typed", () => {
    const { ruleDef } = ruleOf([makeSensor(services, "mark-pending-see")], []);
    const markup = renderLine(ruleDef, { caretPosition: gap(RuleSide.When, 0), pending: true });
    assert.equal(countOf(markup, "data-caret-mark"), 0);
  });

  test("a line holding no caret marks nothing at all", () => {
    const { ruleDef } = ruleOf(
      [makeSensor(services, "mark-settled-see")],
      [makeActuator(services, "mark-settled-move")]
    );
    const markup = renderLine(ruleDef, { composing: false });
    assert.equal(countOf(markup, "data-caret-mark"), 0);
    assert.equal(countOf(markup, "data-caret-focus"), 0);
  });

  test("a rule card armed from its sentence carries one mark across the whole card", () => {
    const { ruleDef, pageDef } = ruleOf([makeSensor(services, "mark-card-see")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "insert",
      tileIndex: 0,
      caret: gap(RuleSide.When, 0),
      entry: "sentence",
      onTileSelected: () => true,
    };
    assert.equal(countOf(renderRuleCard(ruleDef, pageDef, target), "data-caret-mark"), 1);
  });
});

describe("the flash the caret's place takes", () => {
  test("the line paints it wherever a caret stands, and nowhere else", () => {
    const { ruleDef } = ruleOf([makeSensor(services, "landing-see")], [makeActuator(services, "landing-move")]);
    for (const position of [gap(RuleSide.When, 0), gap(RuleSide.Do, 1), element(RuleSide.When, 0)]) {
      const markup = renderLine(ruleDef, { caretPosition: position });
      assert.equal(countOf(markup, "data-caret-landing"), 1, `${position.kind} ${position.side}:${position.tileIndex}`);
    }
    assert.equal(countOf(renderLine(ruleDef, { composing: false }), "data-caret-landing"), 0);
  });

  test("it stands where the typed text does, which the caret's mark gives way to", () => {
    const { ruleDef } = ruleOf([makeSensor(services, "landing-pending")], []);
    const markup = renderLine(ruleDef, { caretPosition: gap(RuleSide.When, 0), pending: true });
    assert.equal(countOf(markup, "data-caret-landing"), 1);
    assert.equal(countOf(markup, "data-caret-mark"), 0);
  });

  test("it is painted on an element of its own, carrying neither the mark nor the focus nor a word", () => {
    const { ruleDef } = ruleOf([makeSensor(services, "landing-layer")], []);
    const onGap = tagWith(renderLine(ruleDef, { caretPosition: gap(RuleSide.When, 0) }), "data-caret-landing");
    assert.ok(onGap, "the line renders the element the flash is painted on");
    assert.ok(!onGap.includes("data-caret-mark"), "the flash is not the caret's mark");
    const onTile = tagWith(renderLine(ruleDef, { caretPosition: element(RuleSide.When, 0) }), "data-caret-landing");
    assert.ok(onTile, "the line renders it for a caret resting on a tile too");
    assert.ok(!onTile.includes("data-caret-focus"), "the flash is not the focus treatment");
    assert.ok(!onTile.includes("data-sentence-tile-index"), "and it is not a word of the sentence");
  });

  test("it takes no layout width and paints nothing at rest", () => {
    const { ruleDef } = ruleOf([makeSensor(services, "landing-rest")], []);
    const tag = tagWith(renderLine(ruleDef, { caretPosition: gap(RuleSide.When, 0) }), "data-caret-landing");
    const tokens = /class="([^"]*)"/.exec(tag ?? "")?.[1].split(" ") ?? [];
    assert.ok(tokens.includes("absolute"), "the flash stands out of the line's flow");
    assert.ok(tokens.includes("opacity-0"), "and paints nothing until the keyboard comes back");
  });
});

describe("the tile the caret rests on", () => {
  test("its word carries the focus, keyed by the tile the line reads it from", () => {
    const { ruleDef } = ruleOf([makeSensor(services, "focus-see")], [makeActuator(services, "focus-move")]);
    const markup = renderLine(ruleDef, { caretPosition: element(RuleSide.Do, 0) });
    assert.deepEqual(
      [...markup.matchAll(/data-caret-focus="(\d+)"/g)].map((match) => Number(match[1])),
      [1],
      "the DO side's first tile is the second of the rule's flattened tiles"
    );
  });

  test("no other tile's word carries it", () => {
    const { ruleDef } = ruleOf(
      [makeSensor(services, "focus-one-see"), makeSensor(services, "focus-one-hear")],
      [makeActuator(services, "focus-one-move")]
    );
    const markup = renderLine(ruleDef, { caretPosition: element(RuleSide.When, 1) });
    assert.equal(countOf(markup, "data-caret-focus"), 1);
  });

  test("the focus is painted in the tile's own hue on its own side", () => {
    const { ruleDef } = ruleOf([makeSensor(services, "hue-see")], [makeActuator(services, "hue-move")]);
    const whenStyle = styleOf(renderLine(ruleDef, { caretPosition: element(RuleSide.When, 0) }), "data-caret-focus");
    assert.ok(whenStyle.includes(tileHues.when), "the WHEN word takes the tile's when hue");
    assert.ok(!whenStyle.includes(tileHues.do), "and not the do hue");
    const doStyle = styleOf(renderLine(ruleDef, { caretPosition: element(RuleSide.Do, 0) }), "data-caret-focus");
    assert.ok(doStyle.includes(tileHues.do), "the DO word takes the tile's do hue");
    assert.ok(!doStyle.includes(tileHues.when), "and not the when hue");
  });

  test("the focus is painted on a box of its own inside the word, not on the word itself", () => {
    const { ruleDef } = ruleOf([makeSensor(services, "focus-layer-see")], []);
    const markup = renderLine(ruleDef, { caretPosition: element(RuleSide.When, 0) });
    const focusTag = tagWith(markup, "data-caret-focus");
    const wordTag = tagWith(markup, "data-sentence-tile-index");
    assert.ok(focusTag && wordTag, "the line renders both the word and the box its focus is painted on");
    assert.ok(!focusTag.includes("data-sentence-tile-index"), "the box the focus is painted on is not the word");
    assert.ok(!wordTag.includes("data-caret-focus"), "and the word does not carry the focus itself");
  });

  test("it is not superseded while nothing is typed", () => {
    const { ruleDef } = ruleOf([makeSensor(services, "supersede-none")], []);
    const markup = renderLine(ruleDef, { caretPosition: element(RuleSide.When, 0) });
    assert.equal(countOf(markup, "data-caret-superseded"), 0);
  });

  test("typed text marks it superseded, which no caret in a gap does", () => {
    const { ruleDef } = ruleOf([makeSensor(services, "supersede-see")], []);
    const onTile = renderLine(ruleDef, { caretPosition: element(RuleSide.When, 0), pending: true });
    assert.equal(countOf(onTile, "data-caret-superseded"), 1);
    const inGap = renderLine(ruleDef, { caretPosition: gap(RuleSide.When, 0), pending: true });
    assert.equal(countOf(inGap, "data-caret-superseded"), 0);
  });
});

describe("the structure the projection supplies", () => {
  test("the line opens on a control the caret can be placed from", () => {
    const { ruleDef, pageDef } = ruleOf([makeSensor(services, "glue-see")], [makeActuator(services, "glue-move")]);
    const indices = structureIndices(renderRuleCard(ruleDef, pageDef));
    assert.ok(indices.length > 0, "the line renders tappable structure");
    assert.equal(indices[0], 0, "the structure the line opens on is the first of them");
  });

  test("structure holding nothing but a space is left as reading text", () => {
    const { ruleDef, pageDef } = ruleOf([makeObjectSensor(services, "glue-bump")], []);
    const markup = renderRuleCard(ruleDef, pageDef);
    const wordIndices = [...markup.matchAll(/data-sentence-tile-index="(\d+)"/g)];
    assert.equal(wordIndices.length, 2, "the tile reads as two words with a space between them");
    assert.deepEqual(
      structureIndices(markup).length,
      2,
      "the line opens and closes on structure, and the space joining the tile's words is no control of its own"
    );
  });

  test("a line with no way to place the caret renders no such control", () => {
    const { ruleDef } = ruleOf([makeSensor(services, "glue-reading")], []);
    const markup = renderToStaticMarkup(
      createElement(
        BrainEditorProvider,
        { config: editorConfig },
        createElement(BrainRuleSentence, { ruleDef, updateCounter: 0 })
      )
    );
    assert.equal(countOf(markup, "data-sentence-structure"), 0);
  });
});

describe("the filter box at rest", () => {
  /** The class tokens of the sentence's filter box on a card armed from its sentence. */
  function sentenceInputTokens(): { tokens: string[]; tag: string } {
    const { ruleDef, pageDef } = ruleOf([makeSensor(services, "chrome-see")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "insert",
      tileIndex: 0,
      caret: gap(RuleSide.When, 0),
      entry: "sentence",
      onTileSelected: () => true,
    };
    const tag = tagWith(renderRuleCard(ruleDef, pageDef, target), 'data-strip-filter="sentence"');
    assert.ok(tag, "the card renders the filter box in its sentence");
    return { tokens: /class="([^"]*)"/.exec(tag)?.[1].split(" ") ?? [], tag };
  }

  test("it takes no layout width and no padding while it holds no text", () => {
    const { tokens } = sentenceInputTokens();
    assert.ok(tokens.includes("w-0"), "the empty box has no width of its own");
    assert.ok(tokens.includes("p-0"), "and no padding");
    for (const token of tokens) {
      assert.ok(!/^(min-w-|px-|pl-|pr-)/.test(token), `the empty box takes no ${token}`);
    }
  });

  test("it draws no border while it holds no text", () => {
    const { tokens } = sentenceInputTokens();
    for (const token of tokens) {
      assert.ok(!/^border-[a-z]?-?\d/.test(token), `the empty box draws no ${token}`);
    }
  });

  test("it shows no placeholder", () => {
    const { tag } = sentenceInputTokens();
    assert.equal(/placeholder="([^"]*)"/.exec(tag)?.[1] ?? "", "");
  });

  test("the wrapper it sits in takes no margin of its own", () => {
    const { ruleDef, pageDef } = ruleOf([makeSensor(services, "chrome-wrap")], []);
    const target: ArmedTileTarget = {
      ruleDef,
      side: RuleSide.When,
      mode: "insert",
      tileIndex: 0,
      caret: gap(RuleSide.When, 0),
      entry: "sentence",
      onTileSelected: () => true,
    };
    const markup = renderRuleCard(ruleDef, pageDef, target);
    const inputAt = markup.indexOf('data-strip-filter="sentence"');
    const wrapper = markup.slice(markup.lastIndexOf("<span", markup.lastIndexOf("<input", inputAt)), inputAt);
    for (const token of /class="([^"]*)"/.exec(wrapper)?.[1].split(" ") ?? []) {
      assert.ok(!/^m[lrxy]?-/.test(token), `the wrapper takes no ${token}`);
    }
  });
});
