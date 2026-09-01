import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isPageTileId } from "@wendoo/core/brain";
import { CoreHostActions, mkSensorTileId } from "@wendoo/core/runtime";
import { CatalogScope } from "../catalog/scope.js";
import { createTargetAdapter, ruleIdAt } from "../testing/index.js";
import { proposeEdit } from "./propose-edit.js";
import { catalogTiles, catalogTilesInScope, readCatalog } from "./read-catalog.js";
import type { AuthoringWorkspace } from "./workspace.js";
import { createAuthoringWorkspace } from "./workspace.js";

/** A sensor the fake target installs. */
const installedSensor = "tile.sensor->sensor.fake.signal";

/** Tile id of the core `otherwise` sensor. */
const otherwiseSensor = mkSensorTileId(CoreHostActions.Otherwise.key);

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
  test("marks the superseded `otherwise` sensor deprecated, and still lists it", () => {
    const listed = catalogTiles(readCatalog(workspace(), {}));

    const otherwise = listed.find((tile) => tile.tileId === otherwiseSensor);

    assert.ok(otherwise, `the catalog lists ${otherwiseSensor}`);
    assert.equal(otherwise.deprecated, true);
    assert.notEqual(otherwise.hidden, true, "a deprecated tile is read, not hidden");
  });

  test("marks no tile deprecated that the language still authors with", () => {
    const listed = catalogTiles(readCatalog(workspace(), {}));

    const signal = listed.find((tile) => tile.tileId === installedSensor);

    assert.equal(signal?.deprecated, undefined);
  });
});
