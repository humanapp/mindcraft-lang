/**
 * Compares the chip the assistant panel draws a tile as against the chip a
 * documentation page draws the same tile as, for every tile this app ships.
 * Both are resolved through this app's own catalogs and its own tile visuals.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TileChip } from "@wendoo/assistant-panel/conversation/TileChip";
import { BrainSurfaceProvider, useTileLooks } from "@wendoo/assistant-panel/conversation/tile-visuals";
import type { IBrainTileDef } from "@wendoo/core/app";
import { coreModule, createWendooEnvironment } from "@wendoo/core/app";
import { InlineTileIcon } from "@wendoo/docs/DocsRule";
import { DocsSidebarProvider } from "@wendoo/docs/DocsSidebarContext";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { genVisualForTile } from "../brain/editor/visual-provider";
import { createEcosimModule } from "../brain/index";

/** The shipped environment both surfaces resolve their tiles against. */
const environment = createWendooEnvironment({ modules: [coreModule(), createEcosimModule()] });

/** Every catalog tile of the shipped environment, in catalog order. */
function catalogTiles(): IBrainTileDef[] {
  const tiles: IBrainTileDef[] = [];
  for (const catalog of environment.tileCatalogs()) {
    const all = catalog.getAll();
    for (let i = 0; i < all.size(); i++) {
      const tileDef = all.get(i);
      if (tileDef) tiles.push(tileDef);
    }
  }
  return tiles;
}

/** The markup a documentation page stands for `tileDef` inline in its prose. */
function docsChip(tileDef: IBrainTileDef): string {
  return renderToStaticMarkup(
    createElement(
      DocsSidebarProvider,
      { resolveTileVisual: genVisualForTile } as never,
      createElement(InlineTileIcon, { tileDef } as never)
    ) as never
  );
}

/** The markup the assistant panel stands for `tileDef` inline in the entity's words. */
function panelChip(tileDef: IBrainTileDef): string {
  function Chip() {
    const look = useTileLooks();
    const found = look(tileDef.tileId);
    return found === undefined ? null : createElement(TileChip, { tileId: tileDef.tileId, look: found });
  }
  return renderToStaticMarkup(
    createElement(BrainSurfaceProvider, {
      value: { tileCatalogs: [...environment.tileCatalogs()], resolveTileVisual: genVisualForTile },
      children: createElement(Chip),
    } as never) as never
  );
}

/** `markup` with every `data-assistant-*` attribute removed, and any element left with no attributes unwrapped. */
function withoutAssistantMarks(markup: string): string {
  const bare = markup.replace(/ data-assistant-[a-z-]+(="[^"]*")?/g, "");
  return bare.replace(/<span>([^<]*)<\/span>/g, "$1");
}

describe("the panel's tile chip", () => {
  test("stands the very markup a documentation page stands, for every tile this app ships", () => {
    const tiles = catalogTiles();
    assert.ok(tiles.length > 0, "the shipped environment carries tiles to compare");

    const differing: string[] = [];
    for (const tileDef of tiles) {
      const drawn = withoutAssistantMarks(panelChip(tileDef));
      if (drawn !== docsChip(tileDef)) differing.push(tileDef.tileId);
    }

    assert.deepEqual(differing, [], "every tile draws alike on both surfaces");
  });

  test("carries the icon and the hue the app resolves, not the tile id", () => {
    const withIcon = catalogTiles().find((tileDef) => genVisualForTile(tileDef).iconUrl !== undefined);
    assert.ok(withIcon, "the shipped environment resolves an icon for some tile");

    const markup = panelChip(withIcon);
    const visual = genVisualForTile(withIcon);

    assert.match(markup, new RegExp(`<img src="${visual.iconUrl?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.ok(visual.colorDef?.when, "the app resolves a hue for it");
    assert.match(markup, new RegExp(`border-color:${visual.colorDef?.when}`));
  });
});
