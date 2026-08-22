/**
 * Pins the caret run: the positions a rule's two tile sets produce, the step the
 * arrow keys take along them, the edit each position intends, the position
 * composition opens at, and the position a hit on a projected segment resolves
 * to.
 *
 * Rules are built through the model API and their sentences come from
 * `projectRuleSentence`. Structural assertions only: positions, modes, indices
 * and counts.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@wendoo/core/brain";
import { RuleSide } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import {
  flattenRuleTiles,
  projectRuleSentence,
  type SentenceSegment,
  type SentenceTileRef,
} from "@wendoo/core/brain/language-service";
import type { BrainRuleDef } from "@wendoo/core/brain/model";
import {
  type CaretPosition,
  caretDeletionTarget,
  caretEditIntent,
  caretOnRun,
  caretPositionForSegment,
  caretRun,
  caretRunHolds,
  caretSentenceSlot,
  caretSideEnd,
  caretStep,
  composerEntryCaret,
} from "./caret-run";
import { armEditPoint, kEditPointPositions } from "./edit-point";
import { composeSentenceReading } from "./sentence-composer";
import { makeActuator, makeBrain, makeObjectSensor, makeSensor } from "./test-only-rule-fixtures";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

function gap(side: RuleSide, tileIndex: number): CaretPosition {
  return { kind: "gap", side, tileIndex };
}

function element(side: RuleSide, tileIndex: number): CaretPosition {
  return { kind: "element", side, tileIndex };
}

/** The rule of a fresh brain holding `whenTiles` and `doTiles`. */
function ruleOf(whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]): BrainRuleDef {
  return makeBrain(services, whenTiles, doTiles).ruleDef;
}

/** The projected sentence of a fresh rule holding `whenTiles` and `doTiles`, and the tiles its words render. */
function sentenceOf(
  whenTiles: readonly IBrainTileDef[],
  doTiles: readonly IBrainTileDef[]
): { rule: BrainRuleDef; segments: SentenceSegment[]; tiles: SentenceTileRef[] } {
  const { brainDef, ruleDef } = makeBrain(services, whenTiles, doTiles);
  return {
    rule: ruleDef,
    segments: projectRuleSentence(ruleDef, brainDef.servicesLocalizer()).toArray(),
    tiles: flattenRuleTiles(ruleDef).toArray(),
  };
}

/** The source-tile index of every word segment of `segments`, in order. */
function wordIndices(segments: readonly SentenceSegment[]): number[] {
  return segments.flatMap((segment) => (segment.kind === "word" ? [segment.sourceTileIndex] : []));
}

/** The index of the glue separating the last WHEN word of `segments` from the first DO word. */
function clauseGlueIndex(segments: readonly SentenceSegment[], tiles: readonly SentenceTileRef[]): number {
  const firstDoWord = segments.findIndex(
    (segment) => segment.kind === "word" && tiles[segment.sourceTileIndex].side === RuleSide.Do
  );
  assert.ok(firstDoWord > 0, "the line reads a word of the DO side");
  return firstDoWord - 1;
}

/** The index of every word segment of `segments`, in order. */
function wordSegmentIndexes(segments: readonly SentenceSegment[]): number[] {
  return segments.flatMap((segment, index) => (segment.kind === "word" ? [index] : []));
}

describe("the run a rule produces", () => {
  test("a rule with tiles on both sides runs its gaps and tiles in reading order", () => {
    const rule = ruleOf(
      [makeSensor(services, "run-see"), makeSensor(services, "run-hear")],
      [makeActuator(services, "run-move")]
    );
    assert.deepEqual(caretRun(rule), [
      gap(RuleSide.When, 0),
      element(RuleSide.When, 0),
      gap(RuleSide.When, 1),
      element(RuleSide.When, 1),
      gap(RuleSide.When, 2),
      gap(RuleSide.Do, 0),
      element(RuleSide.Do, 0),
      gap(RuleSide.Do, 1),
    ]);
  });

  test("a rule with only a WHEN side still runs the DO side's end gap", () => {
    const rule = ruleOf([makeSensor(services, "run-when-only")], []);
    assert.deepEqual(caretRun(rule), [
      gap(RuleSide.When, 0),
      element(RuleSide.When, 0),
      gap(RuleSide.When, 1),
      gap(RuleSide.Do, 0),
    ]);
  });

  test("a rule with only a DO side still runs the WHEN side's end gap", () => {
    const rule = ruleOf([], [makeActuator(services, "run-do-only")]);
    assert.deepEqual(caretRun(rule), [
      gap(RuleSide.When, 0),
      gap(RuleSide.Do, 0),
      element(RuleSide.Do, 0),
      gap(RuleSide.Do, 1),
    ]);
  });

  test("a rule with no tiles runs the two sides' opening gaps", () => {
    assert.deepEqual(caretRun(ruleOf([], [])), [gap(RuleSide.When, 0), gap(RuleSide.Do, 0)]);
  });

  test("a tile the sentence reads as several words is one position", () => {
    const { rule, segments } = sentenceOf([makeObjectSensor(services, "run-bump")], []);
    assert.deepEqual(wordIndices(segments), [0, 0], "the projection reads two words of the one tile");
    assert.deepEqual(caretRun(rule), [
      gap(RuleSide.When, 0),
      element(RuleSide.When, 0),
      gap(RuleSide.When, 1),
      gap(RuleSide.Do, 0),
    ]);
  });

  test("no position of the run stands on the structure the projection supplies", () => {
    const { rule, segments } = sentenceOf(
      [makeObjectSensor(services, "run-glue-bump")],
      [makeActuator(services, "run-glue-move")]
    );
    assert.ok(
      segments.some((segment) => segment.kind === "glue"),
      "the line carries glue of its own"
    );
    assert.equal(
      caretRun(rule).length,
      2 * flattenRuleTiles(rule).size() + 2,
      "the run holds a position per tile and a gap per tile plus each side's end"
    );
  });
});

describe("the boundary between the two sides", () => {
  test("both boundary gaps stand, and they are distinct", () => {
    const rule = ruleOf([makeSensor(services, "boundary-see")], [makeActuator(services, "boundary-move")]);
    const run = caretRun(rule);
    const whenEnd = gap(RuleSide.When, 1);
    const doStart = gap(RuleSide.Do, 0);
    assert.ok(
      run.some((position) => position.side === whenEnd.side && position.tileIndex === whenEnd.tileIndex),
      "the WHEN side's end gap stands"
    );
    assert.ok(
      run.some((position) => position.side === doStart.side && position.tileIndex === doStart.tileIndex),
      "the DO side's opening gap stands"
    );
    assert.notDeepEqual(whenEnd, doStart);
  });

  test("crossing from the last WHEN tile to the DO side takes two steps", () => {
    const rule = ruleOf([makeSensor(services, "cross-see")], [makeActuator(services, "cross-move")]);
    const run = caretRun(rule);
    const first = caretStep(run, element(RuleSide.When, 0), "right");
    assert.deepEqual(first, gap(RuleSide.When, 1));
    assert.deepEqual(caretStep(run, first, "right"), gap(RuleSide.Do, 0));
  });
});

describe("stepping along the run", () => {
  test("every position steps to its neighbour, and both ends clamp", () => {
    const rule = ruleOf(
      [makeSensor(services, "step-see"), makeSensor(services, "step-hear")],
      [makeActuator(services, "step-move")]
    );
    const run = caretRun(rule);
    for (let index = 0; index < run.length; index++) {
      assert.deepEqual(caretStep(run, run[index], "right"), run[Math.min(index + 1, run.length - 1)], `right ${index}`);
      assert.deepEqual(caretStep(run, run[index], "left"), run[Math.max(index - 1, 0)], `left ${index}`);
    }
  });

  test("an empty rule's two positions step to each other and clamp", () => {
    const run = caretRun(ruleOf([], []));
    assert.deepEqual(caretStep(run, run[0], "left"), run[0]);
    assert.deepEqual(caretStep(run, run[0], "right"), run[1]);
    assert.deepEqual(caretStep(run, run[1], "right"), run[1]);
  });

  test("a position the run does not hold is refused", () => {
    const run = caretRun(ruleOf([makeSensor(services, "step-absent")], []));
    assert.throws(() => caretStep(run, element(RuleSide.Do, 0), "right"));
  });
});

describe("whether a run still holds a position", () => {
  test("it holds every position it produced", () => {
    const run = caretRun(ruleOf([makeSensor(services, "holds-see")], [makeActuator(services, "holds-move")]));
    for (const position of run) {
      assert.equal(caretRunHolds(run, position), true, `${position.kind} ${position.side}:${position.tileIndex}`);
    }
  });

  test("a position past the tiles a rule now holds is not held", () => {
    const rule = ruleOf([makeSensor(services, "holds-stale-see"), makeSensor(services, "holds-stale-hear")], []);
    const standing = gap(RuleSide.When, 2);
    assert.equal(caretRunHolds(caretRun(rule), standing), true, "the WHEN side's end gap while it holds two tiles");
    rule.when().removeTileAtIndex(1);
    const run = caretRun(rule);
    assert.equal(caretRunHolds(run, standing), false, "and no longer, once a tile leaves that side");
    assert.throws(() => caretStep(run, standing, "left"), "which is exactly what stepping from it refuses");
  });

  test("a gap and the element of the same index are different positions", () => {
    const run = caretRun(ruleOf([makeSensor(services, "holds-kind-see")], []));
    assert.equal(caretRunHolds(run, element(RuleSide.When, 0)), true);
    assert.equal(caretRunHolds(run, gap(RuleSide.Do, 1)), false);
  });
});

describe("the end of a side", () => {
  test("it is that side's last position, whichever side is asked for", () => {
    const run = caretRun(ruleOf([makeSensor(services, "side-end-see")], [makeActuator(services, "side-end-move")]));

    assert.deepEqual(caretSideEnd(run, RuleSide.When), gap(RuleSide.When, 1));
    assert.deepEqual(caretSideEnd(run, RuleSide.Do), gap(RuleSide.Do, 1));
  });

  test("a side holding no tiles ends at its opening gap", () => {
    const run = caretRun(ruleOf([], []));

    assert.deepEqual(caretSideEnd(run, RuleSide.When), gap(RuleSide.When, 0));
    assert.deepEqual(caretSideEnd(run, RuleSide.Do), gap(RuleSide.Do, 0));
  });

  test("a run holding no position at all ends nowhere", () => {
    assert.equal(caretSideEnd([], RuleSide.When), undefined);
  });
});

describe("standing a position back on a run", () => {
  test("a position the run holds is returned as it stands", () => {
    const run = caretRun(ruleOf([makeSensor(services, "restand-see")], []));

    for (const position of run) {
      assert.equal(caretOnRun(run, position), position);
    }
  });

  test("an element whose tile has gone stands in the gap that tile vacated", () => {
    const rule = ruleOf([makeSensor(services, "restand-gone-see")], []);
    const standing = element(RuleSide.When, 0);
    rule.when().removeTileAtIndex(0);

    assert.deepEqual(caretOnRun(caretRun(rule), standing), gap(RuleSide.When, 0));
  });

  test("a gap past the tiles the side now holds stands at that side's end", () => {
    const rule = ruleOf([makeSensor(services, "restand-past-see"), makeSensor(services, "restand-past-hear")], []);
    const standing = gap(RuleSide.When, 2);
    rule.when().removeTileAtIndex(1);

    assert.deepEqual(caretOnRun(caretRun(rule), standing), gap(RuleSide.When, 1));
  });

  test("an element the run still reaches keeps its index, whichever tile now stands there", () => {
    const rule = ruleOf(
      [
        makeSensor(services, "restand-shift-see"),
        makeSensor(services, "restand-shift-hear"),
        makeSensor(services, "restand-shift-smell"),
      ],
      []
    );
    const standing = element(RuleSide.When, 1);
    rule.when().removeTileAtIndex(0);

    assert.equal(caretOnRun(caretRun(rule), standing), standing);
  });

  test("a run holding no position of the side stands nowhere", () => {
    assert.equal(caretOnRun([], element(RuleSide.When, 0)), undefined);
  });
});

describe("where composition opens", () => {
  test("a rule remembering nothing opens at the end of what it reads", () => {
    const both = caretRun(ruleOf([makeSensor(services, "open-both-see")], [makeActuator(services, "open-both-move")]));
    assert.deepEqual(composerEntryCaret(both, undefined), gap(RuleSide.Do, 1));

    const whenOnly = caretRun(ruleOf([makeSensor(services, "open-when-see")], []));
    assert.deepEqual(composerEntryCaret(whenOnly, undefined), gap(RuleSide.When, 1));
  });

  test("a rule holding no tiles opens at its one WHEN position", () => {
    assert.deepEqual(composerEntryCaret(caretRun(ruleOf([], [])), undefined), gap(RuleSide.When, 0));
  });

  test("a rule opens again at the position it was last edited at", () => {
    const run = caretRun(
      ruleOf(
        [makeSensor(services, "open-held-see"), makeSensor(services, "open-held-hear")],
        [makeActuator(services, "open-held-move")]
      )
    );

    assert.deepEqual(composerEntryCaret(run, gap(RuleSide.When, 1)), gap(RuleSide.When, 1));
    assert.deepEqual(composerEntryCaret(run, element(RuleSide.When, 0)), element(RuleSide.When, 0));
  });

  test("a remembered position the rule no longer holds stands where it stood", () => {
    const rule = ruleOf([makeSensor(services, "open-gone-see")], []);
    const remembered = element(RuleSide.When, 0);
    rule.when().removeTileAtIndex(0);

    assert.deepEqual(composerEntryCaret(caretRun(rule), remembered), gap(RuleSide.When, 0));
  });
});

describe("the tile a deletion takes", () => {
  test("an element is its own target, whichever way the deletion runs", () => {
    const run = caretRun(ruleOf([makeSensor(services, "delete-target-see")], []));
    const standing = element(RuleSide.When, 0);

    assert.deepEqual(caretDeletionTarget(run, standing, "left"), standing);
    assert.deepEqual(caretDeletionTarget(run, standing, "right"), standing);
  });

  test("a gap takes the tile before it going left and the one after it going right", () => {
    const run = caretRun(ruleOf([makeSensor(services, "delete-gap-see"), makeSensor(services, "delete-gap-hear")], []));

    assert.deepEqual(caretDeletionTarget(run, gap(RuleSide.When, 1), "left"), element(RuleSide.When, 0));
    assert.deepEqual(caretDeletionTarget(run, gap(RuleSide.When, 1), "right"), element(RuleSide.When, 1));
  });

  test("the boundary between the sides is crossed either way", () => {
    const run = caretRun(
      ruleOf([makeSensor(services, "delete-cross-see")], [makeActuator(services, "delete-cross-move")])
    );

    assert.deepEqual(caretDeletionTarget(run, gap(RuleSide.Do, 0), "left"), element(RuleSide.When, 0));
    assert.deepEqual(caretDeletionTarget(run, gap(RuleSide.When, 1), "right"), element(RuleSide.Do, 0));
  });

  test("the run's ends have no tile beyond them", () => {
    const run = caretRun(
      ruleOf([makeSensor(services, "delete-ends-see")], [makeActuator(services, "delete-ends-move")])
    );

    assert.equal(caretDeletionTarget(run, run[0], "left"), undefined);
    assert.equal(caretDeletionTarget(run, run[run.length - 1], "right"), undefined);
  });

  test("a rule holding no tiles at all offers nothing to delete", () => {
    const run = caretRun(ruleOf([], []));

    for (const position of run) {
      assert.equal(caretDeletionTarget(run, position, "left"), undefined);
      assert.equal(caretDeletionTarget(run, position, "right"), undefined);
    }
  });

  test("a position the run does not hold names no tile", () => {
    const run = caretRun(ruleOf([makeSensor(services, "delete-stale-see")], []));

    assert.equal(caretDeletionTarget(run, element(RuleSide.When, 4), "left"), undefined);
  });
});

describe("the edit a position intends", () => {
  test("an element replaces the tile it rests on", () => {
    assert.deepEqual(caretEditIntent(element(RuleSide.When, 1), 3), {
      mode: "replace",
      side: RuleSide.When,
      tileIndex: 1,
    });
  });

  test("a gap before a tile inserts at that tile's index", () => {
    assert.deepEqual(caretEditIntent(gap(RuleSide.Do, 1), 3), { mode: "insert", side: RuleSide.Do, tileIndex: 1 });
  });

  test("a gap at a side's end appends to that side", () => {
    assert.deepEqual(caretEditIntent(gap(RuleSide.Do, 3), 3), { mode: "append", side: RuleSide.Do });
  });

  test("the opening gap of an empty side appends", () => {
    assert.deepEqual(caretEditIntent(gap(RuleSide.When, 0), 0), { mode: "append", side: RuleSide.When });
  });

  test("it arms every position of a placed tile as the edit point does", () => {
    for (const tileCount of [1, 2, 4]) {
      for (let anchor = 0; anchor < tileCount; anchor++) {
        for (const position of kEditPointPositions) {
          const caret =
            position === "replace"
              ? element(RuleSide.When, anchor)
              : gap(RuleSide.When, position === "before" ? anchor : anchor + 1);
          assert.deepEqual(
            caretEditIntent(caret, tileCount),
            { ...armEditPoint(position, anchor, tileCount), side: RuleSide.When },
            `${position} at anchor ${anchor} of ${tileCount}`
          );
        }
      }
    }
  });
});

describe("where in the line the caret stands", () => {
  /** The tile a word segment reads, by the slot the caret was placed at. */
  function tileAt(segments: readonly SentenceSegment[], tiles: readonly SentenceTileRef[], slot: number) {
    const segment = segments[slot];
    assert.equal(segment?.kind, "word", "the slot stands at a word of the line");
    return tiles[(segment as { sourceTileIndex: number }).sourceTileIndex];
  }

  test("a caret on a tile stands at the first word reading it", () => {
    const { segments, tiles } = sentenceOf(
      [makeObjectSensor(services, "slot-bump")],
      [makeActuator(services, "slot-jump")]
    );
    const slot = caretSentenceSlot(segments, tiles, element(RuleSide.Do, 0));
    assert.deepEqual(tileAt(segments, tiles, slot), tiles[1]);
  });

  test("the gap before a tile stands where a caret on that tile does", () => {
    const { segments, tiles } = sentenceOf(
      [makeObjectSensor(services, "slot-bump-2")],
      [makeActuator(services, "slot-jump-2")]
    );
    assert.equal(
      caretSentenceSlot(segments, tiles, gap(RuleSide.Do, 0)),
      caretSentenceSlot(segments, tiles, element(RuleSide.Do, 0))
    );
  });

  test("a line with no segments has one slot, its end", () => {
    assert.equal(caretSentenceSlot([], [], gap(RuleSide.When, 0)), 0);
  });

  test("the WHEN side's end gap stands where the WHEN clause's reading ends", () => {
    const { segments, tiles } = sentenceOf([makeSensor(services, "slot-see")], [makeActuator(services, "slot-move")]);
    const slot = caretSentenceSlot(segments, tiles, gap(RuleSide.When, 1));
    assert.equal(slot, clauseGlueIndex(segments, tiles));
    assert.ok(
      slot < caretSentenceSlot(segments, tiles, gap(RuleSide.Do, 0)),
      "the DO side's opening gap stands past it"
    );
  });

  test("the DO side's end gap stands at the end of the line it is read from", () => {
    const { segments, tiles } = sentenceOf(
      [makeSensor(services, "slot-end-see")],
      [makeActuator(services, "slot-end-move")]
    );
    const reading = composeSentenceReading(segments);
    assert.equal(caretSentenceSlot(reading, tiles, gap(RuleSide.Do, 1)), reading.length);
  });

  test("a side the line reads no word of takes the line's own end", () => {
    const { segments, tiles } = sentenceOf([makeObjectSensor(services, "slot-bump-3")], []);
    assert.equal(caretSentenceSlot(segments, tiles, gap(RuleSide.Do, 0)), segments.length);
  });

  test("the slot is taken over the reading it is rendered from, not the settled projection", () => {
    const { segments, tiles } = sentenceOf(
      [makeObjectSensor(services, "slot-bump-4")],
      [makeActuator(services, "slot-jump-3")]
    );
    const reading = composeSentenceReading(segments);
    const position = element(RuleSide.Do, 0);
    const settledSlot = caretSentenceSlot(segments, tiles, position);
    const readingSlot = caretSentenceSlot(reading, tiles, position);
    assert.notEqual(readingSlot, settledSlot, "the completion word the reading drops moves the tile's word");
    assert.deepEqual(tileAt(reading, tiles, readingSlot), tiles[1]);
    assert.deepEqual(tileAt(segments, tiles, settledSlot), tiles[1]);
  });

  test("a tile index of one side does not address the other side's tile", () => {
    const { segments, tiles } = sentenceOf(
      [makeObjectSensor(services, "slot-bump-5")],
      [makeActuator(services, "slot-jump-4")]
    );
    const whenSlot = caretSentenceSlot(segments, tiles, element(RuleSide.When, 0));
    const doSlot = caretSentenceSlot(segments, tiles, element(RuleSide.Do, 0));
    assert.deepEqual(tileAt(segments, tiles, whenSlot), tiles[0]);
    assert.deepEqual(tileAt(segments, tiles, doSlot), tiles[1]);
  });
});

describe("the position a projected segment resolves to", () => {
  test("the leading structure resolves to the WHEN side's opening gap", () => {
    const { segments, tiles } = sentenceOf(
      [makeSensor(services, "hit-lead-see")],
      [makeActuator(services, "hit-lead-move")]
    );
    assert.equal(segments[0].kind, "glue", "the line opens on structure the projection supplies");
    assert.deepEqual(caretPositionForSegment(segments, tiles, 0), gap(RuleSide.When, 0));
  });

  test("the leading structure of a rule with no condition resolves to the same gap", () => {
    const { segments, tiles } = sentenceOf([], [makeActuator(services, "hit-always-move")]);
    assert.equal(segments[0].kind, "glue");
    assert.deepEqual(caretPositionForSegment(segments, tiles, 0), gap(RuleSide.When, 0));
  });

  test("the structure between the clauses resolves to the WHEN side's end gap", () => {
    const { rule, segments, tiles } = sentenceOf(
      [makeSensor(services, "hit-clause-see")],
      [makeActuator(services, "hit-clause-move")]
    );
    const index = clauseGlueIndex(segments, tiles);
    assert.equal(segments[index].kind, "glue");
    const resolved = caretPositionForSegment(segments, tiles, index);
    assert.deepEqual(resolved, gap(RuleSide.When, 1));
    assert.deepEqual(
      caretStep(caretRun(rule), resolved, "right"),
      gap(RuleSide.Do, 0),
      "the DO side's opening gap is one step on from it"
    );
  });

  test("the trailing structure resolves to the run's last position", () => {
    const { rule, segments, tiles } = sentenceOf(
      [makeSensor(services, "hit-tail-see")],
      [makeActuator(services, "hit-tail-move")]
    );
    const last = segments.length - 1;
    assert.equal(segments[last].kind, "glue", "the line ends on structure the projection supplies");
    const run = caretRun(rule);
    assert.deepEqual(caretPositionForSegment(segments, tiles, last), run[run.length - 1]);
  });

  test("a word resolves to the element of the tile it reads", () => {
    const { segments, tiles } = sentenceOf(
      [makeSensor(services, "hit-word-see")],
      [makeActuator(services, "hit-word-move")]
    );
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      if (segment.kind !== "word") continue;
      const tile = tiles[segment.sourceTileIndex];
      assert.deepEqual(caretPositionForSegment(segments, tiles, index), element(tile.side, tile.tileIndex));
    }
  });

  test("every word of a multi-word tile resolves to that tile's one position", () => {
    const { segments, tiles } = sentenceOf([makeObjectSensor(services, "hit-multi-bump")], []);
    const wordIndexes = wordSegmentIndexes(segments);
    assert.equal(wordIndexes.length, 2, "the projection reads two words of the one tile");
    const resolved = wordIndexes.map((index) => caretPositionForSegment(segments, tiles, index));
    assert.deepEqual(resolved, [element(RuleSide.When, 0), element(RuleSide.When, 0)]);
  });

  test("the structure joining a multi-word tile's own words resolves to the gap past that tile", () => {
    const { segments, tiles } = sentenceOf([makeObjectSensor(services, "hit-inner-bump")], []);
    const wordIndexes = wordSegmentIndexes(segments);
    assert.equal(wordIndexes.length, 2);
    const inner = wordIndexes[0] + 1;
    assert.equal(segments[inner].kind, "glue", "the tile's two words are joined by structure of the projection's own");
    assert.deepEqual(caretPositionForSegment(segments, tiles, inner), gap(RuleSide.When, 1));
  });
});
