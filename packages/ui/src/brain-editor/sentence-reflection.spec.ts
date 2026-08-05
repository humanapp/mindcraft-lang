/**
 * Pins the sentence line's change detection: which rendered segments the
 * reflection marks as changed between two renders of a rule's sentence.
 *
 * Structural assertions only -- the identities here are machine forms (tile
 * ids, source indices, rendered text), never product wording.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { changedSentenceSegments, type SentenceSegmentIdentity } from "./sentence-reflection";

/** A word segment identity rendering the tile `tileId` at flattened index `index`. */
function word(index: number, tileId: string, text: string): SentenceSegmentIdentity {
  return { text, sourceTileIndex: index, sourceTileId: tileId };
}

/** A glue segment identity, owned by no tile. */
function glue(text: string): SentenceSegmentIdentity {
  return { text };
}

/** "When I see anything, move forward." shaped rendering. */
function baseline(): SentenceSegmentIdentity[] {
  return [
    glue("When I "),
    word(0, "tile.sensor->see", "see"),
    glue(" "),
    word(0, "tile.sensor->see", "anything"),
    glue(", "),
    word(1, "tile.actuator->move", "move"),
    glue(" "),
    word(2, "tile.modifier->forward", "forward"),
    glue("."),
  ];
}

describe("sentence reflection change detection", () => {
  test("the first render marks nothing changed", () => {
    assert.deepEqual([...changedSentenceSegments([], baseline())], []);
  });

  test("an unchanged sentence marks nothing changed", () => {
    assert.deepEqual([...changedSentenceSegments(baseline(), baseline())], []);
  });

  test("a replaced source tile marks only the segments that tile renders", () => {
    const next = baseline();
    next[5] = word(1, "tile.actuator->say", "say");
    assert.deepEqual([...changedSentenceSegments(baseline(), next)], [5]);
  });

  test("a same-tile text change marks the segment", () => {
    const previous = [glue("When I "), word(0, "tile.literal->number->3", "3"), glue(".")];
    const next = [glue("When I "), word(0, "tile.literal->number->3", "7"), glue(".")];
    assert.deepEqual([...changedSentenceSegments(previous, next)], [1]);
  });

  test("an appended tile marks only its own segments", () => {
    const previous = [glue("When I "), word(0, "tile.sensor->see", "see"), glue(".")];
    const next = [
      glue("When I "),
      word(0, "tile.sensor->see", "see"),
      glue(" "),
      word(1, "tile.modifier->nearby", "nearby"),
      glue("."),
    ];
    assert.deepEqual([...changedSentenceSegments(previous, next)], [3]);
  });

  test("a deleted tile marks the words that shifted onto its index", () => {
    const previous = [
      glue("When I "),
      word(0, "tile.sensor->see", "see"),
      glue(" "),
      word(1, "tile.modifier->nearby", "nearby"),
      glue("."),
    ];
    const next = [glue("When I "), word(0, "tile.modifier->nearby", "nearby"), glue(".")];
    assert.deepEqual([...changedSentenceSegments(previous, next)], [1]);
  });

  test("glue is never marked changed", () => {
    const previous = [glue("When I "), word(0, "tile.sensor->see", "see"), glue(".")];
    const next = [glue("Always "), word(0, "tile.sensor->see", "see"), glue("!")];
    assert.deepEqual([...changedSentenceSegments(previous, next)], []);
  });

  test("a tile that renders two words marks both when it is replaced", () => {
    const next = baseline();
    next[1] = word(0, "tile.sensor->bump", "bump");
    next[3] = word(0, "tile.sensor->bump", "something");
    assert.deepEqual([...changedSentenceSegments(baseline(), next)], [1, 3]);
  });

  test("the same inputs always yield the same result", () => {
    const previous = baseline();
    const next = baseline();
    next[5] = word(1, "tile.actuator->say", "say");
    const first = [...changedSentenceSegments(previous, next)];
    const second = [...changedSentenceSegments(previous, next)];
    assert.deepEqual(first, second);
  });
});
