import type { MindcraftEnvironment, MindcraftModule } from "@mindcraft-lang/core/app";
import { coreModule, createMindcraftEnvironment, Rng } from "@mindcraft-lang/core/app";
import type { NumberPrecision } from "@mindcraft-lang/core/runtime";
import { createProfileNumerics } from "@mindcraft-lang/core/runtime";

/**
 * A seeded pseudo-random generator producing values in `[0, 1)`. The same seed
 * always yields the same sequence, so every choice a rehearsal draws from it is
 * reproducible.
 */
export function createSeededRng(seed: number): () => number {
  const rng = new Rng(seed);
  return () => rng.next();
}

/** How a rehearsal environment is built. */
export interface RehearsalEnvironmentOptions {
  /** Modules to install beyond core's own. */
  readonly modules: readonly MindcraftModule[];
  /** The run's seeded random stream, shared with every brain in the environment. */
  readonly rng: () => number;
  /**
   * Precision every number the environment's brains compute is rounded to.
   * Defaults to `"f64"`, the host's native double precision.
   */
  readonly precision?: NumberPrecision;
}

/**
 * Build the environment one rehearsal runs in: core's modules plus the
 * target's, computing numbers at `options.precision` and drawing randomness
 * from `options.rng`.
 */
export function createRehearsalEnvironment(options: RehearsalEnvironmentOptions): MindcraftEnvironment {
  return createMindcraftEnvironment({
    modules: [coreModule(), ...options.modules],
    rng: { next: options.rng },
    numerics: createProfileNumerics(options.precision ?? "f64"),
  });
}
