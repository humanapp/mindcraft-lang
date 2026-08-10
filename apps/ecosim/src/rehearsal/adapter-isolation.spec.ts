import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import type { AuthoringWorkspace, SimulationRun } from "@mindcraft-lang/assistant-bridge";
import { createAuthoringWorkspace, proposeEdit } from "@mindcraft-lang/assistant-bridge";
import { createRehearsalEnvironment, createSeededRng } from "@mindcraft-lang/assistant-bridge/kit";
import type { Actor } from "@/brain/actor";
import { createEcosimModule } from "@/brain/index";
import { TileIds } from "@/brain/tileids";
import { createTargetAdapter } from "./adapter";
import { sourceRehearsalContent } from "./source-content";
import { createRehearsalWorld } from "./world";

/** Fixed-step thinks each rehearsal covers. */
const RUN_THINKS = 120;

/** The app's own assets, read from the tree these specs run in. */
const CONTENT = sourceRehearsalContent();

/** Scenario every rehearsal in this file stages. */
const SCENARIO = { seed: 20260808, subject: "herbivore" };

/** Fixed steps each interleaved world advances. */
const WORLD_STEPS = 90;

/** Seeds the two interleaved worlds are built and run from. */
const WORLD_SEEDS = [20260808, 20260809] as const;

/**
 * A workspace carrying one rule: on seeing a creature of `actorKind`, move
 * under `movement` relative to it.
 */
function authoredWorkspace(actorKind: string, movement: string): AuthoringWorkspace {
  const workspace = createAuthoringWorkspace(createTargetAdapter(CONTENT), "isolation brain");
  const when = proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: "0/0",
    side: "when",
    tileIds: ["tile.sensor->sensor.see", `tile.modifier->${actorKind}`],
  });
  assert.equal(when.ok, true, JSON.stringify(when));
  const doSide = proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: "0/0",
    side: "do",
    tileIds: ["tile.actuator->actuator.move", `tile.modifier->${movement}`, "tile.literal->struct:<ActorRef>->it"],
  });
  assert.equal(doSide.ok, true, JSON.stringify(doSide));
  return workspace;
}

/** A workspace fleeing carnivores. */
function fleeingWorkspace(): AuthoringWorkspace {
  return authoredWorkspace(TileIds.Modifier.ActorKindCarnivore, TileIds.Modifier.MovementAwayFrom);
}

/** A workspace seeking plants. */
function seekingWorkspace(): AuthoringWorkspace {
  return authoredWorkspace(TileIds.Modifier.ActorKindPlant, TileIds.Modifier.MovementToward);
}

/** Hex SHA-256 of a whole run, byte for byte. */
function digestRun(run: SimulationRun): string {
  return createHash("sha256").update(JSON.stringify(run)).digest("hex");
}

/** Rehearse `workspace` against {@link SCENARIO}. */
function rehearse(workspace: AuthoringWorkspace): Promise<SimulationRun> {
  return workspace.adapter.run({ brainDef: workspace.brainDef, scenario: SCENARIO, thinks: RUN_THINKS });
}

/** One step's serialization: every actor's identity and physical state. */
function traceStep(actors: readonly Actor[]): string {
  return actors
    .map((actor) =>
      [
        actor.actorId,
        actor.archetype,
        actor.sprite.x.toFixed(6),
        actor.sprite.y.toFixed(6),
        actor.sprite.rotation.toFixed(6),
        actor.energy.toFixed(6),
      ].join(":")
    )
    .join("|");
}

/** Stage a whole world seeded by `seed`, running the brains the app ships. */
function stageWorld(seed: number) {
  const next = createSeededRng(seed);
  return createRehearsalWorld({
    environment: createRehearsalEnvironment({ modules: [createEcosimModule()], rng: next }),
    next,
    observer: {},
    shippedBrains: CONTENT.shippedBrains,
  });
}

describe("two ecosim adapters in one process", () => {
  test("each rehearses what it rehearses alone", async () => {
    const soloFleeing = digestRun(await rehearse(fleeingWorkspace()));
    const soloSeeking = digestRun(await rehearse(seekingWorkspace()));
    assert.notEqual(soloFleeing, soloSeeking, "the two brains rehearse differently");

    const fleeing = fleeingWorkspace();
    const seeking = seekingWorkspace();
    assert.equal(digestRun(await rehearse(fleeing)), soloFleeing);
    assert.equal(digestRun(await rehearse(seeking)), soloSeeking);
  });

  test("each rehearses what it rehearses alone when both runs are in flight at once", async () => {
    const soloFleeing = digestRun(await rehearse(fleeingWorkspace()));
    const soloSeeking = digestRun(await rehearse(seekingWorkspace()));
    assert.notEqual(soloFleeing, soloSeeking, "the two brains rehearse differently");

    const [fleeing, seeking] = await Promise.all([rehearse(fleeingWorkspace()), rehearse(seekingWorkspace())]);
    assert.equal(digestRun(fleeing), soloFleeing);
    assert.equal(digestRun(seeking), soloSeeking);
  });
});

describe("two ecosim worlds stepped in alternation", () => {
  test("each traces what it traces alone", async () => {
    const solo: string[] = [];
    for (const seed of WORLD_SEEDS) {
      const world = await stageWorld(seed);
      const trace: string[] = [];
      for (let step = 0; step < WORLD_STEPS; step++) {
        world.step();
        trace.push(traceStep(world.actors()));
      }
      world.shutdown();
      solo.push(createHash("sha256").update(trace.join("\n")).digest("hex"));
    }
    assert.notEqual(solo[0], solo[1], "the two seeds build different worlds");

    const worlds = await Promise.all(WORLD_SEEDS.map((seed) => stageWorld(seed)));
    const traces: string[][] = worlds.map(() => []);
    for (let step = 0; step < WORLD_STEPS; step++) {
      worlds.forEach((world, index) => {
        world.step();
        traces[index]?.push(traceStep(world.actors()));
      });
    }
    for (const world of worlds) world.shutdown();

    traces.forEach((trace, index) => {
      assert.equal(createHash("sha256").update(trace.join("\n")).digest("hex"), solo[index], `world ${index}`);
    });
  });
});
