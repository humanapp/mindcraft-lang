import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CoreVariableFactoryId, mkVariableFactoryTileId } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { getCatalogFallbackLabel } from "@mindcraft-lang/core/brain/tiles";
import { CoreTypeNames } from "@mindcraft-lang/core/runtime";

describe("built-in variable factory tiles", () => {
  const cases: ReadonlyArray<[CoreVariableFactoryId, string]> = [
    [CoreVariableFactoryId.Boolean, CoreTypeNames.Boolean],
    [CoreVariableFactoryId.Number, CoreTypeNames.Number],
    [CoreVariableFactoryId.String, CoreTypeNames.String],
  ];

  for (const [factoryId, expectedLabel] of cases) {
    test(`the '${factoryId}' factory reads as '${expectedLabel}', not the raw id fallback`, () => {
      const services = __test__createBrainServices();
      const tile = services.edit.tiles.get(mkVariableFactoryTileId(factoryId));
      assert.ok(tile, `expected the '${factoryId}' variable factory to be registered`);
      assert.equal(tile.metadata?.label, expectedLabel, "the factory reads with the type's display name");
      assert.notEqual(
        tile.metadata?.label,
        getCatalogFallbackLabel(tile),
        "the label must not collapse to the raw tile-id fallback"
      );
    });
  }
});
