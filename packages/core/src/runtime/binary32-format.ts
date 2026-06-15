// Shortest round-trip binary32 formatting ported from Ryu by Ulf Adams
// (Apache-2.0 / Boost-1.0).

import { INFINITY, MathOps } from "../platform/math";
import { StringUtils } from "../platform/string";

/**
 * Each entry of the IEEE binary32 power-of-five tables, stored as a pair of
 * 32-bit halves [hi, lo] of the underlying 64-bit factor. The TS arithmetic
 * never reconstructs the full 64-bit value; `mulShift32` consumes the halves
 * directly with exact plain-number partial products.
 */
type SplitPow5 = readonly [number, number];

const FLOAT_MANTISSA_BITS = 23;
const FLOAT_BIAS = 127;
const FLOAT_POW5_INV_BITCOUNT = 59;
const FLOAT_POW5_BITCOUNT = 61;

const FLOAT_POW5_INV_SPLIT: readonly SplitPow5[] = [
  [134217728, 1],
  [107374182, 1717986919],
  [85899345, 3951369913],
  [68719476, 3161095930],
  [109951162, 3339766570],
  [87960930, 953826338],
  [70368744, 763061070],
  [112589990, 2938884630],
  [90071992, 2351107704],
  [72057594, 162899245],
  [115292150, 1978625710],
  [92233720, 1582900568],
  [73786976, 1266320455],
  [118059162, 308125809],
  [94447329, 2823481025],
  [75557863, 3117778279],
  [120892581, 4129451787],
  [96714065, 2444567971],
  [77371252, 1955654377],
  [123794003, 3988040462],
  [99035203, 613451992],
  [79228162, 2208748512],
  [126765060, 98023782],
  [101412048, 78419026],
  [81129638, 1780722139],
  [129807421, 1990161963],
  [103845937, 733136111],
  [83076749, 3163489267],
  [132922799, 2484602449],
  [106338239, 2846675418],
  [85070591, 3136333794],
  [68056473, 1650073576],
  [108890357, 1781124262],
  [87112285, 4001879788],
  [69689828, 3201503830],
  [111503725, 4263412669],
  [89202980, 3410730135],
  [71362384, 2728584108],
  [114179815, 1788754195],
  [91343852, 1431003356],
  [73075081, 3721783063],
  [116920130, 4236865982],
  [93536104, 3389492785],
  [74828883, 3570587688],
  [119726214, 558979545],
  [95780971, 1306177095],
  [76624777, 185948217],
  [122599643, 1156510606],
  [98079714, 2643195403],
  [78463771, 2973549782],
  [125542034, 3039692732],
  [100433627, 3290747645],
  [80346902, 914611198],
  [128555043, 2322371375],
  [102844034, 3575884019],
];

const FLOAT_POW5_SPLIT: readonly SplitPow5[] = [
  [268435456, 0],
  [335544320, 0],
  [419430400, 0],
  [524288000, 0],
  [327680000, 0],
  [409600000, 0],
  [512000000, 0],
  [320000000, 0],
  [400000000, 0],
  [500000000, 0],
  [312500000, 0],
  [390625000, 0],
  [488281250, 0],
  [305175781, 1073741824],
  [381469726, 2415919104],
  [476837158, 872415232],
  [298023223, 3766484992],
  [372529029, 3634364416],
  [465661287, 1321730048],
  [291038304, 2436694016],
  [363797880, 3045867520],
  [454747350, 3807334400],
  [284217094, 1305842176],
  [355271367, 3779786368],
  [444089209, 3650991136],
  [277555756, 671256724],
  [346944695, 839070905],
  [433680868, 4270064103],
  [271050543, 521306416],
  [338813178, 3872858492],
  [423516473, 2693589467],
  [529395592, 145761362],
  [330872245, 91100851],
  [413590306, 1187617888],
  [516987882, 3632006008],
  [323117426, 3343745579],
  [403896783, 2032198326],
  [504870979, 1466506084],
  [315544362, 379695390],
  [394430452, 2622102886],
  [493038065, 3277628607],
  [308148791, 437905143],
  [385185988, 3768606901],
  [481482486, 415791331],
  [300926553, 3481095053],
  [376158192, 1130143345],
  [470197740, 1412679181],
];

/** Bit count of 5^e, exact for the float-relevant range. */
function pow5bits(e: number): number {
  return (MathOps.floor((e * 1217359) / 524288) >>> 0) + 1;
}

/** floor(log10(2^e)), exact for the float-relevant range. */
function log10Pow2(e: number): number {
  return MathOps.floor((e * 78913) / 262144) >>> 0;
}

/** floor(log10(5^e)), exact for the float-relevant range. */
function log10Pow5(e: number): number {
  return MathOps.floor((e * 732923) / 1048576) >>> 0;
}

/** Greatest p with 5^p dividing v. */
function pow5factor32(v: number): number {
  let count = 0;
  let n = v;
  for (;;) {
    const q = MathOps.floor(n / 5);
    const r = n - q * 5;
    if (r !== 0) {
      break;
    }
    n = q;
    count += 1;
  }
  return count;
}

/** True when 5^p divides v. */
function multipleOfPowerOf5(v: number, p: number): boolean {
  return pow5factor32(v) >= p;
}

/** True when 2^p divides v, for p in 0..31. */
function multipleOfPowerOf2(v: number, p: number): boolean {
  return (v & ((1 << p) - 1)) === 0;
}

/**
 * Unsigned 32x32 -> 64-bit product, returned as [hi, lo] 32-bit halves. All
 * partial products are split into 16-bit pieces so every intermediate stays
 * below 2^53 and is exact in plain-number arithmetic.
 */
function umul32(a: number, b: number): readonly [number, number] {
  const aLo = a & 0xffff;
  const aHi = a >>> 16;
  const bLo = b & 0xffff;
  const bHi = b >>> 16;
  const ll = aLo * bLo;
  const mid = aLo * bHi + aHi * bLo + (ll >>> 16);
  const lo = ((mid & 0xffff) * 65536 + (ll & 0xffff)) >>> 0;
  const hi = (aHi * bHi + MathOps.floor(mid / 65536)) >>> 0;
  return [hi, lo];
}

/**
 * Returns the low 32 bits of (m * factor) >> shift, where factor is the
 * 64-bit value [factorHi, factorLo] and shift is in 33..63.
 */
function mulShift32(m: number, factor: SplitPow5, shift: number): number {
  const bits0 = umul32(m, factor[1] >>> 0);
  const bits1 = umul32(m, factor[0] >>> 0);

  // sum = (bits0 >> 32) + bits1, kept as hi/lo 32-bit halves.
  const loFull = bits0[0] + bits1[1];
  const sumLo = loFull >>> 0;
  const carry = loFull >= 4294967296 ? 1 : 0;
  const sumHi = (bits1[0] + carry) >>> 0;

  // Low 32 bits of (sum >> s) for s in 1..31.
  const s = shift - 32;
  const twoS = MathOps.pow(2, s);
  const spilled = (sumHi % twoS) * MathOps.pow(2, 32 - s);
  return (((sumLo >>> s) + spilled) % 4294967296) >>> 0;
}

function mulPow5InvDivPow2(m: number, q: number, j: number): number {
  return mulShift32(m, FLOAT_POW5_INV_SPLIT[q], j);
}

function mulPow5divPow2(m: number, i: number, j: number): number {
  return mulShift32(m, FLOAT_POW5_SPLIT[i], j);
}

/** Number of decimal digits in v, for v in 0..999999999. */
function decimalLength9(v: number): number {
  if (v >= 100000000) {
    return 9;
  }
  if (v >= 10000000) {
    return 8;
  }
  if (v >= 1000000) {
    return 7;
  }
  if (v >= 100000) {
    return 6;
  }
  if (v >= 10000) {
    return 5;
  }
  if (v >= 1000) {
    return 4;
  }
  if (v >= 100) {
    return 3;
  }
  if (v >= 10) {
    return 2;
  }
  return 1;
}

/** Shortest decimal mantissa and base-10 exponent of a finite nonzero f32. */
interface FloatingDecimal {
  /** Decimal mantissa with no leading zeros; up to 9 digits. */
  mantissa: number;
  /** Base-10 exponent: value == mantissa * 10^exponent. */
  exponent: number;
}

/** IEEE binary32 sign, 8-bit exponent field, and 23-bit mantissa field. */
interface Binary32Fields {
  /** True when the sign bit is set (negative or -0). */
  sign: boolean;
  /** Raw 8-bit biased exponent field, 0..255. */
  exponent: number;
  /** Raw 23-bit mantissa field, 0..8388607. */
  mantissa: number;
}

const POW2_23 = 8388608;
const POW2_24 = 16777216;

/** Smallest positive normal binary32 magnitude, 2^-126. */
const MIN_NORMAL_F32 = 1.1754943508222875e-38;
/** Quantum of binary32 subnormals, 2^-149. */
const MIN_SUBNORMAL_F32 = 1.401298464324817e-45;

/**
 * Decomposes a number holding an IEEE binary32 value into its raw sign,
 * exponent field, and mantissa field using only plain-number arithmetic.
 * The input must be finite (zeros, normals, and subnormals are all handled).
 */
function decodeBinary32(value: number): Binary32Fields {
  const sign = value < 0 || (value === 0 && 1 / value === -INFINITY);
  const a = MathOps.abs(value);

  if (a === 0) {
    return { sign, exponent: 0, mantissa: 0 };
  }

  if (a < MIN_NORMAL_F32) {
    // Subnormal: value == mantissa * 2^(-126 - 23), mantissa an integer < 2^23.
    const mantissa = MathOps.round(a / MIN_SUBNORMAL_F32);
    return { sign, exponent: 0, mantissa };
  }

  // Normal: find unbiased exponent E with 2^E <= a < 2^(E+1).
  let e = 0;
  let m = a;
  if (m >= 2) {
    while (m >= 2) {
      m /= 2;
      e += 1;
    }
  } else {
    while (m < 1) {
      m *= 2;
      e -= 1;
    }
  }
  // m is in [1, 2); the 24-bit significand is round(m * 2^23).
  const significand = MathOps.round(m * POW2_23);
  // Rounding can push the significand to 2^24, bumping the exponent.
  if (significand === POW2_24) {
    return { sign, exponent: e + 1 + FLOAT_BIAS, mantissa: 0 };
  }
  return { sign, exponent: e + FLOAT_BIAS, mantissa: significand - POW2_23 };
}

/**
 * Ryu f2d core for IEEE binary32. Inputs are the raw 23-bit mantissa field and
 * 8-bit exponent field of a finite nonzero value. Returns the shortest decimal
 * mantissa and its base-10 exponent.
 */
function f2d(ieeeMantissa: number, ieeeExponent: number): FloatingDecimal {
  let e2: number;
  let m2: number;
  if (ieeeExponent === 0) {
    e2 = 1 - FLOAT_BIAS - FLOAT_MANTISSA_BITS - 2;
    m2 = ieeeMantissa;
  } else {
    e2 = ieeeExponent - FLOAT_BIAS - FLOAT_MANTISSA_BITS - 2;
    m2 = (1 << FLOAT_MANTISSA_BITS) | ieeeMantissa;
  }
  const even = (m2 & 1) === 0;
  const acceptBounds = even;
  const mv = 4 * m2;
  const mp = 4 * m2 + 2;
  const mmShift = ieeeMantissa !== 0 || ieeeExponent <= 1 ? 1 : 0;
  const mm = 4 * m2 - 1 - mmShift;

  let vr = 0;
  let vp = 0;
  let vm = 0;
  let e10 = 0;
  let vmIsTrailingZeros = false;
  let vrIsTrailingZeros = false;
  let lastRemovedDigit = 0;

  if (e2 >= 0) {
    const q = log10Pow2(e2);
    e10 = q;
    const k = FLOAT_POW5_INV_BITCOUNT + pow5bits(q) - 1;
    const i = -e2 + q + k;
    vr = mulPow5InvDivPow2(mv, q, i);
    vp = mulPow5InvDivPow2(mp, q, i);
    vm = mulPow5InvDivPow2(mm, q, i);
    if (q !== 0 && MathOps.floor((vp - 1) / 10) <= MathOps.floor(vm / 10)) {
      const l = FLOAT_POW5_INV_BITCOUNT + pow5bits(q - 1) - 1;
      lastRemovedDigit = mulPow5InvDivPow2(mv, q - 1, -e2 + q - 1 + l) % 10;
    }
    if (q <= 9) {
      if (mv % 5 === 0) {
        vrIsTrailingZeros = multipleOfPowerOf5(mv, q);
      } else if (acceptBounds) {
        vmIsTrailingZeros = multipleOfPowerOf5(mm, q);
      } else {
        vp -= multipleOfPowerOf5(mp, q) ? 1 : 0;
      }
    }
  } else {
    const q = log10Pow5(-e2);
    e10 = q + e2;
    const i = -e2 - q;
    const k = pow5bits(i) - FLOAT_POW5_BITCOUNT;
    let j = q - k;
    vr = mulPow5divPow2(mv, i, j);
    vp = mulPow5divPow2(mp, i, j);
    vm = mulPow5divPow2(mm, i, j);
    if (q !== 0 && MathOps.floor((vp - 1) / 10) <= MathOps.floor(vm / 10)) {
      j = q - 1 - (pow5bits(i + 1) - FLOAT_POW5_BITCOUNT);
      lastRemovedDigit = mulPow5divPow2(mv, i + 1, j) % 10;
    }
    if (q <= 1) {
      vrIsTrailingZeros = true;
      if (acceptBounds) {
        vmIsTrailingZeros = mmShift === 1;
      } else {
        vp -= 1;
      }
    } else if (q < 31) {
      vrIsTrailingZeros = multipleOfPowerOf2(mv, q - 1);
    }
  }

  let removed = 0;
  let output: number;
  if (vmIsTrailingZeros || vrIsTrailingZeros) {
    while (MathOps.floor(vp / 10) > MathOps.floor(vm / 10)) {
      vmIsTrailingZeros = vmIsTrailingZeros && vm % 10 === 0;
      vrIsTrailingZeros = vrIsTrailingZeros && lastRemovedDigit === 0;
      lastRemovedDigit = vr % 10;
      vr = MathOps.floor(vr / 10);
      vp = MathOps.floor(vp / 10);
      vm = MathOps.floor(vm / 10);
      removed += 1;
    }
    if (vmIsTrailingZeros) {
      while (vm % 10 === 0) {
        vrIsTrailingZeros = vrIsTrailingZeros && lastRemovedDigit === 0;
        lastRemovedDigit = vr % 10;
        vr = MathOps.floor(vr / 10);
        vp = MathOps.floor(vp / 10);
        vm = MathOps.floor(vm / 10);
        removed += 1;
      }
    }
    if (vrIsTrailingZeros && lastRemovedDigit === 5 && vr % 2 === 0) {
      lastRemovedDigit = 4;
    }
    const roundUp = (vr === vm && (!acceptBounds || !vmIsTrailingZeros)) || lastRemovedDigit >= 5;
    output = vr + (roundUp ? 1 : 0);
  } else {
    while (MathOps.floor(vp / 10) > MathOps.floor(vm / 10)) {
      lastRemovedDigit = vr % 10;
      vr = MathOps.floor(vr / 10);
      vp = MathOps.floor(vp / 10);
      vm = MathOps.floor(vm / 10);
      removed += 1;
    }
    output = vr + (vr === vm || lastRemovedDigit >= 5 ? 1 : 0);
  }

  return { mantissa: output, exponent: e10 + removed };
}

/** Decimal digit string of a non-negative integer with up to 9 digits. */
function digitsOf(value: number, length: number): string {
  let s = "";
  let v = value;
  for (let i = 0; i < length; i += 1) {
    const d = v % 10;
    s = StringUtils.fromCharCode(48 + d) + s;
    v = MathOps.floor(v / 10);
  }
  return s;
}

/** Decimal digit string of a non-negative integer, with no leading zeros. */
function exponentDigits(value: number): string {
  if (value === 0) {
    return "0";
  }
  let s = "";
  let v = value;
  while (v > 0) {
    const d = v % 10;
    s = StringUtils.fromCharCode(48 + d) + s;
    v = MathOps.floor(v / 10);
  }
  return s;
}

/**
 * Formats a number holding an IEEE binary32 value as its ECMAScript
 * `String(Number)` decimal grammar, using the shortest digit sequence that
 * round-trips back to the same binary32 value.
 *
 * Special values format as `"NaN"`, `"Infinity"`, `"-Infinity"`, and `"0"`
 * (both +0 and -0 produce `"0"`). All other finite values, including
 * subnormals, produce a minimal decimal representation.
 */
export function formatF32(value: number): string {
  if (value !== value) {
    return "NaN";
  }
  if (value === INFINITY) {
    return "Infinity";
  }
  if (value === -INFINITY) {
    return "-Infinity";
  }
  if (value === 0) {
    return "0";
  }

  const fields = decodeBinary32(value);
  const dec = f2d(fields.mantissa, fields.exponent);
  const k = decimalLength9(dec.mantissa);
  const s = digitsOf(dec.mantissa, k);
  const n = dec.exponent + k;
  const prefix = fields.sign ? "-" : "";

  if (k <= n && n <= 21) {
    let zeros = "";
    for (let i = 0; i < n - k; i += 1) {
      zeros += "0";
    }
    return prefix + s + zeros;
  }
  if (n > 0 && n <= 21) {
    const intPart = StringUtils.substring(s, 0, n);
    const fracPart = StringUtils.substring(s, n);
    return `${prefix}${intPart}.${fracPart}`;
  }
  if (n > -6 && n <= 0) {
    let zeros = "";
    for (let i = 0; i < -n; i += 1) {
      zeros += "0";
    }
    return `${prefix}0.${zeros}${s}`;
  }

  const exp = n - 1;
  const mantissaPart = k === 1 ? s : `${StringUtils.substring(s, 0, 1)}.${StringUtils.substring(s, 1)}`;
  const expSign = exp >= 0 ? "+" : "-";
  return `${prefix}${mantissaPart}e${expSign}${exponentDigits(MathOps.abs(exp))}`;
}
