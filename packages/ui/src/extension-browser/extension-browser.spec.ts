import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtensionBrowserList } from "./ExtensionBrowserDialog";
import {
  DEFAULT_EXTENSION_THUMBNAIL,
  type ExtensionBrowserEntry,
  type ExtensionCatalogOffer,
  extensionBrowserItemCoordinate,
  extensionBrowserShowsCheckAllUpdates,
  extensionBrowserShowsNoMatch,
  extensionCardMenuItems,
  extensionCardShowsInstall,
  extensionCardShowsRetry,
  filterExtensionEntries,
  filterExtensionOffers,
  orderExtensionBrowserItems,
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
});
const availableAddon = entry({
  coordinate: "mindcraft-lang/shared-math",
  name: "Shared Math",
  version: "2.0.0",
  installed: false,
});
const updatableDependency = entry({
  coordinate: "example-org/position-ext",
  name: "Position",
  version: "0.1.0",
  installed: true,
  updatable: true,
});
const remoteDependency = entry({
  coordinate: "example-org/remote-ext",
  name: "Remote",
  version: "0.1.0",
  installed: true,
  repoUrl: "https://github.com/example-org/remote-ext",
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
      items: entries.map((item) => ({ kind: "entry" as const, entry: item })),
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
  };
  const yahboom: ExtensionCatalogOffer = {
    coordinate: "yahboom/gamepad",
    name: "Yahboom Gamepad",
    version: "1.0.0",
    description: "Read the GHBit gamepad buttons.",
    ref: "embedded:yahboom/gamepad",
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

describe("extensionBrowserShowsNoMatch", () => {
  test("a search matching nothing shows the no-match message", () => {
    assert.equal(extensionBrowserShowsNoMatch(0, true), true);
  });

  test("a search with surviving cards shows no no-match message", () => {
    assert.equal(extensionBrowserShowsNoMatch(1, true), false);
  });

  test("an empty browser with no active search shows no no-match message", () => {
    assert.equal(extensionBrowserShowsNoMatch(0, false), false);
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

  test("an entry with a repoUrl offers Open Repository; one without omits it", () => {
    assert.deepEqual(extensionCardMenuItems(remoteDependency), [
      { action: "open-repo", label: "Open Repository" },
      { action: "uninstall", label: "Uninstall" },
    ]);
    assert.equal(
      extensionCardMenuItems(installedAddon).some((item) => item.action === "open-repo"),
      false
    );
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

  test("open-repo opens the entry's repoUrl", () => {
    const opened: string[] = [];
    runExtensionCardAction(remoteDependency, "open-repo", {
      onInstall: () => {},
      onUninstall: () => {},
      onOpenRepo: (url) => opened.push(url),
    });
    assert.deepEqual(opened, ["https://github.com/example-org/remote-ext"]);
  });

  test("open-repo on an entry without a repoUrl does nothing", () => {
    let called = false;
    runExtensionCardAction(entry({ coordinate: "x/y" }), "open-repo", {
      onInstall: () => {},
      onUninstall: () => {},
      onOpenRepo: () => {
        called = true;
      },
    });
    assert.equal(called, false);
  });

  test("open-repo with an absent callback is a no-op", () => {
    runExtensionCardAction(remoteDependency, "open-repo", { onInstall: () => {}, onUninstall: () => {} });
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

describe("catalog offer cards in the unified list", () => {
  const offers: ExtensionCatalogOffer[] = [
    {
      coordinate: "mindcraft-lang/lib-codal-position",
      name: "Position",
      version: "0.1.0",
      description: "Position sensing.",
      ref: "gh:mindcraft-lang/lib-codal-position@b19b80b029a77303ee575d3ff9b29adbf7021b23",
    },
    {
      coordinate: "mindcraft-lang/lib-ecosim-teleport",
      name: "Teleport",
      version: "0.2.0",
      description: "Teleport actuator.",
      ref: "gh:mindcraft-lang/lib-ecosim-teleport@89abcdef0123456789abcdef0123456789abcdef",
    },
  ];

  test("renders each offer's display metadata with an Add affordance", () => {
    const markup = renderToStaticMarkup(
      createElement(ExtensionBrowserList, {
        items: offers.map((offer) => ({ kind: "offer" as const, offer })),
        onInstall: () => {},
        onUninstall: () => {},
        onInstallReference: () => {},
      })
    );
    assert.match(markup, /Position sensing\./);
    assert.match(markup, /Teleport actuator\./);
    assert.match(markup, /v0\.1\.0/);
    assert.equal(markup.split(">Add<").length - 1, 2, "one Add affordance per offer");
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

describe("orderExtensionBrowserItems -- stable catalog order", () => {
  // The catalog document's order: three catalog libraries. The browser list
  // must present catalog items at their catalog positions regardless of
  // install status; a directly-installed unlisted library follows the catalog
  // block in coordinate order.
  const catalogCoordinates = ["elecfreaks/cutebot", "yahboom/gamepad", "mindcraft-lang/microbit-position"];

  function offerFor(coordinate: string): ExtensionCatalogOffer {
    return {
      coordinate,
      name: coordinate,
      version: "1.0.0",
      description: `${coordinate} library`,
      ref: `embedded:${coordinate}`,
    };
  }

  function installedEntryFor(coordinate: string): ExtensionBrowserEntry {
    return entry({ coordinate, name: coordinate, installed: true });
  }

  /** The browser's list state, derived exactly as the app builders derive it: installed coordinates are entry cards, catalog coordinates not installed are offers, unlisted installed libraries are entry cards. */
  function browserItems(installed: readonly string[], search = ""): string[] {
    const unlisted = installed.filter((coordinate) => !catalogCoordinates.includes(coordinate));
    const entries = [...installed.filter((c) => catalogCoordinates.includes(c)), ...unlisted].map(installedEntryFor);
    const offers = catalogCoordinates.filter((coordinate) => !installed.includes(coordinate)).map(offerFor);
    return orderExtensionBrowserItems(
      filterExtensionEntries(entries, search),
      filterExtensionOffers(offers, search),
      catalogCoordinates
    ).map(extensionBrowserItemCoordinate);
  }

  test("installing a catalog library never changes the list order", () => {
    const before = browserItems([]);
    const after = browserItems(["yahboom/gamepad"]);
    assert.deepEqual(after, before, "the sequence is unchanged; only the item's status changed");
  });

  test("uninstalling a catalog library never changes the list order", () => {
    const before = browserItems(["elecfreaks/cutebot", "yahboom/gamepad"]);
    const after = browserItems(["elecfreaks/cutebot"]);
    assert.deepEqual(after, before, "the sequence is unchanged; only the item's status changed");
  });

  test("an active search filters the sequence without reordering it", () => {
    const installed = ["yahboom/gamepad"];
    const unfiltered = browserItems(installed);
    const filtered = browserItems(installed, "e");
    assert.deepEqual(
      filtered,
      unfiltered.filter((coordinate) => filtered.includes(coordinate)),
      "the filtered list is a subsequence of the unfiltered list"
    );
    const afterInstall = browserItems([...installed, "elecfreaks/cutebot"], "e");
    assert.deepEqual(afterInstall, filtered, "an install under an active search changes no positions");
  });

  test("unlisted installed libraries follow the catalog block in coordinate order", () => {
    const items = browserItems(["example-org/zeta-lib", "example-org/alpha-lib", "yahboom/gamepad"]);
    assert.deepEqual(items, [
      "elecfreaks/cutebot",
      "yahboom/gamepad",
      "mindcraft-lang/microbit-position",
      "example-org/alpha-lib",
      "example-org/zeta-lib",
    ]);
  });
});

describe("extensionBrowserShowsCheckAllUpdates", () => {
  const installedUpdatable = entry({
    coordinate: "example-org/fetched-lib",
    installed: true,
    updatable: true,
    repoUrl: "https://github.com/example-org/fetched-lib",
  });
  const installedEmbedded = entry({ coordinate: "example-org/embedded-lib", installed: true });
  const uninstalledOffer = entry({ coordinate: "example-org/offered-lib", installed: false });

  test("visible with one installed library even when uninstalled libraries are also listed", () => {
    assert.equal(extensionBrowserShowsCheckAllUpdates([installedUpdatable, uninstalledOffer]), true);
  });

  test("visible with one installed embedded library and no updatable dependency", () => {
    assert.equal(extensionBrowserShowsCheckAllUpdates([installedEmbedded, uninstalledOffer]), true);
  });

  test("visible when every listed library is installed", () => {
    assert.equal(
      extensionBrowserShowsCheckAllUpdates([
        installedUpdatable,
        entry({ coordinate: "example-org/other-lib", installed: true, updatable: true }),
      ]),
      true
    );
  });

  test("hidden when no listed library is installed", () => {
    assert.equal(extensionBrowserShowsCheckAllUpdates([uninstalledOffer]), false);
    assert.equal(extensionBrowserShowsCheckAllUpdates([]), false);
  });
});

describe("entry-card descriptions", () => {
  test("an installed library's card carries its description", () => {
    const markup = renderList([
      entry({
        coordinate: "example-org/described-lib",
        name: "Described",
        installed: true,
        description: "Drives the described chassis.",
      }),
    ]);
    assert.match(markup, /Drives the described chassis\./);
  });

  test("a library without a description renders no description paragraph", () => {
    const markup = renderList([entry({ coordinate: "example-org/bare-lib", name: "Bare", installed: true })]);
    assert.doesNotMatch(markup, /Drives the described chassis\./);
  });
});
