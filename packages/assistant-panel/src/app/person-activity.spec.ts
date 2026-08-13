/**
 * Pins the record of what the person has been doing to a brain's rules: the
 * window an interaction counts for, the count of the changes they made, and
 * that both are kept per brain.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { countsAsInteraction, createPersonActivity, personInteractionWindowMs } from "./person-activity";

/** An activity record over a clock the test moves itself, starting at zero. */
function standingClock(): { activity: ReturnType<typeof createPersonActivity>; pass: (ms: number) => void } {
  let at = 0;
  const activity = createPersonActivity({ now: () => at });
  return {
    activity,
    pass: (ms: number) => {
      at += ms;
    },
  };
}

describe("what the person has been doing", () => {
  test("a brain nothing was noted for reads as untouched and unchanged", () => {
    const activity = createPersonActivity();
    assert.equal(activity.isInteracting("brain-a"), false);
    assert.equal(activity.mutations("brain-a"), 0);
  });

  test("an interaction counts until the window runs out", () => {
    const { activity, pass } = standingClock();

    activity.noteInteraction("brain-a");
    assert.equal(activity.isInteracting("brain-a"), true);

    pass(personInteractionWindowMs - 1);
    assert.equal(activity.isInteracting("brain-a"), true);

    pass(1);
    assert.equal(activity.isInteracting("brain-a"), false);
  });

  test("a later interaction starts the window again", () => {
    const { activity, pass } = standingClock();

    activity.noteInteraction("brain-a");
    pass(personInteractionWindowMs - 1);
    activity.noteInteraction("brain-a");
    pass(personInteractionWindowMs - 1);

    assert.equal(activity.isInteracting("brain-a"), true);
  });

  test("counts every change and never takes one back", () => {
    const activity = createPersonActivity();

    activity.noteMutation("brain-a");
    activity.noteMutation("brain-a");

    assert.equal(activity.mutations("brain-a"), 2);
  });

  test("keeps each brain's record to itself", () => {
    const { activity } = standingClock();

    activity.noteInteraction("brain-a");
    activity.noteMutation("brain-a");

    assert.equal(activity.isInteracting("brain-b"), false);
    assert.equal(activity.mutations("brain-b"), 0);
  });

  test("an interaction is not a change, and a change is not an interaction", () => {
    const { activity } = standingClock();

    activity.noteInteraction("brain-a");
    assert.equal(activity.mutations("brain-a"), 0);

    const quiet = createPersonActivity();
    quiet.noteMutation("brain-b");
    assert.equal(quiet.isInteracting("brain-b"), false);
  });
});

describe("which events count as the person acting", () => {
  test("counts a pointer press, a key, and the keyboard landing", () => {
    assert.equal(countsAsInteraction("pointerdown", 1), true);
    assert.equal(countsAsInteraction("keydown", undefined), true);
    assert.equal(countsAsInteraction("focusin", undefined), true);
  });

  test("counts a pointer moving with a button down, and not one merely passing over", () => {
    assert.equal(countsAsInteraction("pointermove", 1), true);
    assert.equal(countsAsInteraction("pointermove", 0), false);
    assert.equal(countsAsInteraction("pointermove", undefined), false);
  });
});
