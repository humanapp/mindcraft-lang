import type { RandomSource } from "./types";

// Mulberry32 -- a fast, high-quality 32-bit PRNG.
// Period: 2^32. Passes BigCrush. Minimal state (single u32).
export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  next(): number {
    this.state += 0x6d2b79f5;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }

  fork(): SeededRandom {
    return new SeededRandom((this.next() * 0x100000000) | 0);
  }
}
