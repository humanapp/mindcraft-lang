import type { RandomSource } from "./types";

class SystemRandom implements RandomSource {
  next(): number {
    return Math.random();
  }
}

export const systemRandom: RandomSource = new SystemRandom();
