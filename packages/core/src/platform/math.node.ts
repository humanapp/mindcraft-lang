/**
 * Platform-agnostic math operations - Node.js implementation
 */

export const MathOps = {
  ceil: (n: number) => Math.ceil(n),
  floor: (n: number) => Math.floor(n),
  round: (n: number) => Math.round(n),
  fround: (n: number) => Math.fround(n),
  entropy: () => Math.random(),
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
