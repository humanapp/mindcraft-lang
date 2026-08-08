import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { IBrainRuntime, NumberPrecision } from "@mindcraft-lang/core/runtime";
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
function roundingOf(environment: MindcraftEnvironment): number {
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
  staged(): MindcraftEnvironment;
} {
  let environment: MindcraftEnvironment | undefined;
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

/** Rehearse an empty brain over `driver` for one think. */
async function rehearseOver(driver: WorldDriver): Promise<void> {
  const adapter = createRehearsalAdapter({
    targetIdentity: FAKE_TARGET_IDENTITY,
    manifest: { target: "a world", thing: "their signaller", provides: [] },
    tileDocs: () => new Map<string, string>(),
    driver,
  });
  const workspace = createAuthoringWorkspace(adapter, "precision brain");
  await adapter.run({ brainDef: workspace.brainDef, scenario: { seed: 1, subject: FAKE_SUBJECT }, thinks: 1 });
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
});
