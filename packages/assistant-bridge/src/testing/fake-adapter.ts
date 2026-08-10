import type { MindcraftBrain } from "@mindcraft-lang/core/app";
import type { RehearsalWorld, WorldDriver, WorldStaging } from "../kit/index.js";
import { createRehearsalAdapter } from "../kit/index.js";
import type { ScenarioInputKind, TargetAdapter, TargetManifest } from "../target/adapter.js";
import type { FakeRinging, FakeWorldState } from "./fake-module.js";
import { createFakeModule } from "./fake-module.js";

/** Mindcraft identity the fake target's adapter reports itself as. */
export const FAKE_TARGET_IDENTITY = "example-org/trg-fake";

/** The one role a fake scenario may put under study. */
export const FAKE_SUBJECT = "signaller";

/** Name of the one percept kind a fake scenario may script. */
export const FAKE_INPUT_KIND = "signal";

/** The one percept kind a fake scenario may script, as the driver registers it. */
const inputKinds: readonly ScenarioInputKind[] = [
  { name: FAKE_INPUT_KIND, description: "Whether the signal is on: true holds it on, false holds it off." },
];

const manifest: TargetManifest = {
  target: "a world with one signal and one emitter",
  thing: "their signaller",
  provides: ["A signaller can tell whether the signal is on.", "A signaller can emit, loudly or at a given strength."],
};

/** Milliseconds one think of the fake world advances. */
const stepMs = 1000 / 60;

/** Thinks a call of `actuator.fake.ring` stays in flight before the fake world settles it. */
export const FAKE_RING_THINKS = 2;

/**
 * The fake world: one participant running the brain under study, and a signal
 * the seeded stream raises or lowers before every think, or that the scenario
 * scripts.
 */
class FakeWorld implements RehearsalWorld {
  private readonly state: FakeWorldState = { signal: false };
  private readonly brain: MindcraftBrain;
  private time = 0;
  private alive = true;
  /** Zero-based index of the think the next {@link step} runs. */
  private think = 0;
  /** The scripted signal level in force, or `undefined` while the seeded stream drives it. */
  private scripted: boolean | undefined;
  /** Ring calls in flight, each with the think it was made on. */
  private ringing: { ring: FakeRinging; at: number }[] = [];

  constructor(private readonly staging: WorldStaging) {
    this.brain = staging.environment.createBrain(staging.subjectBrain, { context: this.state });
    this.brain.startup();
    staging.observeSubject({ brain: this.brain, runs: () => true });
  }

  step(): void {
    for (const entry of this.ringing) {
      if (this.think - entry.at >= FAKE_RING_THINKS) entry.ring.settle();
    }
    this.ringing = this.ringing.filter((entry) => this.think - entry.at < FAKE_RING_THINKS);

    const drawn = this.staging.next() < 0.5;
    for (const input of this.staging.inputs) {
      if (input.at === this.think) this.scripted = Boolean(input.value);
    }
    this.state.signal = this.scripted ?? drawn;
    this.brain.think(this.time);

    for (const ring of this.state.ringing ?? []) this.ringing.push({ ring, at: this.think });
    this.state.ringing = [];

    this.time += stepMs;
    this.think++;
  }

  subjectPresent(): boolean {
    return this.alive;
  }

  participants(): number {
    return this.alive ? 1 : 0;
  }

  brainsExecuted(): number {
    return 1;
  }

  shutdown(): void {
    this.alive = false;
    this.brain.shutdown();
  }
}

/** The fake target's world driver: a single participant, no world beyond its signal. */
const driver: WorldDriver = {
  modules: () => [createFakeModule()],
  subjects: () => [FAKE_SUBJECT],
  inputKinds: () => inputKinds,
  stage: (staging: WorldStaging) => Promise.resolve(new FakeWorld(staging)),
};

/**
 * The fake target adapter: the smallest world driver the kit can carry, for
 * exercising the bridge's tools and the conformance suite without a target.
 */
export function createTargetAdapter(): TargetAdapter {
  return createRehearsalAdapter({
    targetIdentity: FAKE_TARGET_IDENTITY,
    manifest,
    tileDocs: () => new Map<string, string>(),
    driver,
  });
}
