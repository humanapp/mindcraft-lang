import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import type { ScenarioInput } from "@mindcraft-lang/assistant-bridge";
import { createRehearsalEnvironment, createSeededRng } from "@mindcraft-lang/assistant-bridge/kit";
import type { Actor, Archetype } from "@/brain/actor";
import { ARCHETYPE_NAMES, ARCHETYPES } from "@/brain/archetypes";
import { createEcosimModule } from "@/brain/index";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/brain/world-definition";
import { createRehearsalWorld, STEP_MS, type WorldObserver } from "./world";

/** Number of fixed steps a rehearsal runs. */
const RUN_TICKS = 600;

/** Population role a scripted run puts under study. */
const SCRIPTED_SUBJECT: Archetype = "herbivore";

/** One rehearsal's accumulated observations. */
class RunObservations implements WorldObserver {
  /** Per-tick, per-actor host-action dispatch counts keyed `actorId -> actionKey -> count`. */
  readonly tickDispatch = new Map<number, Map<string, number>>();
  /** Total host-action dispatches over the whole run, keyed by action key. */
  readonly totalDispatch = new Map<string, number>();
  /** Number of `think` calls the run executed. */
  thinks = 0;
  /** Number of chat-bubble creations (the `say` actuator reaching presentation). */
  says = 0;
  /** Number of blips activated (the `shoot` actuator reaching presentation). */
  blipsFired = 0;
  /** Number of actors spawned into the world, initial population plus respawns. */
  spawns = 0;
  /** The first actor spawned in the role a scripted run puts under study. */
  subject: Actor | undefined;

  onDispatch(actorId: number, action: string): void {
    let perActor = this.tickDispatch.get(actorId);
    if (!perActor) {
      perActor = new Map<string, number>();
      this.tickDispatch.set(actorId, perActor);
    }
    perActor.set(action, (perActor.get(action) ?? 0) + 1);
    this.totalDispatch.set(action, (this.totalDispatch.get(action) ?? 0) + 1);
  }

  /** Count the spawn and follow the new actor's brain for the actions it dispatches. */
  onSpawn(actor: Actor): void {
    this.spawns++;
    if (this.subject === undefined && actor.archetype === SCRIPTED_SUBJECT) this.subject = actor;
    actor.brain.events().on("host_action_dispatched", ({ descriptor }) => {
      this.onDispatch(actor.actorId, descriptor.key);
    });
  }

  onSay(): void {
    this.says++;
  }

  onBlipFired(): void {
    this.blipsFired++;
  }
}

/** What one rehearsal produced. */
interface RunResult {
  /** One line per tick, in order. Byte-identical lines mean identical runs. */
  trace: string[];
  /** Hex SHA-256 of the whole trace. */
  hash: string;
  observations: RunObservations;
  /** Distinct brain defs held by the actors alive at the end of the run. */
  brainsExecuted: number;
  /** Actor count at the end of the run. */
  finalActors: number;
  /** Static obstacle bodies the world was built with. */
  obstacleCount: number;
}

/** One tick's serialization: every actor's state plus the actions its brain dispatched. */
function traceTick(tick: number, actors: readonly Actor[], obs: RunObservations): string {
  const parts: string[] = [`t=${tick}`];
  for (const actor of actors) {
    const fired = obs.tickDispatch.get(actor.actorId);
    const firedText = fired
      ? [...fired.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([key, count]) => `${key}:${count}`)
          .join("+")
      : "-";
    parts.push(
      [
        actor.actorId,
        actor.archetype,
        actor.sprite.x.toFixed(6),
        actor.sprite.y.toFixed(6),
        actor.sprite.rotation.toFixed(6),
        actor.energy.toFixed(6),
        firedText,
      ].join(":")
    );
  }
  return parts.join("|");
}

/**
 * Run one whole-world rehearsal: stage the shipped world, populate it to the
 * app's default counts, and step gameplay and physics at a fixed timestep for
 * `ticks` steps, recording a trace line per tick.
 *
 * @param inputs Percepts the run scripts, each applied before the think it names.
 */
async function runRehearsal(seed: number, ticks: number, inputs: readonly ScenarioInput[] = []): Promise<RunResult> {
  const obs = new RunObservations();
  const next = createSeededRng(seed);
  const environment = createRehearsalEnvironment({
    modules: [createEcosimModule()],
    rng: next,
  });
  const world = await createRehearsalWorld({
    environment,
    next,
    observer: obs,
    ...(inputs.length > 0 ? { scripted: { inputs, subject: () => obs.subject } } : {}),
  });

  const trace: string[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    obs.tickDispatch.clear();
    obs.thinks += world.actors().length;
    world.step();
    trace.push(traceTick(tick, world.actors(), obs));
  }

  const actors = world.actors();
  const brainsExecuted = new Set(actors.map((actor) => actor.brainDef)).size;
  const finalActors = actors.length;
  world.shutdown();

  return {
    trace,
    hash: createHash("sha256").update(trace.join("\n")).digest("hex"),
    observations: obs,
    brainsExecuted,
    finalActors,
    obstacleCount: world.obstacleCount,
  };
}

/** The number of actor entries a trace line carries. */
function actorsInTraceLine(line: string): number {
  return line.split("|").length - 1;
}

/** The first line index at which two traces differ, or -1 when they are identical. */
function firstDivergence(a: string[], b: string[]): number {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : limit;
}

/** The first field index at which two trace lines differ. */
function firstDifferingField(a: string, b: string): string {
  const fieldsA = a.split("|");
  const fieldsB = b.split("|");
  const limit = Math.min(fieldsA.length, fieldsB.length);
  for (let i = 0; i < limit; i++) {
    if (fieldsA[i] !== fieldsB[i]) return `field ${i}: ${fieldsA[i]} vs ${fieldsB[i]}`;
  }
  return `field count ${fieldsA.length} vs ${fieldsB.length}`;
}

function formatDispatch(totals: Map<string, number>): string {
  return [...totals.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, count]) => `${key}=${count}`)
    .join(" ");
}

describe("headless whole-world rehearsal", () => {
  test("runs the shipped world at a fixed timestep and reproduces it from the same seed", async () => {
    const first = await runRehearsal(20260805, RUN_TICKS);
    const second = await runRehearsal(20260805, RUN_TICKS);
    const other = await runRehearsal(20260806, RUN_TICKS);

    const initialPopulation = actorsInTraceLine(first.trace[0] ?? "");
    const peakPopulation = first.trace.reduce((peak, line) => Math.max(peak, actorsInTraceLine(line)), 0);
    const divergence = firstDivergence(first.trace, second.trace);
    const verdict =
      divergence < 0
        ? "identical"
        : `diverged at tick ${divergence} (${firstDifferingField(first.trace[divergence] ?? "", second.trace[divergence] ?? "")})`;

    console.log(
      [
        "",
        "-- headless whole-world rehearsal --",
        `ticks:            ${RUN_TICKS} at ${STEP_MS.toFixed(4)} ms fixed step`,
        `world:            ${WORLD_WIDTH}x${WORLD_HEIGHT}, ${first.obstacleCount} obstacles, 4 boundary walls`,
        `entities:         ${initialPopulation} on the first step, ${peakPopulation} at peak, ${first.observations.spawns} spawned in total, ${first.finalActors} alive at end`,
        `brains executed:  ${first.brainsExecuted} distinct brain defs (${ARCHETYPE_NAMES.join(", ")})`,
        `thinks:           ${first.observations.thinks}`,
        `dispatches:       ${formatDispatch(first.observations.totalDispatch)}`,
        `say / shoot:      ${first.observations.says} chat bubbles, ${first.observations.blipsFired} blips fired`,
        `trace hash run 1: ${first.hash}`,
        `trace hash run 2: ${second.hash}`,
        `trace hash alt:   ${other.hash} (different seed)`,
        `trace verdict:    ${verdict}`,
        "",
      ].join("\n")
    );

    const expectedPopulation = ARCHETYPE_NAMES.reduce(
      (sum, archetype) => sum + ARCHETYPES[archetype].initialSpawnCount,
      0
    );
    assert.equal(peakPopulation, expectedPopulation, "the world populates to the app's default counts");
    assert.equal(first.obstacleCount, 4, "the world carries the scene's obstacle set");
    assert.equal(first.brainsExecuted, 3, "one distinct brain def per archetype is executing");
    assert.ok(first.observations.thinks > 0, "brains thought during the run");
    assert.ok(first.observations.totalDispatch.has("sensor.see"), "brains sensed each other");
    assert.ok(first.observations.totalDispatch.has("actuator.move"), "brains acted on the world");
    assert.equal(first.trace.length, RUN_TICKS, "one trace line per tick");
    assert.equal(divergence, -1, verdict);
    assert.equal(first.hash, second.hash, "identical seeds produce byte-identical traces");
    assert.notEqual(first.hash, other.hash, "the seed drives the world the trace records");
  });

  test("stages a scripted cause without drawing from the run's own stream", async () => {
    const staged: ScenarioInput[] = [
      { kind: "carnivore-ahead", at: 0, value: 0 },
      { kind: "carnivore-ahead", at: 150, value: 120 },
    ];
    const restated: ScenarioInput[] = [...staged, { kind: "carnivore-ahead", at: 300, value: 120 }];

    const unscripted = await runRehearsal(20260805, RUN_TICKS);
    const scripted = await runRehearsal(20260805, RUN_TICKS, staged);
    const again = await runRehearsal(20260805, RUN_TICKS, restated);

    assert.notEqual(scripted.hash, unscripted.hash, "the scripted causes reached the world");
    assert.equal(
      again.hash,
      scripted.hash,
      "re-stating a level the world already holds moved the world, so staging it drew from the stream"
    );
  });
});
