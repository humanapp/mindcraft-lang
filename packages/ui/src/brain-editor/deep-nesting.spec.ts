/**
 * Pins that the rules of a page nested to the depth the model allows still
 * render: every rule of the tree reaches the markup, once each, with its own
 * handle and its nesting step. A render that throws, loops, or stops short past
 * some nesting depth fails here.
 *
 * Structural assertions only: rule handles are counted by the attribute that
 * addresses them, and the indent of each row is read from the inline pixel step
 * the card lays out with.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import {
  BrainCommandHistory,
  BrainDef,
  type BrainPageDef,
  type BrainRuleDef,
  kMaxBrainRuleDepth,
} from "@wendoo/core/brain/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainPageEditor } from "./BrainPageEditor";
import { makeActuator, makeSensor } from "./test-only-rule-fixtures";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
};

/**
 * A page whose rules run one chain of `depth` nesting steps under its first
 * rule, every rule carrying a tile on each side. The returned page holds
 * `depth + 1` rules in all.
 */
function makeNestedPage(depth: number): BrainPageDef {
  const brainDef = BrainDef.emptyBrainDef(services);
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  let ruleDef = pageDef.children().get(0) as BrainRuleDef;
  for (let step = 0; step <= depth; step++) {
    ruleDef.when().appendTile(makeSensor(services, `deep-sensor-${step}`));
    ruleDef.do().appendTile(makeActuator(services, `deep-actuator-${step}`));
    if (step < depth) ruleDef = ruleDef.appendNewRule();
  }
  return pageDef;
}

/** The markup the page's rules render to. */
function renderPage(pageDef: BrainPageDef): string {
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: editorConfig },
      createElement(BrainPageEditor, { pageDef, commandHistory: new BrainCommandHistory() })
    )
  );
}

/** How many rule handles `markup` stands. */
function handleCount(markup: string): number {
  return (markup.match(/data-rule-handle="/g) ?? []).length;
}

/** Every distinct left indent the rule cards lay out with, in the order they first appear. */
function indentSteps(markup: string): string[] {
  const seen: string[] = [];
  for (const match of markup.matchAll(/margin-left:([^;"]*)/g)) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

describe("deeply nested rules", () => {
  test("a page nested to the model's limit renders every rule once", () => {
    const pageDef = makeNestedPage(kMaxBrainRuleDepth);
    const markup = renderPage(pageDef);
    assert.equal(handleCount(markup), kMaxBrainRuleDepth + 1);
  });

  test("every nesting step lays its rule out one step further in", () => {
    const pageDef = makeNestedPage(kMaxBrainRuleDepth);
    const steps = indentSteps(renderPage(pageDef));
    assert.equal(steps.length, kMaxBrainRuleDepth + 1);
  });

  test("nesting depth alone does not change how many rules render", () => {
    for (const depth of [9, 15, kMaxBrainRuleDepth]) {
      const markup = renderPage(makeNestedPage(depth));
      assert.equal(handleCount(markup), depth + 1, `depth ${depth}`);
    }
  });
});
