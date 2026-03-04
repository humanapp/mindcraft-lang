import { MathOps } from "../../platform/math";
import { StringUtils as SU } from "../../platform/string";
import { TypeUtils } from "../../platform/types";
import { type LiteralDisplayFormat, LiteralDisplayFormats, parseDisplayFormat } from "../interfaces";

const DOT_CHAR_CODE = 46; // "."

/** Find the index of the decimal point in a numeric string, or -1. */
function findDot(str: string): number {
  const len = SU.length(str);
  for (let i = 0; i < len; i++) {
    if (SU.charCodeAt(str, i) === DOT_CHAR_CODE) return i;
  }
  return -1;
}

/**
 * Apply a display format to a numeric value, returning the formatted string.
 * This function is cross-platform safe -- it does not use Intl or toLocaleString.
 *
 * Supported formats:
 * - "default" -- plain number toString
 * - "percent" -- value * 100 + "%"
 * - "percent:N" -- value * 100 with N decimal places + "%"
 * - "fixed:N" -- N decimal places
 * - "thousands" -- comma-separated thousands groups
 * - "time_seconds" -- rounded to 2 decimal places with "s" suffix
 * - "time_ms" -- value * 1000 rounded to integer with "ms" suffix
 */
export function applyDisplayFormat(value: number, format: LiteralDisplayFormat): string {
  if (!format || format === LiteralDisplayFormats.Default) {
    return SU.toString(value);
  }

  const parsed = parseDisplayFormat(format);

  if (parsed.kind === "percent") {
    const pctValue = value * 100;
    if (TypeUtils.isNumber(parsed.decimals)) {
      return `${toFixed(pctValue, parsed.decimals)}%`;
    }
    return `${SU.toString(pctValue)}%`;
  }

  if (parsed.kind === "fixed") {
    const decimals = TypeUtils.isNumber(parsed.decimals) ? parsed.decimals : 0;
    return toFixed(value, decimals);
  }

  if (parsed.kind === "thousands") {
    return addThousandsSeparator(value);
  }

  if (parsed.kind === "time_seconds") {
    const rounded = MathOps.round(value * 100) / 100;
    return `${SU.toString(rounded)}s`;
  }

  if (parsed.kind === "time_ms") {
    return `${SU.toString(MathOps.round(value * 1000))}ms`;
  }

  return SU.toString(value);
}

/**
 * Format a number with a fixed number of decimal places.
 * Cross-platform alternative to Number.toFixed().
 */
function toFixed(value: number, decimals: number): string {
  if (decimals < 0) decimals = 0;
  if (decimals > 20) decimals = 20;

  const factor = 10 ** decimals;
  const rounded = MathOps.round(value * factor) / factor;
  const str = SU.toString(rounded);
  const strLen = SU.length(str);

  if (decimals === 0) {
    const dotIdx = findDot(str);
    if (dotIdx >= 0) return SU.substring(str, 0, dotIdx);
    return str;
  }

  const dotIdx = findDot(str);
  if (dotIdx < 0) {
    return `${str}.${SU.rep("0", decimals)}`;
  }

  const existingDecimals = strLen - dotIdx - 1;
  if (existingDecimals >= decimals) {
    return SU.substring(str, 0, dotIdx + 1 + decimals);
  }

  return str + SU.rep("0", decimals - existingDecimals);
}

/**
 * Add comma thousands separators to a number.
 * Handles negative numbers and decimal portions.
 */
function addThousandsSeparator(value: number): string {
  const str = SU.toString(value);
  const dotIdx = findDot(str);
  const intPart = dotIdx >= 0 ? SU.substring(str, 0, dotIdx) : str;
  const decPart = dotIdx >= 0 ? SU.substring(str, dotIdx) : "";

  const isNegative = SU.startsWith(intPart, "-");
  const digits = isNegative ? SU.substring(intPart, 1) : intPart;
  const digitsLen = SU.length(digits);

  if (digitsLen <= 3) {
    return str;
  }

  let result = "";
  let count = 0;
  for (let i = digitsLen - 1; i >= 0; i--) {
    if (count > 0 && count % 3 === 0) {
      result = `,${result}`;
    }
    result = SU.substring(digits, i, i + 1) + result;
    count++;
  }

  return (isNegative ? "-" : "") + result + decPart;
}
