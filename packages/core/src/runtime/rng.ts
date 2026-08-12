import { MathOps } from "../platform/math";
import type { IRngServices } from "./services";

/**
 * A seeded pseudo-random stream, one per instance. Draws come from a 32-bit
 * linear congruential generator (a = 1664525, c = 1013904223, modulus 2^32);
 * the same seed always yields the same sequence, and two instances never share
 * state.
 */
export class Rng implements IRngServices {
  private state_: number;

  /** @param seed - Starting state, taken modulo 2^32. Defaults to 1. */
  constructor(seed: number = 1) {
    this.state_ = seed >>> 0;
  }

  /** Advances the stream and returns its next value in `[0, 1)`. */
  next(): number {
    this.state_ = (this.state_ * 1664525 + 1013904223) >>> 0;
    return this.state_ / 4294967296;
  }
}

/**
 * Creates an {@link Rng} seeded from {@link MathOps.entropy}, so each call
 * produces a stream unrelated to every other.
 */
export function createEntropySeededRng(): Rng {
  return new Rng(MathOps.floor(MathOps.entropy() * 4294967296));
}
