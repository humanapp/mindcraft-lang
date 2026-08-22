import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { IBrainActionTileDef, IBrainTileDef } from "@wendoo-lang/core/brain";
import { BrainTileActuatorDef, BrainTileParameterDef } from "@wendoo-lang/core/brain/tiles";
import { bag, CoreTypeIds, mkCallDef } from "@wendoo-lang/core/runtime";
import { applyBrokenTileBadges, BROKEN_TILE_BADGE_MESSAGE, type TileBadge } from "./tile-badges";

/** An action (actuator) tile keyed by `id`; carries an `action` descriptor. */
function actionTile(id: string): BrainTileActuatorDef {
  return new BrainTileActuatorDef(id, { key: id, kind: "actuator", callDef: mkCallDef(bag()), isAsync: false });
}

/** A non-action parameter tile; carries no `action` descriptor. */
function nonActionTile(id: string): BrainTileParameterDef {
  return new BrainTileParameterDef(id, CoreTypeIds.String);
}

const brokenKeys = (keys: ReadonlySet<string>) => (tile: IBrainActionTileDef) => keys.has(tile.action.key);

describe("applyBrokenTileBadges", () => {
  test("sets an error badge at the index of each action tile the predicate reports broken", () => {
    const tiles: IBrainTileDef[] = [actionTile("a.broken")];
    const badges = applyBrokenTileBadges(tiles, new Map(), brokenKeys(new Set(["a.broken"])));

    const badge = badges.get(0);
    assert.ok(badge, "the broken tile index gets a badge");
    assert.equal(badge.type, "error");
    assert.equal(badge.message, BROKEN_TILE_BADGE_MESSAGE);
  });

  test("a predicate that returns false produces no broken-tile badge", () => {
    const tiles: IBrainTileDef[] = [actionTile("a.clean")];
    const badges = applyBrokenTileBadges(tiles, new Map(), brokenKeys(new Set()));

    assert.equal(badges.size, 0);
  });

  test("badges land on the index the predicate selects, not on other tiles", () => {
    const tiles: IBrainTileDef[] = [actionTile("a.clean"), actionTile("a.broken")];
    const badges = applyBrokenTileBadges(tiles, new Map(), brokenKeys(new Set(["a.broken"])));

    assert.equal(badges.has(0), false, "the clean tile keeps no badge");
    assert.equal(badges.get(1)?.type, "error", "the broken tile at index 1 gets the error badge");
  });

  test("a broken-tile badge overrides an existing per-rule badge on the same tile", () => {
    const tiles: IBrainTileDef[] = [actionTile("a.broken")];
    const perRule = new Map<number, TileBadge>([[0, { type: "warning", message: "Missing value" }]]);

    const badges = applyBrokenTileBadges(tiles, perRule, brokenKeys(new Set(["a.broken"])));

    assert.equal(badges.get(0)?.type, "error", "the warning is overridden to an error");
    assert.equal(badges.get(0)?.message, BROKEN_TILE_BADGE_MESSAGE);
  });

  test("a broken-tile badge overrides even an existing per-rule error badge", () => {
    const tiles: IBrainTileDef[] = [actionTile("a.broken")];
    const perRule = new Map<number, TileBadge>([[0, { type: "error", message: "Type mismatch" }]]);

    const badges = applyBrokenTileBadges(tiles, perRule, brokenKeys(new Set(["a.broken"])));

    assert.equal(badges.get(0)?.message, BROKEN_TILE_BADGE_MESSAGE, "the root-cause broken message wins");
  });

  test("non-action tiles are skipped and never receive a broken-tile badge", () => {
    const tiles: IBrainTileDef[] = [nonActionTile("p.text"), actionTile("a.broken")];
    // Predicate would report broken for any tile it is handed; the guard must
    // keep it from ever seeing the non-action tile at index 0.
    const badges = applyBrokenTileBadges(tiles, new Map(), () => true);

    assert.equal(badges.has(0), false, "the parameter tile is skipped");
    assert.equal(badges.get(1)?.type, "error", "the action tile still gets its badge");
  });
});
