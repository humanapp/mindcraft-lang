/**
 * Pins what a grabbed rule's handle renders as movement markers: one marker for
 * every direction the pickup names, none for a direction it leaves out, and none
 * at all on a handle whose rule the page is not holding.
 *
 * Counts and distinctness only. No path datum, size, or rotation is asserted --
 * the marker's shape is tuning.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { BrainCommandHistory, type BrainRuleDef } from "@wendoo/core/brain/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ArmedTargetController, ArmedTargetProvider } from "./ArmedTargetContext";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainRuleEditor } from "./BrainRuleEditor";
import { PageGridProvider } from "./PageGridContext";
import type { RuleMoveDirection } from "./page-grid-model";
import { type RulePickup, RulePickupProvider } from "./RulePickupContext";
import { makeActuator, makeBrain, makeSensor } from "./test-only-rule-fixtures";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
};

/** The card rendered inside a page grid holding `pickup`, or holding nothing when it is null. */
function renderRuleCard(ruleDef: BrainRuleDef, pickup: RulePickup | null): string {
  const controller: ArmedTargetController = {
    target: null,
    arm: () => {},
    disarm: () => {},
    mode: null,
    reportMode: () => {},
  };
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: { ...editorConfig, brainServices: services, tileCatalogs: [services.edit.tiles] } },
      createElement(
        ArmedTargetProvider,
        { value: controller },
        createElement(
          PageGridProvider,
          {
            value: {
              registerRule: () => () => {},
              ruleToCompose: undefined,
              composeRule: () => {},
              grabRule: () => {},
              moveRule: () => {},
              offeringRail: null,
            },
          },
          createElement(
            RulePickupProvider,
            { value: { pickup, setPickup: () => {} } },
            createElement(BrainRuleEditor, {
              ruleDef,
              lineNumber: 1,
              ruleCount: 1,
              revision: "",
              commandHistory: new BrainCommandHistory(),
            })
          )
        )
      )
    )
  );
}

/** The markup the handle of `ruleId` stands, from its addressing attribute to the tag that closes it. */
function handleMarkup(markup: string, ruleId: string): string {
  const start = markup.indexOf(`data-rule-handle="${ruleId}"`);
  assert.ok(start >= 0, `the card stands a handle for rule ${ruleId}`);
  const end = markup.indexOf("</button>", start);
  assert.ok(end >= 0, `the handle for rule ${ruleId} closes`);
  return markup.slice(start, end);
}

/** Every movement marker the handle of `ruleId` paints, as its own opening tag. */
function markerTags(markup: string, ruleId: string): string[] {
  return handleMarkup(markup, ruleId).match(/<path\b[^>]*>/g) ?? [];
}

/** A rule holding one tile on each side, typechecked so the oracle has an answer for both. */
function makePopulatedRule(name: string): BrainRuleDef {
  const whenTiles: IBrainTileDef[] = [makeSensor(services, `${name}-see`)];
  const doTiles: IBrainTileDef[] = [makeActuator(services, `${name}-move`)];
  const { ruleDef } = makeBrain(services, whenTiles, doTiles);
  ruleDef.typecheck();
  return ruleDef;
}

describe("the markers a grabbed rule's handle stands", () => {
  const directionSets: readonly (readonly RuleMoveDirection[])[] = [
    ["up"],
    ["up", "down"],
    ["up", "down", "outdent"],
    ["up", "down", "outdent", "indent"],
  ];

  for (const directions of directionSets) {
    test(`stands one marker for each of ${directions.length}, and no more`, () => {
      const ruleDef = makePopulatedRule(`grabbed-${directions.length}`);
      const markers = markerTags(renderRuleCard(ruleDef, { ruleId: ruleDef.ruleId(), directions }), ruleDef.ruleId());
      assert.equal(markers.length, directions.length);
      assert.equal(new Set(markers).size, markers.length);
    });
  }

  test("stands nothing for a direction the pickup leaves out", () => {
    const ruleDef = makePopulatedRule("grabbed-one-way");
    const one = markerTags(
      renderRuleCard(ruleDef, { ruleId: ruleDef.ruleId(), directions: ["indent"] }),
      ruleDef.ruleId()
    );
    const all = markerTags(
      renderRuleCard(ruleDef, { ruleId: ruleDef.ruleId(), directions: ["up", "down", "outdent", "indent"] }),
      ruleDef.ruleId()
    );
    assert.equal(one.length, 1);
    assert.ok(all.includes(one[0]), "the one marker is the same one the full set stands for that direction");
  });

  test("stands none where the pickup names no direction at all", () => {
    const ruleDef = makePopulatedRule("grabbed-stuck");
    assert.deepEqual(
      markerTags(renderRuleCard(ruleDef, { ruleId: ruleDef.ruleId(), directions: [] }), ruleDef.ruleId()),
      []
    );
  });

  test("stands none on a rule the page is not holding", () => {
    const ruleDef = makePopulatedRule("not-grabbed");
    const other: RulePickup = { ruleId: ruleDef.ruleId() + 1, directions: ["up", "down"] };
    assert.deepEqual(markerTags(renderRuleCard(ruleDef, other), ruleDef.ruleId()), []);
    assert.deepEqual(markerTags(renderRuleCard(ruleDef, null), ruleDef.ruleId()), []);
  });
});
