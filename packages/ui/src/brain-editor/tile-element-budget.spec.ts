/**
 * Budgets the size a page renders to against the tiles it holds: what one more
 * placed tile costs in elements, that the cost is the same whatever the page it
 * joins already holds, and that the menu a placed tile stands adds no element
 * until it is opened. A per-tile subtree introduced by accident -- a wrapper, a
 * panel every tile stands whether or not anyone opened it -- either lifts the
 * per-tile figure or bends the line, and fails here.
 *
 * Structural assertions only: elements are counted from the markup
 * `react-dom/server` renders, by their opening tags, and the menu a tile stands
 * is counted by the popup attribute its trigger carries.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainCommandHistory, BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainPageEditor } from "./BrainPageEditor";
import { makeActuator, makeSensor } from "./test-only-rule-fixtures";

/**
 * The most elements one more placed tile may add to a page. A ratchet: lower it
 * when a change takes elements out, and raise it only against a fresh count.
 */
const kElementsPerPlacedTile = 12;

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

const plainConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
};

/** A host wiring up tile documentation, which every placed tile's menu then offers an entry of. */
const documentingConfig: BrainEditorConfig = { ...plainConfig, onTileDocs: () => {} };

/**
 * A flat page of `ruleCount` rules, each carrying `tilesPerSide` tiles on each of
 * its two sides, so the page holds `ruleCount * tilesPerSide * 2` placed tiles.
 */
function makeFlatPage(ruleCount: number, tilesPerSide: number): BrainPageDef {
  const brainDef = BrainDef.emptyBrainDef(services);
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  let ruleDef = pageDef.children().get(0) as BrainRuleDef;
  for (let rule = 0; rule < ruleCount; rule++) {
    for (let index = 0; index < tilesPerSide; index++) {
      ruleDef.when().appendTile(makeSensor(services, `budget-sensor-${rule}-${index}`));
      ruleDef.do().appendTile(makeActuator(services, `budget-actuator-${rule}-${index}`));
    }
    if (rule < ruleCount - 1) ruleDef = pageDef.appendNewRule();
  }
  return pageDef;
}

/** The markup `config` renders the page to. */
function renderPage(pageDef: BrainPageDef, config: BrainEditorConfig): string {
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config },
      createElement(BrainPageEditor, { pageDef, commandHistory: new BrainCommandHistory() })
    )
  );
}

/** How many element opening tags `markup` holds, void elements included. */
function elementCount(markup: string): number {
  return (markup.match(/<[a-zA-Z][^>]*>/g) ?? []).length;
}

/** How many elements `config` renders a page of `ruleCount` rules of `tilesPerSide` tiles a side to. */
function elementsFor(ruleCount: number, tilesPerSide: number, config: BrainEditorConfig): number {
  return elementCount(renderPage(makeFlatPage(ruleCount, tilesPerSide), config));
}

/**
 * The elements one placed tile costs, read off the step from `fromPerSide` to
 * `toPerSide` tiles a side at a fixed `ruleCount`, so the rule's own chrome
 * cancels and only the tiles are left.
 */
function elementsPerTile(ruleCount: number, fromPerSide: number, toPerSide: number, config: BrainEditorConfig): number {
  const grown = elementsFor(ruleCount, toPerSide, config) - elementsFor(ruleCount, fromPerSide, config);
  return grown / (ruleCount * (toPerSide - fromPerSide) * 2);
}

/** How many placed tiles in `markup` stand a menu. */
function menuTriggerCount(markup: string): number {
  return (markup.match(/aria-haspopup="menu"/g) ?? []).length;
}

/** How many tile cells `markup` stands. */
function tileCellCount(markup: string): number {
  return (markup.match(/data-page-grid-cell="[^"]*:tile:/g) ?? []).length;
}

describe("rendered size per placed tile", () => {
  test("a placed tile costs the same however many tiles already stand beside it", () => {
    const sparse = elementsPerTile(10, 1, 3, documentingConfig);
    const dense = elementsPerTile(10, 3, 5, documentingConfig);
    assert.equal(sparse, dense);
  });

  test("a placed tile costs the same however many rules the page already holds", () => {
    const small = elementsPerTile(5, 1, 3, documentingConfig);
    const large = elementsPerTile(20, 1, 3, documentingConfig);
    assert.equal(small, large);
  });

  test("a placed tile stays within its element budget", () => {
    const perTile = elementsPerTile(10, 1, 3, documentingConfig);
    assert.ok(
      perTile <= kElementsPerPlacedTile,
      `a placed tile renders ${perTile} elements, over the budget of ${kElementsPerPlacedTile}`
    );
  });

  test("the menu a placed tile stands adds no element until it is opened", () => {
    for (const tilesPerSide of [1, 3]) {
      assert.equal(
        elementsFor(10, tilesPerSide, documentingConfig),
        elementsFor(10, tilesPerSide, plainConfig),
        `${tilesPerSide} tiles a side`
      );
    }
  });

  test("every placed tile whose menu offers an entry stands one trigger, and no other tile stands any", () => {
    const withMenus = renderPage(makeFlatPage(10, 3), documentingConfig);
    assert.equal(tileCellCount(withMenus), 60);
    assert.equal(menuTriggerCount(withMenus), tileCellCount(withMenus));
    assert.equal(menuTriggerCount(renderPage(makeFlatPage(10, 3), plainConfig)), 0);
  });
});
