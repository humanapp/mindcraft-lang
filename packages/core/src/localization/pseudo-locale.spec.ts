/**
 * Pins the qps pseudo-locale generator: literal text is accented, bracketed,
 * and length-expanded, while placeholders, plural and select syntax, branch
 * keys, and `$(...)` icon tokens survive unaltered.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createLocalizer, defaultPluralRule, parseTemplate, pseudoLocalize } from "@wendoo/core/localization";

/** Render a pseudo-localized source through a qps catalog built from it. */
function renderPseudo(source: string, params?: Record<string, string | number>): string {
  const localizer = createLocalizer({
    locale: "qps",
    pluralRule: defaultPluralRule,
    entries: { [source]: pseudoLocalize(source) },
    contexts: {},
  });
  return localizer.tr(source, params);
}

describe("pseudo-locale markers", () => {
  test("output is bracketed and longer than its source", () => {
    const pseudo = pseudoLocalize("Search tiles");
    assert.ok(pseudo.startsWith("[!"));
    assert.ok(pseudo.endsWith("!]"));
    assert.ok(pseudo.length > "Search tiles".length);
  });

  test("ascii letters are replaced, so an unlocalized string is visibly plain", () => {
    const pseudo = pseudoLocalize("Save");
    assert.ok(!pseudo.includes("Save"));
  });

  test("non-letter characters survive", () => {
    assert.ok(pseudoLocalize("3 of 4").includes("3"));
    assert.ok(pseudoLocalize("3 of 4").includes("4"));
  });
});

describe("token preservation", () => {
  test("named placeholders keep their names", () => {
    assert.ok(pseudoLocalize("Tile {tile} needs {type}").includes("{tile}"));
    assert.ok(pseudoLocalize("Tile {tile} needs {type}").includes("{type}"));
  });

  test("icon tokens survive verbatim", () => {
    assert.ok(pseudoLocalize("$(warning) Build failed").includes("$(warning)"));
  });

  test("plural syntax, branch keys, and the count marker survive", () => {
    const pseudo = pseudoLocalize("{count, plural, one {# error} other {# errors}}");
    assert.ok(pseudo.includes("{count, plural,"));
    assert.ok(pseudo.includes(" one {"));
    assert.ok(pseudo.includes(" other {"));
    assert.ok(pseudo.includes("#"));
    assert.deepEqual(parseTemplate(pseudo).issues, []);
  });

  test("select syntax and branch keys survive", () => {
    const pseudo = pseudoLocalize("{side, select, when {in a WHEN} do {in a DO} other {somewhere}}");
    assert.ok(pseudo.includes("{side, select,"));
    assert.ok(pseudo.includes(" when {"));
    assert.ok(pseudo.includes(" do {"));
    assert.deepEqual(parseTemplate(pseudo).issues, []);
  });

  test("a pseudo-localized template still interpolates its parameters", () => {
    assert.ok(renderPseudo("Tile {tile} is broken", { tile: "sensor.see" }).includes("sensor.see"));
  });

  test("a pseudo-localized plural still selects and substitutes the count", () => {
    assert.ok(renderPseudo("{count, plural, one {# error} other {# errors}}", { count: 4 }).includes("4"));
  });

  test("escaped braces survive the round trip", () => {
    const source = "a \\{b\\} c";
    const localizer = createLocalizer({
      locale: "qps",
      pluralRule: defaultPluralRule,
      entries: { [source]: pseudoLocalize(source) },
      contexts: {},
    });
    assert.ok(localizer.tr(source).includes("{"));
    assert.ok(localizer.tr(source).includes("}"));
  });
});
