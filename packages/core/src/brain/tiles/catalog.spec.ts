import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CoreTypeIds } from "@mindcraft-lang/core/brain";
import { BrainTileParameterDef, TileCatalog } from "@mindcraft-lang/core/brain/tiles";

describe("TileCatalog", () => {
  test("preserves explicit metadata when registering tiles", () => {
    const catalog = new TileCatalog();
    const tile = new BrainTileParameterDef("explicit-visual", CoreTypeIds.Number, {
      metadata: {
        label: "Explicit Label",
      },
    });

    catalog.registerTileDef(tile);

    assert.equal(tile.metadata?.label, "Explicit Label");
  });

  test("registers tiles without metadata when none is provided", () => {
    const catalog = new TileCatalog();
    const tile = new BrainTileParameterDef("no-visual", CoreTypeIds.Number);

    catalog.registerTileDef(tile);

    assert.equal(catalog.has(tile.tileId), true);
    assert.equal(tile.metadata, undefined);
  });
});
