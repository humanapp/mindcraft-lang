/**
 * Pins the trigger-mode switch's own model: the step the cycle takes around the
 * modes a rule's position admits, and that each mode is named and announced
 * distinctly.
 *
 * Structural assertions only: every value asserted here is a mode, a count, or
 * whether two readings differ.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { List } from "@wendoo/core";
import { RuleTriggerMode } from "@wendoo/core/brain";
import { createDefaultLocalizer } from "@wendoo/core/localization";
import {
  nextTriggerMode,
  triggerModeAnnouncement,
  triggerModeLabel,
  triggerSwitchName,
  triggerSwitchState,
} from "./trigger-mode";

const localizer = createDefaultLocalizer();

/** The three modes a rule with a preceding sibling admits, in display order. */
const allModes = List.from<RuleTriggerMode>([RuleTriggerMode.When, RuleTriggerMode.Otherwise, RuleTriggerMode.Then]);

/** The one mode the first rule at a nesting level admits. */
const whenOnly = List.from<RuleTriggerMode>([RuleTriggerMode.When]);

describe("stepping the trigger-mode cycle", () => {
  test("a step advances through the modes and wraps at the end", () => {
    assert.equal(nextTriggerMode(RuleTriggerMode.When, allModes), RuleTriggerMode.Otherwise);
    assert.equal(nextTriggerMode(RuleTriggerMode.Otherwise, allModes), RuleTriggerMode.Then);
    assert.equal(nextTriggerMode(RuleTriggerMode.Then, allModes), RuleTriggerMode.When);
  });

  test("stepping every mode of a cycle returns to where it started", () => {
    let landed: RuleTriggerMode = RuleTriggerMode.When;
    for (let step = 0; step < allModes.size(); step++) landed = nextTriggerMode(landed, allModes);
    assert.equal(landed, RuleTriggerMode.When);
  });

  test("a cycle of one mode stays where it stands", () => {
    assert.equal(nextTriggerMode(RuleTriggerMode.When, whenOnly), RuleTriggerMode.When);
  });

  test("a mode the position no longer admits steps to the first mode offered", () => {
    assert.equal(nextTriggerMode(RuleTriggerMode.Then, whenOnly), RuleTriggerMode.When);
    assert.equal(nextTriggerMode(RuleTriggerMode.Otherwise, whenOnly), RuleTriggerMode.When);
  });
});

describe("how the switch reads", () => {
  test("each mode carries a label of its own", () => {
    const labels = allModes.toArray().map((mode) => triggerModeLabel(mode, localizer));

    assert.equal(new Set(labels).size, labels.length);
    for (const label of labels) assert.ok(label.length > 0);
  });

  test("each mode is announced distinctly", () => {
    const lines = allModes.toArray().map((mode) => triggerModeAnnouncement(mode, localizer));

    assert.equal(new Set(lines).size, lines.length);
    for (const line of lines) assert.ok(line.length > 0);
  });

  test("each mode the switch stands at is named distinctly", () => {
    const named = allModes.toArray().map((mode) => triggerSwitchName(mode, "switchable", localizer));

    assert.equal(new Set(named).size, named.length);
    for (const name of named) assert.ok(name.length > 0);
  });

  test("a mode the position rejects reads differently from the same mode it admits", () => {
    for (const mode of allModes.toArray()) {
      const admitted = triggerSwitchName(mode, "switchable", localizer);
      const rejected = triggerSwitchName(mode, "invalid", localizer);

      assert.notEqual(rejected, admitted);
      assert.ok(rejected.length > admitted.length);
    }
  });
});

describe("the state a trigger switch stands in", () => {
  test("a position admitting the rule's mode and others is switchable", () => {
    assert.equal(triggerSwitchState(RuleTriggerMode.When, allModes), "switchable");
    assert.equal(triggerSwitchState(RuleTriggerMode.Then, allModes), "switchable");
  });

  test("a position admitting the rule's mode and no other is fixed", () => {
    assert.equal(triggerSwitchState(RuleTriggerMode.When, whenOnly), "fixed");
  });

  test("a position rejecting the rule's own mode is invalid, never fixed", () => {
    for (const mode of [RuleTriggerMode.Otherwise, RuleTriggerMode.Then]) {
      assert.equal(triggerSwitchState(mode, whenOnly), "invalid");
    }
  });

  test("one step out of a rejected mode lands on an admitted one", () => {
    for (const mode of [RuleTriggerMode.Otherwise, RuleTriggerMode.Then]) {
      const landed = nextTriggerMode(mode, whenOnly);
      assert.ok(whenOnly.contains(landed), `${mode} landed on ${landed}`);
    }
  });
});
