/**
 * Pins that a fenced brain example draws each rule under the trigger mode the
 * fence declares, and that copying such an example carries the mode with it.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { type BrainServices, RuleTriggerMode } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { BrainDef } from "@wendoo/core/brain/model";
import { createDefaultLocalizer } from "@wendoo/core/localization";
import { deserializeAllRulesFromClipboard, setClipboardFromJson } from "@wendoo/ui/brain-editor/rule-clipboard";
import { triggerModeLabel } from "@wendoo/ui/brain-editor/trigger-mode";
import { renderToStaticMarkup } from "react-dom/server";
import { BrainCodeBlock } from "./BrainCodeBlock";
import { parseBrainFence } from "./brain-fence";
import { DocsSidebarProvider } from "./DocsSidebarContext";

/** The fill, edge and ink classes a capsule of each mode the docs mark is painted with. */
const MARKED_MODE_CHROME: Record<string, string[]> = {
  [RuleTriggerMode.Otherwise]: [
    "bg-brain-capsule-otherwise",
    "border-brain-capsule-otherwise-edge",
    "text-brain-capsule-otherwise-ink",
  ],
  [RuleTriggerMode.Then]: ["bg-brain-capsule-then", "border-brain-capsule-then-edge", "text-brain-capsule-then-ink"],
};

const localizer = createDefaultLocalizer();

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

/** A one-rule fence whose rule carries `trigger`, or none when it is left out. */
function oneRuleFence(trigger?: RuleTriggerMode): string {
  return JSON.stringify([{ version: 1, trigger, when: [], do: [] }]);
}

function renderFence(content: string): string {
  return renderToStaticMarkup(
    <DocsSidebarProvider>
      <BrainCodeBlock content={content} />
    </DocsSidebarProvider>
  );
}

/** The rendered text with every tag removed, which is what the capsules letter. */
function renderedText(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/** The class list of every stacked capsule letter in the rendered markup, in document order. */
function capsuleLetterClasses(html: string): string[] {
  return [...html.matchAll(/<span class="([^"]*\brotate-270\b[^"]*)"/g)].map((match) => match[1]);
}

describe("the capsule a fenced rule draws", () => {
  test("wears the marked mode's chrome when the rule declares one", () => {
    for (const [mode, chrome] of Object.entries(MARKED_MODE_CHROME)) {
      const html = renderFence(oneRuleFence(mode as RuleTriggerMode));
      for (const className of chrome) {
        assert.ok(html.includes(className), `${mode}: ${className} missing from ${html}`);
      }
    }
  });

  test("wears the when chrome when the rule declares no mode", () => {
    const html = renderFence(oneRuleFence());
    for (const chrome of Object.values(MARKED_MODE_CHROME)) {
      for (const className of chrome) {
        assert.ok(!html.includes(className), `${className} painted on a rule declaring no mode`);
      }
    }
  });

  test("spaces every letter of both capsules by the same leading", () => {
    for (const mode of [RuleTriggerMode.When, RuleTriggerMode.Otherwise, RuleTriggerMode.Then]) {
      const letters = capsuleLetterClasses(renderFence(oneRuleFence(mode)));
      const wordLength = triggerModeLabel(mode, localizer).length;
      // The trigger capsule's word, then the DO capsule's.
      assert.equal(letters.length, wordLength + 2);
      assert.equal(new Set(letters).size, 1, `${mode}: uneven leading across ${letters.join(" | ")}`);
      assert.match(letters[0], /\bmx-[\d.]+\b/, `${mode}: no leading class on a capsule letter`);
    }
  });

  test("letters the word the editor's switch stands the same mode at", () => {
    for (const mode of [RuleTriggerMode.When, RuleTriggerMode.Otherwise, RuleTriggerMode.Then]) {
      const text = renderedText(renderFence(oneRuleFence(mode)));
      assert.ok(text.includes(triggerModeLabel(mode, localizer)), `${mode}: ${text}`);
    }
  });
});

describe("the rules a fence copies to the clipboard", () => {
  test("reach the destination brain carrying the mode the fence declared", () => {
    const block = parseBrainFence(oneRuleFence(RuleTriggerMode.Then));
    assert.ok(block !== undefined && block.kind === "rules");
    setClipboardFromJson(block.rules, block.catalogEntries);

    const pasted = deserializeAllRulesFromClipboard(new BrainDef(services), undefined, services);
    assert.equal(pasted.length, 1);
    assert.equal(pasted[0].trigger(), RuleTriggerMode.Then);
  });

  test("reach it as when-mode rules when the fence declared no mode", () => {
    const block = parseBrainFence(oneRuleFence());
    assert.ok(block !== undefined && block.kind === "rules");
    setClipboardFromJson(block.rules, block.catalogEntries);

    const pasted = deserializeAllRulesFromClipboard(new BrainDef(services), undefined, services);
    assert.equal(pasted.length, 1);
    assert.equal(pasted[0].trigger(), RuleTriggerMode.When);
  });
});
