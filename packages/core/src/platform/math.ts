/**
 * Platform-agnostic math operations
 */

export declare const MathOps: {
  ceil: (n: number) => number;
  floor: (n: number) => number;
  round: (n: number) => number;
  random: () => number;
  min: (a: number, b: number) => number;
  max: (a: number, b: number) => number;
  clz32: (n: number) => number;
  abs: (n: number) => number;
  acos: (n: number) => number;
  asin: (n: number) => number;
  atan: (n: number) => number;
  atan2: (y: number, x: number) => number;
  cos: (n: number) => number;
  exp: (n: number) => number;
  log: (n: number) => number;
  pow: (base: number, exp: number) => number;
  bitAnd: (a: number, b: number) => number;
  bitOr: (a: number, b: number) => number;
  bitXor: (a: number, b: number) => number;
  bitNot: (a: number) => number;
  leftShift: (a: number, b: number) => number;
  rightShift: (a: number, b: number) => number;
  sin: (n: number) => number;
  sqrt: (n: number) => number;
  tan: (n: number) => number;
  parseFloat: (value: string) => number;
  isNaN: (value: number) => boolean;
};

/** Positive infinity constant. Cross-platform alias for `Number.POSITIVE_INFINITY`. */
export declare const INFINITY: number;
