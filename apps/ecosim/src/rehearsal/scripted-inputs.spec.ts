import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AuthoringWorkspace, ScenarioInput, SimulationRun } from "@mindcraft-lang/assistant-bridge";
import { createAuthoringWorkspace, proposeEdit } from "@mindcraft-lang/assistant-bridge";
import { ARCHETYPE_NAMES } from "@/brain/archetypes";
import { createTargetAdapter } from "./adapter";
import { sourceRehearsalContent } from "./source-content";
import { SCENARIO_INPUT_KINDS } from "./world";

/** The app's own assets, read from the tree these specs run in. */
const CONTENT = sourceRehearsalContent();

/** Seed every run here stages its world from. */
const SEED = 20260805;

/** Population role the brain under study drives. */
const SUBJECT = "herbivore";

/** Think a scripted creature is put in the world. */
const PLACED = 60;

/** Think the scripted creature is taken out of it again. */
const CLEARED = 120;

/** Fixed steps each run covers. */
const RUN_THINKS = 180;

/** Thinks the world may take to carry a staged creature through to the sensor. */
const SENSING_LAG = 3;

/** Distance in world pixels a creature is staged at to be seen but not touched. */
const IN_VIEW = 120;

/** Distance in world pixels a creature is staged at to be in contact with the subject. */
const IN_CONTACT = 10;

/** A workspace whose one rule wanders while `sensorTiles` reads true. */
function gatedWorkspace(sensorTiles: string[]): AuthoringWorkspace {
  const workspace = createAuthoringWorkspace(createTargetAdapter(CONTENT), "scripted-input brain");
  const when = proposeEdit(workspace, { op: "placeTiles", ruleId: "0/0", side: "when", tileIds: sensorTiles });
  assert.equal(when.ok, true, JSON.stringify(when));
  const doSide = proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: "0/0",
    side: "do",
    tileIds: ["tile.actuator->actuator.move", "tile.modifier->modifier.movement.wander"],
  });
  assert.equal(doSide.ok, true, JSON.stringify(doSide));
  return workspace;
}

/** Rehearse `workspace` over a scenario that stages `kind` at `distance` between the two thinks. */
function rehearse(workspace: AuthoringWorkspace, kind: string, distance: number): Promise<SimulationRun> {
  const inputs: ScenarioInput[] = [
    { kind, at: 0, value: 0 },
    { kind, at: PLACED, value: distance },
    { kind, at: CLEARED, value: 0 },
  ];
  return workspace.adapter.run({
    brainDef: workspace.brainDef,
    scenario: { seed: SEED, subject: SUBJECT, inputs },
    thinks: RUN_THINKS,
  });
}

/** Thinks the brain's gate passed on, in order. */
function firedThinks(run: SimulationRun): number[] {
  const thinks: number[] = [];
  run.observations.forEach((observation, think) => {
    if (observation.gates.some((gate) => gate.fired)) thinks.push(think);
  });
  return thinks;
}

/** Assert `fired` covers the staged stretch and nothing outside it, allowing the sensing lag. */
function assertFlippedWithTheStaging(fired: readonly number[]): void {
  assert.deepEqual(
    fired.filter((think) => think < PLACED),
    [],
    "the gate passed before the creature was in the world"
  );
  assert.deepEqual(
    fired.filter((think) => think > CLEARED + SENSING_LAG),
    [],
    "the gate passed after the creature left the world"
  );
  for (let think = PLACED + SENSING_LAG; think < CLEARED; think++) {
    assert.ok(fired.includes(think), `the gate did not pass on think ${think}, with the creature staged`);
  }
}

describe("scripted world causes in an ecosim rehearsal", () => {
  test("reads one percept kind per archetype, and reports them through the adapter", () => {
    assert.deepEqual(createTargetAdapter(CONTENT).inputKinds(), SCENARIO_INPUT_KINDS);
    assert.equal(SCENARIO_INPUT_KINDS.length, ARCHETYPE_NAMES.length);
  });

  test("a creature staged in view turns the sight sensor on, and taking it away turns it off", async () => {
    const run = await rehearse(
      gatedWorkspace(["tile.sensor->sensor.see", "tile.modifier->modifier.actor_kind.carnivore"]),
      "carnivore-ahead",
      IN_VIEW
    );

    assert.equal(run.thinks, RUN_THINKS, "the creature under study lived through the run");
    assertFlippedWithTheStaging(firedThinks(run));
  });

  test("a creature staged in contact turns the bump sensor on, and taking it away turns it off", async () => {
    const run = await rehearse(
      gatedWorkspace(["tile.sensor->sensor.bump", "tile.modifier->modifier.actor_kind.plant"]),
      "plant-ahead",
      IN_CONTACT
    );

    assert.equal(run.thinks, RUN_THINKS, "the creature under study lived through the run");
    assertFlippedWithTheStaging(firedThinks(run));
  });

  test("reproduces a scripted run exactly from the same seed", async () => {
    const tiles = ["tile.sensor->sensor.see", "tile.modifier->modifier.actor_kind.carnivore"];

    const first = await rehearse(gatedWorkspace(tiles), "carnivore-ahead", IN_VIEW);
    const second = await rehearse(gatedWorkspace(tiles), "carnivore-ahead", IN_VIEW);

    assert.deepEqual(second, first);
  });
});
