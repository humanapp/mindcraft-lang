/**
 * Pins the candidate offering's visibility as a state of its own, separate from
 * the position the editor is armed at: arming a position offers the tiles that
 * fit there, a closed offering renders no panel while the armed position stands,
 * and a closed offering references no element it does not render. Pins with it
 * the sentence line's one owner -- the rule card, in both modes -- and the
 * panel's place out of that card's flow.
 *
 * Structural assertions only: every value asserted here is a role, an id
 * reference, a state flag, or text the user typed. Labels, placeholders, and
 * announcement wording are display prose and are never asserted.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainCommandHistory, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { CoreHostActions, mkSensorTileId } from "@mindcraft-lang/core/runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type ArmedTargetController,
  type ArmedTargetEntry,
  ArmedTargetProvider,
  type ArmedTileTarget,
} from "./ArmedTargetContext";
import type { StripComposerBinding } from "./BrainCandidateStrip";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainRuleEditor } from "./BrainRuleEditor";
import {
  type CandidateEntry,
  kBestNextBandKey,
  type StripCandidate,
  tileCandidateGroup,
  toCandidateEntries,
  visibleStripOptions,
} from "./candidate-strip-model";
import type { CaretPosition } from "./caret-run";
import type { CandidateStripState } from "./hooks/useCandidateStrip";
import { makeActuator, makeBrain, makeSensor, StripSurface } from "./test-only-rule-fixtures";

let services: BrainServices;

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
};

before(() => {
  services = __test__createBrainServices();
});

/** The append target the given entry point arms for `ruleDef`'s `side`, at that side's end gap. */
function appendTarget(ruleDef: BrainRuleDef, side: RuleSide, entry: ArmedTargetEntry): ArmedTileTarget {
  const caret: CaretPosition = { kind: "gap", side, tileIndex: ruleDef.side(side).tiles().size() };
  return {
    ruleDef,
    side,
    mode: "append",
    caret: entry === "sentence" ? caret : undefined,
    entry,
    onTileSelected: () => true,
  };
}

/** The target a tap on the tile at `tileIndex` of `side` arms through the given entry point. */
function tileTarget(
  ruleDef: BrainRuleDef,
  side: RuleSide,
  tileIndex: number,
  entry: ArmedTargetEntry
): ArmedTileTarget {
  return {
    ruleDef,
    side,
    mode: "replace",
    tileIndex,
    anchorTileIndex: tileIndex,
    caret: entry === "sentence" ? { kind: "element", side, tileIndex } : undefined,
    entry,
    onTileSelected: () => true,
  };
}

function renderRuleCard(ruleDef: BrainRuleDef, pageDef: BrainPageDef, target: ArmedTileTarget | null): string {
  const controller: ArmedTargetController = { target, arm: () => {}, disarm: () => {} };
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

/** The strip's DOM id in every direct render, so option ids are deterministic. */
const kStripId = "strip";

/** A candidate over a real core tile, keyed by its tile id as the strip's own candidates are. */
function candidate(tileId: string): StripCandidate {
  const tileDef = services.edit.tiles.get(tileId);
  assert.ok(tileDef, `core tile not registered: ${tileId}`);
  return {
    key: tileId,
    tileDef,
    label: tileId,
    group: tileCandidateGroup(tileDef),
    viaConversion: false,
    origin: { kind: "suggested" },
  };
}

/** The chips a position offers in these probes. */
function offeredEntries(): CandidateEntry[] {
  return toCandidateEntries([
    candidate(mkSensorTileId(CoreHostActions.Timeout.key)),
    candidate(mkSensorTileId(CoreHostActions.OnPageEntered.key)),
  ]);
}

function stripState(overrides: Partial<CandidateStripState>): CandidateStripState {
  return {
    bestNext: [],
    sections: [],
    filter: "",
    offeringOpen: true,
    isUnknown: false,
    acceptsTextLiteral: false,
    textLiteralCandidate: () => undefined,
    setFilter: () => {},
    setOfferingOpen: () => {},
    commit: () => {},
    commitByKey: () => {},
    candidateFromKey: () => undefined,
    ...overrides,
  };
}

/** The binding that hands the strip's filter box to `ruleDef`'s sentence line. */
function composerBinding(ruleDef: BrainRuleDef): StripComposerBinding {
  return {
    caretPosition: { kind: "gap", side: RuleSide.When, tileIndex: ruleDef.when().tiles().size() },
    pivoted: false,
    canEndArmedSide: () => true,
    isRuleEmpty: () => false,
    doTileCount: () => 0,
    ownNewestPlacement: () => undefined,
    undoOwnLastCommit: () => {},
  };
}

function renderStrip(state: CandidateStripState, target: ArmedTileTarget, composer?: StripComposerBinding): string {
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: editorConfig },
      createElement(StripSurface, { id: kStripId, state, target, onDismiss: () => {}, composer })
    )
  );
}

/** How many times `pattern` occurs in `markup`. */
function countOf(markup: string, pattern: string): number {
  return markup.split(pattern).length - 1;
}

/** Every `id` attribute value in `markup`, in document order. */
function idsIn(markup: string): string[] {
  return [...markup.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]);
}

/** Every value of the attribute `name` in `markup`, in document order. */
function attributeValues(markup: string, name: string): string[] {
  return [...markup.matchAll(new RegExp(`\\s${name}="([^"]*)"`, "g"))].map((match) => match[1]);
}

/** The opening tag of the one element in `markup` carrying `role`. */
function tagWithRole(markup: string, role: string): string | undefined {
  return [...markup.matchAll(/<[a-z]+\s[^>]*>/g)]
    .map((match) => match[0])
    .find((tag) => tag.includes(`role="${role}"`));
}

/** The value of `attribute` on `tag`, or undefined when the tag does not carry it. */
function attributeOf(tag: string | undefined, attribute: string): string | undefined {
  return tag === undefined ? undefined : new RegExp(`\\s${attribute}="([^"]*)"`).exec(tag)?.[1];
}

/**
 * True when `markup` renders the strip's panel, which carries the strip's one
 * live region.
 */
function hasOfferingPanel(markup: string): boolean {
  return countOf(markup, 'aria-live="polite"') === 1;
}

/** Every id `markup` points at that no element of `markup` carries. */
function danglingReferences(markup: string): string[] {
  const ids = new Set(idsIn(markup));
  const dangling: string[] = [];
  for (const attribute of ["aria-controls", "aria-describedby", "aria-labelledby", "aria-activedescendant"]) {
    for (const value of attributeValues(markup, attribute)) {
      for (const reference of value.split(/\s+/).filter((token) => token.length > 0)) {
        if (!ids.has(reference)) dangling.push(`${attribute} -> ${reference}`);
      }
    }
  }
  return dangling;
}

describe("arming a position offers the tiles that fit it", () => {
  test("a position armed from the tray renders the offering panel", () => {
    const { ruleDef, pageDef } = makeBrain(services, [], []);
    const markup = renderRuleCard(ruleDef, pageDef, appendTarget(ruleDef, RuleSide.When, "tray"));
    assert.equal(countOf(markup, 'data-strip-filter="tray"'), 1);
    assert.ok(hasOfferingPanel(markup));
    assert.equal(countOf(markup, 'aria-expanded="true"'), 1, "the arming control reports the panel it opened");
    assert.deepEqual(danglingReferences(markup), []);
  });

  test("a position armed from the sentence renders the offering panel too", () => {
    const { ruleDef, pageDef } = makeBrain(services, [makeSensor(services, "offering-see")], []);
    const markup = renderRuleCard(ruleDef, pageDef, appendTarget(ruleDef, RuleSide.When, "sentence"));
    assert.equal(countOf(markup, 'data-strip-filter="sentence"'), 1);
    assert.ok(hasOfferingPanel(markup));
    assert.equal(countOf(markup, 'aria-expanded="true"'), 1);
    assert.deepEqual(danglingReferences(markup), []);
  });

  test("a position armed on a placed tile offers there, with its pivot", () => {
    const { ruleDef, pageDef } = makeBrain(services, [makeSensor(services, "offering-hear")], []);
    const markup = renderRuleCard(ruleDef, pageDef, tileTarget(ruleDef, RuleSide.When, 0, "tray"));
    assert.equal(countOf(markup, 'data-strip-filter="tray"'), 1);
    assert.ok(hasOfferingPanel(markup));
    assert.equal(countOf(markup, "data-edit-point-pivot"), 1);
    assert.deepEqual(danglingReferences(markup), []);
  });

  test("a rule with no armed position renders no offering at all", () => {
    const { ruleDef, pageDef } = makeBrain(
      services,
      [makeSensor(services, "offering-smell")],
      [makeActuator(services, "offering-move")]
    );
    const markup = renderRuleCard(ruleDef, pageDef, null);
    assert.equal(countOf(markup, "data-strip-filter"), 0);
    assert.equal(countOf(markup, 'role="combobox"'), 0);
    assert.equal(hasOfferingPanel(markup), false);
    assert.equal(countOf(markup, 'aria-expanded="true"'), 0);
    assert.deepEqual(danglingReferences(markup), []);
  });
});

describe("the offering closed at an armed position", () => {
  test("no panel and no chip stand while the offering is closed", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "offering-closed-see")], []);
    const target = appendTarget(ruleDef, RuleSide.When, "tray");
    const offering = { bestNext: offeredEntries() };
    assert.ok(hasOfferingPanel(renderStrip(stripState(offering), target)));
    const closed = renderStrip(stripState({ ...offering, offeringOpen: false }), target);
    assert.equal(hasOfferingPanel(closed), false);
    assert.equal(countOf(closed, 'role="option"'), 0);
    assert.equal(countOf(closed, 'role="listbox"'), 0);
  });

  test("the armed position survives the closure, keeping the box the sentence hosts", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "offering-closed-hear")], []);
    const target = appendTarget(ruleDef, RuleSide.When, "sentence");
    const closed = renderStrip(
      stripState({ bestNext: offeredEntries(), offeringOpen: false }),
      target,
      composerBinding(ruleDef)
    );
    assert.equal(countOf(closed, 'data-strip-filter="sentence"'), 1);
    assert.equal(hasOfferingPanel(closed), false);
  });

  test("a closed offering with no sentence to host it renders nothing", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "offering-closed-smell")], []);
    const target = appendTarget(ruleDef, RuleSide.When, "tray");
    assert.equal(renderStrip(stripState({ bestNext: offeredEntries(), offeringOpen: false }), target), "");
  });

  test("the word in progress is untouched by the closure", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "offering-closed-typed")], []);
    const target = appendTarget(ruleDef, RuleSide.When, "sentence");
    const composer = composerBinding(ruleDef);
    const typed = { bestNext: offeredEntries(), filter: "tim" };
    const closed = renderStrip(stripState({ ...typed, offeringOpen: false }), target, composer);
    const reopened = renderStrip(stripState(typed), target, composer);
    assert.equal(attributeOf(tagWithRole(closed, "combobox"), "value"), "tim");
    assert.equal(attributeOf(tagWithRole(reopened, "combobox"), "value"), "tim");
  });

  test("reopening at the same position offers every chip again", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "offering-closed-reopen")], []);
    const target = appendTarget(ruleDef, RuleSide.When, "tray");
    const entries = offeredEntries();
    const reopened = renderStrip(stripState({ bestNext: entries, offeringOpen: true }), target);
    assert.deepEqual(
      [...reopened.matchAll(/<button\s[^>]*role="option"[^>]*>/g)].map((match) => attributeOf(match[0], "id")),
      visibleStripOptions(kStripId, [{ key: kBestNextBandKey, entries }]).map((option) => option.optionId)
    );
  });
});

describe("the sentence line's owner", () => {
  test("the rule card renders it whether or not the rule is being composed", () => {
    const { ruleDef, pageDef } = makeBrain(services, [makeSensor(services, "owner-see")], []);
    const marker = `data-rule-sentence="${ruleDef.id()}"`;
    assert.equal(countOf(renderRuleCard(ruleDef, pageDef, null), marker), 1, "settled");
    assert.equal(
      countOf(renderRuleCard(ruleDef, pageDef, appendTarget(ruleDef, RuleSide.When, "sentence")), marker),
      1,
      "composing"
    );
  });

  test("the strip renders none of it, composing or not", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "owner-hear")], []);
    const target = appendTarget(ruleDef, RuleSide.When, "sentence");
    const state = stripState({ bestNext: offeredEntries() });
    assert.equal(countOf(renderStrip(state, target, composerBinding(ruleDef)), "data-rule-sentence"), 0);
    assert.equal(countOf(renderStrip(state, target), "data-rule-sentence"), 0);
  });
});

describe("the offering panel's place", () => {
  test("it is laid over the rules below, taking no room in the card's flow", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "panel-place")], []);
    const markup = renderStrip(
      stripState({ bestNext: offeredEntries() }),
      appendTarget(ruleDef, RuleSide.When, "tray")
    );
    const tokens = /<section[^>]*class="([^"]*)"/.exec(markup)?.[1].split(" ") ?? [];
    assert.ok(tokens.includes("absolute"), "the panel is out of flow");
    assert.ok(!tokens.includes("relative"), "and not a box the card lays out");
  });

  test("the close button stands over the panel, which positions it", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "panel-close")], []);
    const markup = renderStrip(
      stripState({ bestNext: offeredEntries() }),
      appendTarget(ruleDef, RuleSide.When, "tray")
    );
    const close = /<button[^>]*data-strip-close=""[^>]*>/.exec(markup)?.[0] ?? "";
    const tokens = /class="([^"]*)"/.exec(close)?.[1].split(" ") ?? [];
    assert.ok(tokens.includes("absolute"), "the close button is laid over its panel");
    assert.ok(
      markup.indexOf("data-strip-close") > markup.indexOf("<section"),
      "and stands inside the panel it is positioned against"
    );
  });
});

describe("the combobox while the offering is closed", () => {
  const closedMarkup = (sensorId: string): string => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, sensorId)], []);
    return renderStrip(
      stripState({ bestNext: offeredEntries(), offeringOpen: false }),
      appendTarget(ruleDef, RuleSide.When, "sentence"),
      composerBinding(ruleDef)
    );
  };

  test("it reports its popup collapsed", () => {
    assert.equal(
      attributeOf(tagWithRole(closedMarkup("offering-aria-collapsed"), "combobox"), "aria-expanded"),
      "false"
    );
  });

  test("it controls nothing and highlights nothing", () => {
    const combobox = tagWithRole(closedMarkup("offering-aria-controls"), "combobox");
    assert.ok(combobox, "the box the composer hosts stands while the offering is closed");
    assert.equal(attributeOf(combobox, "aria-controls"), undefined);
    assert.equal(attributeOf(combobox, "aria-activedescendant"), undefined);
    assert.equal(attributeOf(combobox, "aria-describedby"), undefined);
  });

  test("every id the closed strip points at resolves to an element it renders", () => {
    assert.deepEqual(danglingReferences(closedMarkup("offering-aria-dangling")), []);
  });

  test("unknown text still marks the box invalid without pointing at an absent explanation", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "offering-aria-unknown")], []);
    const markup = renderStrip(
      stripState({ filter: "zzz", isUnknown: true, offeringOpen: false }),
      appendTarget(ruleDef, RuleSide.When, "sentence"),
      composerBinding(ruleDef)
    );
    assert.equal(attributeOf(tagWithRole(markup, "combobox"), "aria-invalid"), "true");
    assert.deepEqual(danglingReferences(markup), []);
  });
});
