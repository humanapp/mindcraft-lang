/**
 * Pins the bounded message-template syntax: named substitution, plural
 * selection under a locale's rules, select branching, backslash escapes, and
 * the codes reported for malformed templates. Branch bodies use machine
 * markers, never display prose.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PluralRuleSpec } from "@wendoo-lang/core/localization";
import {
  defaultPluralRule,
  parseTemplate,
  pseudoLocalize,
  renderTemplate,
  selectPluralCategory,
  TemplateDiagCode,
} from "@wendoo-lang/core/localization";

/**
 * CLDR plural rule for Russian: four categories keyed off the last one and two
 * integer digits. Exercises mod reduction, excluded ranges, and alternatives.
 */
const russianPluralRule: PluralRuleSpec = [
  {
    category: "one",
    any: [
      [
        { operand: "v", ranges: [{ lo: 0, hi: 0 }] },
        { operand: "i", mod: 10, ranges: [{ lo: 1, hi: 1 }] },
        { operand: "i", mod: 100, not: true, ranges: [{ lo: 11, hi: 11 }] },
      ],
    ],
  },
  {
    category: "few",
    any: [
      [
        { operand: "v", ranges: [{ lo: 0, hi: 0 }] },
        { operand: "i", mod: 10, ranges: [{ lo: 2, hi: 4 }] },
        { operand: "i", mod: 100, not: true, ranges: [{ lo: 12, hi: 14 }] },
      ],
    ],
  },
  {
    category: "many",
    any: [
      [
        { operand: "v", ranges: [{ lo: 0, hi: 0 }] },
        { operand: "i", mod: 10, ranges: [{ lo: 0, hi: 0 }] },
      ],
      [
        { operand: "v", ranges: [{ lo: 0, hi: 0 }] },
        { operand: "i", mod: 10, ranges: [{ lo: 5, hi: 9 }] },
      ],
      [
        { operand: "v", ranges: [{ lo: 0, hi: 0 }] },
        { operand: "i", mod: 100, ranges: [{ lo: 11, hi: 14 }] },
      ],
    ],
  },
];

const kCountTemplate = "{n, plural, one {ONE:#} few {FEW:#} many {MANY:#} other {OTHER:#}}";

function issueCodes(template: string): string[] {
  return parseTemplate(template).issues.map((issue) => issue.code);
}

describe("template substitution", () => {
  test("named parameters substitute in template order", () => {
    const rendered = renderTemplate(
      "{tile} needs a {type} result",
      { tile: "sensor.see", type: "Number" },
      [] as const
    );
    assert.equal(rendered, "sensor.see needs a Number result");
  });

  test("a translation may reorder the same named parameters", () => {
    const params = { tile: "sensor.see", type: "Number" };
    const forward = renderTemplate("{tile}/{type}", params, [] as const);
    const reversed = renderTemplate("{type}/{tile}", params, [] as const);
    assert.equal(forward, "sensor.see/Number");
    assert.equal(reversed, "Number/sensor.see");
  });

  test("an unsupplied parameter renders as its own placeholder", () => {
    assert.equal(renderTemplate("{a}-{b}", { a: 1 }, [] as const), "1-{b}");
  });

  test("a backslash escapes a brace to its literal self", () => {
    assert.equal(renderTemplate("a \\{b\\} c", undefined, [] as const), "a {b} c");
  });

  test("icon tokens pass through untouched", () => {
    assert.equal(renderTemplate("$(warning) {n} left", { n: 3 }, [] as const), "$(warning) 3 left");
  });

  test("select branches on the parameter value and falls back to other", () => {
    const template = "{side, select, when {WHEN} do {DO} other {OTHER}}";
    assert.equal(renderTemplate(template, { side: "do" }, [] as const), "DO");
    assert.equal(renderTemplate(template, { side: "elsewhere" }, [] as const), "OTHER");
  });
});

describe("plural selection", () => {
  test("the default locale distinguishes one from other", () => {
    assert.equal(renderTemplate(kCountTemplate, { n: 1 }, defaultPluralRule), "ONE:1");
    assert.equal(renderTemplate(kCountTemplate, { n: 0 }, defaultPluralRule), "OTHER:0");
    assert.equal(renderTemplate(kCountTemplate, { n: 21 }, defaultPluralRule), "OTHER:21");
  });

  test("a four-category locale selects by the last one and two digits", () => {
    const render = (n: number) => renderTemplate(kCountTemplate, { n }, russianPluralRule);
    assert.equal(render(1), "ONE:1");
    assert.equal(render(2), "FEW:2");
    assert.equal(render(5), "MANY:5");
    assert.equal(render(11), "MANY:11");
    assert.equal(render(21), "ONE:21");
    assert.equal(render(22), "FEW:22");
    assert.equal(render(25), "MANY:25");
  });

  test("a fractional count takes other under the default rule", () => {
    assert.equal(selectPluralCategory(defaultPluralRule, 1.5), "other");
    assert.equal(selectPluralCategory(defaultPluralRule, 1), "one");
  });

  test("a non-numeric plural parameter takes the other branch", () => {
    assert.equal(renderTemplate(kCountTemplate, { n: "many" }, defaultPluralRule), "OTHER:many");
  });

  test("the pseudo-locale renders every branch and keeps the count", () => {
    const rendered = renderTemplate(pseudoLocalize(kCountTemplate), { n: 1 }, defaultPluralRule);
    assert.ok(rendered.includes("1"), "count substitutes into the pseudo-localized branch");
    assert.ok(rendered.startsWith("[!"), "pseudo-localized output carries its opening marker");
    assert.ok(rendered.endsWith("!]"), "pseudo-localized output carries its closing marker");
  });
});

describe("malformed templates", () => {
  test("each structural fault reports its code", () => {
    assert.deepEqual(issueCodes("{}"), [TemplateDiagCode.EmptyPlaceholderName]);
    assert.deepEqual(issueCodes("{n"), [TemplateDiagCode.UnclosedPlaceholder]);
    assert.deepEqual(issueCodes("{n, date, short}"), [TemplateDiagCode.UnknownFormat]);
    assert.deepEqual(issueCodes("{n, plural, one {x}}"), [TemplateDiagCode.MissingOtherBranch]);
  });

  test("a well-formed template reports no faults", () => {
    assert.deepEqual(issueCodes(kCountTemplate), []);
    assert.deepEqual(issueCodes("plain {a} text"), []);
  });

  test("a malformed construct still renders, verbatim", () => {
    assert.equal(
      renderTemplate("before {n, date, short} after", { n: 1 }, defaultPluralRule),
      "before {n, date, short} after"
    );
  });
});
