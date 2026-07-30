/**
 * Pins the composer's input model as traces: a sequence of tokens goes in, and
 * the effects the model asks for come out in order, leaving a state the next
 * token reads.
 *
 * The traces run against a scripted stand-in for the editor that applies the
 * effects a following token can read -- placements, the pivot, the own-commit
 * stack, the accordion -- and records every effect. Its offering is resolved by
 * the same predicates the strip resolves it with, so a word commits here exactly
 * where it commits in the editor. Tokens, effects, stable option ids, and tile
 * labels are asserted; no display prose is.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { CoreLiteralFactoryId, mkLiteralFactoryTileId, RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { tileSentenceWord } from "@mindcraft-lang/core/brain/language-service";
import type { BrainCommand } from "@mindcraft-lang/core/brain/model";
import { BrainTileActuatorDef, type BrainTileLiteralDef, BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import { createDefaultLocalizer, type Localizer } from "@mindcraft-lang/core/localization";
import { bag, CoreTypeIds, mkActionDescriptor, mkCallDef, NIL_VALUE } from "@mindcraft-lang/core/runtime";
import {
  decideCandidateCommit,
  decideStripFocusTarget,
  filterStripCandidates,
  kBestNextBandKey,
  mintNumberLiteralCandidate,
  mintTextLiteralCandidate,
  offersTextLiteral,
  type StripCandidate,
  type StripFocusTarget,
  type StripOption,
  type StripOptionBand,
  type StripOptionGeometry,
  stripOptionId,
  toCandidateEntries,
  visibleStripOptions,
} from "./candidate-strip-model";
import {
  type ComposerCloseReason,
  type ComposerInputEffect,
  type ComposerInputFacts,
  type ComposerInputState,
  type ComposerInputToken,
  composerHeadingToken,
  composerTokenForKey,
  reduceComposerInput,
} from "./composer-input-model";

let services: BrainServices;
let localizer: Localizer;
let nextFnId = 5120;

/** Identity of the strip the traces build option ids against. */
const kStripId = "composer-trace";

/** Band key of the accordion section the browsing traces open. */
const kSectionBandKey = "sensor";

before(() => {
  services = __test__createBrainServices();
  localizer = createDefaultLocalizer();
});

function makeSensorTile(sensorId: string): IBrainTileDef {
  const fnId = nextFnId;
  nextFnId += 1;
  const fnEntry = services.runtime.functions.register(
    fnId,
    `${sensorId}#${fnId}`,
    false,
    { exec: () => NIL_VALUE },
    mkCallDef(bag())
  );
  return new BrainTileSensorDef(sensorId, mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Boolean), {
    metadata: { label: sensorId },
  });
}

function makeActuatorTile(actuatorId: string): IBrainTileDef {
  const fnId = nextFnId;
  nextFnId += 1;
  const fnEntry = services.runtime.functions.register(
    fnId,
    `${actuatorId}#${fnId}`,
    false,
    { exec: () => NIL_VALUE },
    mkCallDef(bag())
  );
  return new BrainTileActuatorDef(actuatorId, mkActionDescriptor("actuator", fnEntry), {
    metadata: { label: actuatorId },
  });
}

/** One offered candidate over a real tile, keyed and labelled as the strip's own candidates are. */
function candidateOf(tileDef: IBrainTileDef, label: string): StripCandidate {
  return {
    key: tileDef.tileId,
    tileDef,
    label,
    group: "sensor",
    viaConversion: false,
    origin: { kind: "suggested" },
  };
}

/** The core number-literal factory candidate, which the typed-number traces mint from. */
function numberFactoryCandidate(): StripCandidate {
  const tileDef = services.edit.tiles.get(mkLiteralFactoryTileId(CoreLiteralFactoryId.Number));
  assert.ok(tileDef, "core number literal factory not registered");
  return candidateOf(tileDef, "number");
}

/** The core text-literal factory candidate, which the typed-text traces mint from. */
function textFactoryCandidate(): StripCandidate {
  const tileDef = services.edit.tiles.get(mkLiteralFactoryTileId(CoreLiteralFactoryId.String));
  assert.ok(tileDef, "core text literal factory not registered");
  return candidateOf(tileDef, "text");
}

/** A command standing in for one the editor executed, identified by `description`. */
function makeCommand(description: string): BrainCommand {
  return { execute: () => {}, undo: () => {}, getDescription: () => description };
}

/** What one trace step reads and what the offering holds while it reads it. */
interface ComposerTraceOptions {
  /** The side composition starts armed on. */
  readonly armedSide?: RuleSide;
  /** Whether composition runs in the rule's sentence line or the strip's own tray. */
  readonly inSentence?: boolean;
  /** The candidates offered for one filter text, before the filter narrows them. */
  readonly offeringFor?: (filter: string) => readonly StripCandidate[];
  /** Every accordion band in display order, whether open or closed. */
  readonly bandSequence?: readonly StripOptionBand[];
  /** How many tiles each side starts with. */
  readonly whenTiles?: number;
  readonly doTiles?: number;
}

/**
 * A scripted editor the model's effects are applied to, so each token reads what
 * the ones before it did.
 */
class ComposerTrace {
  state: ComposerInputState;
  /** True when the tiles of the armed side may end where composition stands. */
  armedSideCanEnd = true;
  /** Every effect the trace has asked for, in order. */
  readonly log: ComposerInputEffect[] = [];
  /** Why the strip closed, or undefined while it is open. */
  closedAs: ComposerCloseReason | undefined;
  /** The command history, newest last. */
  private readonly history: BrainCommand[] = [];
  /** The composition's own placements, newest last, with the side each landed on. */
  private readonly placements: { command: BrainCommand; side: RuleSide }[] = [];
  private whenTiles: number;
  private doTiles: number;
  private openSectionKey: string | null = null;
  /** The chip each open text value offers, keyed by the value. */
  private readonly pendingTextChips = new Map<string, StripCandidate>();
  private readonly offeringFor: (filter: string) => readonly StripCandidate[];
  private readonly bandSequence: readonly StripOptionBand[];

  constructor(options: ComposerTraceOptions = {}) {
    this.state = {
      armedSide: options.armedSide ?? RuleSide.When,
      armedEntry: options.inSentence === false ? "tray" : "sentence",
      filter: "",
      activeOptionId: undefined,
      highlightMode: "typing",
      pivoted: (options.armedSide ?? RuleSide.When) === RuleSide.Do,
      textLiteral: undefined,
      ownCommits: [],
    };
    this.offeringFor = options.offeringFor ?? (() => []);
    this.bandSequence = options.bandSequence ?? [];
    this.whenTiles = options.whenTiles ?? 0;
    this.doTiles = options.doTiles ?? 0;
  }

  /** The bands whose chips are rendered: the best-next row, plus the one open section. */
  openBands(): readonly StripOptionBand[] {
    return this.bandSequence.filter((band) => band.key === kBestNextBandKey || band.key === this.openSectionKey);
  }

  /** Every rendered chip, in the order the highlight walks them. */
  options(): readonly StripOption[] {
    return visibleStripOptions(kStripId, this.openBands());
  }

  /** Where DOM focus belongs while the highlight rests where it does. */
  focusTarget(): StripFocusTarget {
    return decideStripFocusTarget(this.options(), this.state.activeOptionId, this.state.highlightMode);
  }

  /** Add a command the composition did not make, which becomes the history's newest entry. */
  pushForeignCommand(description: string): void {
    this.history.push(makeCommand(description));
  }

  /** How many tiles the rule holds on `side`. */
  tileCount(side: RuleSide): number {
    return side === RuleSide.When ? this.whenTiles : this.doTiles;
  }

  /** Type `word` a character at a time, as the filter box reports its own content. */
  typeWord(word: string): void {
    for (let length = 1; length <= word.length; length++) {
      this.press({ kind: "text", text: word.slice(0, length) });
    }
  }

  /** Feed one token through the model, apply what it asks for, and return the effects of this press. */
  press(token: ComposerInputToken): readonly ComposerInputEffect[] {
    const outcome = reduceComposerInput(this.state, token, this.facts());
    this.state = outcome.state;
    const pressed: ComposerInputEffect[] = [];
    for (const effect of outcome.effects) {
      pressed.push(effect);
      this.log.push(effect);
      const followed = this.apply(effect);
      pressed.push(...followed);
    }
    return pressed;
  }

  /**
   * The candidate the open text value places, minted once per value so the same
   * value always offers the same chip.
   */
  pendingTextChip(): StripCandidate | undefined {
    const value = this.state.textLiteral;
    if (value === undefined) return undefined;
    const cached = this.pendingTextChips.get(value);
    if (cached) return cached;
    const minted = mintTextLiteralCandidate(this.offeringFor(this.state.filter), value, (tileDef) =>
      tileSentenceWord(tileDef, localizer)
    );
    if (minted) this.pendingTextChips.set(value, minted);
    return minted;
  }

  /** The facts of the moment, read the way the strip reads them. */
  private facts(): ComposerInputFacts {
    const offered = this.offeringFor(this.state.filter);
    const visible = filterStripCandidates(offered, this.state.filter);
    const activeOption = this.options().find((option) => option.optionId === this.state.activeOptionId);
    return {
      acceptsTextLiteral: offersTextLiteral(offered),
      pendingTextLiteral: this.pendingTextChip(),
      armedSideCanEnd: this.armedSideCanEnd,
      ruleIsEmpty: this.whenTiles === 0 && this.doTiles === 0,
      doTileCount: this.doTiles,
      newestCommand: this.history[this.history.length - 1],
      topCandidate: decideCandidateCommit(visible, this.state.filter, "enter"),
      spaceCandidate: decideCandidateCommit(visible, this.state.filter, "space"),
      highlightedCandidate: visible.find((candidate) => candidate.key === activeOption?.candidateKey),
      options: this.options(),
      optionGeometry: layOutOptions(this.options()),
      stripId: kStripId,
      bandsWithSection: (sectionKey: string) =>
        this.bandSequence.filter(
          (band) => band.key === kBestNextBandKey || band.key === this.openSectionKey || band.key === sectionKey
        ),
    };
  }

  /** Carry out one effect, returning any effects the follow-up token asked for. */
  private apply(effect: ComposerInputEffect): readonly ComposerInputEffect[] {
    switch (effect.kind) {
      case "place-tile": {
        const command = makeCommand(`placed:${effect.candidate.key}`);
        const side = this.state.armedSide;
        this.history.push(command);
        this.placements.push({ command, side });
        if (side === RuleSide.When) this.whenTiles += 1;
        else this.doTiles += 1;
        // The commit path records the command it executed; the model pops it.
        this.state = { ...this.state, ownCommits: [...this.state.ownCommits, command] };
        return [];
      }
      case "undo-own-commit": {
        const placement = this.placements.pop();
        assert.ok(placement, "nothing of the composition's own to take back");
        this.history.pop();
        if (placement.side === RuleSide.When) this.whenTiles -= 1;
        else this.doTiles -= 1;
        return [];
      }
      case "open-section":
        this.openSectionKey = effect.sectionKey;
        return [];
      case "close-strip":
        this.closedAs = effect.reason;
        return [];
      case "reask-after-placement":
        return this.press({ kind: "placement-landed", gesture: effect.gesture });
      default:
        return [];
    }
  }
}

/**
 * Synthetic layout for the rendered chips: each band is one row, and each chip
 * sits beside the one before it in its band.
 */
function layOutOptions(options: readonly StripOption[]): StripOptionGeometry[] {
  const rows: string[] = [];
  return options.map((option) => {
    if (!rows.includes(option.bandKey)) rows.push(option.bandKey);
    const row = rows.indexOf(option.bandKey);
    const column = options.filter((other) => other.bandKey === option.bandKey).indexOf(option);
    return { optionId: option.optionId, left: column * 100, width: 90, top: row * 40 };
  });
}

const consumeKey: ComposerInputEffect = { kind: "consume-key" };
const typingFocus: ComposerInputEffect = { kind: "move-focus", target: { kind: "input" }, keepScroll: false };
const settledFocus: ComposerInputEffect = { kind: "move-focus", target: { kind: "input" }, keepScroll: true };
const clearHighlight: ComposerInputEffect = { kind: "highlight", optionId: undefined, mode: "typing" };

/** The effects every placement asks for, plus whatever gesture it was made on the way to. */
function placementEffects(
  candidate: StripCandidate,
  ...then: readonly ComposerInputEffect[]
): readonly ComposerInputEffect[] {
  return [
    consumeKey,
    { kind: "place-tile", candidate },
    { kind: "announce-placement", label: candidate.label },
    clearHighlight,
    settledFocus,
    ...then,
  ];
}

/** The effects one typed character asks for. */
function typedEffects(text: string): readonly ComposerInputEffect[] {
  return [{ kind: "set-filter", text }, clearHighlight];
}

/** Every place-tile effect of `log`, in order, by the candidate key it placed. */
function placedKeys(log: readonly ComposerInputEffect[]): string[] {
  return log.filter((effect) => effect.kind === "place-tile").map((effect) => effect.candidate.key);
}

describe("composing a rule from the keyboard", () => {
  test("word, space, word, space, comma, word, space, period places, pivots, and settles in order", () => {
    const see = candidateOf(makeSensorTile("composer-trace-see"), "see");
    const plant = candidateOf(makeSensorTile("composer-trace-plant"), "plant");
    const jump = candidateOf(makeActuatorTile("composer-trace-jump"), "jump");
    const trace = new ComposerTrace({ offeringFor: () => [see, plant, jump] });

    trace.typeWord("see");
    assert.deepEqual(trace.press({ kind: "space" }), placementEffects(see));
    trace.typeWord("plant");
    assert.deepEqual(trace.press({ kind: "space" }), placementEffects(plant));

    assert.deepEqual(trace.press({ kind: "comma" }), [consumeKey, { kind: "arm-side", side: RuleSide.Do }]);
    assert.equal(trace.state.armedSide, RuleSide.Do);
    assert.equal(trace.state.pivoted, true);

    trace.typeWord("jump");
    assert.deepEqual(trace.press({ kind: "space" }), placementEffects(jump));
    assert.deepEqual(trace.press({ kind: "period" }), [consumeKey, { kind: "close-strip", reason: "settled" }]);

    assert.deepEqual(placedKeys(trace.log), [see.key, plant.key, jump.key]);
    assert.equal(trace.closedAs, "settled");
    assert.equal(trace.tileCount(RuleSide.When), 2);
    assert.equal(trace.tileCount(RuleSide.Do), 1);
    assert.equal(trace.state.ownCommits.length, 3);
    assert.equal(trace.state.filter, "");
  });

  test("the last typed character is the filter the commit resolves against", () => {
    const see = candidateOf(makeSensorTile("composer-trace-see-2"), "see");
    const trace = new ComposerTrace({ offeringFor: () => [see] });

    assert.deepEqual(trace.press({ kind: "text", text: "s" }), typedEffects("s"));
    assert.equal(trace.state.filter, "s");
    assert.deepEqual(trace.press({ kind: "text", text: "se" }), typedEffects("se"));
    trace.press({ kind: "text", text: "see" });

    assert.deepEqual(trace.press({ kind: "space" }), placementEffects(see));
  });
});

describe("the backspace ladder", () => {
  test("walks back from a pivoted DO side through the filter, the pivot, each own commit, and then nothing", () => {
    const see = candidateOf(makeSensorTile("composer-trace-ladder-see"), "see");
    const plant = candidateOf(makeSensorTile("composer-trace-ladder-plant"), "plant");
    const trace = new ComposerTrace({ offeringFor: () => [see, plant] });

    trace.typeWord("see");
    trace.press({ kind: "space" });
    trace.typeWord("plant");
    trace.press({ kind: "space" });
    trace.press({ kind: "comma" });
    trace.typeWord("ju");

    // The word in progress goes first, and the filter box makes that edit itself.
    assert.deepEqual(trace.press({ kind: "backspace", from: "filter" }), []);
    trace.press({ kind: "text", text: "j" });
    trace.press({ kind: "text", text: "" });

    assert.deepEqual(trace.press({ kind: "backspace", from: "filter" }), [
      consumeKey,
      { kind: "arm-side", side: RuleSide.When },
    ]);
    assert.equal(trace.state.pivoted, false);
    assert.equal(trace.state.armedSide, RuleSide.When);

    assert.deepEqual(trace.press({ kind: "backspace", from: "filter" }), [consumeKey, { kind: "undo-own-commit" }]);
    assert.equal(trace.state.ownCommits.length, 1);
    assert.equal(trace.tileCount(RuleSide.When), 1);

    assert.deepEqual(trace.press({ kind: "backspace", from: "filter" }), [consumeKey, { kind: "undo-own-commit" }]);
    assert.deepEqual(trace.state.ownCommits, []);
    assert.equal(trace.tileCount(RuleSide.When), 0);

    assert.deepEqual(trace.press({ kind: "backspace", from: "filter" }), []);
  });

  test("a command the composition did not make becoming newest leaves backspace with nothing to do", () => {
    const see = candidateOf(makeSensorTile("composer-trace-foreign-see"), "see");
    const trace = new ComposerTrace({ offeringFor: () => [see] });

    trace.typeWord("see");
    trace.press({ kind: "space" });
    trace.pushForeignCommand("composer-trace-foreign-edit");

    assert.deepEqual(trace.press({ kind: "backspace", from: "filter" }), []);
    assert.equal(trace.state.ownCommits.length, 1);
    assert.equal(trace.tileCount(RuleSide.When), 1);
  });

  test("backspace on a band's chips edits the word in progress and hands the keyboard back", () => {
    const see = candidateOf(makeSensorTile("composer-trace-band-see"), "see");
    const trace = new ComposerTrace({ offeringFor: () => [see] });
    trace.typeWord("se");

    assert.deepEqual(trace.press({ kind: "backspace", from: "band" }), [
      typingFocus,
      consumeKey,
      { kind: "set-filter", text: "s" },
      clearHighlight,
    ]);
    assert.equal(trace.state.filter, "s");
  });
});

describe("the comma", () => {
  test("stays filter text with a word in progress that resolves to nothing", () => {
    const see = candidateOf(makeSensorTile("composer-trace-comma-see"), "see");
    const trace = new ComposerTrace({ offeringFor: () => [see] });
    trace.typeWord("zzz");

    assert.deepEqual(trace.press({ kind: "comma" }), []);
    assert.deepEqual(placedKeys(trace.log), []);
    assert.equal(trace.state.armedSide, RuleSide.When);
    assert.equal(trace.state.pivoted, false);
  });

  test("places a word in progress that resolves, then pivots against the side that word joined", () => {
    const see = candidateOf(makeSensorTile("composer-trace-comma-commit"), "see");
    const trace = new ComposerTrace({ offeringFor: () => [see] });
    trace.typeWord("see");

    assert.deepEqual(
      trace.press({ kind: "comma" }),
      placementEffects(
        see,
        { kind: "reask-after-placement", gesture: "pivot" },
        { kind: "arm-side", side: RuleSide.Do }
      )
    );
    assert.equal(trace.state.armedSide, RuleSide.Do);
    assert.equal(trace.state.pivoted, true);
  });

  test("holds the pivot back when the word just placed leaves the side unable to end", () => {
    const see = candidateOf(makeSensorTile("composer-trace-comma-mid"), "see");
    const trace = new ComposerTrace({ offeringFor: () => [see] });
    trace.typeWord("see");
    trace.armedSideCanEnd = false;

    assert.deepEqual(
      trace.press({ kind: "comma" }),
      placementEffects(see, { kind: "reask-after-placement", gesture: "pivot" })
    );
    assert.equal(trace.state.armedSide, RuleSide.When);
    assert.equal(trace.state.pivoted, false);
  });

  test("is filter text on the DO side, which has nowhere to pivot to", () => {
    const trace = new ComposerTrace({ armedSide: RuleSide.Do, doTiles: 1 });

    assert.deepEqual(trace.press({ kind: "comma" }), []);
  });

  test("is filter text in a strip armed from the tray", () => {
    const trace = new ComposerTrace({ inSentence: false });

    assert.deepEqual(trace.press({ kind: "comma" }), []);
  });
});

describe("the period", () => {
  test("refuses where the armed side cannot end", () => {
    const trace = new ComposerTrace({ whenTiles: 1 });
    trace.armedSideCanEnd = false;

    assert.deepEqual(trace.press({ kind: "period" }), []);
    assert.equal(trace.closedAs, undefined);
  });

  test("is inert on a rule holding no tiles at all", () => {
    const trace = new ComposerTrace();

    assert.deepEqual(trace.press({ kind: "period" }), [consumeKey]);
    assert.equal(trace.closedAs, undefined);
  });

  test("settles a rule whose armed side may end", () => {
    const trace = new ComposerTrace({ whenTiles: 1 });

    assert.deepEqual(trace.press({ kind: "period" }), [consumeKey, { kind: "close-strip", reason: "settled" }]);
    assert.equal(trace.closedAs, "settled");
  });
});

describe("typed numbers", () => {
  /** The offering at a position that accepts a number: the mint the typed text names. */
  function numberOffering(): (filter: string) => readonly StripCandidate[] {
    const factory = numberFactoryCandidate();
    return (filter: string) => {
      const minted = mintNumberLiteralCandidate([factory], filter, (tileDef) => tileSentenceWord(tileDef, localizer));
      return minted ? [minted] : [];
    };
  }

  test("a period continuing a whole number is filter text, and the finished number commits", () => {
    const trace = new ComposerTrace({ offeringFor: numberOffering(), whenTiles: 1 });
    trace.press({ kind: "text", text: "1" });

    assert.deepEqual(trace.press({ kind: "period" }), []);

    trace.press({ kind: "text", text: "1." });
    trace.press({ kind: "text", text: "1.5" });
    const pressed = trace.press({ kind: "space" });

    assert.equal(placedKeys(pressed).length, 1);
    assert.equal(trace.closedAs, undefined);
  });

  test("a period on a number that already carries a decimal point commits it and settles", () => {
    const trace = new ComposerTrace({ offeringFor: numberOffering(), whenTiles: 1 });
    trace.press({ kind: "text", text: "1" });
    trace.press({ kind: "text", text: "1." });
    trace.press({ kind: "text", text: "1.5" });

    const pressed = trace.press({ kind: "period" });
    assert.equal(placedKeys(pressed).length, 1);
    assert.deepEqual(
      pressed.filter((effect) => effect.kind === "reask-after-placement"),
      [{ kind: "reask-after-placement", gesture: "settle" }]
    );
    assert.equal(trace.closedAs, "settled");
  });
});

describe("a typed text value", () => {
  /** The value each placement carried, read off the origin the manufacture path commits through. */
  function placedValues(log: readonly ComposerInputEffect[]): unknown[] {
    return log
      .filter((effect) => effect.kind === "place-tile")
      .map((effect) => (effect.candidate.origin.kind === "minted-literal" ? effect.candidate.origin.value : undefined));
  }

  /** The effects opening a text value asks for. */
  const openEffects: readonly ComposerInputEffect[] = [
    consumeKey,
    { kind: "set-filter", text: "" },
    { kind: "set-text-literal", value: "" },
    clearHighlight,
  ];

  /** The effects abandoning an open text value asks for. */
  const abandonEffects: readonly ComposerInputEffect[] = [consumeKey, { kind: "set-text-literal", value: undefined }];

  /** A trace at a position that accepts a text literal, alongside one word tile. */
  function textTrace(): { trace: ComposerTrace; word: StripCandidate } {
    const word = candidateOf(makeSensorTile("composer-trace-text-see"), "see");
    const factory = textFactoryCandidate();
    return { trace: new ComposerTrace({ offeringFor: () => [word, factory], whenTiles: 1 }), word };
  }

  /** A trace with `value` typed into an open text value, a character at a time. */
  function openedTextTrace(value: string): ComposerTrace {
    const { trace } = textTrace();
    trace.press({ kind: "quote" });
    trace.typeWord(value);
    return trace;
  }

  test("the closing quote places one literal carrying the text exactly as typed", () => {
    const typed = "hello world. ok";
    const trace = openedTextTrace(typed);
    assert.equal(trace.state.textLiteral, typed);

    const pressed = trace.press({ kind: "quote" });

    const placements = pressed.filter((effect) => effect.kind === "place-tile");
    assert.equal(placements.length, 1);
    assert.equal(placements[0].candidate.tileDef.kind, "literal");
    assert.deepEqual(placedValues(pressed), [typed]);
    assert.deepEqual(
      pressed.filter((effect) => effect.kind === "set-text-literal"),
      [{ kind: "set-text-literal", value: undefined }]
    );
    assert.equal(trace.state.textLiteral, undefined);
    assert.equal(trace.state.filter, "");
    assert.equal(trace.closedAs, undefined);
    assert.equal(trace.tileCount(RuleSide.When), 2);
  });

  test("opening a value takes over the word in progress", () => {
    const { trace } = textTrace();
    trace.typeWord("se");

    assert.deepEqual(trace.press({ kind: "quote" }), openEffects);
    assert.equal(trace.state.filter, "");
    assert.equal(trace.state.textLiteral, "");
  });

  test("the punctuation keys reach the value as content, placing nothing and neither pivoting nor settling", () => {
    const trace = openedTextTrace("a");

    // Each key is left to the filter box, which types it into the value.
    assert.deepEqual(trace.press({ kind: "comma" }), []);
    assert.deepEqual(trace.press({ kind: "period" }), []);
    assert.deepEqual(trace.press({ kind: "space" }), []);
    trace.press({ kind: "text", text: "a,. " });

    assert.equal(trace.state.textLiteral, "a,. ");
    assert.equal(trace.state.armedSide, RuleSide.When);
    assert.equal(trace.state.pivoted, false);
    assert.equal(trace.closedAs, undefined);
    assert.deepEqual(placedKeys(trace.log), []);
  });

  test("Enter and Tab place the value the closing quote would", () => {
    const typed = "left";
    for (const token of [{ kind: "enter", from: "filter" }, { kind: "tab" }] as const) {
      const byQuote = openedTextTrace(typed);
      const byKey = openedTextTrace(typed);

      const quoted = byQuote.press({ kind: "quote" });
      const keyed = byKey.press(token);

      assert.deepEqual(
        keyed.map((effect) => effect.kind),
        quoted.map((effect) => effect.kind),
        token.kind
      );
      assert.deepEqual(placedKeys(keyed), placedKeys(quoted), token.kind);
      assert.deepEqual(placedValues(keyed), [typed], token.kind);
      assert.equal(byKey.state.textLiteral, undefined, token.kind);
      assert.equal(byKey.tileCount(RuleSide.When), 2, token.kind);
    }
  });

  test("a value holding a dollar sign, digits, and a percent places them as text", () => {
    const typed = "cost: $5 or 50%. ok?";
    const word = candidateOf(makeSensorTile("composer-trace-text-mints"), "see");
    // The position mints numbers and variables, and the open value reaches neither.
    const trace = new ComposerTrace({
      offeringFor: () => [word, numberFactoryCandidate(), textFactoryCandidate()],
      whenTiles: 1,
    });
    trace.press({ kind: "quote" });
    trace.typeWord(typed);
    assert.equal(trace.state.filter, "", "nothing the offering could filter or mint from is typed");

    const pressed = trace.press({ kind: "quote" });

    const placements = pressed.filter((effect) => effect.kind === "place-tile");
    assert.equal(placements.length, 1);
    assert.deepEqual(
      placements.map((effect) => effect.candidate.origin.kind),
      ["minted-literal"]
    );
    assert.equal((placements[0].candidate.tileDef as BrainTileLiteralDef).valueType, CoreTypeIds.String);
    assert.deepEqual(placedValues(pressed), [typed]);
  });

  test("backspace shortens the value, and past the opening quote leaves it placing nothing", () => {
    const { trace, word } = textTrace();
    trace.typeWord("see");
    trace.press({ kind: "space" });
    assert.deepEqual(placedKeys(trace.log), [word.key]);
    trace.press({ kind: "quote" });
    trace.typeWord("hi");

    // The filter box makes the edit of the value itself.
    assert.deepEqual(trace.press({ kind: "backspace", from: "filter" }), []);
    trace.press({ kind: "text", text: "h" });
    trace.press({ kind: "text", text: "" });
    assert.equal(trace.state.textLiteral, "");

    assert.deepEqual(trace.press({ kind: "backspace", from: "filter" }), abandonEffects);
    assert.equal(trace.state.textLiteral, undefined);
    assert.deepEqual(placedKeys(trace.log), [word.key]);
    assert.equal(trace.state.ownCommits.length, 1);
    assert.equal(trace.tileCount(RuleSide.When), 2);
  });

  test("backspace on the pending chip's band shortens the value and hands the keyboard back", () => {
    const trace = openedTextTrace("hi");

    assert.deepEqual(trace.press({ kind: "backspace", from: "band" }), [
      typingFocus,
      consumeKey,
      { kind: "set-text-literal", value: "h" },
      clearHighlight,
    ]);
    assert.equal(trace.state.textLiteral, "h");
  });

  test("escape abandons the value before it clears the word in progress and closes the strip", () => {
    const trace = openedTextTrace("hi");

    assert.deepEqual(trace.press({ kind: "escape" }), abandonEffects);
    assert.equal(trace.state.textLiteral, undefined);
    assert.equal(trace.closedAs, undefined);
    assert.deepEqual(placedKeys(trace.log), []);

    assert.deepEqual(trace.press({ kind: "escape" }), [consumeKey, { kind: "close-strip", reason: "dismissed" }]);
    assert.equal(trace.closedAs, "dismissed");
  });

  test("two quotes in a row place an empty text value", () => {
    const trace = openedTextTrace("");

    const pressed = trace.press({ kind: "quote" });

    assert.deepEqual(placedValues(pressed), [""]);
    assert.equal(trace.state.textLiteral, undefined);
  });

  test("tapping the pending chip places what the closing quote would", () => {
    const typed = "left";
    const byQuote = openedTextTrace(typed);
    const byTap = openedTextTrace(typed);
    const chip = byTap.pendingTextChip();
    assert.ok(chip, "an open value offers the chip that places it");

    const quoted = byQuote.press({ kind: "quote" });
    const tapped = byTap.press({ kind: "candidate-tapped", candidate: chip });

    assert.deepEqual(
      tapped.map((effect) => effect.kind),
      quoted.map((effect) => effect.kind)
    );
    assert.deepEqual(placedKeys(tapped), placedKeys(quoted));
    assert.deepEqual(placedValues(tapped), [typed]);
    assert.equal(byTap.state.textLiteral, undefined);
    assert.equal(byTap.tileCount(RuleSide.When), 2);
  });

  test("a quote is ordinary text where the position accepts no text literal", () => {
    const see = candidateOf(makeSensorTile("composer-trace-text-none"), "see");
    const trace = new ComposerTrace({ offeringFor: () => [see], whenTiles: 1 });

    assert.deepEqual(trace.press({ kind: "quote" }), []);
    assert.equal(trace.state.textLiteral, undefined);

    // The keystroke stays with the filter box, where it reads as unmatched text.
    trace.press({ kind: "text", text: '"' });
    assert.equal(trace.state.filter, '"');
    assert.equal(trace.state.textLiteral, undefined);
  });

  test("the comma pivot and the period settle work again once the value is placed", () => {
    const trace = openedTextTrace("hi");
    trace.press({ kind: "quote" });

    assert.deepEqual(trace.press({ kind: "comma" }), [consumeKey, { kind: "arm-side", side: RuleSide.Do }]);
    assert.equal(trace.state.armedSide, RuleSide.Do);
    assert.deepEqual(trace.press({ kind: "period" }), [consumeKey, { kind: "close-strip", reason: "settled" }]);
    assert.equal(trace.closedAs, "settled");
  });
});

describe("browsing the accordion", () => {
  /** A best-next row of two chips over a closed section holding a third. */
  function browsingTrace(): { trace: ComposerTrace; best: StripCandidate[]; sectioned: StripCandidate } {
    const first = candidateOf(makeSensorTile("composer-trace-browse-one"), "one");
    const second = candidateOf(makeSensorTile("composer-trace-browse-two"), "two");
    const sectioned = candidateOf(makeSensorTile("composer-trace-browse-three"), "three");
    const trace = new ComposerTrace({
      offeringFor: () => [first, second, sectioned],
      bandSequence: [
        { key: kBestNextBandKey, entries: toCandidateEntries([first, second]) },
        { key: kSectionBandKey, entries: toCandidateEntries([sectioned]) },
      ],
    });
    return { trace, best: [first, second], sectioned };
  }

  test("an arrow on a closed heading opens the section and starts browsing its first chip", () => {
    const { trace, sectioned } = browsingTrace();
    const entered = stripOptionId(kStripId, kSectionBandKey, sectioned.key);

    assert.deepEqual(trace.press({ kind: "heading-arrow", direction: "down", sectionKey: kSectionBandKey }), [
      { kind: "open-section", sectionKey: kSectionBandKey },
      { kind: "highlight", optionId: entered, mode: "browsing" },
      consumeKey,
    ]);
    assert.equal(trace.state.activeOptionId, entered);
    assert.equal(trace.state.highlightMode, "browsing");
    // Focus rests on the band being browsed, so Tab reaches the next heading.
    assert.deepEqual(trace.focusTarget(), { kind: "band", bandKey: kSectionBandKey });
  });

  test("an arrow between rows crosses from the open section back into the best-next row", () => {
    const { trace, best } = browsingTrace();
    trace.press({ kind: "heading-arrow", direction: "down", sectionKey: kSectionBandKey });

    const crossed = stripOptionId(kStripId, kBestNextBandKey, best[0].key);
    assert.deepEqual(trace.press({ kind: "arrow", direction: "up", from: "band" }), [
      { kind: "highlight", optionId: crossed, mode: "browsing" },
      consumeKey,
    ]);
    assert.deepEqual(trace.focusTarget(), { kind: "band", bandKey: kBestNextBandKey });
  });

  test("Enter on a browsed chip places it and hands the keyboard back to the filter box", () => {
    const { trace, sectioned } = browsingTrace();
    trace.press({ kind: "heading-arrow", direction: "down", sectionKey: kSectionBandKey });

    assert.deepEqual(trace.press({ kind: "enter", from: "band" }), placementEffects(sectioned));
    assert.deepEqual(trace.focusTarget(), { kind: "input" });
  });

  test("a character typed while browsing hands the keyboard back without placing anything", () => {
    const { trace } = browsingTrace();
    trace.press({ kind: "heading-arrow", direction: "down", sectionKey: kSectionBandKey });
    const activeOptionId = trace.state.activeOptionId;

    assert.deepEqual(trace.press({ kind: "printable" }), [
      typingFocus,
      { kind: "highlight", optionId: activeOptionId, mode: "typing" },
    ]);
    assert.deepEqual(placedKeys(trace.log), []);
    assert.deepEqual(trace.focusTarget(), { kind: "input" });
  });

  test("the horizontal arrows stay with the text caret until a chip is highlighted", () => {
    const { trace, best } = browsingTrace();

    assert.deepEqual(trace.press({ kind: "arrow", direction: "right", from: "filter" }), []);
    trace.press({ kind: "arrow", direction: "down", from: "filter" });
    assert.equal(trace.state.activeOptionId, stripOptionId(kStripId, kBestNextBandKey, best[0].key));
    assert.equal(trace.state.highlightMode, "typing");
  });
});

describe("the token vocabulary", () => {
  test("the filter box's structural keys map to their own tokens", () => {
    assert.deepEqual(composerTokenForKey(",", "filter"), { kind: "comma" });
    assert.deepEqual(composerTokenForKey(".", "filter"), { kind: "period" });
    assert.deepEqual(composerTokenForKey(" ", "filter"), { kind: "space" });
    assert.deepEqual(composerTokenForKey("Tab", "filter"), { kind: "tab" });
    assert.deepEqual(composerTokenForKey("Enter", "filter"), { kind: "enter", from: "filter" });
    assert.deepEqual(composerTokenForKey("Backspace", "filter"), { kind: "backspace", from: "filter" });
    assert.deepEqual(composerTokenForKey("Escape", "filter"), { kind: "escape" });
    assert.deepEqual(composerTokenForKey("ArrowDown", "filter"), {
      kind: "arrow",
      direction: "down",
      from: "filter",
    });
    assert.equal(composerTokenForKey("a", "filter"), undefined);
  });

  test("a double quote is its own token on the filter surface", () => {
    assert.deepEqual(composerTokenForKey('"', "filter"), { kind: "quote" });
  });

  test("a band leaves the punctuation accelerators to the filter box it hands the keyboard to", () => {
    assert.deepEqual(composerTokenForKey(",", "band"), { kind: "printable" });
    assert.deepEqual(composerTokenForKey(".", "band"), { kind: "printable" });
    assert.deepEqual(composerTokenForKey(" ", "band"), { kind: "printable" });
    assert.deepEqual(composerTokenForKey("Backspace", "band"), { kind: "backspace", from: "band" });
    assert.equal(composerTokenForKey("Tab", "band"), undefined);
    assert.equal(composerTokenForKey("F2", "band"), undefined);
  });

  test("the close button steers only the rows of chips", () => {
    assert.deepEqual(composerTokenForKey("ArrowUp", "close"), { kind: "arrow", direction: "up", from: "close" });
    assert.equal(composerTokenForKey("Enter", "close"), undefined);
    assert.equal(composerTokenForKey(" ", "close"), undefined);
  });

  test("an accordion heading answers only the arrows that step between rows", () => {
    assert.deepEqual(composerHeadingToken("ArrowDown", kSectionBandKey), {
      kind: "heading-arrow",
      direction: "down",
      sectionKey: kSectionBandKey,
    });
    assert.equal(composerHeadingToken("ArrowRight", kSectionBandKey), undefined);
    assert.equal(composerHeadingToken("Enter", kSectionBandKey), undefined);
  });
});

describe("escape", () => {
  test("clears the word in progress before it closes the strip", () => {
    const trace = new ComposerTrace();
    trace.typeWord("se");

    assert.deepEqual(trace.press({ kind: "escape" }), [consumeKey, { kind: "set-filter", text: "" }, clearHighlight]);
    assert.equal(trace.closedAs, undefined);

    assert.deepEqual(trace.press({ kind: "escape" }), [consumeKey, { kind: "close-strip", reason: "dismissed" }]);
    assert.equal(trace.closedAs, "dismissed");
  });
});
