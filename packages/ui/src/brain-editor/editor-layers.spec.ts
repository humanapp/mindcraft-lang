/**
 * Pins the order of the brain editor's stacking steps: the offering panel is
 * above every step a rule card's own chrome may take, and below the dialog's
 * own chrome.
 *
 * Structural assertions only: each step is read back as the number its Tailwind
 * utility names, never as the utility's text.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { kDialogChromeLayer, kOfferingLayer, kRuleChromeLayer, kRuleContentLayer } from "./editor-layers";

/** The z-index a `z-N` utility sets. Throws when the class is not of that shape. */
function stepOf(layerClass: string): number {
  const match = /^z-(\d+)$/.exec(layerClass);
  if (!match) throw new Error(`not a z-index utility: ${layerClass}`);
  return Number(match[1]);
}

describe("editor layer scale", () => {
  test("steps rise from rule content to the dialog's own chrome", () => {
    const steps = [kRuleContentLayer, kRuleChromeLayer, kOfferingLayer, kDialogChromeLayer].map(stepOf);
    for (let i = 1; i < steps.length; i++) {
      assert.ok(steps[i] > steps[i - 1], `step ${i} is not above step ${i - 1}`);
    }
  });
});
