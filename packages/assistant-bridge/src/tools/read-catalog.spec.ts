import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isPageTileId } from "@wendoo/core/brain";
import { CoreHostActions, mkActuatorTileId } from "@wendoo/core/runtime";
import { catalogDigest } from "../catalog/digest.js";
import { CatalogScope } from "../catalog/scope.js";
import { USER_TILE_ID, USER_TILE_NAMESPACE, userTileBundle } from "../kit/user-tile-bundle.js";
import { createTargetAdapter, ruleIdAt } from "../testing/index.js";
import type { CatalogFeaturing } from "./featuring.js";
import { admitsLongFormDocs } from "./featuring.js";
import { proposeEdit } from "./propose-edit.js";
import type { CatalogTile } from "./read-catalog.js";
import { catalogTiles, catalogTilesInScope, readCatalog } from "./read-catalog.js";
import type { AuthoringWorkspace } from "./workspace.js";
import { createAuthoringWorkspace } from "./workspace.js";

/** A sensor the fake target installs. */
const installedSensor = "tile.sensor->sensor.fake.signal";

/** Tile id of the core `restart page` actuator, which the catalog carries deprecated. */
const restartPageActuator = mkActuatorTileId(CoreHostActions.RestartPage.key);

/** A workspace over the fake target, one empty rule ready on its first page. */
function workspace(): AuthoringWorkspace {
  return createAuthoringWorkspace(createTargetAdapter(), "fake brain");
}

/** Mint a variable named `name` into `ws`, which registers it in the document's own catalog. */
function mintVariable(ws: AuthoringWorkspace, name: string): void {
  const placed = proposeEdit(ws, {
    op: "placeTiles",
    ruleId: ruleIdAt(ws.brainDef, "0/0"),
    side: "when",
    tileIds: [{ tileId: "tile.var.factory->boolean", name }],
  });
  assert.equal(placed.ok, true, JSON.stringify(placed));
}

describe("the scopes read_catalog groups tiles under", () => {
  test("puts the target's own vocabulary under the environment scope", () => {
    const view = readCatalog(workspace(), {});

    const environment = catalogTilesInScope(view, CatalogScope.Environment).map((tile) => tile.tileId);

    assert.ok(environment.includes(installedSensor), "the sensor the target installs is environment vocabulary");
    assert.ok(!environment.some((tileId) => isPageTileId(tileId)), "no page tile is environment vocabulary");
  });

  test("puts the document's own page tile under the document scope", () => {
    const view = readCatalog(workspace(), {});

    const document = catalogTilesInScope(view, CatalogScope.Document).map((tile) => tile.tileId);

    assert.equal(document.length, 1, JSON.stringify(document));
    assert.ok(isPageTileId(document[0]!), document[0]);
  });

  test("puts a variable the document minted under the document scope", () => {
    const ws = workspace();
    mintVariable(ws, "hunger");

    const document = catalogTilesInScope(readCatalog(ws, {}), CatalogScope.Document);

    assert.ok(
      document.some((tile) => tile.label === "hunger"),
      JSON.stringify(document.map((tile) => tile.label))
    );
  });

  test("sorts each group by tile id and reports every tile once", () => {
    const view = readCatalog(workspace(), {});

    for (const group of view.groups) {
      const ids = group.tiles.map((tile) => tile.tileId);
      assert.deepEqual(ids, [...ids].sort(), group.scope);
    }
    const all = catalogTiles(view).map((tile) => tile.tileId);
    assert.deepEqual(all.length, new Set(all).size, "no tile id is listed under two scopes");
    assert.equal(all.length, view.total);
  });

  test("leaves out a scope the filter matches nothing in, and leaves the total intact", () => {
    const ws = workspace();
    const unfiltered = readCatalog(ws, {});

    const view = readCatalog(ws, { filter: installedSensor });

    assert.deepEqual(
      view.groups.map((group) => group.scope),
      [CatalogScope.Environment]
    );
    assert.deepEqual(
      catalogTiles(view).map((tile) => tile.tileId),
      [installedSensor]
    );
    assert.equal(view.total, unfiltered.total, "the total counts every tile the filter narrowed from");
  });

  test("answers a filter matching nothing with no group at all", () => {
    const view = readCatalog(workspace(), { filter: "no tile reads like this" });

    assert.deepEqual(view.groups, []);
    assert.ok(view.total > 0);
  });
});

describe("the tiles the catalog tells the model not to author with", () => {
  test("marks a superseded tile deprecated, and still lists it", () => {
    const listed = catalogTiles(readCatalog(workspace(), {}));

    const restartPage = listed.find((tile) => tile.tileId === restartPageActuator);

    assert.ok(restartPage, `the catalog lists ${restartPageActuator}`);
    assert.equal(restartPage.deprecated, true);
    assert.notEqual(restartPage.hidden, true, "a deprecated tile is read, not hidden");
  });

  test("marks no tile deprecated that the language still authors with", () => {
    const listed = catalogTiles(readCatalog(workspace(), {}));

    const signal = listed.find((tile) => tile.tileId === installedSensor);

    assert.equal(signal?.deprecated, undefined);
  });
});

/** The documentation a compiled library ships with a tile: an opening paragraph, then the rules it states. */
const bundleTileDoc = "# Mark\n\nMarks the run so the rehearsal can see it.\n\n## Rules\n\n- one mark to a rule\n";

/** The description {@link bundleTileDoc} opens with. */
const bundleTileDescription = "Marks the run so the rehearsal can see it.";

/** First-party description text keyed by a tile id, standing in for the documented core and target tiles. */
function bakedDescriptions(tileId: string): ReadonlyMap<string, string> {
  return new Map([[tileId, "the first-party text"]]);
}

/**
 * A workspace whose environment holds the compiled bundle, its one tile
 * documented by `markdown` and owned by the bundle's compilation root.
 */
function bundledWorkspace(markdown?: string): AuthoringWorkspace {
  const ws = workspace();
  const bundle = userTileBundle();
  const tile = bundle.tiles[0]!;
  tile.metadata = { label: "mark", ...(markdown === undefined ? {} : { docsMarkdown: markdown }) };
  ws.environment.replaceActionBundle(bundle);
  return ws;
}

/** The catalog entry `ws` lists the compiled bundle's tile under. */
function bundledTile(ws: AuthoringWorkspace): CatalogTile {
  const listed = catalogTiles(readCatalog(ws, {})).find((tile) => tile.tileId === USER_TILE_ID);
  assert.ok(listed, `the catalog lists ${USER_TILE_ID}`);
  return listed;
}

describe("the description read_catalog gives each tile", () => {
  test("reads a compiled bundle tile's own documentation", () => {
    assert.equal(bundledTile(bundledWorkspace(bundleTileDoc)).description, bundleTileDescription);
  });

  test("leaves it out for a bundle tile whose documentation opens with none", () => {
    assert.equal(bundledTile(bundledWorkspace()).description, undefined);
  });

  test("keeps a bundle tile off the first-party text, even where its tile id collides with a documented one", () => {
    const documented = bundledWorkspace(bundleTileDoc);
    const undocumented = bundledWorkspace();

    const collidingDocumented = bundledTile({ ...documented, descriptions: bakedDescriptions(USER_TILE_ID) });
    const collidingUndocumented = bundledTile({ ...undocumented, descriptions: bakedDescriptions(USER_TILE_ID) });

    assert.equal(collidingDocumented.description, bundleTileDescription);
    assert.equal(collidingUndocumented.description, undefined);
  });

  test("serves it for a bundle tile no session features, whose long-form documentation is withheld", () => {
    const ws = bundledWorkspace(bundleTileDoc);
    const tile = ws.environment.appliedActionBundle()?.tiles.find((entry) => entry.tileId === USER_TILE_ID);

    assert.deepEqual(tile?.provenance?.owners, [USER_TILE_NAMESPACE]);
    assert.equal(
      admitsLongFormDocs(tile?.provenance, ws.environment.appliedActionBundle()?.roots ?? [], undefined),
      false
    );
    assert.equal(bundledTile(ws).description, bundleTileDescription);
  });

  test("reads the first-party text for a tile the environment's modules registered", () => {
    const ws = workspace();

    const listed = catalogTiles(readCatalog({ ...ws, descriptions: bakedDescriptions(installedSensor) }, {}));

    assert.equal(listed.find((tile) => tile.tileId === installedSensor)?.description, "the first-party text");
  });
});

/** The teaching prose a tile's documentation reserves for the model. */
const bundleTileTeaching = "Mark once a run, at the moment the rehearsal must see.";

/** {@link bundleTileDoc} with an assistant section standing after its body. */
const bundleTileDocWithSection = `${bundleTileDoc}\n\`\`\`assistant\n${bundleTileTeaching}\n\`\`\`\n`;

/** First-party assistant-section text keyed by a tile id, standing in for the baked target docs. */
function bakedSections(tileId: string): ReadonlyMap<string, string> {
  return new Map([[tileId, "the first-party teaching"]]);
}

/** A session featuring `featured`, naming no host project of its own. */
function featuring(...featured: readonly string[]): CatalogFeaturing {
  return { featured: new Set(featured) };
}

describe("the assistant section read_catalog serves a tile", () => {
  test("carries it on a bundle tile the session features", () => {
    const ws = bundledWorkspace(bundleTileDocWithSection);

    const listed = bundledTile({ ...ws, featuring: featuring(USER_TILE_NAMESPACE) });

    assert.equal(listed.assistant, bundleTileTeaching);
    assert.equal(listed.description, bundleTileDescription);
  });

  test("withholds it from a bundle tile the session does not feature, and still serves the description", () => {
    const ws = bundledWorkspace(bundleTileDocWithSection);

    const withheld = bundledTile({ ...ws, featuring: featuring() });
    const unfeatured = bundledTile(ws);

    assert.equal(withheld.assistant, undefined);
    assert.equal(withheld.description, bundleTileDescription);
    assert.equal(unfeatured.assistant, undefined);
    assert.equal(unfeatured.description, bundleTileDescription);
  });

  test("leaves it out for a featured bundle tile whose documentation carries no section", () => {
    const ws = bundledWorkspace(bundleTileDoc);

    assert.equal(bundledTile({ ...ws, featuring: featuring(USER_TILE_NAMESPACE) }).assistant, undefined);
  });

  test("reads the baked text for a tile the environment's modules registered, which no featuring gates", () => {
    const ws = workspace();

    const listed = catalogTiles(readCatalog({ ...ws, assistantSections: bakedSections(installedSensor) }, {}));

    assert.equal(listed.find((tile) => tile.tileId === installedSensor)?.assistant, "the first-party teaching");
  });

  test("keeps a bundle tile off the baked text, even where its tile id collides with a documented one", () => {
    const documented = bundledWorkspace(bundleTileDocWithSection);
    const undocumented = bundledWorkspace(bundleTileDoc);
    const baked = { assistantSections: bakedSections(USER_TILE_ID), featuring: featuring(USER_TILE_NAMESPACE) };

    assert.equal(bundledTile({ ...documented, ...baked }).assistant, bundleTileTeaching);
    assert.equal(bundledTile({ ...undocumented, ...baked }).assistant, undefined);
  });
});

describe("what the featuring of a session moves in the catalog it serves", () => {
  test("serves different text, and a different digest, for one workspace read under two featurings", () => {
    const ws = bundledWorkspace(bundleTileDocWithSection);

    const featured = catalogDigest(catalogTiles(readCatalog({ ...ws, featuring: featuring(USER_TILE_NAMESPACE) }, {})));
    const withheld = catalogDigest(catalogTiles(readCatalog({ ...ws, featuring: featuring() }, {})));

    assert.ok(featured.text.includes(bundleTileTeaching), "the featured read carries the teaching");
    assert.ok(!withheld.text.includes(bundleTileTeaching), "the withheld read carries none of it");
    assert.notEqual(featured.hash, withheld.hash);
    assert.equal(featured.tileCount, withheld.tileCount, "featuring moves the text, not which tiles are listed");
  });

  test("repeats the same text and digest for the same workspace read twice under one featuring", () => {
    const ws = { ...bundledWorkspace(bundleTileDocWithSection), featuring: featuring(USER_TILE_NAMESPACE) };

    const first = catalogDigest(catalogTiles(readCatalog(ws, {})));
    const second = catalogDigest(catalogTiles(readCatalog(ws, {})));

    assert.equal(first.text, second.text);
    assert.equal(first.hash, second.hash);
  });

  test("keeps two coexisting workspaces reading by their own featuring, however the reads interleave", () => {
    const features = { ...bundledWorkspace(bundleTileDocWithSection), featuring: featuring(USER_TILE_NAMESPACE) };
    const withholds = { ...bundledWorkspace(bundleTileDocWithSection), featuring: featuring() };

    const featuredFirst = bundledTile(features).assistant;
    const withheldBetween = bundledTile(withholds).assistant;
    const featuredAgain = bundledTile(features).assistant;

    assert.equal(featuredFirst, bundleTileTeaching);
    assert.equal(withheldBetween, undefined);
    assert.equal(featuredAgain, bundleTileTeaching);
  });
});
