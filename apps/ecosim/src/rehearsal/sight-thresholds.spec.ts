/**
 * The distance lines the sight sensor draws, read through whole staged
 * scenarios. `nearby` reads true within 100 px and `far away` beyond 300 px,
 * each repeat of the modifier dividing or multiplying the squared threshold:
 * `nearby` stands at 100, 70.711 and 57.735 px for one, two and three repeats,
 * `far away` at 300, 424.264 and 519.615 px, and every reading is bounded by
 * the archetype's 600 px vision range.
 *
 * Stage a scenario one pixel to either side of a line, never on it. At exactly
 * the threshold distance the comparison is a floating-point coin flip that
 * lands both ways within a single run; a pixel off it is decided and holds for
 * every think. A rehearsal arena carries no line-of-sight blockers, so a
 * creature staged inside the vision cone is seen at every distance the range
 * covers.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AuthoringWorkspace, ScenarioInput, SimulationRun } from "@wendoo/assistant-bridge";
import { createAuthoringWorkspace, proposeEdit } from "@wendoo/assistant-bridge";
import { ruleIdAt } from "@wendoo/assistant-bridge/testing";
import { createTargetAdapter } from "./adapter";
import { sourceRehearsalContent } from "./source-content";

/** The app's own assets, read from the tree these specs run in. */
const CONTENT = sourceRehearsalContent();

/** Seed every run here stages its world from. */
const SEED = 20260805;

/** Population role the brain under study drives. */
const SUBJECT = "herbivore";

/** Fixed steps each run covers. */
const RUN_THINKS = 180;

/** Percept kind every run scripts, and the kind of creature it stages. */
const STAGED_KIND = "plant-ahead";

/** Tiles the reading rules are built from. */
const SEE = "tile.sensor->sensor.see";
const STAGED_ACTOR_KIND = "tile.modifier->modifier.actor_kind.plant";
const NEARBY = "tile.modifier->modifier.distance.nearby";
const FAR_AWAY = "tile.modifier->modifier.distance.faraway";
const WANDER = ["tile.actuator->actuator.move", "tile.modifier->modifier.movement.wander"];

/** Repeats of a distance modifier one rule may carry. */
const REPEATS = [0, 1, 2, 3] as const;

/**
 * A workspace whose creature under study wanders on a rule with no gate, and
 * reads `see` for the staged kind on four further rules: one carrying no
 * distance modifier, and one for each repeat of `distanceTile`. The reading
 * rules place no action tiles, leaving a run's world identical at every
 * distance.
 */
function readingWorkspace(distanceTile: string): { workspace: AuthoringWorkspace; rules: readonly string[] } {
  const workspace = createAuthoringWorkspace(createTargetAdapter(CONTENT), "distance reading brain");
  const wandering = proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: ruleIdAt(workspace.brainDef, "0/0"),
    side: "do",
    tileIds: WANDER,
  });
  assert.equal(wandering.ok, true, JSON.stringify(wandering));

  const rules: string[] = [];
  for (const repeats of REPEATS) {
    const added = proposeEdit(workspace, { op: "addRule", pageIndex: 0 });
    assert.equal(added.ok, true, JSON.stringify(added));
    const ruleId = ruleIdAt(workspace.brainDef, `0/${repeats + 1}`);
    rules.push(ruleId);
    const when = proposeEdit(workspace, {
      op: "placeTiles",
      ruleId,
      side: "when",
      tileIds: [SEE, STAGED_ACTOR_KIND, ...Array.from({ length: repeats }, () => distanceTile)],
    });
    assert.equal(when.ok, true, JSON.stringify(when));
  }
  return { workspace, rules };
}

/**
 * Rehearse `workspace` over a scenario holding one creature `distance` pixels
 * directly ahead of the creature under study for the whole run. The single
 * input leaves the staging holding the world's entire population of the staged
 * kind from the first step on.
 */
function rehearse(workspace: AuthoringWorkspace, distance: number): Promise<SimulationRun> {
  const inputs: ScenarioInput[] = [{ kind: STAGED_KIND, at: 0, value: distance }];
  return workspace.adapter.run({
    brainDef: workspace.brainDef,
    scenario: { seed: SEED, subject: SUBJECT, inputs },
    thinks: RUN_THINKS,
  });
}

/** Thinks the run recorded a reading of `ruleId` on, and the ones it read true. */
function readings(run: SimulationRun, ruleId: string): { read: number; fired: number } {
  let read = 0;
  let fired = 0;
  for (const think of run.observations) {
    const gate = think.gates.find((entry) => entry.ruleId === ruleId);
    if (!gate) continue;
    read++;
    if (gate.fired) fired++;
  }
  return { read, fired };
}

/** Assert `ruleId` read true on every think it was read on, having been read at all. */
function assertReadsThroughout(run: SimulationRun, ruleId: string, where: string): void {
  const reading = readings(run, ruleId);
  assert.ok(reading.read > 0, `the creature under study read nothing at ${where}`);
  assert.equal(reading.fired, reading.read, `the reading did not hold through the run at ${where}`);
}

/**
 * Assert the staged creature was in sight throughout, that the first `passing`
 * repeats of the distance modifier read true on every think, and that every
 * deeper repeat read false on all of them.
 */
function assertRepeatsPassing(run: SimulationRun, rules: readonly string[], passing: number, where: string): void {
  assert.equal(run.thinks, RUN_THINKS, `the creature under study did not live through the run at ${where}`);
  assertReadsThroughout(run, rules[0], `${where}, with no distance modifier`);
  for (const repeats of REPEATS) {
    if (repeats === 0) continue;
    const reading = readings(run, rules[repeats]);
    assert.equal(
      reading.fired,
      repeats <= passing ? reading.read : 0,
      `${repeats} repeats read ${reading.fired} of ${reading.read} thinks true at ${where}`
    );
  }
}

describe("the distance lines an ecosim rehearsal reads a staged creature across", () => {
  test("reads `nearby` within 100 px, and one repeat deeper within 70.711 and 57.735 px", async () => {
    const { workspace, rules } = readingWorkspace(NEARBY);

    for (const [distance, passing] of [
      [57, 3],
      [58, 2],
      [70, 2],
      [71, 1],
      [99, 1],
      [101, 0],
    ]) {
      assertRepeatsPassing(await rehearse(workspace, distance), rules, passing, `${distance} px`);
    }
  });

  test("reads `far away` beyond 300 px, and one repeat deeper beyond 424.264 and 519.615 px", async () => {
    const { workspace, rules } = readingWorkspace(FAR_AWAY);

    for (const [distance, passing] of [
      [299, 0],
      [301, 1],
      [424, 1],
      [425, 2],
      [519, 2],
      [520, 3],
    ]) {
      assertRepeatsPassing(await rehearse(workspace, distance), rules, passing, `${distance} px`);
    }
  });

  test("reads nothing at all past the 600 px vision range", async () => {
    const { workspace, rules } = readingWorkspace(FAR_AWAY);

    const inRange = await rehearse(workspace, 599);
    const pastRange = await rehearse(workspace, 601);

    for (const repeats of REPEATS) {
      assertReadsThroughout(inRange, rules[repeats], `599 px, with ${repeats} repeats`);
      const reading = readings(pastRange, rules[repeats]);
      assert.ok(reading.read > 0, `the creature under study read nothing at 601 px`);
      assert.equal(reading.fired, 0, `${repeats} repeats read a creature staged past the vision range`);
    }
  });
});
