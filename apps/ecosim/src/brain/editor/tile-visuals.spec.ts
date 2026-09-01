/**
 * Pins the word every shipped tile reads as: the word the sentence line renders
 * and the candidate strip labels its chips with is the one the tile's own
 * metadata authors, and no tile falls back to reading as its tile id. Sweeps the
 * other direction too: every `tileVisuals` entry names a tile the environment
 * still ships.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { IBrainTileDef } from "@wendoo/core/app";
import { coreModule, createWendooEnvironment } from "@wendoo/core/app";
import { tileSentenceWord } from "@wendoo/core/brain/language-service";
import { createDefaultLocalizer } from "@wendoo/core/localization";
import { createEcosimModule } from "../index";
import { tileVisuals } from "./tile-visuals";

/**
 * Tile kinds whose word comes from the tile's own data: a literal value, a
 * variable name, an accessor field name, an output name, a page name.
 */
const DATA_LABELED_KINDS = new Set<string>(["literal", "variable", "accessor", "output", "page"]);

/** Separates a tile id's namespace from its local name; a word carrying it came from the id. */
const kTileIdSeparator = "->";

/** Every catalog tile of the shipped ecosim environment, including hidden and deprecated tiles. */
function catalogTiles(): IBrainTileDef[] {
  const environment = createWendooEnvironment({ modules: [coreModule(), createEcosimModule()] });
  const tiles: IBrainTileDef[] = [];
  for (const catalog of environment.tileCatalogs()) {
    const all = catalog.getAll();
    for (let i = 0; i < all.size(); i++) {
      const tileDef = all.get(i);
      if (!tileDef) {
        continue;
      }
      tiles.push(tileDef);
    }
  }
  return tiles;
}

/** Every catalog tile of the shipped ecosim environment the tile picker can offer. */
function visibleCatalogTiles(): IBrainTileDef[] {
  return catalogTiles().filter((tileDef) => !tileDef.hidden && !tileDef.deprecated);
}

describe("ecosim tile visuals", () => {
  test("every visible catalog tile resolves the word its own metadata authors", () => {
    const localizer = createDefaultLocalizer();
    const offenders: string[] = [];
    for (const tileDef of visibleCatalogTiles()) {
      if (DATA_LABELED_KINDS.has(tileDef.kind)) {
        continue;
      }
      const authored = tileDef.metadata?.language?.form || tileDef.metadata?.label;
      if (!authored) {
        offenders.push(tileDef.tileId);
        continue;
      }
      assert.equal(tileSentenceWord(tileDef, localizer), authored, tileDef.tileId);
    }
    assert.deepEqual(offenders, [], `tiles without an authored word: ${offenders.join(", ")}`);
  });

  test("no visible catalog tile reads as a namespaced fragment of its tile id", () => {
    const localizer = createDefaultLocalizer();
    const leaking = visibleCatalogTiles()
      .filter((tileDef) => tileSentenceWord(tileDef, localizer).includes(kTileIdSeparator))
      .map((tileDef) => tileDef.tileId);
    assert.deepEqual(leaking, [], `tiles reading as a tile-id fragment: ${leaking.join(", ")}`);
  });

  test("every tile-visuals map entry targets a shipped catalog tile and carries an icon", () => {
    const shippedTileIds = new Set(catalogTiles().map((tileDef) => tileDef.tileId));
    const staleKeys: string[] = [];
    const iconless: string[] = [];
    for (const [tileId, visual] of tileVisuals) {
      if (!shippedTileIds.has(tileId)) {
        staleKeys.push(tileId);
      }
      if (!visual.iconUrl) {
        iconless.push(tileId);
      }
    }
    assert.deepEqual(staleKeys, [], `map keys without a shipped catalog tile: ${staleKeys.join(", ")}`);
    assert.deepEqual(iconless, [], `map entries without an icon: ${iconless.join(", ")}`);
  });
});
