/**
 * Platform-agnostic math operations
 */

export declare const MathOps: {
  ceil: (n: number) => number;
  floor: (n: number) => number;
  random: () => number;
  min: (a: number, b: number) => number;
  max: (a: number, b: number) => number;
  clz32: (n: number) => number;
  abs: (n: number) => number;
  parseFloat: (value: string) => number;
  isNaN: (value: number) => boolean;
};

export declare const INFINITY: number;
