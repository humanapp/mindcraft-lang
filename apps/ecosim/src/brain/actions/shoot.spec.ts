import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AuthoringWorkspace, CatalogTile, SimulationRun } from "@wendoo/assistant-bridge";
import {
  catalogDigest,
  catalogTiles,
  createAuthoringWorkspace,
  findTile,
  readCatalog,
  tileCatalogsOf,
} from "@wendoo/assistant-bridge";
import { mkModifierTileId } from "@wendoo/core/brain";
import type { BrainRuleDef } from "@wendoo/core/brain/model";
import { TileIds } from "@/brain/tileids";
import { createTargetAdapter } from "@/rehearsal/adapter";
import { sourceRehearsalContent } from "@/rehearsal/source-content";
import shootAction, { clampShootRate } from "./shoot";

/** Tile id the shoot actuator is addressed by. */
const SHOOT_TILE_ID = "tile.actuator->actuator.shoot";

/** Tile id the value reporting whether a shot went out is addressed by. */
const SHOT_FIRED_TILE_ID = "tile.out->boolean:<boolean>.shot fired";

/** Tile id the turn actuator is addressed by. */
const TURN_TILE_ID = "tile.actuator->actuator.turn";

/** A fresh authoring session over the ecosim target. */
function ecosimWorkspace(): AuthoringWorkspace {
  return createAuthoringWorkspace(createTargetAdapter(sourceRehearsalContent()), "shoot brain");
}

/** Every tile of a fresh ecosim session, as the catalog reports them to a model. */
function ecosimCatalog(): readonly CatalogTile[] {
  return catalogTiles(readCatalog(ecosimWorkspace(), {}));
}

/** The catalog entry for `tileId`, which must be present. */
function catalogEntry(tiles: readonly CatalogTile[], tileId: string): CatalogTile {
  const tile = tiles.find((entry) => entry.tileId === tileId);
  assert.ok(tile, tileId);
  return tile;
}

/** The shoot tile as the catalog reports it to a model. */
function shootTile(): CatalogTile {
  return catalogEntry(ecosimCatalog(), SHOOT_TILE_ID);
}

/** Calls of `action` the whole run recorded. */
function countDispatches(run: SimulationRun, action: string): number {
  return run.observations.reduce(
    (total, think) => total + think.dispatches.filter((dispatch) => dispatch.action === action).length,
    0
  );
}

/** The bounds shoot's rate slot declares, which must be declared. */
function declaredRateRange(): { low: number; high: number } {
  const slots = shootAction.callDef.argSlots;
  for (let i = 0; i < slots.size(); i++) {
    const range = slots.get(i).argSpec.range;
    if (range?.min !== undefined && range.max !== undefined) return { low: range.min, high: range.max };
  }
  assert.fail("shoot declares a range on its rate slot");
}

describe("what shoot advertises about its rate", () => {
  test("the catalog reads shoot's rate bounds out of its argument grammar", () => {
    const { low, high } = declaredRateRange();

    assert.ok(shootTile().args?.includes(`[${low}..${high} clamp]`), shootTile().args);
  });

  test("the declared range is the range the runtime clamps a rate into", () => {
    const { low, high } = declaredRateRange();

    assert.equal(clampShootRate(low), low, "the low end is reachable");
    assert.equal(clampShootRate(high), high, "the high end is reachable");
    assert.equal(clampShootRate(low - 1), low, "a rate below the range fires at the low end");
    assert.equal(clampShootRate(high + 1), high, "a rate above the range fires at the high end");
  });
});

describe("what shoot reports about the shot it just took", () => {
  test("shoot advertises the fire report, and the tile reading it is offered inline", () => {
    const tiles = ecosimCatalog();
    const shoot = catalogEntry(tiles, SHOOT_TILE_ID);
    const report = catalogEntry(tiles, SHOT_FIRED_TILE_ID);

    assert.deepEqual(shoot.outputs, ["__out.boolean:<boolean>.shot fired"], "shoot provides one output key");
    assert.equal(report.kind, "output");
    assert.deepEqual([...report.placement].sort(), ["do", "inline", "when"], "the report reads on either side");
    assert.ok(report.description, "the report carries an author description");
  });

  test("the digest advertises the report on shoot's own line", () => {
    const digest = catalogDigest(ecosimCatalog());
    const shootLine = digest.text
      .split("\n")
      .map((line) => JSON.parse(line) as CatalogTile)
      .find((tile) => tile.tileId === SHOOT_TILE_ID);

    assert.ok(shootLine, "the digest carries a line for shoot");
    assert.deepEqual(shootLine.outputs, ["__out.boolean:<boolean>.shot fired"]);
  });

  test("the report tracks the shots the runtime actually took, not the calls made", async () => {
    const workspace = ecosimWorkspace();
    // A rule that shoots every think, with a rule below it that acts only on
    // the thinks a blip really went out.
    const rule = workspace.brainDef.pages().get(0).children().get(0) as BrainRuleDef;
    rule.do().appendTile(findTile(tileCatalogsOf(workspace.catalogs), SHOOT_TILE_ID)!);
    const counter = rule.appendNewRule();
    counter.when().appendTile(findTile(tileCatalogsOf(workspace.catalogs), SHOT_FIRED_TILE_ID)!);
    counter.do().appendTile(findTile(tileCatalogsOf(workspace.catalogs), TURN_TILE_ID)!);
    counter
      .do()
      .appendTile(findTile(tileCatalogsOf(workspace.catalogs), mkModifierTileId(TileIds.Modifier.TurnAround))!);

    const run = await workspace.adapter.run({
      brainDef: workspace.brainDef,
      scenario: { seed: 20260810, subject: "herbivore" },
      thinks: 60,
    });

    const calls = countDispatches(run, "actuator.shoot");
    const fires = countDispatches(run, "actuator.turn");
    const reports = new Set(
      run.observations.flatMap((think) =>
        think.gates.filter((gate) => gate.ruleId === counter.ruleId()).map((gate) => gate.result)
      )
    );

    // The world populates during its first step, so the creature under study
    // misses at most that one think.
    assert.ok(calls >= run.thinks - 1, `the brain called shoot on every think it ran: ${calls} of ${run.thinks}`);
    assert.ok(fires > 0, "some of those calls put a blip into flight");
    assert.ok(fires < calls, `the cooldown refused most of them: ${fires} of ${calls}`);
    assert.equal(reports.size, 2, `the report reads both ways over the run: ${[...reports].join(", ")}`);
  });
});
