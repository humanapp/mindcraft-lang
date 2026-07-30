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
import { List } from "@mindcraft-lang/core";
import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { CoreControlFlowId, mkControlFlowTileId, mkOperatorTileId, RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import {
  projectRuleSentence,
  type SentenceSegment,
  type SentenceWordSegment,
  whenTriggerWord,
} from "@mindcraft-lang/core/brain/language-service";
import {
  AddTileCommand,
  type BrainCommand,
  BrainDef,
  type BrainPageDef,
  type BrainRuleDef,
} from "@mindcraft-lang/core/brain/model";
import { BrainTileActuatorDef, BrainTileModifierDef, BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import { createDefaultLocalizer, type Localizer } from "@mindcraft-lang/core/localization";
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
} from "@mindcraft-lang/core/runtime";
import {
  canEndSideExpression,
  composePivotReading,
  composeSentenceReading,
  decideComposerBackspace,
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

/** The settled projection of a rule holding `whenTiles` and `doTiles`. */
function projectionOf(whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]): SentenceSegment[] {
  const brainDef = BrainDef.emptyBrainDef(services, "composer-reading");
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  const ruleDef = pageDef.children().get(0) as BrainRuleDef;
  for (const tileDef of whenTiles) ruleDef.when().appendTile(tileDef);
  for (const tileDef of doTiles) ruleDef.do().appendTile(tileDef);
  return projectRuleSentence(ruleDef, brainDef.servicesLocalizer()).toArray();
}

/** The source-tile index of every word segment of `segments`, in order. */
function wordIndices(segments: readonly SentenceSegment[]): number[] {
  return segments
    .filter((segment): segment is SentenceWordSegment => segment.kind === "word")
    .map((segment) => segment.sourceTileIndex);
}

/**
 * A real command against a real rule, standing for one the composer's own commit
 * executed. Never executed: it serves as an identity.
 */
function makeCommand(sensorId: string): BrainCommand {
  const brainDef = BrainDef.emptyBrainDef(services, "composer-commit");
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  const ruleDef = pageDef.children().get(0) as BrainRuleDef;
  return new AddTileCommand(ruleDef, RuleSide.When, makeSensor(sensorId));
}

before(() => {
  services = __test__createBrainServices();
  localizer = createDefaultLocalizer();
  registerObjectModifiers();
});

describe("where a rule side may end", () => {
  test("an empty side may end", () => {
    assert.equal(canEndSideExpression(tiles()), true);
  });

  test("a bare sensor may end", () => {
    assert.equal(canEndSideExpression(tiles(makeSensor("composer-see"))), true);
  });

  test("a bare actuator on a DO side may end", () => {
    assert.equal(canEndSideExpression(tiles(makeActuator("composer-end-jump"))), true);
  });

  test("a trailing infix operator may not end", () => {
    const side = tiles(makeSensor("composer-hear"), coreTile(mkOperatorTileId(CoreOpId.And)));
    assert.equal(canEndSideExpression(side), false);
  });

  test("a leading prefix operator with no operand may not end", () => {
    assert.equal(canEndSideExpression(tiles(coreTile(mkOperatorTileId(CoreOpId.Not)))), false);
  });

  test("an unclosed group may not end", () => {
    const side = tiles(coreTile(mkControlFlowTileId(CoreControlFlowId.OpenParen)), makeSensor("composer-smell"));
    assert.equal(canEndSideExpression(side), false);
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
      armedSideCanEnd: canEndSideExpression(tiles(makeSensor("composer-period-see"))),
      ruleIsEmpty: false,
      wordInProgressCommits: false,
    });
    assert.equal(action, "settle");
  });

  test("settles a rule whose condition stands alone behind an empty DO side", () => {
    const action = decideComposerPeriod({
      filter: "",
      armedSideCanEnd: canEndSideExpression(tiles()),
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

  test("is filter text while an unresolvable word is in progress", () => {
    const action = decideComposerPeriod({
      filter: "zzz",
      armedSideCanEnd: true,
      ruleIsEmpty: false,
      wordInProgressCommits: false,
    });
    assert.equal(action, "filter-text");
  });

  test("is filter text where the side being composed may not end", () => {
    const side = tiles(makeSensor("composer-period-hear"), coreTile(mkOperatorTileId(CoreOpId.And)));
    const action = decideComposerPeriod({
      filter: "",
      armedSideCanEnd: canEndSideExpression(side),
      ruleIsEmpty: false,
      wordInProgressCommits: false,
    });
    assert.equal(action, "filter-text");
  });

  test("does nothing on a rule with nothing composed on either side", () => {
    const action = decideComposerPeriod({
      filter: "",
      armedSideCanEnd: canEndSideExpression(tiles()),
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
    const trigger = whenTriggerWord(localizer);

    assert.deepEqual(composePivotReading([], trigger), [
      { kind: "glue", text: trigger },
      { kind: "glue", text: "," },
    ]);
  });

  test("a WHEN side that reads its own words takes the comma alone", () => {
    const reading = composeSentenceReading(projectionOf([makeObjectSensor("composer-pivot-bump")], []));

    assert.deepEqual(composePivotReading(reading, whenTriggerWord(localizer)), [{ kind: "glue", text: "," }]);
  });

  test("no trigger word stands in the pivot of a WHEN side that reads its own words", () => {
    const reading = composeSentenceReading(projectionOf([makeObjectSensor("composer-pivot-bump-2")], []));
    const trigger = whenTriggerWord(localizer);

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
    const own = makeCommand("composer-ladder-see");
    const action = decideComposerBackspace({
      filter: "se",
      ownLastCommit: own,
      newestCommand: own,
      pivoted: false,
      doTileCount: 0,
    });
    assert.equal(action, "edit-filter");
  });

  test("edits the word in progress before it would take back the pivot", () => {
    const own = makeCommand("composer-ladder-hear");
    const action = decideComposerBackspace({
      filter: "se",
      ownLastCommit: own,
      newestCommand: own,
      pivoted: true,
      doTileCount: 0,
    });
    assert.equal(action, "edit-filter");
  });

  test("takes back the typed pivot before the composer's own last commit", () => {
    const own = makeCommand("composer-ladder-smell");
    const action = decideComposerBackspace({
      filter: "",
      ownLastCommit: own,
      newestCommand: own,
      pivoted: true,
      doTileCount: 0,
    });
    assert.equal(action, "unpivot");
  });

  test("takes back the pivot with no commit of the composer's own to undo", () => {
    const action = decideComposerBackspace({
      filter: "",
      ownLastCommit: undefined,
      newestCommand: undefined,
      pivoted: true,
      doTileCount: 0,
    });
    assert.equal(action, "unpivot");
  });

  test("takes back a word placed on the DO side before the pivot that opened it", () => {
    const own = makeCommand("composer-ladder-jump");
    const action = decideComposerBackspace({
      filter: "",
      ownLastCommit: own,
      newestCommand: own,
      pivoted: true,
      doTileCount: 1,
    });
    assert.equal(action, "uncommit-word");
  });

  test("uncommits the composer's own last commit when it is the newest history entry", () => {
    const own = makeCommand("composer-ladder-bump");
    const action = decideComposerBackspace({
      filter: "",
      ownLastCommit: own,
      newestCommand: own,
      pivoted: false,
      doTileCount: 0,
    });
    assert.equal(action, "uncommit-word");
  });

  test("does nothing when the composer has committed no word", () => {
    const action = decideComposerBackspace({
      filter: "",
      ownLastCommit: undefined,
      newestCommand: makeCommand("composer-ladder-foreign"),
      pivoted: false,
      doTileCount: 0,
    });
    assert.equal(action, "none");
  });

  test("does nothing when a command the composer did not make is the newest history entry", () => {
    const own = makeCommand("composer-ladder-own");
    const foreign = makeCommand("composer-ladder-other");
    const action = decideComposerBackspace({
      filter: "",
      ownLastCommit: own,
      newestCommand: foreign,
      pivoted: false,
      doTileCount: 0,
    });
    assert.equal(action, "none");
  });

  test("does nothing once the composer's own commit has been undone elsewhere", () => {
    const action = decideComposerBackspace({
      filter: "",
      ownLastCommit: makeCommand("composer-ladder-undone"),
      newestCommand: undefined,
      pivoted: false,
      doTileCount: 0,
    });
    assert.equal(action, "none");
  });

  test("uncommits successive words while the composer's own commits stay newest", () => {
    const first = makeCommand("composer-ladder-first");
    const second = makeCommand("composer-ladder-second");
    const own = [first, second];
    const backspace = (newestCommand: BrainCommand | undefined) =>
      decideComposerBackspace({
        filter: "",
        ownLastCommit: own[own.length - 1],
        newestCommand,
        pivoted: false,
        doTileCount: 0,
      });

    assert.equal(backspace(second), "uncommit-word");
    own.pop();
    assert.equal(backspace(first), "uncommit-word");
    own.pop();
    assert.equal(backspace(undefined), "none");
  });
});
