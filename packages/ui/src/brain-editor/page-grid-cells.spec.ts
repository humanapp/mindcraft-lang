/**
 * Pins what a rule card renders for the page's selection grid: one element per
 * cell, addressed by the key the model names it, carrying an accessible name,
 * and holding the grid's one tab stop between them all. Every other control the
 * card stands is reached by the arrow keys, so none of them is a tab stop of its
 * own.
 *
 * Structural assertions only: every value asserted here is a cell key, a tab
 * index, or the presence of a name.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, type ReadonlyList } from "@mindcraft-lang/core";
import type { BrainServices, IBrainTileDef, ITileCatalog } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainCommandHistory, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ArmedTargetController, ArmedTargetProvider } from "./ArmedTargetContext";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainRuleEditor } from "./BrainRuleEditor";
import { sideOffersAppendedTile } from "./insertion-context";
import { PageGridProvider } from "./PageGridContext";
import {
  kPageGridCellAttribute,
  type PageGridCell,
  pageGridCellKey,
  pageGridRows,
  type RuleCellDescriptor,
} from "./page-grid-model";
import { makeActuator, makeBrain, makeSensor } from "./test-only-rule-fixtures";

let services: BrainServices;
let catalogs: ReadonlyList<ITileCatalog>;

before(() => {
  services = __test__createBrainServices();
  catalogs = List.from<ITileCatalog>([services.edit.tiles]).asReadonly();
});

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
};

/** Every opening tag in `markup`, as its own text. */
function tags(markup: string): string[] {
  return markup.match(/<[a-zA-Z][^>]*>/g) ?? [];
}

/** The value `tag` gives `name`, or undefined where it carries no such attribute. */
function attributeOf(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match === null ? undefined : match[1];
}

/** The tags standing for a cell of the page's grid, in the order they render. */
function cellTags(markup: string): string[] {
  return tags(markup).filter((tag) => attributeOf(tag, kPageGridCellAttribute) !== undefined);
}

/** The card rendered inside a page grid whose one tab stop rests on `currentCell`. */
function renderRuleCard(ruleDef: BrainRuleDef, pageDef: BrainPageDef, currentCell?: PageGridCell): string {
  const controller: ArmedTargetController = { target: null, arm: () => {}, disarm: () => {} };
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
              currentCell,
              ruleToCompose: undefined,
              composeRule: () => {},
              grabRule: () => {},
            },
          },
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
      )
    )
  );
}

/** The keys the model names for `ruleDef`'s own rows, in reading order. */
function modelCellKeys(ruleDef: BrainRuleDef, hasSentence: boolean): string[] {
  const descriptor: RuleCellDescriptor = {
    ruleId: ruleDef.id(),
    whenTileCount: ruleDef.when().tiles().size(),
    doTileCount: ruleDef.do().tiles().size(),
    whenAppendable: sideOffersAppendedTile({ ruleDef, side: RuleSide.When, catalogs, services }),
    doAppendable: sideOffersAppendedTile({ ruleDef, side: RuleSide.Do, catalogs, services }),
    hasSentence,
  };
  // The page stands the last row, not the rule.
  return pageGridRows([descriptor]).slice(0, -1).flat().map(pageGridCellKey);
}

/** A rule holding one tile on each side, typechecked so the oracle has an answer for both. */
function makePopulatedRule(name: string): { ruleDef: BrainRuleDef; pageDef: BrainPageDef } {
  const whenTiles: IBrainTileDef[] = [makeSensor(services, `${name}-see`)];
  const doTiles: IBrainTileDef[] = [makeActuator(services, `${name}-move`)];
  const { ruleDef, pageDef } = makeBrain(services, whenTiles, doTiles);
  ruleDef.typecheck();
  return { ruleDef, pageDef };
}

describe("the cells a rule card renders", () => {
  test("the card stands exactly the cells the model names, in the same order", () => {
    const { ruleDef, pageDef } = makePopulatedRule("cells-order");
    const rendered = cellTags(renderRuleCard(ruleDef, pageDef)).map(
      (tag) => attributeOf(tag, kPageGridCellAttribute) as string
    );
    assert.deepEqual(rendered, modelCellKeys(ruleDef, true));
  });

  test("a rule holding no tiles stands its sentence cell on the line inviting one", () => {
    const { ruleDef, pageDef } = makeBrain(services, [], []);
    const rendered = cellTags(renderRuleCard(ruleDef, pageDef)).map(
      (tag) => attributeOf(tag, kPageGridCellAttribute) as string
    );
    assert.deepEqual(rendered, modelCellKeys(ruleDef, true));
    assert.ok(rendered.includes(pageGridCellKey({ kind: "sentence", ruleId: ruleDef.id() })));
  });

  test("no cell key is repeated", () => {
    const { ruleDef, pageDef } = makePopulatedRule("cells-unique");
    const keys = cellTags(renderRuleCard(ruleDef, pageDef)).map((tag) => attributeOf(tag, kPageGridCellAttribute));
    assert.equal(new Set(keys).size, keys.length);
  });

  test("every cell carries an accessible name", () => {
    const { ruleDef, pageDef } = makePopulatedRule("cells-named");
    for (const tag of cellTags(renderRuleCard(ruleDef, pageDef))) {
      const name = attributeOf(tag, "aria-label");
      assert.ok(name !== undefined && name.length > 0, attributeOf(tag, kPageGridCellAttribute));
    }
  });
});

describe("the grid's one tab stop", () => {
  test("the named cell takes it and every other cell gives it up", () => {
    const { ruleDef, pageDef } = makePopulatedRule("stop-named");
    const named: PageGridCell = { kind: "tile", ruleId: ruleDef.id(), side: RuleSide.Do, tileIndex: 0 };
    const namedKey = pageGridCellKey(named);
    const stops = new Map(
      cellTags(renderRuleCard(ruleDef, pageDef, named)).map((tag) => [
        attributeOf(tag, kPageGridCellAttribute) as string,
        attributeOf(tag, "tabindex"),
      ])
    );
    assert.equal(stops.get(namedKey), "0");
    assert.equal([...stops.values()].filter((value) => value === "0").length, 1);
    for (const [key, value] of stops) if (key !== namedKey) assert.equal(value, "-1");
  });

  test("no other control of the card is a tab stop", () => {
    const { ruleDef, pageDef } = makePopulatedRule("stop-only");
    const named: PageGridCell = { kind: "handle", ruleId: ruleDef.id() };
    for (const tag of tags(renderRuleCard(ruleDef, pageDef, named))) {
      if (!tag.startsWith("<button")) continue;
      const key = attributeOf(tag, kPageGridCellAttribute);
      if (key !== undefined) continue;
      assert.equal(attributeOf(tag, "tabindex"), "-1", tag);
    }
  });

  test("a card rendered outside a page grid stands no cell and reserves no tab stop", () => {
    const { ruleDef, pageDef } = makePopulatedRule("stop-none");
    const markup = renderToStaticMarkup(
      createElement(
        BrainEditorProvider,
        { config: { ...editorConfig, brainServices: services, tileCatalogs: [services.edit.tiles] } },
        createElement(
          ArmedTargetProvider,
          { value: { target: null, arm: () => {}, disarm: () => {} } as ArmedTargetController },
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
      )
    );
    assert.deepEqual(cellTags(markup), []);
  });
});
