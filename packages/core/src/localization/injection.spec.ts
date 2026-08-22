/**
 * Pins the localizer injection seams: the host-supplied `AppServices` member,
 * the environment option that threads it, the edit-time access path off
 * `IBrainDef`, and the removal of the retired translator subpath.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { brain, coreModule, createWendooEnvironment } from "@wendoo-lang/core";
import { BrainDef } from "@wendoo-lang/core/brain/model";
import type { Localizer } from "@wendoo-lang/core/localization";
import { createDefaultLocalizer, createLocalizer, defaultPluralRule } from "@wendoo-lang/core/localization";

/** A localizer whose locale identifies it, for tracing which instance was threaded. */
function markerLocalizer(): Localizer {
  return createLocalizer({ locale: "xx", pluralRule: defaultPluralRule, entries: {}, contexts: {} });
}

describe("app services", () => {
  test("a localizer is supplied by default", () => {
    assert.equal(brain.createAppServices().localizer.locale(), "en");
  });

  test("a host-supplied localizer is carried through", () => {
    assert.equal(brain.createAppServices(undefined, undefined, markerLocalizer()).localizer.locale(), "xx");
  });

  test("the environment threads its localizer option into app services", () => {
    const environment = createWendooEnvironment({ modules: [coreModule()], localizer: markerLocalizer() });
    assert.equal(environment.appServices.localizer.locale(), "xx");
  });

  test("the environment defaults its localizer when the option is omitted", () => {
    const environment = createWendooEnvironment({ modules: [coreModule()] });
    assert.equal(environment.appServices.localizer.locale(), "en");
  });
});

describe("edit-time access path", () => {
  test("a brain definition reaches the injected localizer", () => {
    const services = brain.createBrainServices(brain.createAppServices(undefined, undefined, markerLocalizer()));
    const brainDef = BrainDef.emptyBrainDef(services);
    assert.equal(brainDef.servicesLocalizer().locale(), "xx");
  });

  test("the localizer a brain definition exposes is the one the host injected", () => {
    const localizer = createDefaultLocalizer();
    const services = brain.createBrainServices(brain.createAppServices(undefined, undefined, localizer));
    assert.equal(BrainDef.emptyBrainDef(services).servicesLocalizer(), localizer);
  });
});

describe("retired translator surface", () => {
  test("the i18n subpath no longer resolves", async () => {
    const retiredSubpath = ["@wendoo-lang", "core", "i18n"].join("/");
    await assert.rejects(async () => {
      await import(retiredSubpath);
    });
  });
});
