/**
 * Platform-agnostic math operations - Node.js implementation
 */

// Internal state for random number generator
let randomSeed = 1;

export const MathOps = {
  ceil: (n: number) => Math.ceil(n),
  floor: (n: number) => Math.floor(n),
  random: () => {
    // Simple LCG (Linear Congruential Generator) for cross-platform deterministic random
    // Uses a = 1664525, c = 1013904223, m = 2^32 (Numerical Recipes parameters)
    randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
    return randomSeed / 4294967296; // Convert to [0, 1)
  },
  min: (a: number, b: number) => Math.min(a, b),
  max: (a: number, b: number) => Math.max(a, b),
  clz32: (n: number) => Math.clz32(n),
  abs: (n: number) => Math.abs(n),
  parseFloat: (value: string) => Number.parseFloat(value),
  isNaN: (value: number) => Number.isNaN(value),
};

export const INFINITY = Number.POSITIVE_INFINITY;
