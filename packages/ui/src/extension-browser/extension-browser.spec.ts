import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtensionBrowserList, ExtensionCatalogSection } from "./ExtensionBrowserDialog";
import {
  DEFAULT_EXTENSION_THUMBNAIL,
  type ExtensionBrowserEntry,
  type ExtensionCatalogOffer,
  extensionBrowserSections,
  extensionCardMenuItems,
  extensionCardShowsInstall,
  extensionCardShowsRetry,
  filterExtensionEntries,
  filterExtensionOffers,
  runExtensionCardAction,
} from "./extension-browser-model";

function entry(
  overrides: Partial<ExtensionBrowserEntry> & Pick<ExtensionBrowserEntry, "coordinate">
): ExtensionBrowserEntry {
  return {
    name: overrides.coordinate,
    version: "1.0.0",
    installed: false,
    ...overrides,
  };
}

const installedAddon = entry({
  coordinate: "mindcraft-lang/microbit-position",
  name: "Position",
  version: "1.3.0",
  installed: true,
  thumbnailUrl: "https://example.test/pos.png",
  docsUrl: "https://github.com/mindcraft-lang/microbit-position",
});
const availableAddon = entry({
  coordinate: "mindcraft-lang/shared-math",
  name: "Shared Math",
  version: "2.0.0",
  installed: false,
  docsUrl: "https://github.com/mindcraft-lang/shared-math",
});
const updatableDependency = entry({
  coordinate: "example-org/position-ext",
  name: "Position",
  version: "0.1.0",
  installed: true,
  updatable: true,
});
const brokenDependency = entry({
  coordinate: "example-org/ghost-ext",
  name: "example-org/ghost-ext",
  version: "0.0.0",
  installed: false,
  broken: { code: "EXTENSION_FETCH_UNREACHABLE", message: "The source is unreachable: refused" },
});
const forkedDependency = entry({
  coordinate: "fork-org/position-ext",
  name: "Position",
  version: "0.1.0",
  installed: true,
  updatable: true,
  identityMismatch: { declaredIdentity: "upstream-org/position-ext" },
});

function renderList(entries: readonly ExtensionBrowserEntry[]): string {
  return renderToStaticMarkup(
    createElement(ExtensionBrowserList, {
      entries,
      onInstall: () => {},
      onUninstall: () => {},
      onCheckUpdate: () => {},
      onRetry: () => {},
    })
  );
}

describe("filterExtensionEntries", () => {
  const all = [installedAddon, availableAddon];

  test("a blank query returns every entry", () => {
    assert.deepEqual(
      filterExtensionEntries(all, "").map((e) => e.coordinate),
      all.map((e) => e.coordinate)
    );
    assert.deepEqual(filterExtensionEntries(all, "   ").length, all.length);
  });

  test("filters case-insensitively by name", () => {
    const result = filterExtensionEntries(all, "position");
    assert.deepEqual(
      result.map((e) => e.coordinate),
      ["mindcraft-lang/microbit-position"]
    );
  });

  test("filters by coordinate", () => {
    const result = filterExtensionEntries(all, "shared-math");
    assert.deepEqual(
      result.map((e) => e.coordinate),
      ["mindcraft-lang/shared-math"]
    );
  });
});

describe("filterExtensionOffers", () => {
  const cutebot: ExtensionCatalogOffer = {
    coordinate: "elecfreaks/cutebot",
    name: "Cutebot",
    version: "1.0.0",
    description: "Drive the Cutebot chassis.",
    ref: "embedded:elecfreaks/cutebot",
    installed: false,
  };
  const yahboom: ExtensionCatalogOffer = {
    coordinate: "yahboom/gamepad",
    name: "Yahboom Gamepad",
    version: "1.0.0",
    description: "Read the GHBit gamepad buttons.",
    ref: "embedded:yahboom/gamepad",
    installed: false,
  };
  const offers = [cutebot, yahboom];

  test("a blank query returns every offer", () => {
    assert.deepEqual(
      filterExtensionOffers(offers, "").map((o) => o.coordinate),
      offers.map((o) => o.coordinate)
    );
    assert.equal(filterExtensionOffers(offers, "   ").length, offers.length);
  });

  test("filters case-insensitively by name", () => {
    assert.deepEqual(
      filterExtensionOffers(offers, "CUTE").map((o) => o.coordinate),
      ["elecfreaks/cutebot"]
    );
  });

  test("filters by coordinate", () => {
    assert.deepEqual(
      filterExtensionOffers(offers, "yahboom/gamepad").map((o) => o.coordinate),
      ["yahboom/gamepad"]
    );
  });

  test("filters by description substring", () => {
    assert.deepEqual(
      filterExtensionOffers(offers, "ghbit").map((o) => o.coordinate),
      ["yahboom/gamepad"]
    );
  });

  test("a query matching nothing yields no offers", () => {
    assert.deepEqual(filterExtensionOffers(offers, "zzz"), []);
  });
});

describe("extensionBrowserSections", () => {
  test("a fresh project (no entries, offers present, no search) shows offers and no no-match message", () => {
    const sections = extensionBrowserSections(2, 0, false);
    assert.equal(sections.showNoMatch, false);
    assert.equal(sections.showOffers, true);
    assert.equal(sections.showEntries, false);
  });

  test("no search with entries present shows the list and no no-match message", () => {
    const sections = extensionBrowserSections(0, 3, false);
    assert.equal(sections.showNoMatch, false);
    assert.equal(sections.showEntries, true);
    assert.equal(sections.showOffers, false);
  });

  test("a search matching only an offer shows offers and no no-match message", () => {
    const sections = extensionBrowserSections(1, 0, true);
    assert.equal(sections.showNoMatch, false);
    assert.equal(sections.showOffers, true);
    assert.equal(sections.showEntries, false);
  });

  test("a search matching only an entry shows the list and no no-match message", () => {
    const sections = extensionBrowserSections(0, 1, true);
    assert.equal(sections.showNoMatch, false);
    assert.equal(sections.showEntries, true);
  });

  test("a search matching nothing anywhere shows the no-match message", () => {
    const sections = extensionBrowserSections(0, 0, true);
    assert.equal(sections.showNoMatch, true);
    assert.equal(sections.showOffers, false);
    assert.equal(sections.showEntries, false);
  });

  test("an empty browser with no active search shows neither content nor the no-match message", () => {
    const sections = extensionBrowserSections(0, 0, false);
    assert.equal(sections.showNoMatch, false);
    assert.equal(sections.showOffers, false);
    assert.equal(sections.showEntries, false);
  });
});

describe("extensionCardMenuItems and extensionCardShowsInstall", () => {
  test("an installed add-on offers Uninstall and no inline Add", () => {
    assert.deepEqual(extensionCardMenuItems(installedAddon), [{ action: "uninstall", label: "Uninstall" }]);
    assert.equal(extensionCardShowsInstall(installedAddon), false);
  });

  test("a not-installed add-on offers no menu and shows the inline Add", () => {
    assert.deepEqual(extensionCardMenuItems(availableAddon), []);
    assert.equal(extensionCardShowsInstall(availableAddon), true);
  });

  test("an updatable dependency offers Check for Update ahead of Uninstall", () => {
    assert.deepEqual(extensionCardMenuItems(updatableDependency), [
      { action: "check-update", label: "Check for Update" },
      { action: "uninstall", label: "Uninstall" },
    ]);
  });

  test("a broken dependency offers Uninstall and shows Retry instead of Add", () => {
    assert.deepEqual(extensionCardMenuItems(brokenDependency), [{ action: "uninstall", label: "Uninstall" }]);
    assert.equal(extensionCardShowsInstall(brokenDependency), false);
    assert.equal(extensionCardShowsRetry(brokenDependency), true);
    assert.equal(extensionCardShowsRetry(availableAddon), false);
  });
});

describe("runExtensionCardAction", () => {
  test("install and uninstall fire their callbacks with the coordinate", () => {
    const installed: string[] = [];
    const uninstalled: string[] = [];
    const callbacks = { onInstall: (c: string) => installed.push(c), onUninstall: (c: string) => uninstalled.push(c) };

    runExtensionCardAction(availableAddon, "install", callbacks);
    runExtensionCardAction(installedAddon, "uninstall", callbacks);

    assert.deepEqual(installed, ["mindcraft-lang/shared-math"]);
    assert.deepEqual(uninstalled, ["mindcraft-lang/microbit-position"]);
  });

  test("docs opens the entry's docsUrl", () => {
    const opened: string[] = [];
    runExtensionCardAction(installedAddon, "docs", {
      onInstall: () => {},
      onUninstall: () => {},
      openDocs: (url) => opened.push(url),
    });
    assert.deepEqual(opened, ["https://github.com/mindcraft-lang/microbit-position"]);
  });

  test("docs on an entry without a docsUrl does nothing", () => {
    let called = false;
    runExtensionCardAction(entry({ coordinate: "x/y" }), "docs", {
      onInstall: () => {},
      onUninstall: () => {},
      openDocs: () => {
        called = true;
      },
    });
    assert.equal(called, false);
  });

  test("check-update and retry fire their callbacks with the coordinate, and do nothing when absent", () => {
    const checked: string[] = [];
    const retried: string[] = [];
    const callbacks = {
      onInstall: () => {},
      onUninstall: () => {},
      onCheckUpdate: (c: string) => checked.push(c),
      onRetry: (c: string) => retried.push(c),
    };

    runExtensionCardAction(updatableDependency, "check-update", callbacks);
    runExtensionCardAction(brokenDependency, "retry", callbacks);
    assert.deepEqual(checked, ["example-org/position-ext"]);
    assert.deepEqual(retried, ["example-org/ghost-ext"]);

    // Absent optional callbacks make the actions no-ops.
    runExtensionCardAction(updatableDependency, "check-update", { onInstall: () => {}, onUninstall: () => {} });
    runExtensionCardAction(brokenDependency, "retry", { onInstall: () => {}, onUninstall: () => {} });
  });
});

describe("ExtensionBrowserList rendering", () => {
  test("renders name, version, and a thumbnail per entry", () => {
    const markup = renderList([installedAddon]);
    assert.match(markup, /Position/);
    assert.match(markup, /v1\.3\.0/);
    assert.ok(markup.includes("https://example.test/pos.png"), "uses the entry thumbnail when present");
  });

  test("falls back to the bundled default thumbnail when the entry has none", () => {
    const markup = renderList([availableAddon]);
    assert.ok(markup.includes(DEFAULT_EXTENSION_THUMBNAIL), "renders the default thumbnail data URI");
  });

  test("shows an Installed indicator only for installed entries", () => {
    assert.match(renderList([installedAddon]), /Installed/);
    assert.doesNotMatch(renderList([availableAddon]), /Installed/);
  });

  test("a not-installed add-on renders an inline Add and no kebab", () => {
    const markup = renderList([availableAddon]);
    assert.match(markup, />Add</);
    assert.doesNotMatch(markup, /Shared Math actions/);
  });

  test("installed add-ons render a kebab and no inline Add", () => {
    const markup = renderList([installedAddon, updatableDependency]);
    assert.match(markup, /Position actions/);
    assert.doesNotMatch(markup, />Add</);
  });

  test("a broken dependency renders its failure code and reason with a Retry affordance and no Add", () => {
    const markup = renderList([brokenDependency]);
    assert.match(markup, /EXTENSION_FETCH_UNREACHABLE/);
    assert.match(markup, /The source is unreachable: refused/);
    assert.match(markup, />Retry</);
    assert.doesNotMatch(markup, />Add</);
  });

  test("an identity mismatch renders the declared identity on the card", () => {
    const markup = renderList([forkedDependency]);
    assert.match(markup, /Publishes as upstream-org\/position-ext/);
  });
});

describe("ExtensionCatalogSection rendering", () => {
  const offers: ExtensionCatalogOffer[] = [
    {
      coordinate: "mindcraft-lang/lib-codal-position",
      name: "Position",
      version: "0.1.0",
      description: "Position sensing.",
      ref: "gh:mindcraft-lang/lib-codal-position@b19b80b029a77303ee575d3ff9b29adbf7021b23",
      installed: false,
    },
    {
      coordinate: "mindcraft-lang/lib-ecosim-teleport",
      name: "Teleport",
      version: "0.2.0",
      description: "Teleport actuator.",
      ref: "gh:mindcraft-lang/lib-ecosim-teleport@89abcdef0123456789abcdef0123456789abcdef",
      installed: true,
    },
  ];

  test("renders each offer's display metadata with Add only on not-installed offers", () => {
    const markup = renderToStaticMarkup(
      createElement(ExtensionCatalogSection, { offers, onInstallReference: () => {} })
    );
    assert.match(markup, /Catalog/);
    assert.match(markup, /Position sensing\./);
    assert.match(markup, /Teleport actuator\./);
    assert.match(markup, /v0\.1\.0/);
    assert.match(markup, /Installed/);
    assert.equal(markup.split(">Add<").length - 1, 1, "one Add affordance for the one not-installed offer");
  });
});

describe("ExtensionReferenceInstallRow", () => {
  test("renders the add-from-GitHub input inviting a pasted GitHub URL", async () => {
    const { ExtensionReferenceInstallRow } = await import("./ExtensionBrowserDialog");
    const markup = renderToStaticMarkup(createElement(ExtensionReferenceInstallRow, { onInstallReference: () => {} }));
    assert.match(markup, /aria-label="Add from GitHub"/);
    assert.match(markup, /Paste GitHub URL/);
    // The Add affordance starts disabled until a reference is entered.
    assert.match(markup, /disabled/);
  });
});
