/**
 * Pins the two pure decisions the keyboard help page rests on: the chips a
 * binding draws on each platform, and whether a live section stands at all.
 *
 * Chip tokens are machine forms produced by the formatting under test -- the
 * spelling a `KeyboardEvent` gives a key, mapped to the chip that key reads as.
 * A contribution's label and note are display prose and are asserted nowhere.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type AcceleratorBinding,
  acceleratorChips,
  acceleratorKeyName,
  acceleratorModifierName,
  acceleratorPlatform,
  kAcceleratorContributions,
  liveAcceleratorSection,
} from "./accelerators";
import { kEditorModes } from "./editor-mode";

describe("accelerator chips", () => {
  test("a platform is read from a user-agent string", () => {
    assert.equal(acceleratorPlatform("MacIntel"), "mac");
    assert.equal(acceleratorPlatform("iPhone"), "mac");
    assert.equal(acceleratorPlatform("Win32"), "other");
    assert.equal(acceleratorPlatform("Linux x86_64"), "other");
  });

  test("macOS draws modifiers as glyphs and every other platform spells them", () => {
    assert.deepEqual(
      (["command", "shift", "alt", "control"] as const).map((m) => acceleratorModifierName(m, "mac")),
      ["⌘", "⇧", "⌥", "⌃"]
    );
    assert.deepEqual(
      (["command", "shift", "alt", "control"] as const).map((m) => acceleratorModifierName(m, "other")),
      ["Ctrl", "Shift", "Alt", "Ctrl"]
    );
  });

  test("a key reads as its own chip", () => {
    assert.equal(acceleratorKeyName(" "), "Space");
    assert.equal(acceleratorKeyName("ArrowUp"), "Up");
    assert.equal(acceleratorKeyName("Escape"), "Esc");
    assert.equal(acceleratorKeyName("Enter"), "Enter");
    assert.equal(acceleratorKeyName("z"), "Z");
    assert.equal(acceleratorKeyName(","), ",");
  });

  test("a chord draws one chip per modifier and one per key", () => {
    const undo: AcceleratorBinding = { kind: "chord", modifiers: ["command"], keys: ["z"] };
    assert.deepEqual(acceleratorChips(undo, "mac"), ["⌘", "Z"]);
    assert.deepEqual(acceleratorChips(undo, "other"), ["Ctrl", "Z"]);

    const redo: AcceleratorBinding = { kind: "chord", modifiers: ["command", "shift"], keys: ["Z"] };
    assert.deepEqual(acceleratorChips(redo, "mac"), ["⌘", "⇧", "Z"]);
    assert.deepEqual(acceleratorChips(redo, "other"), ["Ctrl", "Shift", "Z"]);

    const arrows: AcceleratorBinding = { kind: "chord", keys: ["ArrowUp", "ArrowDown"] };
    assert.deepEqual(acceleratorChips(arrows, "mac"), ["Up", "Down"]);
    assert.deepEqual(acceleratorChips(arrows, "other"), ["Up", "Down"]);
  });

  test("a gesture draws its one chip on every platform", () => {
    const gesture: AcceleratorBinding = { kind: "gesture", chip: "Right-click" };
    assert.deepEqual(acceleratorChips(gesture, "mac"), ["Right-click"]);
    assert.deepEqual(acceleratorChips(gesture, "other"), ["Right-click"]);
  });

  test("every binding in the registry draws at least one chip on both platforms", () => {
    for (const contribution of kAcceleratorContributions) {
      for (const binding of contribution.bindings) {
        for (const platform of ["mac", "other"] as const) {
          const chips = acceleratorChips(binding, platform);
          assert.ok(chips.length > 0, `${contribution.id} draws no chip on ${platform}`);
          assert.ok(
            chips.every((chip) => chip.length > 0),
            `${contribution.id} draws an empty chip on ${platform}`
          );
        }
      }
    }
  });
});

describe("live accelerator section", () => {
  test("no reported mode stands no live section", () => {
    assert.equal(liveAcceleratorSection(undefined), undefined);
  });

  test("a reported mode stands a live section of exactly that mode's contributions", () => {
    for (const mode of kEditorModes) {
      const section = liveAcceleratorSection(mode);
      assert.ok(section !== undefined, `${mode} stands no live section`);
      assert.equal(section.mode, mode);
      assert.ok(section.contributions.length > 0);
      for (const contribution of section.contributions) {
        assert.ok(contribution.when.includes(mode), `${contribution.id} is live in ${mode} but does not stand there`);
      }
    }
  });

  test("a mode nothing documents stands no live section", () => {
    assert.equal(liveAcceleratorSection("composing", []), undefined);
  });
});
