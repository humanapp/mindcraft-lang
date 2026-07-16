import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtensionBrowserList, ExtensionCatalogSection } from "./ExtensionBrowserDialog";
import {
  DEFAULT_EXTENSION_THUMBNAIL,
  type ExtensionBrowserEntry,
  type ExtensionCatalogOffer,
  extensionCardMenuItems,
  extensionCardShowsInstall,
  extensionCardShowsRetry,
  filterExtensionEntries,
  runExtensionCardAction,
} from "./extension-browser-model";

function entry(
  overrides: Partial<ExtensionBrowserEntry> & Pick<ExtensionBrowserEntry, "coordinate">
): ExtensionBrowserEntry {
  return {
    name: overrides.coordinate,
    version: "1.0.0",
    installed: false,
    locked: false,
    ...overrides,
  };
}

const lockedLib = entry({
  coordinate: "mindcraft-lang/microbit-v2",
  name: "Micro:bit v2",
  version: "0.2.1",
  installed: true,
  locked: true,
  docsUrl: "https://github.com/mindcraft-lang/microbit-v2",
});
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
  const all = [lockedLib, installedAddon, availableAddon];

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

describe("extensionCardMenuItems and extensionCardShowsInstall", () => {
  test("a locked layer library offers only View Docs and no inline Add", () => {
    assert.deepEqual(extensionCardMenuItems(lockedLib), [{ action: "docs", label: "View Docs" }]);
    assert.equal(extensionCardShowsInstall(lockedLib), false);
  });

  test("an installed add-on offers Uninstall and no inline Add", () => {
    assert.deepEqual(extensionCardMenuItems(installedAddon), [{ action: "uninstall", label: "Uninstall" }]);
    assert.equal(extensionCardShowsInstall(installedAddon), false);
  });

  test("a not-installed add-on offers no menu and shows the inline Add", () => {
    assert.deepEqual(extensionCardMenuItems(availableAddon), []);
    assert.equal(extensionCardShowsInstall(availableAddon), true);
  });

  test("a locked library with no docsUrl offers no menu items", () => {
    assert.deepEqual(extensionCardMenuItems(entry({ coordinate: "x/y", locked: true, installed: true })), []);
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
    runExtensionCardAction(lockedLib, "docs", {
      onInstall: () => {},
      onUninstall: () => {},
      openDocs: (url) => opened.push(url),
    });
    assert.deepEqual(opened, ["https://github.com/mindcraft-lang/microbit-v2"]);
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

  test("a locked library and an installed add-on render a kebab and no inline Add", () => {
    const markup = renderList([lockedLib, installedAddon]);
    assert.match(markup, /Micro:bit v2 actions/);
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
      coordinate: "mindcraft-lang/codal-position-ext",
      name: "Position",
      version: "0.1.0",
      description: "Position sensing.",
      ref: "gh:mindcraft-lang/codal-position-ext@b19b80b029a77303ee575d3ff9b29adbf7021b23",
      installed: false,
    },
    {
      coordinate: "mindcraft-lang/ecosim-teleport-ext",
      name: "Teleport",
      version: "0.2.0",
      description: "Teleport actuator.",
      ref: "gh:mindcraft-lang/ecosim-teleport-ext@89abcdef0123456789abcdef0123456789abcdef",
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
