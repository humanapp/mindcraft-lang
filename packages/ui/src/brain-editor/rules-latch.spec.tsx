/**
 * Pins the editor's two-pass rules latch: what the rules area stands for a
 * given pair of pages, and what the region renders in each stand. The pages are
 * supplied directly; `useLatchedPage`'s own effect is not covered here.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { BrainCommandHistory, BrainDef, type BrainPageDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadingIndicator } from "../ui/loading-indicator";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainPageEditor } from "./BrainPageEditor";
import { BrainRulesRegion } from "./BrainRulesRegion";
import { type RulesAreaStand, rulesAreaStand } from "./rules-latch";
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

/** A page carrying `count` rules, each with a tile on both sides. */
function makePage(count: number): BrainPageDef {
  const brainDef = BrainDef.emptyBrainDef(services);
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  let ruleDef = pageDef.children().get(0) as BrainRuleDef;
  for (let index = 0; index < count; index++) {
    ruleDef.when().appendTile(makeSensor(services, `latch-sensor-${index}`));
    ruleDef.do().appendTile(makeActuator(services, `latch-actuator-${index}`));
    if (index < count - 1) ruleDef = pageDef.appendNewRule();
  }
  return pageDef;
}

/** The markup the region renders in `stand`, holding `pageDef`'s rules. */
function renderRegion(stand: RulesAreaStand, pageDef: BrainPageDef): string {
  return renderToStaticMarkup(
    <BrainEditorProvider config={editorConfig}>
      <BrainRulesRegion stand={stand}>
        <BrainPageEditor pageDef={pageDef} commandHistory={new BrainCommandHistory()} />
      </BrainRulesRegion>
    </BrainEditorProvider>
  );
}

/** How many rule handles `markup` stands. */
function handleCount(markup: string): number {
  return (markup.match(/data-rule-handle="/g) ?? []).length;
}

describe("what the rules area stands", () => {
  test("an editor with no page to show stands no rules", () => {
    assert.equal(rulesAreaStand(undefined, undefined), "no-page");
    assert.equal(rulesAreaStand(undefined, "page-a"), "no-page");
  });

  test("a page whose rules have not been committed yet is loading", () => {
    assert.equal(rulesAreaStand("page-a", undefined), "loading");
  });

  test("rules committed for the page being shown are the rules", () => {
    assert.equal(rulesAreaStand("page-a", "page-a"), "rules");
  });

  test("rules committed for another page are never shown under this one", () => {
    assert.equal(rulesAreaStand("page-b", "page-a"), "loading");
  });

  test("pages are told apart by identity, not by their contents", () => {
    const first = { pageDef: "p", pageChangeCounter: 0 };
    const second = { pageDef: "p", pageChangeCounter: 0 };
    assert.equal(rulesAreaStand(first, second), "loading");
    assert.equal(rulesAreaStand(first, first), "rules");
  });
});

describe("the rules region", () => {
  test("commits none of the rules while the page is loading", () => {
    const pageDef = makePage(4);
    assert.equal(handleCount(renderRegion("loading", pageDef)), 0);
    assert.equal(handleCount(renderRegion("rules", pageDef)), 4);
  });

  test("marks itself busy only while the page is loading", () => {
    const pageDef = makePage(2);
    assert.match(renderRegion("loading", pageDef), /<section[^>]*aria-busy="true"/);
    assert.match(renderRegion("rules", pageDef), /<section[^>]*aria-busy="false"/);
    assert.match(renderRegion("no-page", pageDef), /<section[^>]*aria-busy="false"/);
  });

  test("stands a live region while the page is loading and none with no page", () => {
    const pageDef = makePage(2);
    assert.match(renderRegion("loading", pageDef), /<output/);
    assert.doesNotMatch(renderRegion("no-page", pageDef), /<output/);
  });
});

describe("the loading indicator", () => {
  test("is a live region carrying the label it was given", () => {
    const markup = renderToStaticMarkup(<LoadingIndicator label="waiting-on-the-rules" />);
    assert.match(markup, /^<output/);
    assert.match(markup, /waiting-on-the-rules/);
  });
});
