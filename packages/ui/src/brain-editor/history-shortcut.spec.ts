/**
 * Pins the decision the editor's history shortcut makes: given the mode the
 * keyboard stands in and one press, whether the editor steps its history or
 * leaves the press to the surface holding it.
 *
 * The chord steps the history in every mode but `text-literal` and
 * `rule-held`, which take no step, and gives a held rule back at the page.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { kEditorModes } from "./editor-mode";
import { decideHistoryShortcut, isUndoChord } from "./history-shortcut";
import { decidePageKey, type PageGridCell, pageGridRows, resolvePageGridCursor } from "./page-grid-model";

/** The modes the history is stepped from. */
const kSteppingModes = kEditorModes.filter((mode) => mode !== "text-literal" && mode !== "rule-held");

/** One rule, which the held-rule cases pick up. */
const kRows = pageGridRows([
  {
    ruleId: "r1",
    whenTileCount: 1,
    doTileCount: 1,
    whenAppendable: true,
    doAppendable: true,
    triggerSwitchable: true,
    hasSentence: true,
  },
]);

/** The rule's handle, which is where the keyboard stands while the rule is held. */
const kHandle: PageGridCell = { kind: "handle", ruleId: "r1" };

describe("undo chord", () => {
  test("Z with the command modifier and no shift is the chord", () => {
    assert.equal(isUndoChord({ key: "z", withCommand: true }), true);
    assert.equal(isUndoChord({ key: "z", withCommand: true, withShift: false }), true);
  });

  test("the same key without the command modifier is not", () => {
    assert.equal(isUndoChord({ key: "z", withCommand: false }), false);
  });

  test("the chord held with shift is not", () => {
    assert.equal(isUndoChord({ key: "z", withCommand: true, withShift: true }), false);
    assert.equal(isUndoChord({ key: "Z", withCommand: true }), false);
  });
});

describe("history shortcut", () => {
  test("the chord undoes in every mode that steps the history", () => {
    for (const mode of kSteppingModes) {
      assert.equal(decideHistoryShortcut(mode, { key: "z", withCommand: true }), "undo", mode);
    }
  });

  test("both redo bindings redo in every mode that steps the history", () => {
    for (const mode of kSteppingModes) {
      assert.equal(decideHistoryShortcut(mode, { key: "z", withCommand: true, withShift: true }), "redo", mode);
      assert.equal(decideHistoryShortcut(mode, { key: "Z", withCommand: true }), "redo", mode);
      assert.equal(decideHistoryShortcut(mode, { key: "y", withCommand: true }), "redo", mode);
    }
  });

  test("a text value in progress keeps the chord for the box it is written in", () => {
    assert.equal(decideHistoryShortcut("text-literal", { key: "z", withCommand: true }), undefined);
    assert.equal(decideHistoryShortcut("text-literal", { key: "Z", withCommand: true }), undefined);
    assert.equal(decideHistoryShortcut("text-literal", { key: "y", withCommand: true }), undefined);
  });

  test("a held rule takes no step along the history", () => {
    assert.equal(decideHistoryShortcut("rule-held", { key: "z", withCommand: true }), undefined);
    assert.equal(decideHistoryShortcut("rule-held", { key: "Z", withCommand: true }), undefined);
  });

  test("the keys without the command modifier take no step in any mode", () => {
    for (const mode of kEditorModes) {
      for (const key of ["z", "Z", "y"]) {
        assert.equal(decideHistoryShortcut(mode, { key, withCommand: false }), undefined, `${mode} ${key}`);
      }
    }
  });

  test("every other press with the modifier takes no step", () => {
    for (const mode of kSteppingModes) {
      for (const key of ["a", "c", "x", "v", "Enter", "Escape", "ArrowUp", " "]) {
        assert.equal(decideHistoryShortcut(mode, { key, withCommand: true }), undefined, `${mode} ${key}`);
      }
    }
  });
});

describe("the chord while a rule is held", () => {
  const cursor = resolvePageGridCursor(kRows, kHandle);

  test("gives the held rule back", () => {
    const result = decidePageKey(kRows, cursor, { key: "z", withCommand: true, placement: "on-cell" }, "r1");
    assert.deepEqual(result, { kind: "cancel" });
  });

  test("reads the same as Escape, which is the one reversal it makes", () => {
    const chord = decidePageKey(kRows, cursor, { key: "z", withCommand: true, placement: "on-cell" }, "r1");
    const escapeKey = decidePageKey(kRows, cursor, { key: "Escape", withCommand: false, placement: "on-cell" }, "r1");
    assert.deepEqual(chord, escapeKey);
  });

  test("the redo bindings leave the held rule where it stands", () => {
    for (const key of ["Z", "y"]) {
      const result = decidePageKey(kRows, cursor, { key, withCommand: true, placement: "on-cell" }, "r1");
      assert.deepEqual(result, { kind: "inert" }, key);
    }
  });

  test("the chord with no rule held reaches no page decision", () => {
    const result = decidePageKey(kRows, cursor, { key: "z", withCommand: true, placement: "on-cell" }, undefined);
    assert.deepEqual(result, { kind: "inert" });
  });
});
