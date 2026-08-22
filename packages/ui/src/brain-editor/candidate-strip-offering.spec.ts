/**
 * Pins the candidate offering's visibility as a reading of the armed position:
 * a position the oracle offers a tile at stands the panel, a position it offers
 * nothing at stands none, and the answer agrees with the offering that position
 * would build, for the append, insert and replace shapes alike. Pins with it
 * that a closed offering renders no panel while the armed position stands, that
 * it references no element it does not render, the sentence line's one owner --
 * the rule card, in both modes -- and the panel's place out of that card's flow.
 *
 * A host supplying no brain services cannot ask the oracle, so its offering
 * stands open; the probes that supply none rely on that.
 *
 * Structural assertions only: every value asserted here is a role, an id
 * reference, a state flag, a candidate count, or text the user typed. Labels,
 * placeholders, and announcement wording are display prose and are never
 * asserted.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@wendoo/core";
import type { BrainServices, ITileCatalog } from "@wendoo/core/brain";
import { RuleSide } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { buildInsertionContext, suggestTiles } from "@wendoo/core/brain/language-service";
import { BrainCommandHistory, type BrainPageDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import { CoreHostActions, mkSensorTileId } from "@wendoo/core/runtime";
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
  buildStripCandidates,
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

/** The target a caret in the gap before the tile at `tileIndex` of `side` arms. */
function insertTarget(
  ruleDef: BrainRuleDef,
  side: RuleSide,
  tileIndex: number,
  entry: ArmedTargetEntry
): ArmedTileTarget {
  return {
    ruleDef,
    side,
    mode: "insert",
    tileIndex,
    caret: entry === "sentence" ? { kind: "gap", side, tileIndex } : undefined,
    entry,
    onTileSelected: () => true,
  };
}

function renderCardWith(config: BrainEditorConfig, ruleDef: BrainRuleDef, target: ArmedTileTarget | null): string {
  const controller: ArmedTargetController = {
    target,
    arm: () => {},
    disarm: () => {},
    mode: null,
    reportMode: () => {},
  };
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config },
      createElement(
        ArmedTargetProvider,
        { value: controller },
        createElement(BrainRuleEditor, {
          ruleDef,
          lineNumber: 1,
          ruleCount: 1,
          revision: "",
          commandHistory: new BrainCommandHistory(),
        })
      )
    )
  );
}

function renderRuleCard(ruleDef: BrainRuleDef, target: ArmedTileTarget | null): string {
  return renderCardWith(editorConfig, ruleDef, target);
}

/** The card as a host that supplies the oracle renders it, so the armed position is really asked. */
function renderAskedRuleCard(ruleDef: BrainRuleDef, target: ArmedTileTarget | null): string {
  return renderCardWith(
    { ...editorConfig, brainServices: services, tileCatalogs: [services.edit.tiles] },
    ruleDef,
    target
  );
}

/**
 * How many candidates the oracle offers at the position `target` arms, asked in
 * that target's own shape: the full tile list for an append or a replace, and
 * the list truncated at the insertion index for an insert.
 */
function candidateCountAt(target: ArmedTileTarget): number {
  const tileSet = target.side === RuleSide.When ? target.ruleDef.when() : target.ruleDef.do();
  const tiles = tileSet.tiles();
  const isInsert = target.mode === "insert";
  const context = buildInsertionContext({
    side: target.side,
    expr: isInsert ? undefined : tileSet.expr(),
    replaceTileIndex: target.mode === "replace" ? target.tileIndex : undefined,
    ruleDef: target.ruleDef,
    existingTiles: isInsert ? tiles.slice(0, target.tileIndex ?? 0) : tiles,
  });
  const catalogs = List.from<ITileCatalog>([services.edit.tiles]).asReadonly();
  return buildStripCandidates(suggestTiles(context, catalogs, services), (tileDef) => tileDef.tileId).length;
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
    insertRuleAfter: () => {},
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
    const { ruleDef } = makeBrain(services, [], []);
    const markup = renderRuleCard(ruleDef, appendTarget(ruleDef, RuleSide.When, "tray"));
    assert.equal(countOf(markup, 'data-strip-filter="tray"'), 1);
    assert.ok(hasOfferingPanel(markup));
    assert.equal(countOf(markup, 'aria-expanded="true"'), 1, "the arming control reports the panel it opened");
    assert.deepEqual(danglingReferences(markup), []);
  });

  test("a position armed from the sentence renders the offering panel too", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "offering-see")], []);
    const markup = renderRuleCard(ruleDef, appendTarget(ruleDef, RuleSide.When, "sentence"));
    assert.equal(countOf(markup, 'data-strip-filter="sentence"'), 1);
    assert.ok(hasOfferingPanel(markup));
    assert.equal(countOf(markup, 'aria-expanded="true"'), 1);
    assert.deepEqual(danglingReferences(markup), []);
  });

  test("a position armed on a placed tile offers there, with its pivot", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "offering-hear")], []);
    const markup = renderRuleCard(ruleDef, tileTarget(ruleDef, RuleSide.When, 0, "tray"));
    assert.equal(countOf(markup, 'data-strip-filter="tray"'), 1);
    assert.ok(hasOfferingPanel(markup));
    assert.equal(countOf(markup, "data-edit-point-pivot"), 1);
    assert.deepEqual(danglingReferences(markup), []);
  });

  test("a rule with no armed position renders no offering at all", () => {
    const { ruleDef } = makeBrain(
      services,
      [makeSensor(services, "offering-smell")],
      [makeActuator(services, "offering-move")]
    );
    const markup = renderRuleCard(ruleDef, null);
    assert.equal(countOf(markup, "data-strip-filter"), 0);
    assert.equal(countOf(markup, 'role="combobox"'), 0);
    assert.equal(hasOfferingPanel(markup), false);
    assert.equal(countOf(markup, 'aria-expanded="true"'), 0);
    assert.deepEqual(danglingReferences(markup), []);
  });
});

describe("the offering stands only where the position offers a tile", () => {
  /** A rule whose two sides each read as complete, so each side's end offers nothing. */
  function completeRule(name: string) {
    const brain = makeBrain(services, [makeSensor(services, `${name}-see`)], [makeActuator(services, `${name}-move`)]);
    brain.ruleDef.typecheck();
    return brain;
  }

  test("a position the oracle offers nothing at never opens one", () => {
    const { ruleDef } = completeRule("dead-end");
    for (const side of [RuleSide.When, RuleSide.Do]) {
      const target = appendTarget(ruleDef, side, "sentence");
      assert.equal(candidateCountAt(target), 0, "the position under test offers nothing");
      assert.equal(hasOfferingPanel(renderAskedRuleCard(ruleDef, target)), false);
    }
  });

  test("reaching it from the tray opens none either", () => {
    const { ruleDef } = completeRule("dead-tray");
    const markup = renderAskedRuleCard(ruleDef, appendTarget(ruleDef, RuleSide.Do, "tray"));
    assert.equal(hasOfferingPanel(markup), false);
    assert.equal(countOf(markup, "data-strip-filter"), 0);
  });

  test("the caret still stands at such a position, with the box the sentence hosts", () => {
    const { ruleDef } = completeRule("dead-caret");
    const markup = renderAskedRuleCard(ruleDef, appendTarget(ruleDef, RuleSide.When, "sentence"));
    assert.equal(countOf(markup, 'data-strip-filter="sentence"'), 1);
    assert.equal(countOf(markup, 'role="combobox"'), 1);
    assert.equal(hasOfferingPanel(markup), false);
    assert.deepEqual(danglingReferences(markup), []);
  });

  test("a position that offers still opens one", () => {
    const { ruleDef } = completeRule("live-position");
    for (const target of [
      insertTarget(ruleDef, RuleSide.When, 0, "sentence"),
      tileTarget(ruleDef, RuleSide.When, 0, "tray"),
    ]) {
      assert.ok(candidateCountAt(target) > 0, "the position under test offers tiles");
      assert.ok(hasOfferingPanel(renderAskedRuleCard(ruleDef, target)));
    }
  });

  test("an interior gap answers over the tiles before it, not the whole side", () => {
    const { ruleDef } = makeBrain(
      services,
      [],
      [makeActuator(services, "interior-move"), makeActuator(services, "interior-turn")]
    );
    ruleDef.typecheck();
    const opening = insertTarget(ruleDef, RuleSide.Do, 0, "sentence");
    const past = insertTarget(ruleDef, RuleSide.Do, 1, "sentence");
    assert.ok(candidateCountAt(opening) > 0);
    assert.equal(candidateCountAt(past), 0);
    assert.ok(hasOfferingPanel(renderAskedRuleCard(ruleDef, opening)));
    assert.equal(hasOfferingPanel(renderAskedRuleCard(ruleDef, past)), false);
  });

  test("a placement that completes the side closes the offering standing there", () => {
    const { ruleDef } = makeBrain(services, [], []);
    const open = appendTarget(ruleDef, RuleSide.When, "sentence");
    assert.ok(hasOfferingPanel(renderAskedRuleCard(ruleDef, open)));
    ruleDef.when().appendTile(makeSensor(services, "completing-see"));
    ruleDef.typecheck();
    const settled = appendTarget(ruleDef, RuleSide.When, "sentence");
    assert.equal(candidateCountAt(settled), 0);
    assert.equal(hasOfferingPanel(renderAskedRuleCard(ruleDef, settled)), false);
  });

  test("the panel agrees with the offering that position would build", () => {
    const { ruleDef } = completeRule("agreement");
    const empty = makeBrain(services, [], []);
    const targets = [
      appendTarget(ruleDef, RuleSide.When, "sentence"),
      appendTarget(ruleDef, RuleSide.Do, "sentence"),
      insertTarget(ruleDef, RuleSide.When, 0, "sentence"),
      insertTarget(ruleDef, RuleSide.Do, 0, "sentence"),
      tileTarget(ruleDef, RuleSide.When, 0, "tray"),
      tileTarget(ruleDef, RuleSide.Do, 0, "tray"),
    ];
    for (const target of targets) {
      assert.equal(
        hasOfferingPanel(renderAskedRuleCard(ruleDef, target)),
        candidateCountAt(target) > 0,
        `${target.mode} ${target.side} ${target.tileIndex ?? "end"}`
      );
    }
    const opening = appendTarget(empty.ruleDef, RuleSide.When, "sentence");
    assert.equal(hasOfferingPanel(renderAskedRuleCard(empty.ruleDef, opening)), candidateCountAt(opening) > 0);
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
    const { ruleDef } = makeBrain(services, [makeSensor(services, "owner-see")], []);
    const marker = `data-rule-sentence="${ruleDef.ruleId()}"`;
    assert.equal(countOf(renderRuleCard(ruleDef, null), marker), 1, "settled");
    assert.equal(
      countOf(renderRuleCard(ruleDef, appendTarget(ruleDef, RuleSide.When, "sentence")), marker),
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
  test("it fills the box it is rendered into, and positions what is laid over it", () => {
    const { ruleDef } = makeBrain(services, [makeSensor(services, "panel-place")], []);
    const markup = renderStrip(
      stripState({ bestNext: offeredEntries() }),
      appendTarget(ruleDef, RuleSide.When, "tray")
    );
    const tokens = /<section[^>]*class="([^"]*)"/.exec(markup)?.[1].split(" ") ?? [];
    assert.ok(tokens.includes("relative"), "the panel is the box its own controls are placed against");
    assert.ok(!tokens.includes("absolute"), "and takes its place from whatever renders it");
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
