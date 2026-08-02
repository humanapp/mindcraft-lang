/**
 * Pins how the offering's position row names the caret: each kind of position a
 * caret can stand at announces itself through its own catalog entry, and every
 * one of those entries is reached through the localizer with the neighbouring
 * tile's word carried as a named parameter.
 *
 * Structural assertions only. The localizer these renders run against answers
 * every lookup with a machine marker naming the entry it selected, so an
 * assertion names an entry with no English text in it. Announcement wording is
 * display prose and is never asserted.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import type { LocalizedValue, Localizer } from "@mindcraft-lang/core/localization";
import { createDefaultLocalizer } from "@mindcraft-lang/core/localization";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ArmedTileTarget } from "./ArmedTargetContext";
import type { StripEditPointBinding } from "./BrainCandidateStrip";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import type { CaretPosition } from "./caret-run";
import type { CandidateStripState } from "./hooks/useCandidateStrip";
import { makeBrain, makeSensor, StripSurface } from "./test-only-rule-fixtures";

/** Context tag the offering files its own prose under. */
const kOfferingContext = "tile-offering";

/** Shape of every marker the spec's localizer answers with. */
const kMarkerPattern = /^\[\[\d+\]\]$/;

/** One lookup a render asked the localizer for, and the marker it answered with. */
interface TrCall {
  readonly source: string;
  readonly context?: string;
  readonly params?: Record<string, LocalizedValue>;
  /** The marker this lookup rendered as, which the markup carries verbatim. */
  readonly marker: string;
}

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

/** The marker each source and context pair has been answered with so far. */
const markers = new Map<string, string>();

/**
 * A localizer answering every lookup with a machine marker naming the entry it
 * selected: one marker per distinct source and context pair, stable across
 * every render of the spec, carrying none of the entry's text. Appends each
 * lookup to `calls`.
 */
function markerLocalizer(calls: TrCall[]): Localizer {
  const base = createDefaultLocalizer();
  return {
    locale: () => "marker",
    tr(source: string, params?: Record<string, LocalizedValue>, context?: string): string {
      const key = `${context ?? ""}|${source}`;
      let marker = markers.get(key);
      if (marker === undefined) {
        marker = `[[${markers.size}]]`;
        markers.set(key, marker);
      }
      calls.push({ source, context, params, marker });
      return marker;
    },
    list: (items, kind) => base.list(items, kind),
    compare: (a, b) => base.compare(a, b),
    foldForSearch: (text) => base.foldForSearch(text),
  };
}

/** An open offering holding no candidates, which is all these renders need. */
function stripState(): CandidateStripState {
  return {
    bestNext: [],
    sections: [],
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
}

/** The target a tap at `caret` in the rule's sentence arms. */
function caretTarget(ruleDef: BrainRuleDef, caret: CaretPosition): ArmedTileTarget {
  const tileCount = ruleDef.side(caret.side).tiles().size();
  const mode = caret.kind === "element" ? "replace" : caret.tileIndex < tileCount ? "insert" : "append";
  return {
    ruleDef,
    side: caret.side,
    mode,
    tileIndex: mode === "append" ? undefined : caret.tileIndex,
    caret,
    entry: "sentence",
    onTileSelected: () => true,
  };
}

/** The target a tap on the tile at `tileIndex` of the WHEN side arms in the tile row. */
function tileTarget(ruleDef: BrainRuleDef, tileIndex: number): ArmedTileTarget {
  return {
    ruleDef,
    side: RuleSide.When,
    mode: "replace",
    tileIndex,
    anchorTileIndex: tileIndex,
    onTileSelected: () => true,
  };
}

/** The pivot binding a target armed in the tile row stands the strip's position pivot on. */
const tileRowPivot: StripEditPointBinding = { position: "replace", arm: () => {}, menu: undefined };

/**
 * The offering panel rendered for `target`, with every lookup appended to
 * `calls`. `editPoint` stands the position pivot, which a target armed in the
 * tile row carries.
 */
function renderStrip(target: ArmedTileTarget, calls: TrCall[], editPoint?: StripEditPointBinding): string {
  const config: BrainEditorConfig = {
    dataTypeIcons: new Map(),
    dataTypeNames: new Map(),
    customLiteralTypes: [],
    localizer: markerLocalizer(calls),
  };
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config },
      createElement(StripSurface, { state: stripState(), target, onDismiss: () => {}, editPoint })
    )
  );
}

/** The text of the first element the position row holds, which is the row's announcement. */
function positionRowName(markup: string): string {
  const row = /data-strip-position-row=""[^>]*>([\s\S]*?)<\/div>/.exec(markup);
  assert.ok(row, "the panel renders its position row");
  const name = /<span[^>]*>([\s\S]*?)<\/span>/.exec(row[1]);
  assert.ok(name, "the row renders the caret's place");
  return name[1];
}

/** The opening tag of the removal control, or undefined when the panel offers none. */
function removalTag(markup: string): string | undefined {
  return /<button[^>]*data-strip-delete=""[^>]*>/.exec(markup)?.[0];
}

/** The value of `attribute` on `tag`, or undefined when the tag does not carry it. */
function attributeOf(tag: string, attribute: string): string | undefined {
  return new RegExp(`\\s${attribute}="([^"]*)"`).exec(tag)?.[1];
}

/** The lookup of `calls` that rendered `marker`, which is the entry the markup shows. */
function lookupBehind(calls: readonly TrCall[], marker: string): TrCall {
  const call = calls.find((candidate) => candidate.marker === marker);
  assert.ok(call, "the rendered text is a catalog entry the localizer answered");
  return call;
}

/** The catalog entry the offering's position row announces a caret at `caret` through. */
function announce(ruleDef: BrainRuleDef, caret: CaretPosition): TrCall {
  const calls: TrCall[] = [];
  const marker = positionRowName(renderStrip(caretTarget(ruleDef, caret), calls));
  const call = lookupBehind(calls, marker);
  assert.equal(call.context, kOfferingContext, "the announcement is filed under the offering's context");
  return call;
}

describe("the caret's place, as the offering's position row announces it", () => {
  test("each kind of position announces itself through its own entry", () => {
    const oneTile = makeBrain(services, [makeSensor(services, "caret-name-see")], []);
    const empty = makeBrain(services, [], []);
    const announced = [
      announce(empty.ruleDef, { kind: "gap", side: RuleSide.When, tileIndex: 0 }).marker,
      announce(oneTile.ruleDef, { kind: "gap", side: RuleSide.When, tileIndex: 0 }).marker,
      announce(oneTile.ruleDef, { kind: "element", side: RuleSide.When, tileIndex: 0 }).marker,
      announce(oneTile.ruleDef, { kind: "gap", side: RuleSide.When, tileIndex: 1 }).marker,
    ];
    for (const marker of announced) assert.match(marker, kMarkerPattern, "every position announces an entry");
    assert.equal(new Set(announced).size, announced.length, "and no two of them announce the same one");
  });

  test("a side holding no tiles announces its one gap with no tile named", () => {
    const { ruleDef } = makeBrain(services, [], []);
    const call = announce(ruleDef, { kind: "gap", side: RuleSide.When, tileIndex: 0 });
    assert.equal(call.params, undefined, "the announcement names no tile, since the side holds none");
  });

  test("a position standing next to a tile carries that tile's word as a named parameter", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "caret-name-word")], []);
    const positions: readonly CaretPosition[] = [
      { kind: "gap", side: RuleSide.When, tileIndex: 0 },
      { kind: "element", side: RuleSide.When, tileIndex: 0 },
      { kind: "gap", side: RuleSide.When, tileIndex: 1 },
    ];
    for (const position of positions) {
      const where = `${position.kind} at ${position.tileIndex}`;
      const params = announce(ruleDef, position).params;
      assert.ok(params, `${where} interpolates its parameters`);
      assert.deepEqual(Object.keys(params), ["word"], `${where} names the tile's word as its one parameter`);
    }
  });

  test("a side names itself against its own tiles, not the other side's", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "caret-name-when")], []);
    const whenEnd = announce(ruleDef, { kind: "gap", side: RuleSide.When, tileIndex: 1 });
    const doOnly = announce(ruleDef, { kind: "gap", side: RuleSide.Do, tileIndex: 0 });
    assert.notEqual(whenEnd.marker, doOnly.marker, "an empty DO side reads unlike the WHEN side's end");
    assert.equal(doOnly.params, undefined, "the empty side names no tile");
  });
});

describe("the offering's other prose", () => {
  test("the removal control's name and tooltip are one entry, read together", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "caret-name-removal")], []);
    const calls: TrCall[] = [];
    const tag = removalTag(renderStrip(tileTarget(ruleDef, 0), calls, tileRowPivot));
    assert.ok(tag, "the panel offers the removal");
    const name = attributeOf(tag, "aria-label");
    assert.ok(name, "the control carries an accessible name");
    assert.equal(attributeOf(tag, "title"), name, "and a tooltip reading the same entry");
    const call = lookupBehind(calls, name);
    assert.equal(call.context, kOfferingContext, "the name is filed under the offering's context");
    assert.deepEqual(Object.keys(call.params ?? {}), ["word"], "and names the tile it addresses by parameter");
  });

  test("a strip armed from the tray names its filter box through the localizer", () => {
    const { ruleDef } = makeBrain(services, [], []);
    const calls: TrCall[] = [];
    const target: ArmedTileTarget = { ruleDef, side: RuleSide.When, mode: "append", onTileSelected: () => true };
    const input = /<input[^>]*data-strip-filter="tray"[^>]*>/.exec(renderStrip(target, calls))?.[0];
    assert.ok(input, "the tray hosts the filter box");
    const name = attributeOf(input, "aria-label");
    assert.ok(name, "the box carries an accessible name");
    assert.equal(lookupBehind(calls, name).context, kOfferingContext, "read from the offering's context");
  });
});
