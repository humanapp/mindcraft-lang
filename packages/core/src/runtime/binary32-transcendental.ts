import { INFINITY, MathOps } from "../platform/math";

/**
 * Single-precision (IEEE binary32) transcendental functions for the device
 * numeric profile. Every operation rounds to binary32 (`Math.fround`) after
 * each step. Results are a few ULP accurate, not correctly rounded.
 *
 * Algorithms and coefficients are ported from the Cephes single-precision math
 * library by Stephen L. Moshier (Release 2.2, 1992).
 */

const f = MathOps.fround;
const f32add = (a: number, b: number): number => f(a + b);
const f32sub = (a: number, b: number): number => f(a - b);
const f32mul = (a: number, b: number): number => f(a * b);
const f32div = (a: number, b: number): number => f(a / b);
const sqrtf = (v: number): number => f(MathOps.sqrt(v));
const floorf = (v: number): number => MathOps.floor(v);
const NAN_F = 0 / 0;
const isFiniteValue = (x: number): boolean => !MathOps.isNaN(x) && x !== INFINITY && x !== -INFINITY;

// biome-ignore lint/suspicious/noApproximativeNumericConstant: intentional binary32 literal, not an approximation to replace
const PI = f(3.141592653589793);
const HALF_PI = f(1.5707963267948966);
const QUARTER_PI = f(0.7853981633974483);
const FOUR_OVER_PI = f(1.27323954473516);
// Cody-Waite three-part pi/4, for sine/cosine/tangent argument reduction.
const DP1 = f(0.78515625);
const DP2 = f(0.00024187564849853516);
const DP3 = f(3.774894977445941e-8);
const SIN_LOSS_THRESHOLD = f(8192.0);
const INTEGER_LIMIT = f(16777215.0); // 2^24 - 1
// biome-ignore lint/suspicious/noApproximativeNumericConstant: intentional binary32 literal, not an approximation to replace
const LOG2E = f(1.4426950408889634);
const SQRT_HALF = f(MathOps.sqrt(0.5));
// Cody-Waite two-part ln(2): LN2_HI + LN2_LO.
const LN2_HI = f(0.693359375);
const LN2_LO = f(-2.1219444e-4);
const MAX_LOG = f(88.72283905206835);
const MIN_LOG = f(-103.27892990343184);

const SIN_COF = [-1.9515295891e-4, 8.3321608736e-3, -1.6666654611e-1].map(f);
const COS_COF = [2.443315711809948e-5, -1.388731625493765e-3, 4.166664568298827e-2].map(f);
const TAN_COF = [
  9.38540185543e-3, 3.11992232697e-3, 2.44301354525e-2, 5.34112807005e-2, 1.33387994085e-1, 3.33331568548e-1,
].map(f);
const ASIN_COF = [4.2163199048e-2, 2.4181311049e-2, 4.5470025998e-2, 7.4953002686e-2, 1.6666752422e-1].map(f);
const ATAN_COF = [8.05374449538e-2, -1.38776856032e-1, 1.99777106478e-1, -3.33329491539e-1].map(f);
const EXP_COF = [
  1.98756915e-4, 1.3981999507e-3, 8.3334519073e-3, 4.1665795894e-2, 1.6666665459e-1, 5.0000001201e-1,
].map(f);
const LOG_COF = [
  7.0376836292e-2, -1.151461031e-1, 1.167699874e-1, -1.2420140846e-1, 1.4249322787e-1, -1.6668057665e-1,
  2.0000714765e-1, -2.4999993993e-1, 3.3333331174e-1,
].map(f);

/** Horner evaluation of a polynomial in `v`, two roundings per term. */
function horner(coeffs: ReadonlyArray<number>, v: number): number {
  let y = coeffs[0];
  let i = 0;
  for (const c of coeffs) {
    if (i > 0) {
      y = f32add(f32mul(y, v), c);
    }
    i++;
  }
  return y;
}

/** Sine on a reduced argument: x + x^3 * P(x^2) with z = x*x. */
function sinReduced(z: number, x: number): number {
  let y = horner(SIN_COF, z);
  y = f32mul(y, z);
  y = f32mul(y, x);
  y = f32add(y, x);
  return y;
}

/** Cosine on a reduced argument: 1 - 0.5*z + z^2 * Q(z) with z = x*x. */
function cosReduced(z: number): number {
  let y = horner(COS_COF, z);
  y = f32mul(y, z);
  y = f32mul(y, z);
  y = f32sub(y, f32mul(f(0.5), z));
  y = f32add(y, f(1.0));
  return y;
}

/** Splits `x` (finite, > 0) into a mantissa in [0.5, 1) and a power-of-two
 * exponent; the halving/doubling steps are exact. */
function frexpValue(x: number): { m: number; e: number } {
  let m = x;
  let e = 0;
  while (m >= 1.0) {
    m = f32mul(m, f(0.5));
    e++;
  }
  while (m < 0.5) {
    m = f32mul(m, f(2.0));
    e--;
  }
  return { m, e };
}

/** Returns z * 2^n with a single final rounding; the power-of-two scale is
 * built exactly. */
function ldexpValue(z: number, n: number): number {
  let scale = f(1.0);
  if (n >= 0) {
    for (let i = 0; i < n; i++) {
      scale = f32mul(scale, f(2.0));
    }
  } else {
    for (let i = 0; i < -n; i++) {
      scale = f32mul(scale, f(0.5));
    }
  }
  return f32mul(z, scale);
}

/** |base|^e by exact binary exponentiation. */
function integerPow(base: number, e: number): number {
  let result = f(1.0);
  let b = base;
  let exp = e;
  while (exp !== 0) {
    if ((exp & 1) !== 0) {
      result = f32mul(result, b);
    }
    b = f32mul(b, b);
    exp = exp >>> 1;
  }
  return result;
}

/** True when `y` is an odd integer (no odd integers are representable past
 * 2^24). */
function isOddInteger(y: number): boolean {
  if (MathOps.floor(y) !== y) {
    return false;
  }
  return MathOps.abs(y) % 2 === 1;
}

/** Sine of `x` radians. */
export function sin(x: number): number {
  if (!isFiniteValue(x)) {
    return NAN_F;
  }
  let sign = 1;
  if (x < 0.0) {
    sign = -1;
    x = -x;
  }
  if (x > INTEGER_LIMIT) {
    return 0.0;
  }
  let j = MathOps.floor(f32mul(FOUR_OVER_PI, x)) >>> 0;
  let y = f(j);
  if ((j & 1) !== 0) {
    j += 1;
    y = f32add(y, f(1.0));
  }
  j = j & 7;
  if (j > 3) {
    sign = -sign;
    j -= 4;
  }
  if (x > SIN_LOSS_THRESHOLD) {
    x = f32sub(x, f32mul(y, QUARTER_PI));
  } else {
    x = f32sub(f32sub(f32sub(x, f32mul(y, DP1)), f32mul(y, DP2)), f32mul(y, DP3));
  }
  const z = f32mul(x, x);
  y = j === 1 || j === 2 ? cosReduced(z) : sinReduced(z, x);
  return sign < 0 ? -y : y;
}

/** Cosine of `x` radians. */
export function cos(x: number): number {
  if (!isFiniteValue(x)) {
    return NAN_F;
  }
  let sign = 1;
  if (x < 0.0) {
    x = -x;
  }
  if (x > INTEGER_LIMIT) {
    return 0.0;
  }
  let j = MathOps.floor(f32mul(FOUR_OVER_PI, x)) >>> 0;
  let y = f(j);
  if ((j & 1) !== 0) {
    j += 1;
    y = f32add(y, f(1.0));
  }
  j = j & 7;
  if (j > 3) {
    j -= 4;
    sign = -sign;
  }
  if (j > 1) {
    sign = -sign;
  }
  if (x > SIN_LOSS_THRESHOLD) {
    x = f32sub(x, f32mul(y, QUARTER_PI));
  } else {
    x = f32sub(f32sub(f32sub(x, f32mul(y, DP1)), f32mul(y, DP2)), f32mul(y, DP3));
  }
  const z = f32mul(x, x);
  y = j === 1 || j === 2 ? sinReduced(z, x) : cosReduced(z);
  return sign < 0 ? -y : y;
}

/** Tangent of `x` radians. */
export function tan(x: number): number {
  if (!isFiniteValue(x)) {
    return NAN_F;
  }
  let sign = 1;
  if (x < 0.0) {
    x = -x;
    sign = -1;
  }
  if (x > SIN_LOSS_THRESHOLD) {
    return 0.0;
  }
  let j = MathOps.floor(f32mul(FOUR_OVER_PI, x)) >>> 0;
  let y = f(j);
  if ((j & 1) !== 0) {
    j += 1;
    y = f32add(y, f(1.0));
  }
  const z = f32sub(f32sub(f32sub(x, f32mul(y, DP1)), f32mul(y, DP2)), f32mul(y, DP3));
  const zz = f32mul(z, z);
  if (x > f(0.0001)) {
    y = horner(TAN_COF, zz);
    y = f32mul(y, zz);
    y = f32mul(y, z);
    y = f32add(y, z);
  } else {
    y = z;
  }
  if ((j & 2) !== 0) {
    y = f32div(f(-1.0), y);
  }
  return sign < 0 ? -y : y;
}

/** Arcsine of `x`, in radians. */
export function asin(x: number): number {
  if (MathOps.isNaN(x)) {
    return NAN_F;
  }
  if (x === 0.0) {
    return x;
  }
  let sign = 1;
  let a = x;
  if (x < 0.0) {
    sign = -1;
    a = -x;
  }
  if (a > 1.0) {
    return NAN_F;
  }
  if (a < f(0.0001)) {
    return sign < 0 ? -a : a;
  }
  let reduced: number;
  let z: number;
  let reflected: boolean;
  if (a > 0.5) {
    z = f32mul(f(0.5), f32sub(f(1.0), a));
    reduced = sqrtf(z);
    reflected = true;
  } else {
    reduced = a;
    z = f32mul(reduced, reduced);
    reflected = false;
  }
  let y = horner(ASIN_COF, z);
  y = f32mul(y, z);
  y = f32mul(y, reduced);
  y = f32add(y, reduced);
  if (reflected) {
    y = f32add(y, y);
    y = f32sub(HALF_PI, y);
  }
  return sign < 0 ? -y : y;
}

/** Arccosine of `x`, in radians. */
export function acos(x: number): number {
  if (MathOps.isNaN(x)) {
    return NAN_F;
  }
  if (x < -1.0 || x > 1.0) {
    return NAN_F;
  }
  if (x < -0.5) {
    return f32sub(PI, f32mul(f(2.0), asin(sqrtf(f32mul(f(0.5), f32add(f(1.0), x))))));
  }
  if (x > 0.5) {
    return f32mul(f(2.0), asin(sqrtf(f32mul(f(0.5), f32sub(f(1.0), x)))));
  }
  return f32sub(HALF_PI, asin(x));
}

/** Arctangent of `x`, in radians. */
export function atan(x: number): number {
  if (MathOps.isNaN(x)) {
    return NAN_F;
  }
  let sign = 1;
  let a = x;
  if (x < 0.0) {
    sign = -1;
    a = -x;
  }
  let y: number;
  if (a > f(2.414213562373095)) {
    y = HALF_PI;
    a = -f32div(f(1.0), a);
  } else if (a > f(0.414213562373095)) {
    y = QUARTER_PI;
    a = f32div(f32sub(a, f(1.0)), f32add(a, f(1.0)));
  } else {
    y = f(0.0);
  }
  const z = f32mul(a, a);
  let poly = horner(ATAN_COF, z);
  poly = f32mul(poly, z);
  poly = f32mul(poly, a);
  poly = f32add(poly, a);
  y = f32add(y, poly);
  return sign < 0 ? -y : y;
}

/** Two-argument arctangent of `y / x`, in radians. */
export function atan2(y: number, x: number): number {
  if (MathOps.isNaN(x) || MathOps.isNaN(y)) {
    return NAN_F;
  }
  let code = 0;
  if (x < 0.0) {
    code = 2;
  }
  if (y < 0.0) {
    code |= 1;
  }
  if (x === 0.0) {
    if ((code & 1) !== 0) {
      return -HALF_PI;
    }
    if (y === 0.0) {
      return 0.0;
    }
    return HALF_PI;
  }
  if (y === 0.0) {
    if ((code & 2) !== 0) {
      return PI;
    }
    return 0.0;
  }
  let w: number;
  if (code === 2) {
    w = PI;
  } else if (code === 3) {
    w = -PI;
  } else {
    w = f(0.0);
  }
  const z = atan(f32div(y, x));
  return f32add(w, z);
}

/** Natural exponential of `x`. */
export function exp(x: number): number {
  if (MathOps.isNaN(x)) {
    return NAN_F;
  }
  if (x > MAX_LOG) {
    return INFINITY;
  }
  if (x < MIN_LOG) {
    return 0.0;
  }
  const k = floorf(f32add(f32mul(LOG2E, x), f(0.5)));
  x = f32sub(x, f32mul(k, LN2_HI));
  x = f32sub(x, f32mul(k, LN2_LO));
  const zz = f32mul(x, x);
  let y = horner(EXP_COF, x);
  y = f32mul(y, zz);
  y = f32add(y, x);
  y = f32add(y, f(1.0));
  return ldexpValue(y, k);
}

/** Natural logarithm of `x`. */
export function log(x: number): number {
  if (MathOps.isNaN(x)) {
    return NAN_F;
  }
  if (x < 0.0) {
    return NAN_F;
  }
  if (x === 0.0) {
    return -INFINITY;
  }
  if (!isFiniteValue(x)) {
    return INFINITY;
  }
  const split = frexpValue(x);
  let m = split.m;
  let e = split.e;
  if (m < SQRT_HALF) {
    e -= 1;
    m = f32sub(f32add(m, m), f(1.0));
  } else {
    m = f32sub(m, f(1.0));
  }
  const z = f32mul(m, m);
  let y = horner(LOG_COF, m);
  y = f32mul(y, m);
  y = f32mul(y, z);
  if (e !== 0) {
    const fe = f(e);
    y = f32add(y, f32mul(LN2_LO, fe));
  }
  y = f32add(y, f32mul(f(-0.5), z));
  let r = f32add(m, y);
  if (e !== 0) {
    const fe = f(e);
    r = f32add(r, f32mul(LN2_HI, fe));
  }
  return r;
}

/** `base` raised to `exponent`, following the ECMAScript exponentiation special
 * cases. Integer exponents use exact binary exponentiation. */
export function pow(base: number, exponent: number): number {
  if (exponent === 0.0) {
    return 1.0;
  }
  if (MathOps.isNaN(exponent) || MathOps.isNaN(base)) {
    return NAN_F;
  }
  const absBase = MathOps.abs(base);
  if (!isFiniteValue(exponent)) {
    if (absBase === 1.0) {
      return NAN_F;
    }
    if (exponent > 0.0) {
      return absBase > 1.0 ? INFINITY : 0.0;
    }
    return absBase > 1.0 ? 0.0 : INFINITY;
  }
  if (!isFiniteValue(base)) {
    if (base > 0.0) {
      return exponent > 0.0 ? INFINITY : 0.0;
    }
    const odd = isOddInteger(exponent);
    if (exponent > 0.0) {
      return odd ? -INFINITY : INFINITY;
    }
    return odd ? -0.0 : 0.0;
  }
  if (base === 0.0) {
    const negZero = 1 / base === -INFINITY;
    if (exponent > 0.0) {
      return negZero && isOddInteger(exponent) ? -0.0 : 0.0;
    }
    return negZero && isOddInteger(exponent) ? -INFINITY : INFINITY;
  }
  const integerExponent = MathOps.floor(exponent) === exponent;
  if (base < 0.0 && !integerExponent) {
    return NAN_F;
  }
  if (integerExponent && MathOps.abs(exponent) <= 2147483648.0) {
    const e = MathOps.abs(exponent);
    const magnitude = integerPow(absBase, e);
    const result = exponent < 0.0 ? f32div(f(1.0), magnitude) : magnitude;
    const negate = base < 0.0 && (e & 1) !== 0;
    return negate ? -result : result;
  }
  return exp(f32mul(exponent, log(absBase)));
}
