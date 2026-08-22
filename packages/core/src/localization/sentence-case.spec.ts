/**
 * Pins the sentence-case seam: the default locale's leading-character rule, the
 * per-locale overrides a catalog supplies -- a multi-character opening unit and
 * an orthography that opens in lower case -- the locale's own casing rules
 * reaching the uppercase call, and the one-directional contract that leaves
 * authored capitals alone.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LocaleCatalog, SentenceCaseSpec } from "@wendoo-lang/core/localization";
import {
  applySentenceCase,
  createDefaultLocalizer,
  createLocalizer,
  defaultPluralRule,
  defaultSentenceCaseSpec,
} from "@wendoo-lang/core/localization";

/** A catalog translating nothing, carrying only `locale` and its sentence-case rule. */
function catalogFor(locale: string, sentenceCase?: SentenceCaseSpec): LocaleCatalog {
  return { locale, pluralRule: defaultPluralRule, entries: {}, contexts: {}, sentenceCase };
}

describe("the default sentence-case rule", () => {
  test("it uppercases the leading character and leaves the rest alone", () => {
    assert.equal(createDefaultLocalizer().sentenceCase("otherwise"), "Otherwise");
    assert.equal(createDefaultLocalizer().sentenceCase("a random number"), "A random number");
  });

  test("an empty word comes back empty", () => {
    assert.equal(createDefaultLocalizer().sentenceCase(""), "");
  });

  test("it is the rule a catalog declaring none takes", () => {
    assert.equal(
      createLocalizer(catalogFor("en")).sentenceCase("otherwise"),
      applySentenceCase(defaultSentenceCaseSpec, "en", "otherwise")
    );
  });
});

describe("the one-directional contract", () => {
  test("an already-capitalized word is returned unchanged", () => {
    assert.equal(createDefaultLocalizer().sentenceCase("Reykjavik"), "Reykjavik");
  });

  test("applying the rule twice is the same as applying it once", () => {
    const localizer = createDefaultLocalizer();
    const once = localizer.sentenceCase("meanwhile");
    assert.equal(localizer.sentenceCase(once), once);
  });

  test("nothing after the leading character is touched", () => {
    assert.equal(createDefaultLocalizer().sentenceCase("iPhone by NeXT"), "IPhone by NeXT");
    assert.equal(createDefaultLocalizer().sentenceCase("ALLCAPS"), "ALLCAPS");
  });
});

describe("per-locale overrides", () => {
  test("a locale opening in lower case gets its word back unchanged", () => {
    const localizer = createLocalizer(catalogFor("zz", { capitalizes: false }));
    assert.equal(localizer.sentenceCase("otherwise"), "otherwise");
    assert.equal(localizer.sentenceCase("Reykjavik"), "Reykjavik");
  });

  test("a declared opening unit is uppercased whole", () => {
    const localizer = createLocalizer(catalogFor("nl", { capitalizes: true, initialUnits: ["ij"] }));
    assert.equal(localizer.sentenceCase("ijs"), "IJs");
  });

  test("a word matching no declared unit still takes the leading character", () => {
    const localizer = createLocalizer(catalogFor("nl", { capitalizes: true, initialUnits: ["ij"] }));
    assert.equal(localizer.sentenceCase("anders"), "Anders");
  });

  test("a word already opening on the declared unit is returned unchanged", () => {
    const localizer = createLocalizer(catalogFor("nl", { capitalizes: true, initialUnits: ["ij"] }));
    assert.equal(localizer.sentenceCase("IJs"), "IJs");
  });

  test("the longest declared unit matching the word wins", () => {
    const localizer = createLocalizer(catalogFor("zz", { capitalizes: true, initialUnits: ["i", "ij"] }));
    assert.equal(localizer.sentenceCase("ijs"), "IJs");
  });
});

describe("the locale's own casing rules", () => {
  test("the locale reaches the uppercase mapping, so Turkish dots its capital i", () => {
    assert.equal(createLocalizer(catalogFor("tr")).sentenceCase("istanbul"), "İstanbul");
    assert.equal(createDefaultLocalizer().sentenceCase("istanbul"), "Istanbul");
  });
});
