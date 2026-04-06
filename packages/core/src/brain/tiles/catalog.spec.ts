import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { CoreTypeIds } from "@mindcraft-lang/core/brain";
import {
  BrainTileParameterDef,
  getTileVisualProvider,
  setTileVisualProvider,
  TileCatalog,
} from "@mindcraft-lang/core/brain/tiles";

const originalTileVisualProvider = getTileVisualProvider();

afterEach(() => {
  setTileVisualProvider(originalTileVisualProvider);
});

describe("TileCatalog", () => {
  test("preserves explicit visuals when registering tiles", () => {
    const catalog = new TileCatalog();
    const tile = new BrainTileParameterDef("explicit-visual", CoreTypeIds.Number, {
      visual: {
        label: "Explicit Label",
      },
    });

    catalog.registerTileDef(tile);

    assert.equal(tile.visual?.label, "Explicit Label");
  });

  test("keeps legacy visual providers as fallback augmentation", () => {
    setTileVisualProvider(() => ({ label: "Provider Label" }));

    const catalog = new TileCatalog();
    const tile = new BrainTileParameterDef("provider-visual", CoreTypeIds.Number);

    catalog.registerTileDef(tile);

    assert.equal(tile.visual?.label, "Provider Label");
  });
});
