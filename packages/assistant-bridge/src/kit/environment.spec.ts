import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { List } from "@wendoo/core";
import type { WendooEnvironment } from "@wendoo/core/app";
import type { BrainServices } from "@wendoo/core/brain";
import type {
  BrainSyncFunctionEntry,
  ExecutionContext,
  IBrainRuntime,
  NumberPrecision,
  Value,
} from "@wendoo/core/runtime";
import { CoreFuncId, extractNumberValue } from "@wendoo/core/runtime";
import { createFakeModule } from "../testing/fake-module.js";
import { FAKE_SUBJECT, FAKE_TARGET_IDENTITY } from "../testing/index.js";
import { createAuthoringWorkspace } from "../tools/workspace.js";
import { createRehearsalEnvironment, createSeededRng } from "./environment.js";
import type { RehearsalWorld, WorldDriver, WorldStaging } from "./rehearsal-adapter.js";
import { createRehearsalAdapter } from "./rehearsal-adapter.js";

/**
 * A value the two precisions disagree on: exact at binary64, rounded at
 * binary32.
 */
const SAMPLE = 0.1;

/** What `SAMPLE` becomes once rounded to the nearest binary32 value. */
const SAMPLE_AT_F32 = Math.fround(SAMPLE);

/** The rounding an environment applies to every numeric operator result. */
function roundingOf(environment: WendooEnvironment): number {
  return environment.appServices.numerics.round(SAMPLE);
}

/** A world of one participant running the brain under study, with nothing else in it. */
function stageOneParticipant(staging: WorldStaging): RehearsalWorld {
  const brain = staging.environment.createBrain(staging.subjectBrain);
  brain.startup();
  // The kit reads only the event stream, so the runtime surface suffices.
  const observed: IBrainRuntime = brain;
  staging.observeSubject({ brain: observed, runs: () => true });

  let time = 0;
  return {
    step: () => {
      brain.think(time);
      time += 1000 / 60;
    },
    subjectPresent: () => true,
    participants: () => 1,
    brainsExecuted: () => 1,
    shutdown: () => {
      brain.shutdown();
    },
  };
}

/**
 * A driver over the fake target's module that records the environment it was
 * staged in, declaring `precision` when one is given.
 */
function recordingDriver(precision?: NumberPrecision): {
  readonly driver: WorldDriver;
  staged(): WendooEnvironment;
} {
  let environment: WendooEnvironment | undefined;
  const driver: WorldDriver = {
    modules: () => [createFakeModule()],
    subjects: () => [FAKE_SUBJECT],
    ...(precision === undefined ? {} : { precision: () => precision }),
    stage: (staging: WorldStaging) => {
      environment = staging.environment;
      return Promise.resolve(stageOneParticipant(staging));
    },
  };
  return {
    driver,
    staged: () => {
      assert.ok(environment, "the driver was staged");
      return environment;
    },
  };
}

/** Rehearse an empty brain over `driver` for one think, at `seed`. */
async function rehearseOver(driver: WorldDriver, seed = 1): Promise<void> {
  const adapter = createRehearsalAdapter({
    targetIdentity: FAKE_TARGET_IDENTITY,
    manifest: { target: "a world", thing: "their signaller", provides: [] },
    tileDocs: () => new Map<string, string>(),
    driver,
  });
  const workspace = createAuthoringWorkspace(adapter, "precision brain");
  await adapter.run({ brainDef: workspace.brainDef, scenario: { seed, subject: FAKE_SUBJECT }, thinks: 1 });
}

/** Draws `$$math_random` from `environment` `count` times, as a brain's compiled `Math.random()` does. */
function mathRandomDraws(environment: WendooEnvironment, count: number): number[] {
  const services: BrainServices = environment.withServices((brainServices) => brainServices);
  const entry = services.runtime.functions.getSyncById(CoreFuncId.MathRandom) as BrainSyncFunctionEntry | undefined;
  assert.ok(entry, "the core module registers $$math_random");
  const ctx = { services, fiberId: 0, time: 0, dt: 0, currentTick: 0 } as unknown as ExecutionContext;
  const drawn: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = extractNumberValue(entry.fn.exec(ctx, List.empty<Value>()));
    assert.ok(value !== undefined, "$$math_random returns a number");
    drawn.push(value);
  }
  return drawn;
}

/** How many draws a replay comparison covers. */
const REPLAY_DRAWS = 8;

/** Rehearse at `seed` and report what the brain-side `$$math_random` drew while the world was staged. */
async function rehearsalDraws(seed: number): Promise<number[]> {
  let drawn: number[] | undefined;
  await rehearseOver(
    {
      modules: () => [createFakeModule()],
      subjects: () => [FAKE_SUBJECT],
      stage: (staging: WorldStaging) => {
        drawn = mathRandomDraws(staging.environment, REPLAY_DRAWS);
        return Promise.resolve(stageOneParticipant(staging));
      },
    },
    seed
  );
  assert.ok(drawn, "the driver was staged");
  return drawn;
}

describe("a rehearsal environment", () => {
  test("computes at the host's native double precision when none is declared", () => {
    const environment = createRehearsalEnvironment({
      modules: [createFakeModule()],
      rng: createSeededRng(1),
    });

    assert.equal(roundingOf(environment), SAMPLE);
  });

  test("computes at single precision when f32 is declared", () => {
    const environment = createRehearsalEnvironment({
      modules: [createFakeModule()],
      rng: createSeededRng(1),
      precision: "f32",
    });

    assert.equal(roundingOf(environment), SAMPLE_AT_F32);
    assert.notEqual(SAMPLE_AT_F32, SAMPLE);
  });
});

describe("a rehearsal over a world driver", () => {
  test("rehearses at the precision its world driver declares", async () => {
    const recorded = recordingDriver("f32");

    await rehearseOver(recorded.driver);

    assert.equal(roundingOf(recorded.staged()), SAMPLE_AT_F32);
  });

  test("rehearses at the host's native double precision when its driver declares none", async () => {
    const recorded = recordingDriver();

    await rehearseOver(recorded.driver);

    assert.equal(roundingOf(recorded.staged()), SAMPLE);
  });

  test("reproduces the brain's random draws when the same seed is rehearsed again", async () => {
    const first = await rehearsalDraws(20260812);
    const replayed = await rehearsalDraws(20260812);

    assert.deepEqual(replayed, first);
  });

  test("draws differently under a different seed", async () => {
    const first = await rehearsalDraws(20260812);
    const other = await rehearsalDraws(31415926);

    assert.notDeepEqual(other, first);
  });
});
