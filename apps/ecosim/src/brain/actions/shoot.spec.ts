import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createAuthoringWorkspace, readCatalog } from "@mindcraft-lang/assistant-bridge";
import { createTargetAdapter } from "@/rehearsal/adapter";
import { sourceRehearsalContent } from "@/rehearsal/source-content";
import { clampShootRate } from "./shoot";

/** Tile id the shoot actuator is addressed by. */
const SHOOT_TILE_ID = "tile.actuator->actuator.shoot";

/** The shoot tile as the catalog reports it to a model. */
function shootTile() {
  const workspace = createAuthoringWorkspace(createTargetAdapter(sourceRehearsalContent()), "shoot brain");
  const tile = readCatalog(workspace, {}).tiles.find((entry) => entry.tileId === SHOOT_TILE_ID);
  assert.ok(tile, SHOOT_TILE_ID);
  return tile;
}

/** The `low..high` range a note advertises. */
function advertisedRange(note: string): { low: number; high: number } {
  const match = /(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)/.exec(note);
  assert.ok(match, `no range in ${JSON.stringify(note)}`);
  return { low: Number(match[1]), high: Number(match[2]) };
}

describe("what shoot advertises about its rate", () => {
  test("the catalog carries shoot's rate rule", () => {
    assert.ok(shootTile().grammarNote, "shoot registers a grammar note");
  });

  test("the advertised range is the range the runtime clamps a rate into", () => {
    const { low, high } = advertisedRange(shootTile().grammarNote!);

    assert.equal(clampShootRate(low), low, "the low end is reachable");
    assert.equal(clampShootRate(high), high, "the high end is reachable");
    assert.equal(clampShootRate(low - 1), low, "a rate below the range fires at the low end");
    assert.equal(clampShootRate(high + 1), high, "a rate above the range fires at the high end");
  });
});
