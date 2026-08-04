/**
 * Pins the one derived value naming the editor's keyboard context: which mode
 * each combination of arming, box, open text value and held rule stands in.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deriveEditorMode, kEditorModes } from "./editor-mode";

describe("editor mode", () => {
  test("nothing armed and no rule held is the page's selection", () => {
    assert.equal(deriveEditorMode({}), "grid-selection");
    assert.equal(deriveEditorMode({ ruleIsHeld: false }), "grid-selection");
  });

  test("a rule picked up is its own mode", () => {
    assert.equal(deriveEditorMode({ ruleIsHeld: true }), "rule-held");
  });

  test("a tray arming with its box hidden is tray-armed", () => {
    const mode = deriveEditorMode({
      arming: { entry: "tray", boxIsShown: false, textLiteralIsOpen: false },
      ruleIsHeld: true,
    });
    assert.equal(mode, "tray-armed");
  });

  test("a hidden box leaves the tray's own keys standing whatever it holds", () => {
    const mode = deriveEditorMode({ arming: { entry: "tray", boxIsShown: false, textLiteralIsOpen: true } });
    assert.equal(mode, "tray-armed");
  });

  test("a tray arming with its box shown is tray-filtering", () => {
    const mode = deriveEditorMode({ arming: { entry: "tray", boxIsShown: true, textLiteralIsOpen: false } });
    assert.equal(mode, "tray-filtering");
  });

  test("a sentence arming composes", () => {
    const mode = deriveEditorMode({ arming: { entry: "sentence", boxIsShown: true, textLiteralIsOpen: false } });
    assert.equal(mode, "composing");
  });

  test("an open text value takes the shown box from either entry", () => {
    for (const entry of ["tray", "sentence"] as const) {
      const mode = deriveEditorMode({ arming: { entry, boxIsShown: true, textLiteralIsOpen: true } });
      assert.equal(mode, "text-literal");
    }
  });

  test("an arming decides the mode whether or not a rule is held", () => {
    const arming = { entry: "sentence", boxIsShown: true, textLiteralIsOpen: false } as const;
    assert.equal(deriveEditorMode({ arming, ruleIsHeld: true }), deriveEditorMode({ arming, ruleIsHeld: false }));
  });

  test("every mode the type names is reachable and listed once", () => {
    const reached = new Set([
      deriveEditorMode({}),
      deriveEditorMode({ ruleIsHeld: true }),
      deriveEditorMode({ arming: { entry: "tray", boxIsShown: false, textLiteralIsOpen: false } }),
      deriveEditorMode({ arming: { entry: "tray", boxIsShown: true, textLiteralIsOpen: false } }),
      deriveEditorMode({ arming: { entry: "sentence", boxIsShown: true, textLiteralIsOpen: false } }),
      deriveEditorMode({ arming: { entry: "sentence", boxIsShown: true, textLiteralIsOpen: true } }),
    ]);
    assert.deepEqual([...reached].sort(), [...kEditorModes].sort());
    assert.equal(new Set(kEditorModes).size, kEditorModes.length);
  });
});
