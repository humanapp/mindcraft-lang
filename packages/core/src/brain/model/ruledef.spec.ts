import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List, stream } from "@mindcraft-lang/core";
import { getBrainServices, type ITileCatalog, registerCoreBrainComponents } from "@mindcraft-lang/core/brain";
import { BrainDef, BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { TileCatalog } from "@mindcraft-lang/core/brain/tiles";

const { MemoryStream } = stream;

before(() => {
  registerCoreBrainComponents();
});

type TileSetDeserializer = {
  deserialize: (stream: MemoryStream, catalogs?: List<ITileCatalog>) => void;
};

type BrainRuleDefInternals = {
  when_: TileSetDeserializer;
};

function createSerializedRuleLevel(): MemoryStream {
  const stream = new MemoryStream();
  const rule = new BrainRuleDef();
  rule.serializeThisLevelOnly(stream);
  stream.resetRead();
  return stream;
}

function captureBinaryCatalogs(catalogs?: List<ITileCatalog>): {
  brainCatalog: ITileCatalog;
  capturedCatalogs: List<ITileCatalog>;
} {
  const brain = new BrainDef();
  const page = new BrainPageDef();
  brain.addPage(page);

  const rule = new BrainRuleDef();
  rule.setPage(page);

  let capturedCatalogs: List<ITileCatalog> | undefined;
  const internals = rule as unknown as BrainRuleDefInternals;
  const whenTileSet = internals.when_;
  const originalDeserialize = whenTileSet.deserialize.bind(whenTileSet);

  whenTileSet.deserialize = (stream, nextCatalogs) => {
    capturedCatalogs = nextCatalogs;
    originalDeserialize(stream, nextCatalogs);
  };

  rule.deserializeThisLevelOnly(createSerializedRuleLevel(), catalogs);

  assert.ok(capturedCatalogs);
  return {
    brainCatalog: brain.catalog(),
    capturedCatalogs,
  };
}

describe("BrainRuleDef binary deserialization", () => {
  test("reuses provided catalogs without appending brain and global again", () => {
    const firstCatalog = new TileCatalog();
    const secondCatalog = new TileCatalog();
    const providedCatalogs = List.from<ITileCatalog>([firstCatalog, secondCatalog]);

    const { capturedCatalogs } = captureBinaryCatalogs(providedCatalogs);

    assert.equal(capturedCatalogs.size(), 2);
    assert.equal(capturedCatalogs.get(0), firstCatalog);
    assert.equal(capturedCatalogs.get(1), secondCatalog);
  });

  test("builds brain and global catalogs when none are provided", () => {
    const { brainCatalog, capturedCatalogs } = captureBinaryCatalogs();

    assert.equal(capturedCatalogs.size(), 2);
    assert.equal(capturedCatalogs.get(0), brainCatalog);
    assert.equal(capturedCatalogs.get(1), getBrainServices().tiles);
  });
});
