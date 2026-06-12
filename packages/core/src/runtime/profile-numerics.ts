import { MathOps } from "../platform/math";
import { StringUtils as SU } from "../platform/string";
import type { NumberPrecision } from "./brain-program-binary-codec";

/**
 * Brain-observable numeric semantics for a device profile.
 *
 * One instance is selected when an environment is constructed (see
 * `AppServices.numerics`) and captured by the operator, conversion, and
 * math-builtin exec bodies at registration time. Every number a brain can
 * observe flows through this interface; VM-internal mechanics (operand
 * indexing, codec encoding, scheduler bookkeeping) do not and stay
 * profile-invariant.
 */
export interface ProfileNumerics {
  /**
   * Result-rounding policy applied to every numeric operator result.
   * Identity at f64. At f32, rounds to the nearest IEEE-754 binary32 value
   * (`Math.fround` semantics); a result whose magnitude exceeds the f32
   * range rounds to an infinity.
   */
  round: (x: number) => number;

  /** Power function at the profile's precision. */
  pow: (base: number, exponent: number) => number;

  /** Sine at the profile's precision. The argument is in radians. */
  sin: (x: number) => number;

  /** Cosine at the profile's precision. The argument is in radians. */
  cos: (x: number) => number;

  /** Tangent at the profile's precision. The argument is in radians. */
  tan: (x: number) => number;

  /** Arcsine at the profile's precision. Returns radians. */
  asin: (x: number) => number;

  /** Arccosine at the profile's precision. Returns radians. */
  acos: (x: number) => number;

  /** Arctangent at the profile's precision. Returns radians. */
  atan: (x: number) => number;

  /** Two-argument arctangent at the profile's precision. Returns radians. */
  atan2: (y: number, x: number) => number;

  /** Natural exponential at the profile's precision. */
  exp: (x: number) => number;

  /** Natural logarithm at the profile's precision. */
  log: (x: number) => number;

  /** Square root at the profile's precision. */
  sqrt: (x: number) => number;

  /** Formats a number as its decimal string form at the profile's precision. */
  formatNumber: (x: number) => string;

  /**
   * Parses a decimal string to a number at the profile's precision.
   * Unparseable input yields `0`.
   */
  parseNumber: (text: string) => number;
}

/**
 * Creates the f64 {@link ProfileNumerics}: native double-precision semantics.
 * `round` is the identity and every other slot delegates to the host's
 * double-precision math. This is the default for in-process consumers.
 */
export function createF64ProfileNumerics(): ProfileNumerics {
  return {
    round: (x: number) => x,
    pow: (base: number, exponent: number) => MathOps.pow(base, exponent),
    sin: (x: number) => MathOps.sin(x),
    cos: (x: number) => MathOps.cos(x),
    tan: (x: number) => MathOps.tan(x),
    asin: (x: number) => MathOps.asin(x),
    acos: (x: number) => MathOps.acos(x),
    atan: (x: number) => MathOps.atan(x),
    atan2: (y: number, x: number) => MathOps.atan2(y, x),
    exp: (x: number) => MathOps.exp(x),
    log: (x: number) => MathOps.log(x),
    sqrt: (x: number) => MathOps.sqrt(x),
    formatNumber: (x: number) => SU.toString(x),
    parseNumber: (text: string) => {
      const n = MathOps.parseFloat(text);
      return MathOps.isNaN(n) ? 0 : n;
    },
  };
}

/**
 * Creates the f32 {@link ProfileNumerics}: IEEE-754 binary32 result
 * semantics, modeling a single-precision FPU.
 *
 * `round` and `sqrt` are bit-exact: on f32-representable inputs,
 * rounding the double-precision result of `+ - * / %` and `sqrt` to f32
 * is the correctly-rounded f32 result.
 *
 * The transcendental slots (`pow`, `sin`, ...), `formatNumber`, and
 * `parseNumber` are not yet pinned to a device reference implementation:
 * they delegate to the host's double-precision math and round numeric
 * results to f32, so their low-order result bits may differ from a
 * device's libm until the pinned implementations land.
 */
export function createF32ProfileNumerics(): ProfileNumerics {
  const fround = MathOps.fround;
  return {
    round: (x: number) => fround(x),
    pow: (base: number, exponent: number) => fround(MathOps.pow(base, exponent)),
    sin: (x: number) => fround(MathOps.sin(x)),
    cos: (x: number) => fround(MathOps.cos(x)),
    tan: (x: number) => fround(MathOps.tan(x)),
    asin: (x: number) => fround(MathOps.asin(x)),
    acos: (x: number) => fround(MathOps.acos(x)),
    atan: (x: number) => fround(MathOps.atan(x)),
    atan2: (y: number, x: number) => fround(MathOps.atan2(y, x)),
    exp: (x: number) => fround(MathOps.exp(x)),
    log: (x: number) => fround(MathOps.log(x)),
    sqrt: (x: number) => fround(MathOps.sqrt(x)),
    formatNumber: (x: number) => SU.toString(x),
    parseNumber: (text: string) => {
      const n = MathOps.parseFloat(text);
      return MathOps.isNaN(n) ? 0 : fround(n);
    },
  };
}

/**
 * Creates the {@link ProfileNumerics} for a device profile's declared
 * number precision.
 *
 * @param precision - The profile's number precision (`"f32"` or `"f64"`).
 */
export function createProfileNumerics(precision: NumberPrecision): ProfileNumerics {
  return precision === "f32" ? createF32ProfileNumerics() : createF64ProfileNumerics();
}
