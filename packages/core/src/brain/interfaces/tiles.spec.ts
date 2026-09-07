import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CoreLiteralFactoryId,
  isLiteralFactoryTileId,
  mkLiteralFactoryTileId,
  mkLiteralTileId,
  mkVariableFactoryTileId,
} from "@wendoo/core/brain";
import { CoreTypeIds, mkActuatorTileId } from "@wendoo/core/runtime";

describe("isLiteralFactoryTileId", () => {
  test("holds for every core literal factory", () => {
    assert.equal(isLiteralFactoryTileId(mkLiteralFactoryTileId(CoreLiteralFactoryId.Boolean)), true);
    assert.equal(isLiteralFactoryTileId(mkLiteralFactoryTileId(CoreLiteralFactoryId.Number)), true);
    assert.equal(isLiteralFactoryTileId(mkLiteralFactoryTileId(CoreLiteralFactoryId.String)), true);
  });

  test("holds for a factory id no core enum names", () => {
    assert.equal(isLiteralFactoryTileId(mkLiteralFactoryTileId("swatch")), true);
  });

  test("does not hold for the literal tiles a factory produces", () => {
    assert.equal(isLiteralFactoryTileId(mkLiteralTileId(CoreTypeIds.Number, "7")), false);
    assert.equal(isLiteralFactoryTileId(mkLiteralTileId(CoreTypeIds.Number, "7", "percent")), false);
  });

  test("does not hold for another area's tiles", () => {
    assert.equal(isLiteralFactoryTileId(mkVariableFactoryTileId("number")), false);
    assert.equal(isLiteralFactoryTileId(mkActuatorTileId("wait")), false);
  });

  test("does not hold for text that is not a tile id", () => {
    assert.equal(isLiteralFactoryTileId(""), false);
    assert.equal(isLiteralFactoryTileId("lit.factory->number"), false);
    assert.equal(isLiteralFactoryTileId("tile.lit.factory"), false);
    assert.equal(isLiteralFactoryTileId("tile.lit.factorynumber"), false);
  });
});
