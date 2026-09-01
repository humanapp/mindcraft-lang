/**
 * Pins the sentence composer's pure decisions: what a composed rule's sentence
 * line reads, what the typed pivot adds to that reading, what the comma and
 * period keys do at the armed position, and what Backspace does with an empty
 * word in progress.
 *
 * The composition reading is taken over a real projection of a real rule, so the
 * segment shapes it drops are the ones the projection produces. The comma pivot
 * is decided from the armed side, the word in progress, and whether the tiles of
 * the armed side parse as an expression that may end; the period settles from
 * that same end-of-side answer plus whether the rule holds any tiles at all,
 * except on a whole number in progress, where it continues the number. The
 * backspace ladder is decided from the pivot, the DO side, and the identity of
 * the composer's own last commit against the command history's newest entry, so
 * a command the composer did not make is never undone.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@wendoo/core";
import type { BrainServices, IBrainTileDef } from "@wendoo/core/brain";
import {
  CoreControlFlowId,
  mkControlFlowTileId,
  mkOperatorTileId,
  RuleSide,
  RuleTriggerMode,
} from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import {
  flattenRuleTiles,
  projectRuleSentence,
  type SentenceSegment,
  type SentenceTileRef,
  type SentenceWordSegment,
  triggerModeWord,
} from "@wendoo/core/brain/language-service";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import { BrainTileActuatorDef, BrainTileModifierDef, BrainTileSensorDef } from "@wendoo/core/brain/tiles";
import { createDefaultLocalizer, type Localizer } from "@wendoo/core/localization";
import {
  bag,
  CoreOpId,
  CoreTypeIds,
  choice,
  mkActionDescriptor,
  mkCallDef,
  mod,
  NIL_VALUE,
  optional,
} from "@wendoo/core/runtime";
import {
  canEndSideExpression,
  composePivotReading,
  composeSentenceReading,
  decideComposerBackspace,
  decideComposerCharacter,
  decideComposerComma,
  decideComposerPeriod,
} from "./sentence-composer";

let services: BrainServices;
let localizer: Localizer;
let nextFnId = 4960;

/** Tile id of the object modifier whose sentence word carries an article. */
const kPlantModifierId = "composer-mod-plant";

/** Tile id of the second object modifier the object slot accepts. */
const kCarnivoreModifierId = "composer-mod-carnivore";

/** Register the object modifiers a sensor's object slot accepts, worded as the apps' own object tiles are. */
function registerObjectModifiers(): void {
  const specs: readonly (readonly [string, string, string])[] = [
    [kCarnivoreModifierId, "carnivore", "a carnivore"],
    [kPlantModifierId, "plant", "a plant"],
  ];
  for (const [tileId, label, form] of specs) {
    services.edit.tiles.registerTileDef(new BrainTileModifierDef(tileId, { metadata: { label, language: { form } } }));
  }
}

function makeSensor(sensorId: string): BrainTileSensorDef {
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

/**
 * A sensor whose one optional slot takes an object modifier, so its bare
 * placement reads with the frame's completion word.
 */
function makeObjectSensor(sensorId: string): BrainTileSensorDef {
  const fnId = nextFnId;
  nextFnId += 1;
  const fnEntry = services.runtime.functions.register(
    fnId,
    `${sensorId}#${fnId}`,
    false,
    { exec: () => NIL_VALUE },
    mkCallDef(bag(optional(choice(mod(kCarnivoreModifierId), mod(kPlantModifierId)))))
  );
  return new BrainTileSensorDef(sensorId, mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Boolean), {
    metadata: { label: sensorId, language: { form: sensorId } },
  });
}

function makeActuator(actuatorId: string): BrainTileActuatorDef {
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
    metadata: { label: actuatorId, language: { form: actuatorId } },
  });
}

function coreTile(tileId: string): IBrainTileDef {
  const tileDef = services.edit.tiles.get(tileId);
  assert.ok(tileDef, `core tile not registered: ${tileId}`);
  return tileDef;
}

function tiles(...list: IBrainTileDef[]) {
  return List.from(list).asReadonly();
}

/** The settled projection of a rule holding `whenTiles` and `doTiles`, with the tiles its words render. */
function sentenceOf(
  whenTiles: readonly IBrainTileDef[],
  doTiles: readonly IBrainTileDef[]
): { segments: SentenceSegment[]; tiles: SentenceTileRef[] } {
  const brainDef = BrainDef.emptyBrainDef(services, "composer-reading");
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  const ruleDef = pageDef.children().get(0) as BrainRuleDef;
  for (const tileDef of whenTiles) ruleDef.when().appendTile(tileDef);
  for (const tileDef of doTiles) ruleDef.do().appendTile(tileDef);
  return {
    segments: projectRuleSentence(ruleDef, brainDef.servicesLocalizer()).toArray(),
    tiles: flattenRuleTiles(ruleDef).toArray(),
  };
}

/** The settled projection of a rule holding `whenTiles` and `doTiles`. */
function projectionOf(whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]): SentenceSegment[] {
  return sentenceOf(whenTiles, doTiles).segments;
}

/** The source-tile index of every word segment of `segments`, in order. */
function wordIndices(segments: readonly SentenceSegment[]): number[] {
  return segments
    .filter((segment): segment is SentenceWordSegment => segment.kind === "word")
    .map((segment) => segment.sourceTileIndex);
}

before(() => {
  services = __test__createBrainServices();
  localizer = createDefaultLocalizer();
  registerObjectModifiers();
});

describe("where a rule side may end", () => {
  test("an empty side may end", () => {
    assert.equal(canEndSideExpression(tiles(), localizer), true);
  });

  test("a bare sensor may end", () => {
    assert.equal(canEndSideExpression(tiles(makeSensor("composer-see")), localizer), true);
  });

  test("a bare actuator on a DO side may end", () => {
    assert.equal(canEndSideExpression(tiles(makeActuator("composer-end-jump")), localizer), true);
  });

  test("a trailing infix operator may not end", () => {
    const side = tiles(makeSensor("composer-hear"), coreTile(mkOperatorTileId(CoreOpId.And)));
    assert.equal(canEndSideExpression(side, localizer), false);
  });

  test("a leading prefix operator with no operand may not end", () => {
    assert.equal(canEndSideExpression(tiles(coreTile(mkOperatorTileId(CoreOpId.Not))), localizer), false);
  });

  test("an unclosed group may not end", () => {
    const side = tiles(coreTile(mkControlFlowTileId(CoreControlFlowId.OpenParen)), makeSensor("composer-smell"));
    assert.equal(canEndSideExpression(side, localizer), false);
  });
});

describe("the composition reading", () => {
  test("the settled projection completes a bare sensor with a second word of its own tile", () => {
    const settled = projectionOf([makeObjectSensor("composer-read-bump")], []);
    assert.deepEqual(wordIndices(settled), [0, 0]);
  });

  test("the reading drops the completion word the frame supplied", () => {
    const settled = projectionOf([makeObjectSensor("composer-read-bump-2")], []);
    assert.deepEqual(wordIndices(composeSentenceReading(settled)), [0]);
  });

  test("the reading ends on the last word the user placed", () => {
    const reading = composeSentenceReading(projectionOf([makeObjectSensor("composer-read-bump-3")], []));
    assert.equal(reading[reading.length - 1].kind, "word");
  });

  test("the reading keeps the words of both sides and the glue between them", () => {
    const settled = projectionOf([makeObjectSensor("composer-read-bump-4")], [makeActuator("composer-read-jump")]);
    const reading = composeSentenceReading(settled);
    assert.deepEqual(wordIndices(reading), [0, 1]);
    const between = reading.slice(reading.findIndex((segment) => segment.kind === "word") + 1, reading.length - 1);
    assert.ok(
      between.some((segment) => segment.kind === "glue"),
      "the two words stay joined by the projection's own glue"
    );
  });

  test("the reading leaves no separator dangling where the completion was", () => {
    const settled = projectionOf([makeObjectSensor("composer-read-bump-5")], [makeActuator("composer-read-jump-2")]);
    for (const segment of composeSentenceReading(settled)) {
      assert.notEqual(segment.text.trim(), "", "no segment of the reading is a bare separator");
    }
  });

  test("a projection with no completion and no terminator reads unchanged", () => {
    const reading = composeSentenceReading([
      { kind: "glue", text: "When I " },
      { kind: "word", text: "hear", sourceTileIndex: 0 },
    ]);
    assert.deepEqual(reading, [
      { kind: "glue", text: "When I " },
      { kind: "word", text: "hear", sourceTileIndex: 0 },
    ]);
  });

  test("an empty projection reads as nothing", () => {
    assert.deepEqual(composeSentenceReading([]), []);
  });
});

describe("the comma key", () => {
  test("pivots to the DO side at an end the WHEN expression may take", () => {
    const action = decideComposerComma({
      armedSide: RuleSide.When,
      filter: "",
      armedSideCanEnd: true,
      wordInProgressCommits: false,
    });
    assert.equal(action, "pivot-to-do");
  });

  test("is filter text where the WHEN expression may not end", () => {
    const action = decideComposerComma({
      armedSide: RuleSide.When,
      filter: "",
      armedSideCanEnd: false,
      wordInProgressCommits: false,
    });
    assert.equal(action, "filter-text");
  });

  test("commits the word in progress first when that word resolves", () => {
    const action = decideComposerComma({
      armedSide: RuleSide.When,
      filter: "plant",
      armedSideCanEnd: true,
      wordInProgressCommits: true,
    });
    assert.equal(action, "commit-then-pivot");
  });

  test("commits the word in progress from a position the expression cannot yet end at", () => {
    const action = decideComposerComma({
      armedSide: RuleSide.When,
      filter: "plant",
      armedSideCanEnd: false,
      wordInProgressCommits: true,
    });
    assert.equal(action, "commit-then-pivot");
  });

  test("is filter text while an unresolvable word is in progress", () => {
    const action = decideComposerComma({
      armedSide: RuleSide.When,
      filter: "zzz",
      armedSideCanEnd: true,
      wordInProgressCommits: false,
    });
    assert.equal(action, "filter-text");
  });

  test("is filter text once composition has moved to the DO side", () => {
    const action = decideComposerComma({
      armedSide: RuleSide.Do,
      filter: "",
      armedSideCanEnd: true,
      wordInProgressCommits: false,
    });
    assert.equal(action, "filter-text");
  });
});

describe("the period key", () => {
  test("settles the rule where the side being composed may end", () => {
    const action = decideComposerPeriod({
      filter: "",
      armedSideCanEnd: canEndSideExpression(tiles(makeSensor("composer-period-see")), localizer),
      ruleIsEmpty: false,
      wordInProgressCommits: false,
    });
    assert.equal(action, "settle");
  });

  test("settles a rule whose condition stands alone behind an empty DO side", () => {
    const action = decideComposerPeriod({
      filter: "",
      armedSideCanEnd: canEndSideExpression(tiles(), localizer),
      ruleIsEmpty: false,
      wordInProgressCommits: false,
    });
    assert.equal(action, "settle");
  });

  test("commits the word in progress first when that word resolves", () => {
    const action = decideComposerPeriod({
      filter: "plant",
      armedSideCanEnd: true,
      ruleIsEmpty: false,
      wordInProgressCommits: true,
    });
    assert.equal(action, "commit-then-settle");
  });

  test("commits the word in progress from a position the side cannot yet end at", () => {
    const action = decideComposerPeriod({
      filter: "plant",
      armedSideCanEnd: false,
      ruleIsEmpty: true,
      wordInProgressCommits: true,
    });
    assert.equal(action, "commit-then-settle");
  });

  test("is refused while an unresolvable word is in progress", () => {
    const action = decideComposerPeriod({
      filter: "zzz",
      armedSideCanEnd: true,
      ruleIsEmpty: false,
      wordInProgressCommits: false,
    });
    assert.equal(action, "refuse");
  });

  test("is refused where the side being composed may not end", () => {
    const side = tiles(makeSensor("composer-period-hear"), coreTile(mkOperatorTileId(CoreOpId.And)));
    const action = decideComposerPeriod({
      filter: "",
      armedSideCanEnd: canEndSideExpression(side, localizer),
      ruleIsEmpty: false,
      wordInProgressCommits: false,
    });
    assert.equal(action, "refuse");
  });

  test("does nothing on a rule with nothing composed on either side", () => {
    const action = decideComposerPeriod({
      filter: "",
      armedSideCanEnd: canEndSideExpression(tiles(), localizer),
      ruleIsEmpty: true,
      wordInProgressCommits: false,
    });
    assert.equal(action, "none");
  });

  test("continues a bare integer as filter text so a decimal is typeable", () => {
    const action = decideComposerPeriod({
      filter: "1",
      armedSideCanEnd: true,
      ruleIsEmpty: false,
      wordInProgressCommits: true,
    });
    assert.equal(action, "filter-text");
  });

  test("continues a negative bare integer as filter text", () => {
    const action = decideComposerPeriod({
      filter: "-12",
      armedSideCanEnd: true,
      ruleIsEmpty: false,
      wordInProgressCommits: true,
    });
    assert.equal(action, "filter-text");
  });

  test("settles once the number in progress already holds a decimal point", () => {
    const action = decideComposerPeriod({
      filter: "1.5",
      armedSideCanEnd: true,
      ruleIsEmpty: false,
      wordInProgressCommits: true,
    });
    assert.equal(action, "commit-then-settle");
  });

  test("settles on an empty filter at a position that offers numbers", () => {
    const action = decideComposerPeriod({
      filter: "",
      armedSideCanEnd: true,
      ruleIsEmpty: false,
      wordInProgressCommits: false,
    });
    assert.equal(action, "settle");
  });

  test("settles a number carrying a typed format specifier", () => {
    const action = decideComposerPeriod({
      filter: "0.5s",
      armedSideCanEnd: true,
      ruleIsEmpty: false,
      wordInProgressCommits: true,
    });
    assert.equal(action, "commit-then-settle");
  });

  test("leaves a word that merely opens with digits to the resolvable-word rung", () => {
    const action = decideComposerPeriod({
      filter: "1st",
      armedSideCanEnd: true,
      ruleIsEmpty: false,
      wordInProgressCommits: true,
    });
    assert.equal(action, "commit-then-settle");
  });
});

describe("the pivot reading", () => {
  test("a WHEN side that reads no words of its own reads the trigger word before the comma", () => {
    const trigger = triggerModeWord(RuleTriggerMode.When, localizer);

    assert.deepEqual(composePivotReading([], trigger), [
      { kind: "glue", text: trigger },
      { kind: "glue", text: "," },
    ]);
  });

  test("a WHEN side that reads its own words takes the comma alone", () => {
    const reading = composeSentenceReading(projectionOf([makeObjectSensor("composer-pivot-bump")], []));

    assert.deepEqual(composePivotReading(reading, triggerModeWord(RuleTriggerMode.When, localizer)), [
      { kind: "glue", text: "," },
    ]);
  });

  test("no trigger word stands in the pivot of a WHEN side that reads its own words", () => {
    const reading = composeSentenceReading(projectionOf([makeObjectSensor("composer-pivot-bump-2")], []));
    const trigger = triggerModeWord(RuleTriggerMode.When, localizer);

    for (const segment of composePivotReading(reading, trigger)) {
      assert.notEqual(segment.text, trigger);
    }
  });

  test("an empty rule reads neither the trigger word nor the comma before the pivot", () => {
    assert.deepEqual(composeSentenceReading(projectionOf([], [])), []);
  });
});

describe("the backspace ladder", () => {
  test("edits the word in progress while there is one", () => {
    const action = decideComposerBackspace({ filter: "se", pivoted: false, doTileCount: 0 });
    assert.equal(action, "edit-filter");
  });

  test("edits the word in progress before it would take back the pivot", () => {
    const action = decideComposerBackspace({ filter: "se", pivoted: true, doTileCount: 0 });
    assert.equal(action, "edit-filter");
  });

  test("takes back the typed pivot before it reaches the tiles at the caret", () => {
    const action = decideComposerBackspace({ filter: "", pivoted: true, doTileCount: 0 });
    assert.equal(action, "unpivot");
  });

  test("deletes at the caret once a word stands on the DO side of the pivot", () => {
    const action = decideComposerBackspace({ filter: "", pivoted: true, doTileCount: 1 });
    assert.equal(action, "delete-at-caret");
  });

  test("deletes at the caret with no word in progress and no pivot to take back", () => {
    const action = decideComposerBackspace({ filter: "", pivoted: false, doTileCount: 0 });
    assert.equal(action, "delete-at-caret");
  });
});

describe("the character that ends a word", () => {
  /**
   * The action for `char` typed onto `word`, at a position that places that word
   * when `wordCommits`.
   */
  function decide(word: string, char: string, wordCommits = true) {
    return decideComposerCharacter({ char, word, wordCommits });
  }

  test("a character of the word's own class joins it", () => {
    assert.equal(decide("", "1"), "extend");
    assert.equal(decide("1", "2"), "extend");
    assert.equal(decide("foo", "b"), "extend");
    assert.equal(decide("foo", "1"), "extend");
    assert.equal(decide("2", "s"), "extend");
    assert.equal(decide("$fo", "o"), "extend");
    assert.equal(decide("_a", "b"), "extend");
  });

  test("a decimal point and a format specifier stay inside the number", () => {
    assert.equal(decide("1", "."), "extend");
    assert.equal(decide("1.", "5"), "extend");
    assert.equal(decide("50", "%"), "extend");
    assert.equal(decide("1", "m"), "extend");
  });

  test("an operator symbol ends the value before it", () => {
    for (const char of ["+", "-", "*", "/", ">", "<", "=", "!"]) {
      assert.equal(decide("1", char), "commit-then-start", char);
    }
  });

  test("a value character ends the operator before it", () => {
    assert.equal(decide("+", "3"), "commit-then-start");
    assert.equal(decide(">=", "3"), "commit-then-start");
    assert.equal(decide("!", "f"), "commit-then-start");
  });

  test("two operator characters stay one word only while they still spell an operator", () => {
    assert.equal(decide(">", "="), "extend");
    assert.equal(decide("<", "="), "extend");
    assert.equal(decide("=", "="), "extend");
    assert.equal(decide("!", "="), "extend");
    assert.equal(decide(">=", "-"), "commit-then-start");
    assert.equal(decide("==", "="), "commit-then-start");
    assert.equal(decide("+", "-"), "commit-then-start");
    assert.equal(decide("*", "-"), "commit-then-start");
    assert.equal(decide("-", "-"), "commit-then-start");
  });

  test("a bare minus is an operator where one places, and opens a number where none does", () => {
    assert.equal(decide("-", "3", true), "commit-then-start");
    assert.equal(decide("-", "3", false), "extend");
    assert.equal(decide("-3", "0", false), "extend");
  });

  test("a bracket is a word of its own, whichever word it lands beside", () => {
    assert.equal(decide("", "("), "place-alone");
    assert.equal(decide("", ")"), "place-alone");
    assert.equal(decide("3", ")"), "commit-then-start");
    assert.equal(decide("foo", "("), "commit-then-start");
    assert.equal(decide("+", "("), "commit-then-start");
    assert.equal(decide("(", "("), "commit-then-start");
    assert.equal(decide("(", "f"), "commit-then-start");
    assert.equal(decide(")", "*"), "commit-then-start");
  });

  test("a word that places nothing here refuses the character that would end it", () => {
    assert.equal(decide("zz", "+", false), "refuse");
    assert.equal(decide("zz", "(", false), "refuse");
    assert.equal(decide("!", "f", false), "refuse");
    assert.equal(decide("(", "f", false), "refuse");
  });

  test("a word that places nothing here still takes a character of its own class", () => {
    assert.equal(decide("zz", "z", false), "extend");
    assert.equal(decide("", "+", false), "extend");
    assert.equal(decide("", ")", false), "place-alone");
  });
});
