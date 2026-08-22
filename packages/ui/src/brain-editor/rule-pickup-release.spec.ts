/**
 * Pins what a page stopping rendering does to the history: it gives back a rule
 * it holds picked up and aborts the batch that pick-up opened, under the
 * editor's own origin, and leaves a batch it never opened gathering.
 *
 * Exercised against a real command history.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BrainCommand } from "@wendoo/core/brain/model";
import { BrainCommandHistory, BrainEditOrigin } from "@wendoo/core/brain/model";
import type { RulePickup, RulePickupController } from "./RulePickupContext";
import { releaseHeldRule } from "./rule-pickup-release";

/** A command counting the times it was run and taken back. */
function countingCommand(): BrainCommand & { executed: number; undone: number } {
  return {
    executed: 0,
    undone: 0,
    execute() {
      this.executed++;
    },
    undo() {
      this.undone++;
    },
    getDescription: () => "counted",
  };
}

/** A controller holding `pickup`, recording what it is handed. */
function controller(pickup: RulePickup | null): RulePickupController & { handed: (RulePickup | null)[] } {
  const handed: (RulePickup | null)[] = [];
  return {
    pickup,
    handed,
    setPickup(next) {
      handed.push(next);
    },
  };
}

/** A pick-up of one rule, with no step available from where it stands. */
const kHeldRule: RulePickup = { ruleId: "r1", directions: [] };

/** The origins `work` reports its changes under. */
function originsOf(history: BrainCommandHistory, work: () => void): BrainEditOrigin[] {
  const seen: BrainEditOrigin[] = [];
  const stop = history.onChange((origin) => seen.push(origin));
  work();
  stop();
  return seen;
}

describe("a page that stops rendering while it holds a rule", () => {
  test("aborts the batch its pick-up opened and gives the rule back", () => {
    const history = new BrainCommandHistory();
    const command = countingCommand();
    history.beginBatch("Move rule");
    history.executeCommand(command);
    const pickup = controller(kHeldRule);

    releaseHeldRule(history, pickup);

    assert.equal(history.isBatchOpen(), false);
    assert.equal(command.undone, 1);
    assert.equal(history.undoDepth(), 0);
    assert.deepEqual(pickup.handed, [null]);
  });

  test("reports the abort as the editor's own change", () => {
    const history = new BrainCommandHistory();
    history.beginBatch("Move rule");
    history.executeCommand(countingCommand());
    const pickup = controller(kHeldRule);

    const origins = originsOf(history, () => releaseHeldRule(history, pickup));

    assert.deepEqual(origins, [BrainEditOrigin.Editor]);
  });
});

describe("a page that stops rendering while it holds no rule", () => {
  test("leaves a batch it never opened gathering, with its commands standing", () => {
    const history = new BrainCommandHistory();
    const command = countingCommand();
    history.beginBatch("Apply 2 edits");
    history.executeCommand(command);

    releaseHeldRule(history, controller(null));

    assert.equal(history.isBatchOpen(), true);
    assert.equal(command.undone, 0);
  });

  test("reports no change of its own and hands the pick-up nothing", () => {
    const history = new BrainCommandHistory();
    history.beginBatch("Apply 2 edits");
    history.executeCommand(countingCommand());
    const pickup = controller(null);

    const origins = originsOf(history, () => releaseHeldRule(history, pickup));

    assert.deepEqual(origins, []);
    assert.deepEqual(pickup.handed, []);
  });
});
