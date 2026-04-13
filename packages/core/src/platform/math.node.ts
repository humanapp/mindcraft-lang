/**
 * Platform-agnostic math operations - Node.js implementation
 */

// Internal state for random number generator
let randomSeed = 1;

export const MathOps = {
  ceil: (n: number) => Math.ceil(n),
  floor: (n: number) => Math.floor(n),
  round: (n: number) => Math.round(n),
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
  acos: (n: number) => Math.acos(n),
  asin: (n: number) => Math.asin(n),
  atan: (n: number) => Math.atan(n),
  atan2: (y: number, x: number) => Math.atan2(y, x),
  cos: (n: number) => Math.cos(n),
  exp: (n: number) => Math.exp(n),
  log: (n: number) => Math.log(n),
  pow: (base: number, exp: number) => base ** exp,
  bitAnd: (a: number, b: number) => a & b,
  bitOr: (a: number, b: number) => a | b,
  bitXor: (a: number, b: number) => a ^ b,
  bitNot: (a: number) => ~a,
  leftShift: (a: number, b: number) => a << b,
  rightShift: (a: number, b: number) => a >> b,
  sin: (n: number) => Math.sin(n),
  sqrt: (n: number) => Math.sqrt(n),
  tan: (n: number) => Math.tan(n),
  parseFloat: (value: string) => Number.parseFloat(value),
  isNaN: (value: number) => Number.isNaN(value),
};

export const INFINITY = Number.POSITIVE_INFINITY;
