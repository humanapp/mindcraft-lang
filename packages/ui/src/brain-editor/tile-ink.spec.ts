/**
 * Pins the label ink the tile surfaces render: a placed tile and a candidate
 * chip both take their label color from `readableInk` applied to the gradient's
 * dark stop, so a dark tile color gets light text and a light one keeps dark
 * text. Assertions are on the rendered color values, never on label wording.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@wendoo/core/brain";
import { mkOperatorTileId, RuleSide } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { BrainDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import { CoreOpId } from "@wendoo/core/runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readableInk } from "../lib/color";
import type { ArmedTileTarget } from "./ArmedTargetContext";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainTile } from "./BrainTile";
import {
  arrangeCandidateSubcategories,
  type CandidateEntry,
  type StripCandidate,
  tileCandidateGroup,
  toCandidateEntries,
} from "./candidate-strip-model";
import type { CandidateStripSection, CandidateStripState } from "./hooks/useCandidateStrip";
import { StripSurface } from "./test-only-rule-fixtures";

/** The default tile color the editor falls back to when no visual supplies one. */
const kFallbackTileColor = "#475569";

/** A tile color light enough that dark ink reads better on it. */
const kLightTileColor = "#aa94eb";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

function coreTile(tileId: string): IBrainTileDef {
  const tileDef = services.edit.tiles.get(tileId);
  assert.ok(tileDef, `core tile not registered: ${tileId}`);
  return tileDef;
}

/** An editor config whose tiles all carry `color` on both rule sides, or none when omitted. */
function configWithTileColor(color?: string): BrainEditorConfig {
  return {
    dataTypeIcons: new Map(),
    dataTypeNames: new Map(),
    customLiteralTypes: [],
    resolveTileVisual: color === undefined ? undefined : () => ({ label: "", colorDef: { when: color, do: color } }),
  };
}

/** Every `color:` declaration in the inline styles of `markup`, in document order. */
function inlineColors(markup: string): string[] {
  return [...markup.matchAll(/(?:^|[;"])color:([^;"]+)/g)].map((match) => match[1].trim());
}

function renderTile(color: string | undefined, tileDef: IBrainTileDef): string {
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: configWithTileColor(color) },
      createElement(BrainTile, { tileDef, side: RuleSide.When })
    )
  );
}

function candidate(tileDef: IBrainTileDef): StripCandidate {
  return {
    key: tileDef.tileId,
    tileDef,
    label: tileDef.tileId,
    group: tileCandidateGroup(tileDef),
    viaConversion: false,
    origin: { kind: "suggested" },
  };
}

function section(entries: readonly CandidateEntry[]): CandidateStripSection {
  const subcategories = arrangeCandidateSubcategories(entries, {}, []);
  return {
    key: entries[0].candidate.group,
    group: entries[0].candidate.group,
    subcategories,
    entries: subcategories.flatMap((subcategory) => subcategory.entries),
    totalCount: entries.length,
  };
}

/** An append target on a real rule's WHEN side, the shape the strip is always rendered for. */
function whenAppendTarget(): ArmedTileTarget {
  const brainDef = BrainDef.emptyBrainDef(services);
  const ruleDef = brainDef.pages().get(0).children().get(0) as BrainRuleDef;
  return { ruleDef, side: RuleSide.When, mode: "append", onTileSelected: () => true };
}

function renderStrip(color: string | undefined, tileDef: IBrainTileDef): string {
  const entries = toCandidateEntries([candidate(tileDef)]);
  const state: CandidateStripState = {
    bestNext: entries,
    sections: [section(entries)],
    filter: "",
    offeringOpen: true,
    isUnknown: false,
    acceptsTextLiteral: false,
    textLiteralCandidate: () => undefined,
    setFilter: () => {},
    commit: () => {},
    commitByKey: () => {},
    candidateFromKey: () => undefined,
  };
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: configWithTileColor(color) },
      createElement(StripSurface, { id: "strip", state, target: whenAppendTarget(), onDismiss: () => {} })
    )
  );
}

describe("tile label ink", () => {
  const notTile = () => coreTile(mkOperatorTileId(CoreOpId.Not));

  test("a placed tile on the fallback color renders the ink that color calls for", () => {
    const markup = renderTile(undefined, notTile());
    assert.equal(readableInk(kFallbackTileColor), "#ffffff");
    assert.ok(inlineColors(markup).includes("#ffffff"));
  });

  test("a placed tile on a light color keeps dark ink", () => {
    const markup = renderTile(kLightTileColor, notTile());
    assert.equal(readableInk(kLightTileColor), "#000000");
    assert.ok(inlineColors(markup).includes("#000000"));
    assert.ok(!inlineColors(markup).includes("#ffffff"));
  });

  test("a candidate chip on the fallback color renders the ink that color calls for", () => {
    const markup = renderStrip(undefined, notTile());
    assert.ok(inlineColors(markup).includes(readableInk(kFallbackTileColor)));
  });

  test("a candidate chip on a light color keeps dark ink", () => {
    const markup = renderStrip(kLightTileColor, notTile());
    assert.ok(inlineColors(markup).includes(readableInk(kLightTileColor)));
  });
});
