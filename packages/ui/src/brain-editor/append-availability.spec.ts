/**
 * Pins the decision behind the add-tile control: whether the suggestion oracle
 * offers anything at the end of a rule side. A side that can be continued
 * answers true and stands its control; a side the oracle offers nothing at
 * answers false; the two sides answer independently. Pins with it that the
 * answer agrees with the offering the strip would build at the same position, so
 * the control never opens an empty offering and never hides one that has
 * candidates.
 *
 * A false answer reaches the two sides differently. The WHEN control stands
 * mid-row, so its footprint is reserved and the control hidden in it, leaving
 * the row right of it unmoved. The DO control stands at the row's end, where a
 * reserved footprint would be dead space, so it is not rendered at all.
 *
 * Structural assertions only: every value asserted here is a boolean decision,
 * a candidate count, or a marker attribute.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, type ReadonlyList } from "@mindcraft-lang/core";
import type { BrainServices, IBrainTileDef, ITileCatalog } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { suggestTiles } from "@mindcraft-lang/core/brain/language-service";
import { BrainCommandHistory, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ArmedTargetController, ArmedTargetProvider } from "./ArmedTargetContext";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainRuleEditor } from "./BrainRuleEditor";
import { buildStripCandidates } from "./candidate-strip-model";
import { buildInsertionContext, sideOffersAppendedTile } from "./insertion-context";
import { makeActuator, makeBrain as makeRuleBrain, makeSensor } from "./test-only-rule-fixtures";

let services: BrainServices;
let catalogs: ReadonlyList<ITileCatalog>;

before(() => {
  services = __test__createBrainServices();
  catalogs = List.from<ITileCatalog>([services.edit.tiles]).asReadonly();
});

/** A brain whose first rule holds `whenTiles` and `doTiles`. */
function makeBrain(whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]) {
  return makeRuleBrain(services, whenTiles, doTiles);
}

/** The decision the add-tile control on `side` of `ruleDef` is drawn from. */
function offers(ruleDef: BrainRuleDef, side: RuleSide): boolean {
  return sideOffersAppendedTile({ ruleDef, side, catalogs, services });
}

/** How many candidates the strip would build at the end of `side`, the full offering the control opens. */
function candidateCount(ruleDef: BrainRuleDef, side: RuleSide): number {
  const tileSet = side === RuleSide.When ? ruleDef.when() : ruleDef.do();
  const context = buildInsertionContext({
    side,
    expr: tileSet.expr(),
    ruleDef,
    existingTiles: tileSet.tiles(),
  });
  return buildStripCandidates(suggestTiles(context, catalogs, services), (tileDef) => tileDef.tileId).length;
}

describe("what may be appended to a rule side", () => {
  test("a side holding nothing can be continued", () => {
    const { ruleDef } = makeBrain([], []);
    assert.equal(offers(ruleDef, RuleSide.When), true);
    assert.equal(offers(ruleDef, RuleSide.Do), true);
  });

  test("a side reading as a complete action can not", () => {
    const { ruleDef } = makeBrain(
      [makeSensor(services, "append-complete-see")],
      [makeActuator(services, "append-complete-move")]
    );
    ruleDef.typecheck();
    assert.equal(offers(ruleDef, RuleSide.When), false);
    assert.equal(offers(ruleDef, RuleSide.Do), false);
  });

  test("the two sides answer independently", () => {
    const completeWhen = makeBrain([makeSensor(services, "append-split-see")], []);
    completeWhen.ruleDef.typecheck();
    assert.equal(offers(completeWhen.ruleDef, RuleSide.When), false);
    assert.equal(offers(completeWhen.ruleDef, RuleSide.Do), true);

    const completeDo = makeBrain([], [makeActuator(services, "append-split-move")]);
    completeDo.ruleDef.typecheck();
    assert.equal(offers(completeDo.ruleDef, RuleSide.When), true);
    assert.equal(offers(completeDo.ruleDef, RuleSide.Do), false);
  });

  test("catalogs holding nothing to place answer false", () => {
    const { ruleDef } = makeBrain([], []);
    const empty = List.empty<ITileCatalog>().asReadonly();
    assert.equal(sideOffersAppendedTile({ ruleDef, side: RuleSide.When, catalogs: empty, services }), false);
  });

  test("the answer agrees with the offering the position would build", () => {
    const empty = makeBrain([], []);
    const complete = makeBrain(
      [makeSensor(services, "append-agree-see")],
      [makeActuator(services, "append-agree-move")]
    );
    complete.ruleDef.typecheck();
    const cases = [
      [empty.ruleDef, RuleSide.When] as const,
      [empty.ruleDef, RuleSide.Do] as const,
      [complete.ruleDef, RuleSide.When] as const,
      [complete.ruleDef, RuleSide.Do] as const,
    ];
    for (const [ruleDef, side] of cases) {
      assert.equal(offers(ruleDef, side), candidateCount(ruleDef, side) > 0);
    }
  });
});

describe("the add-tile control the decision stands", () => {
  const editorConfig: BrainEditorConfig = {
    dataTypeIcons: new Map(),
    dataTypeNames: new Map(),
    customLiteralTypes: [],
  };

  function renderRuleCard(ruleDef: BrainRuleDef): string {
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

  /**
   * What the card stands for the add-tile control on `side`: `"standing"` when
   * the control is there to be reached, `"reserved"` when only its footprint is
   * held and the control in it is hidden from pointer, tab order, and screen
   * reader alike, or `undefined` when the card stands nothing for that side.
   */
  function appendControl(markup: string, side: RuleSide): "standing" | "reserved" | undefined {
    const match = markup.match(new RegExp(`<button type="button" class="([^"]*)" data-append-tile="${side}"`));
    if (match === null) return undefined;
    return match[1].split(" ").includes("invisible") ? "reserved" : "standing";
  }

  test("a side that can be continued stands its control", () => {
    const { ruleDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef);
    assert.equal(appendControl(markup, RuleSide.When), "standing");
    assert.equal(appendControl(markup, RuleSide.Do), "standing");
  });

  test("a when side the oracle offers nothing at reserves its control's footprint", () => {
    const { ruleDef } = makeBrain(
      [makeSensor(services, "append-control-see")],
      [makeActuator(services, "append-control-move")]
    );
    ruleDef.typecheck();
    const markup = renderRuleCard(ruleDef);
    assert.equal(appendControl(markup, RuleSide.When), "reserved");
  });

  test("a do side the oracle offers nothing at stands none", () => {
    const { ruleDef } = makeBrain(
      [makeSensor(services, "append-control-see")],
      [makeActuator(services, "append-control-move")]
    );
    ruleDef.typecheck();
    const markup = renderRuleCard(ruleDef);
    assert.equal(appendControl(markup, RuleSide.Do), undefined);
  });

  test("one side losing its control leaves the other's standing", () => {
    const { ruleDef } = makeBrain([makeSensor(services, "append-control-split-see")], []);
    ruleDef.typecheck();
    const markup = renderRuleCard(ruleDef);
    assert.equal(appendControl(markup, RuleSide.When), "reserved");
    assert.equal(appendControl(markup, RuleSide.Do), "standing");
  });

  test("every rule stands a handle the closing offering can hand the keyboard to", () => {
    const { ruleDef } = makeBrain(
      [makeSensor(services, "append-handle-see")],
      [makeActuator(services, "append-handle-move")]
    );
    ruleDef.typecheck();
    const markup = renderRuleCard(ruleDef);
    assert.ok(markup.includes(`data-rule-handle="${ruleDef.id()}"`));
  });

  test("a host supplying no services stands both controls", () => {
    const { ruleDef } = makeBrain(
      [makeSensor(services, "append-no-services-see")],
      [makeActuator(services, "append-no-services-move")]
    );
    ruleDef.typecheck();
    const markup = renderToStaticMarkup(
      createElement(
        BrainEditorProvider,
        { config: editorConfig },
        createElement(
          ArmedTargetProvider,
          {
            value: {
              target: null,
              arm: () => {},
              disarm: () => {},
              mode: null,
              reportMode: () => {},
            } as ArmedTargetController,
          },
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
    assert.equal(appendControl(markup, RuleSide.When), "standing");
    assert.equal(appendControl(markup, RuleSide.Do), "standing");
  });
});
