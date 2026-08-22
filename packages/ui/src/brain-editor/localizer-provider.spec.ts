/**
 * Pins the editor's localizer seam: `useTr` renders through the localizer the
 * host config carries, falls back to the default localizer when the config
 * omits one, and re-renders against a swapped localizer. Assertions are on
 * catalog-driven markers, never on product wording.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LocaleCatalog } from "@wendoo-lang/core/localization";
import { createDefaultLocalizer, createLocalizer, defaultPluralRule } from "@wendoo-lang/core/localization";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type BrainEditorConfig, BrainEditorProvider, useTr } from "./BrainEditorContext";

/** Source string this spec renders; its catalog entries carry machine markers. */
const kSource = "Rule {index}";

function catalogFor(locale: string, translation: string): LocaleCatalog {
  return { locale, pluralRule: defaultPluralRule, entries: { [kSource]: translation }, contexts: {} };
}

function baseConfig(): BrainEditorConfig {
  return { dataTypeIcons: new Map(), dataTypeNames: new Map(), customLiteralTypes: [] };
}

/** Renders the source string through the provider's localizer. */
function Probe() {
  const tr = useTr();
  return createElement("span", null, tr(kSource, { index: 2 }));
}

function render(config: BrainEditorConfig): string {
  return renderToStaticMarkup(createElement(BrainEditorProvider, { config }, createElement(Probe)));
}

describe("editor localizer seam", () => {
  test("tr renders through the localizer the config carries", () => {
    const config: BrainEditorConfig = { ...baseConfig(), localizer: createLocalizer(catalogFor("xx", "XX-{index}")) };
    assert.ok(render(config).includes("XX-2"));
  });

  test("a config without a localizer renders the source string", () => {
    assert.ok(render(baseConfig()).includes("Rule 2"));
  });

  test("an explicit default localizer renders the source string", () => {
    assert.ok(render({ ...baseConfig(), localizer: createDefaultLocalizer() }).includes("Rule 2"));
  });

  test("swapping the config localizer renders the other locale", () => {
    const first = render({ ...baseConfig(), localizer: createLocalizer(catalogFor("xx", "XX-{index}")) });
    const second = render({ ...baseConfig(), localizer: createLocalizer(catalogFor("yy", "YY-{index}")) });
    assert.ok(first.includes("XX-2"));
    assert.ok(second.includes("YY-2"));
  });
});
