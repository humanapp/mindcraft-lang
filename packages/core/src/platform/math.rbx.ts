/**
 * Platform-agnostic math operations - Roblox implementation
 */

// Internal state for random number generator
let randomSeed = 1;

export const MathOps = {
  ceil: (n: number) => {
    const floored = n | 0;
    return n > floored ? floored + 1 : floored;
  },
  floor: (n: number) => n | 0,
  random: () => {
    // Simple LCG (Linear Congruential Generator) for cross-platform deterministic random
    // Uses a = 1664525, c = 1013904223, m = 2^32 (Numerical Recipes parameters)
    randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
    return randomSeed / 4294967296; // Convert to [0, 1)
  },
  min: (a: number, b: number) => (a < b ? a : b),
  max: (a: number, b: number) => (a > b ? a : b),
  clz32: (n: number) => {
    // Count leading zeros for 32-bit integer
    if (n === 0) return 32;
    let count = 0;
    if ((n & 0xffff0000) === 0) {
      count += 16;
      n <<= 16;
    }
    if ((n & 0xff000000) === 0) {
      count += 8;
      n <<= 8;
    }
    if ((n & 0xf0000000) === 0) {
      count += 4;
      n <<= 4;
    }
    if ((n & 0xc0000000) === 0) {
      count += 2;
      n <<= 2;
    }
    if ((n & 0x80000000) === 0) {
      count += 1;
    }
    return count;
  },
  abs: (n: number) => math.abs(n),
  parseFloat: (value: string) => {
    const num = tonumber(value);
    return num !== undefined ? num : 0 / 0; // NaN
  },
  isNaN: (value: number) => value !== value,
};

export const INFINITY = math.huge;
