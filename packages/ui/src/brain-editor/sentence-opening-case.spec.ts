/**
 * Pins that the sentence line renders the projection's display text: the word a
 * sentence opens with reaches the reader in the active locale's opening case,
 * and no other word is touched.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { projectRuleSentence, segmentDisplayText, sentenceText } from "@wendoo/core/brain/language-service";
import type { Localizer } from "@wendoo/core/localization";
import { createLocalizer, defaultPluralRule } from "@wendoo/core/localization";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainPrintRuleSentence, BrainRuleSentence } from "./BrainRuleSentence";
import { makeActuator, makeBrain, makeSensor } from "./test-only-rule-fixtures";

let services: BrainServices;

/**
 * The WHEN-template override that puts a sensor's own word first in the
 * sentence, which is what the positional case rule marks.
 */
const kSlotOpeningWhenContext = { "When I {form} {object}": "{form} {object}" };

/** A locale whose sentences open on the WHEN-side sensor's word, capitalized. */
const slotOpeningLocalizer: Localizer = createLocalizer({
  locale: "zz",
  pluralRule: defaultPluralRule,
  entries: {},
  contexts: { "sentence-when": kSlotOpeningWhenContext },
});

/** The same locale, opening its sentences in lower case, which the opening word must follow. */
const lowercaseOpeningLocalizer: Localizer = createLocalizer({
  locale: "zz",
  pluralRule: defaultPluralRule,
  entries: {},
  contexts: { "sentence-when": kSlotOpeningWhenContext },
  sentenceCase: { capitalizes: false },
});

function configFor(localizer?: Localizer): BrainEditorConfig {
  return { dataTypeIcons: new Map(), dataTypeNames: new Map(), customLiteralTypes: [], localizer };
}

before(() => {
  services = __test__createBrainServices();
});

/** A rule whose sentence opens on its WHEN-side sensor's word under {@link slotOpeningLocalizer}. */
function ruleOpeningOnAWord(sensorId: string) {
  return makeBrain(services, [makeSensor(services, sensorId)], [makeActuator(services, `${sensorId}-act`)]).ruleDef;
}

/** The text content of `markup`, with every tag removed. */
function textOf(markup: string): string {
  return markup.replace(/<[^>]*>/g, "");
}

describe("the sentence line's opening case", () => {
  test("the line reads the projection's display text, not its raw segments", () => {
    const ruleDef = ruleOpeningOnAWord("ui-opening-case-line");
    const localizer = slotOpeningLocalizer;
    const segments = projectRuleSentence(ruleDef, localizer).toArray();
    const raw = segments.map((segment) => segment.text).join("");
    const displayed = sentenceText(projectRuleSentence(ruleDef, localizer), localizer);

    assert.notEqual(displayed, raw, "the fixture's opening word is one the locale cases");
    assert.equal(
      textOf(
        renderToStaticMarkup(
          createElement(
            BrainEditorProvider,
            { config: configFor(localizer) },
            createElement(BrainRuleSentence, { ruleDef, revision: "" })
          )
        )
      ),
      displayed
    );
  });

  test("only the opening word is cased; every other word reads as projected", () => {
    const ruleDef = ruleOpeningOnAWord("ui-opening-case-others");
    const localizer = slotOpeningLocalizer;

    for (const segment of projectRuleSentence(ruleDef, localizer).toArray()) {
      if (segment.kind === "word" && segment.sentenceInitial !== true) {
        assert.equal(segmentDisplayText(segment, localizer), segment.text);
      }
    }
  });

  test("the locale the host supplies decides the opening case", () => {
    const ruleDef = ruleOpeningOnAWord("ui-opening-case-locale");
    const rendered = textOf(
      renderToStaticMarkup(
        createElement(
          BrainEditorProvider,
          { config: configFor(lowercaseOpeningLocalizer) },
          createElement(BrainRuleSentence, { ruleDef, revision: "" })
        )
      )
    );

    assert.equal(
      rendered,
      sentenceText(projectRuleSentence(ruleDef, lowercaseOpeningLocalizer), lowercaseOpeningLocalizer)
    );
  });

  test("the print line reads the same display text", () => {
    const ruleDef = ruleOpeningOnAWord("ui-opening-case-print");
    const localizer = slotOpeningLocalizer;

    assert.equal(
      textOf(
        renderToStaticMarkup(
          createElement(
            BrainEditorProvider,
            { config: configFor(localizer) },
            createElement(BrainPrintRuleSentence, { ruleDef })
          )
        )
      ),
      sentenceText(projectRuleSentence(ruleDef, localizer), localizer)
    );
  });
});
