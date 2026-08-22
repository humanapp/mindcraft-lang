/**
 * Pins the Localizer contract: per-entry fallback to the source string, the
 * open context namespace, list glue, display collation, and search folding.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LocaleCatalog } from "@wendoo/core/localization";
import { createDefaultLocalizer, createLocalizer, defaultPluralRule } from "@wendoo/core/localization";

/** A partially translated catalog: one plain key and two contextualized keys. */
const partialCatalog: LocaleCatalog = {
  locale: "xx",
  pluralRule: defaultPluralRule,
  entries: {
    "Translated {value}": "XX-{value}",
  },
  contexts: {
    "tile-label": { Stop: "XX-STOP-LABEL" },
    "sentence-connective": { Stop: "XX-STOP-SENTENCE" },
  },
};

describe("catalog lookup", () => {
  test("a translated entry renders from the catalog template", () => {
    const localizer = createLocalizer(partialCatalog);
    assert.equal(localizer.tr("Translated {value}", { value: 7 }), "XX-7");
  });

  test("an untranslated entry falls back to the source string, per entry", () => {
    const localizer = createLocalizer(partialCatalog);
    assert.equal(localizer.tr("Untranslated {value}", { value: 7 }), "Untranslated 7");
    assert.equal(localizer.tr("Translated {value}", { value: 7 }), "XX-7");
  });

  test("the locale is reported from the catalog", () => {
    assert.equal(createLocalizer(partialCatalog).locale(), "xx");
    assert.equal(createDefaultLocalizer().locale(), "en");
  });

  test("the default localizer renders every source string from its own text", () => {
    const localizer = createDefaultLocalizer();
    assert.equal(localizer.tr("Rule {index}", { index: 2 }), "Rule 2");
    assert.equal(localizer.tr("Stop", undefined, "tile-label"), "Stop");
  });
});

describe("context namespace", () => {
  test("the same source resolves differently under different contexts", () => {
    const localizer = createLocalizer(partialCatalog);
    assert.equal(localizer.tr("Stop", undefined, "tile-label"), "XX-STOP-LABEL");
    assert.equal(localizer.tr("Stop", undefined, "sentence-connective"), "XX-STOP-SENTENCE");
  });

  test("a context core knows nothing about resolves like any other", () => {
    const localizer = createLocalizer({
      locale: "xx",
      pluralRule: defaultPluralRule,
      entries: {},
      contexts: { "a-context-invented-by-a-future-consumer": { Anything: "XX-ANYTHING" } },
    });
    assert.equal(localizer.tr("Anything", undefined, "a-context-invented-by-a-future-consumer"), "XX-ANYTHING");
  });

  test("a source missing from its context falls back to the source string", () => {
    const localizer = createLocalizer(partialCatalog);
    assert.equal(localizer.tr("Start", undefined, "tile-label"), "Start");
    assert.equal(localizer.tr("Anything", undefined, "no-such-context"), "Anything");
  });
});

describe("list glue", () => {
  test("joining follows the item count", () => {
    const localizer = createDefaultLocalizer();
    assert.equal(localizer.list([], "or"), "");
    assert.equal(localizer.list(["Number"], "or"), "Number");
    assert.equal(localizer.list(["Number", "String"], "or"), "Number or String");
    assert.equal(localizer.list(["Number", "String", "Boolean"], "or"), "Number, String, or Boolean");
    assert.equal(localizer.list(["Number", "String", "Boolean"], "and"), "Number, String, and Boolean");
  });

  test("glue templates come from the catalog under the list context", () => {
    const localizer = createLocalizer({
      locale: "xx",
      pluralRule: defaultPluralRule,
      entries: {},
      contexts: { list: { "{a} or {b}": "{a} SLASH {b}" } },
    });
    assert.equal(localizer.list(["Number", "String"], "or"), "Number SLASH String");
  });
});

describe("display collation and search folding", () => {
  test("folding removes case and diacritics", () => {
    const localizer = createDefaultLocalizer();
    assert.equal(localizer.foldForSearch("Uber"), "uber");
    assert.equal(localizer.foldForSearch("Über"), "uber");
    assert.equal(localizer.foldForSearch("über"), "uber");
    assert.equal(localizer.foldForSearch("straße"), "strasse");
  });

  test("compare orders accented forms next to their base letters", () => {
    const localizer = createDefaultLocalizer();
    assert.ok(localizer.compare("apple", "äpple") < 0, "apple sorts before aepple");
    assert.ok(localizer.compare("äpple", "banana") < 0, "aepple sorts before banana");
    assert.equal(localizer.compare("apple", "apple"), 0);
  });

  test("compare is antisymmetric on distinct inputs", () => {
    const localizer = createDefaultLocalizer();
    assert.ok(localizer.compare("a", "b") < 0);
    assert.ok(localizer.compare("b", "a") > 0);
  });
});
