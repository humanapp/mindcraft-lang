/**
 * The document-catalog invariant a tile set enforces: a tile whose persistence
 * runs through the owning brain's catalog may only be placed once that catalog
 * holds it. Deserialization materializes tiles below the guard and is
 * unaffected.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { type BrainServices, type IBrainTileDef, mkVariableTileId } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainDef, type BrainJson, UnregisteredTileErrorCode } from "@mindcraft-lang/core/brain/model";
import { BrainTileLiteralDef, BrainTileOperatorDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import { CoreOpId, CoreTypeIds } from "@mindcraft-lang/core/runtime";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

/** A brain with one page and one rule, plus that rule's WHEN tile set. */
function emptyRule() {
  const brainDef = BrainDef.emptyBrainDef(services, "catalog invariant");
  const when = brainDef.pages().get(0).children().get(0).when();
  return { brainDef, when };
}

/** Assert `run` throws the unregistered-tile code. */
function assertRejects(run: () => void, label: string): void {
  assert.throws(
    run,
    (error: unknown) => {
      const message = (error as { message: string }).message;
      assert.ok(message.startsWith(UnregisteredTileErrorCode.NotInDocumentCatalog), message);
      return true;
    },
    label
  );
}

/** The WHEN tiles the rule holds after `json` is loaded into a fresh brain. */
function reloadedWhenTiles(json: BrainJson): readonly IBrainTileDef[] {
  const reloaded = BrainDef.fromJson(json, services);
  return reloaded.pages().get(0).children().get(0).when().tiles().toArray();
}

describe("a document-scoped tile the brain's catalog does not hold", () => {
  test("appending an unregistered literal is refused", () => {
    const { when } = emptyRule();
    const literal = new BrainTileLiteralDef(CoreTypeIds.Number, 50, {}, services);
    assertRejects(() => {
      when.appendTile(literal);
    }, "appendTile must refuse an unregistered literal");
    assert.equal(when.tiles().size(), 0);
  });

  test("appending an unregistered variable is refused", () => {
    const { when } = emptyRule();
    const uniqueId = "unregistered-var";
    const variable = new BrainTileVariableDef(mkVariableTileId(uniqueId), "score", CoreTypeIds.Number, uniqueId);
    assertRejects(() => {
      when.appendTile(variable);
    }, "appendTile must refuse an unregistered variable");
    assert.equal(when.tiles().size(), 0);
  });

  test("inserting an unregistered literal is refused", () => {
    const { when } = emptyRule();
    const literal = new BrainTileLiteralDef(CoreTypeIds.Number, 7, {}, services);
    assertRejects(() => {
      when.insertTileAtIndex(0, literal);
    }, "insertTileAtIndex must refuse an unregistered literal");
    assert.equal(when.tiles().size(), 0);
  });

  test("replacing with an unregistered variable is refused", () => {
    const { brainDef, when } = emptyRule();
    const placed = services.edit.tileBuilder.createLiteralTileDef(brainDef.catalog(), CoreTypeIds.Number, 1, {});
    when.appendTile(placed);

    const uniqueId = "unregistered-replacement";
    const variable = new BrainTileVariableDef(mkVariableTileId(uniqueId), "swap", CoreTypeIds.Number, uniqueId);
    assertRejects(() => {
      when.replaceTileAtIndex(0, variable);
    }, "replaceTileAtIndex must refuse an unregistered variable");
    assert.equal(when.tiles().get(0).tileId, placed.tileId);
  });

  test("a tile the services catalog provides is placed freely", () => {
    const { when } = emptyRule();
    when.appendTile(new BrainTileOperatorDef(CoreOpId.GreaterThan, {}, services));
    assert.equal(when.tiles().size(), 1);
  });
});

describe("a tile minted through the brain's catalog", () => {
  test("a minted literal places and survives the brain JSON round trip", () => {
    const { brainDef, when } = emptyRule();
    const literal = services.edit.tileBuilder.createLiteralTileDef(brainDef.catalog(), CoreTypeIds.Number, 50, {});
    when.appendTile(literal);

    const tiles = reloadedWhenTiles(brainDef.toJson());
    assert.equal(tiles.length, 1);
    assert.equal(tiles[0].tileId, literal.tileId);
    assert.equal(tiles[0].kind, "literal");
    assert.equal((tiles[0] as BrainTileLiteralDef).value, 50);
  });

  test("a minted variable places and survives the brain JSON round trip", () => {
    const { brainDef, when } = emptyRule();
    const uniqueId = "minted-var";
    const variable = services.edit.tileBuilder.createVariableTileDef(
      brainDef.catalog(),
      mkVariableTileId(uniqueId),
      "score",
      CoreTypeIds.Number,
      uniqueId,
      {}
    );
    when.appendTile(variable);

    const tiles = reloadedWhenTiles(brainDef.toJson());
    assert.equal(tiles.length, 1);
    assert.equal(tiles[0].tileId, variable.tileId);
    assert.equal(tiles[0].kind, "variable");
    assert.equal((tiles[0] as BrainTileVariableDef).varName, "score");
  });

  test("minting the same value twice yields the one registered tile", () => {
    const { brainDef } = emptyRule();
    const first = services.edit.tileBuilder.createLiteralTileDef(brainDef.catalog(), CoreTypeIds.Number, 3, {});
    const second = services.edit.tileBuilder.createLiteralTileDef(brainDef.catalog(), CoreTypeIds.Number, 3, {});
    assert.equal(first, second);
  });
});

describe("deserialization materializes tiles below the guard", () => {
  test("a document whose catalog holds its minted tiles loads without refusal", () => {
    const { brainDef, when } = emptyRule();
    const uniqueId = "loaded-var";
    when.appendTile(
      services.edit.tileBuilder.createVariableTileDef(
        brainDef.catalog(),
        mkVariableTileId(uniqueId),
        "loaded",
        CoreTypeIds.Number,
        uniqueId,
        {}
      )
    );
    when.appendTile(services.edit.tileBuilder.createLiteralTileDef(brainDef.catalog(), CoreTypeIds.Number, 9, {}));

    const tiles = reloadedWhenTiles(brainDef.toJson());
    assert.deepEqual(
      tiles.map((tileDef) => tileDef.kind),
      ["variable", "literal"]
    );
  });

  test("an unresolved tile id loads as a placeholder no catalog holds", () => {
    const { brainDef, when } = emptyRule();
    when.appendTile(services.edit.tileBuilder.createLiteralTileDef(brainDef.catalog(), CoreTypeIds.Number, 4, {}));

    const json = brainDef.toJson();
    const stripped: BrainJson = { ...json, catalog: json.catalog.filter(() => false) };

    const tiles = reloadedWhenTiles(stripped);
    assert.equal(tiles.length, 1);
    assert.equal(tiles[0].kind, "missing");
    assert.equal(tiles[0].persist, true);
  });
});
