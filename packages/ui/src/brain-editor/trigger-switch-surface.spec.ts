/**
 * Pins the trigger-mode capsule a rule card stands at the head of its WHEN side:
 * a capsule offering a choice of mode is a button addressing its own grid cell,
 * the first rule at a level stands a static marker instead, and each mode paints
 * its own capsule token. Also pins that the page stands the one polite live
 * region a mode change is read out through.
 *
 * Structural assertions only: every value asserted here is a tag name, an
 * attribute, a cell key, or a token class.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@wendoo/core/brain";
import { RuleTriggerMode } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { availableTriggerModes } from "@wendoo/core/brain/language-service";
import { BrainCommandHistory, BrainDef, type BrainPageDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainPageEditor } from "./BrainPageEditor";
import { kPageGridCellAttribute, pageGridCellKey } from "./page-grid-model";
import { makeActuator, makeSensor } from "./test-only-rule-fixtures";
import { nextTriggerMode, triggerSwitchState } from "./trigger-mode";

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
 * A page of `count` top-level rules, the first `tiled` of them carrying a tile
 * on both sides and the rest holding none.
 */
function makePage(count: number, tiled = count): { pageDef: BrainPageDef; rules: BrainRuleDef[] } {
  const brainDef = BrainDef.emptyBrainDef(services);
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  const rules = [pageDef.children().get(0) as BrainRuleDef];
  while (rules.length < count) rules.push(pageDef.appendNewRule());
  rules.slice(0, tiled).forEach((ruleDef, index) => {
    ruleDef.when().appendTile(makeSensor(services, `switch-sensor-${index}`));
    ruleDef.do().appendTile(makeActuator(services, `switch-actuator-${index}`));
  });
  return { pageDef, rules };
}

function renderPage(pageDef: BrainPageDef): string {
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: editorConfig },
      createElement(BrainPageEditor, { pageDef, commandHistory: new BrainCommandHistory() })
    )
  );
}

/** The attribute naming `ruleDef`'s trigger cell, as the markup writes it. */
function triggerCellAttribute(ruleDef: BrainRuleDef): string {
  return `${kPageGridCellAttribute}="${pageGridCellKey({ kind: "trigger", ruleId: ruleDef.ruleId() })}"`;
}

/** The opening tag of the element addressing `ruleDef`'s trigger cell. */
function switchTag(markup: string, ruleDef: BrainRuleDef): string {
  const opening = markup.lastIndexOf("<", markup.indexOf(triggerCellAttribute(ruleDef)));
  assert.ok(opening >= 0, `the page stands an element for ${triggerCellAttribute(ruleDef)}`);
  return markup.slice(opening, markup.indexOf(">", opening) + 1);
}

/** The opening tags of every DO capsule the page stands, in reading order. */
function doCapsuleTags(markup: string): string[] {
  return [...markup.matchAll(/<div[^>]*aria-label="Do action tiles"[^>]*>/g)].map((match) => match[0]);
}

/**
 * The opening tags of every capsule the page stands, in reading order, taken
 * from the rounded shape only a capsule wears.
 */
function capsuleTags(markup: string): string[] {
  return [...markup.matchAll(/<(?:div|button)[^>]*rounded-l-2xl[^>]*>/g)].map((match) => match[0]);
}

/**
 * The opening tag of the box holding `ruleDef`'s capsule and its badge, which is
 * the element standing immediately before the capsule's own badge or button.
 */
function switchBoxTag(markup: string, ruleDef: BrainRuleDef): string {
  const at = markup.indexOf(triggerCellAttribute(ruleDef));
  const box = markup.lastIndexOf("<div", at);
  assert.ok(box >= 0, `the page stands a box for ${triggerCellAttribute(ruleDef)}`);
  return markup.slice(box, markup.indexOf(">", box) + 1);
}

/** The opening tag of every capsule error badge the page renders, in order. */
function badgeTags(markup: string): string[] {
  return [...markup.matchAll(/<span class="[^"]*bg-destructive[^"]*"[^>]*>/g)].map((match) => match[0]);
}

/**
 * The class attribute of every stacked capsule letter the page renders, in
 * order, taken from every capsule it stands.
 */
function letterClasses(markup: string): string[] {
  return [...markup.matchAll(/<span class="([^"]*rotate-270[^"]*)"/g)].map((match) => match[1]);
}

describe("the trigger-mode switch a rule card stands", () => {
  test("it is a button addressing its own grid cell", () => {
    const { pageDef, rules } = makePage(2);
    const tag = switchTag(renderPage(pageDef), rules[1]);

    assert.ok(tag.startsWith("<button"));
    assert.ok(tag.includes('type="button"'));
  });

  test("the first rule at a level stands no trigger cell, so the selection never rests there", () => {
    const { pageDef, rules } = makePage(2);
    const markup = renderPage(pageDef);

    assert.equal(markup.includes(triggerCellAttribute(rules[0])), false);
    assert.ok(markup.includes(triggerCellAttribute(rules[1])));
  });

  test("the first rule's capsule is a static marker: no button, no cell, nothing exposed disabled", () => {
    const { pageDef, rules } = makePage(2);
    const markup = renderPage(pageDef);
    const capsules = capsuleTags(markup);

    // Two rules, each standing its trigger capsule and its DO capsule.
    assert.equal(capsules.length, 4);
    assert.ok(capsules[0].startsWith("<div"), capsules[0]);
    assert.ok(!capsules[0].includes(kPageGridCellAttribute), capsules[0]);
    assert.ok(!capsules[0].includes("aria-disabled"), capsules[0]);
    assert.ok(!capsules[0].includes("scale-105"), capsules[0]);
    assert.equal(markup.includes("aria-disabled"), false);
    assert.ok(switchTag(markup, rules[1]).startsWith("<button"));
  });

  test("the static marker is painted in the same chrome the DO capsule beside it wears", () => {
    const { pageDef } = makePage(2);
    const marker = capsuleTags(renderPage(pageDef))[0];

    assert.ok(marker.includes("bg-brain-capsule "), marker);
    assert.ok(marker.includes("border-brain-capsule-edge"), marker);
    assert.ok(marker.includes("text-brain-capsule-ink"), marker);
  });

  test("a rule carrying a mode its position rejects keeps an operable switch", () => {
    const { pageDef, rules } = makePage(2);
    rules[1].setTrigger(RuleTriggerMode.Then);
    assert.ok(rules[1].indent(), "the second rule indents under the first");
    const tag = switchTag(renderPage(pageDef), rules[1]);

    assert.ok(!tag.includes("aria-disabled"), tag);
    assert.ok(tag.includes("aria-label="), tag);
  });

  test("one step out of a rejected mode lands on a mode the position admits", () => {
    const { rules } = makePage(2);
    rules[1].setTrigger(RuleTriggerMode.Then);
    assert.ok(rules[1].indent(), "the second rule indents under the first");
    const admitted = availableTriggerModes(rules[1]);

    assert.equal(triggerSwitchState(rules[1].trigger(), admitted), "invalid");
    assert.ok(admitted.contains(nextTriggerMode(rules[1].trigger(), admitted)));
  });

  test("the rejected mode badges the capsule, and an admitted one does not", () => {
    const { pageDef, rules } = makePage(3);
    rules[1].setTrigger(RuleTriggerMode.Then);
    assert.ok(rules[1].indent(), "the second rule indents under the first");
    pageDef.typecheck();
    const invalidBadges = badgeTags(renderPage(pageDef));

    assert.equal(invalidBadges.length, 1);
    assert.ok(invalidBadges[0].includes("bg-destructive"), invalidBadges[0]);

    rules[1].setTrigger(RuleTriggerMode.When);
    pageDef.typecheck();
    assert.deepEqual(badgeTags(renderPage(pageDef)), []);
  });

  test("the badge names its summary and stands one that shows on hover, as a tile's does", () => {
    const { pageDef, rules } = makePage(3);
    rules[1].setTrigger(RuleTriggerMode.Then);
    assert.ok(rules[1].indent(), "the second rule indents under the first");
    pageDef.typecheck();
    const markup = renderPage(pageDef);
    const badge = badgeTags(markup)[0];
    assert.ok(badge, "the rejected mode stands a badge");

    assert.ok(badge.includes('role="img"'), badge);
    assert.ok(badge.includes("aria-label="), badge);
    assert.ok(!badge.includes("aria-hidden"), badge);
    assert.ok(badge.includes("pointer-events-auto"), badge);
    // The summary is portaled as the pointer arrives, so it stands in no markup
    // a server render produces; `BrainBadge` is the seam that carries it.
    assert.ok(!markup.includes("data-brain-badge-tip"), markup.slice(0, 200));
  });

  test("the growth a switchable capsule takes is worn by the box holding its badge too", () => {
    const { pageDef, rules } = makePage(2);
    const markup = renderPage(pageDef);
    const box = switchBoxTag(markup, rules[1]);

    assert.ok(box.includes("hover:scale-105"), box);
    assert.ok(box.includes("active:scale-95"), box);
    assert.ok(!switchTag(markup, rules[1]).includes("scale-105"), "the capsule itself takes no growth of its own");
  });

  test("each mode paints its own capsule fill, edge and ink, and none of them the amber the unsaved dot wears", () => {
    const { pageDef, rules } = makePage(4);
    rules[1].setTrigger(RuleTriggerMode.Otherwise);
    rules[2].setTrigger(RuleTriggerMode.Then);
    const markup = renderPage(pageDef);
    const painted = [rules[1], rules[2], rules[3]].map((ruleDef) => switchTag(markup, ruleDef));

    assert.ok(painted[0].includes("bg-brain-capsule-otherwise"));
    assert.ok(painted[0].includes("border-brain-capsule-otherwise-edge"));
    assert.ok(painted[0].includes("text-brain-capsule-otherwise-ink"));
    assert.ok(painted[1].includes("bg-brain-capsule-then"));
    assert.ok(painted[1].includes("border-brain-capsule-then-edge"));
    assert.ok(painted[1].includes("text-brain-capsule-then-ink"));
    assert.ok(painted[2].includes("bg-brain-capsule "));
    assert.ok(painted[2].includes("border-brain-capsule-edge"));
    assert.ok(painted[2].includes("text-brain-capsule-ink"));
    for (const tag of painted) {
      assert.ok(!tag.includes("brain-amber"), tag);
      assert.ok(!/-(?:teal|cyan|pink|rose|emerald|sky|amber|violet)-\d/.test(tag), tag);
    }
  });

  test("a marked mode letters itself in its own ink, never the shared one the DO capsule wears", () => {
    const { pageDef, rules } = makePage(3);
    rules[1].setTrigger(RuleTriggerMode.Otherwise);
    rules[2].setTrigger(RuleTriggerMode.Then);
    const markup = renderPage(pageDef);

    for (const ruleDef of [rules[1], rules[2]]) {
      const tag = switchTag(markup, ruleDef);
      assert.ok(!/text-brain-capsule-ink\b/.test(tag), tag);
    }
    for (const tag of doCapsuleTags(markup)) {
      assert.ok(tag.includes("text-brain-capsule-ink"), tag);
    }
  });

  test("no two modes are painted the same way", () => {
    const { pageDef, rules } = makePage(4);
    rules[1].setTrigger(RuleTriggerMode.Otherwise);
    rules[2].setTrigger(RuleTriggerMode.Then);
    const markup = renderPage(pageDef);
    const painted = [rules[1], rules[2], rules[3]].map((ruleDef) => switchTag(markup, ruleDef));

    assert.equal(new Set(painted.map((tag) => /class="([^"]*)"/.exec(tag)?.[1])).size, painted.length);
  });

  test("it holds the tile height and centres itself, on a rule holding tiles and on one holding none", () => {
    const { pageDef, rules } = makePage(3, 2);
    const markup = renderPage(pageDef);

    for (const ruleDef of [rules[1], rules[2]]) {
      const tag = switchTag(markup, ruleDef);
      assert.ok(tag.includes("h-24"), tag);
      assert.ok(tag.includes("self-center"), tag);
    }
  });

  test("every stacked letter carries the same leading, in its capsule and in the DO capsule beside it", () => {
    const { pageDef } = makePage(3, 1);
    const classes = letterClasses(renderPage(pageDef));

    assert.ok(classes.length > 0);
    assert.equal(new Set(classes).size, 1, [...new Set(classes)].join(" | "));
    assert.ok(classes[0].includes("mx-0.75"), classes[0]);
  });

  test("the DO capsule beside it is sized the same way", () => {
    const { pageDef } = makePage(2, 1);
    const tags = doCapsuleTags(renderPage(pageDef));

    assert.equal(tags.length, 2);
    for (const tag of tags) {
      assert.ok(tag.includes("h-24"), tag);
      assert.ok(tag.includes("self-center"), tag);
    }
  });

  test("the page stands one polite live region, which a mode change is read out through", () => {
    const { pageDef } = makePage(2);
    const markup = renderPage(pageDef);

    assert.equal(markup.split('aria-live="polite"').length - 1, 1);
  });
});
