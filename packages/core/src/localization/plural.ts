import { MathOps } from "../platform/math";
import { StringUtils as SU } from "../platform/string";

/** CLDR plural category a count selects in a given locale. */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

/**
 * Numeric operand a {@link PluralTest} inspects, following CLDR naming:
 *
 * - `n` -- the absolute value of the count.
 * - `i` -- the integer digits of `n`.
 * - `v` -- the number of visible fraction digits of `n`.
 */
export type PluralOperand = "n" | "i" | "v";

/** Inclusive numeric interval `lo <= x <= hi`. */
export interface PluralRange {
  readonly lo: number;
  readonly hi: number;
}

/**
 * One condition on a plural operand: take the operand, optionally reduce it
 * modulo `mod`, then test whether the result falls in any of `ranges`.
 * When `not` is true the test passes only when the result falls in none.
 */
export interface PluralTest {
  readonly operand: PluralOperand;
  /** Divisor applied to the operand before the range test; omitted means no reduction. */
  readonly mod?: number;
  /** Inverts the range test. */
  readonly not?: boolean;
  readonly ranges: readonly PluralRange[];
}

/**
 * One category of a locale's plural rule. `any` is a disjunction of
 * conjunctions: the clause matches when every test in at least one inner
 * group passes.
 */
export interface PluralClause {
  readonly category: PluralCategory;
  readonly any: readonly (readonly PluralTest[])[];
}

/**
 * A locale's plural rule: clauses tried in order, first match wins. The
 * `other` category is the implicit fallback and is never listed.
 */
export type PluralRuleSpec = readonly PluralClause[];

/** Plural rule of the default locale (English): `one` for the integer 1, `other` otherwise. */
export const defaultPluralRule: PluralRuleSpec = [
  {
    category: "one",
    any: [
      [
        { operand: "i", ranges: [{ lo: 1, hi: 1 }] },
        { operand: "v", ranges: [{ lo: 0, hi: 0 }] },
      ],
    ],
  },
];

/** Number of visible fraction digits in the decimal rendering of `n`. */
function fractionDigits(n: number): number {
  const text = SU.toString(n);
  const dot = SU.indexOf(text, ".");
  if (dot < 0) {
    return 0;
  }
  return SU.length(text) - dot - 1;
}

function operandValue(operand: PluralOperand, n: number): number {
  if (operand === "i") {
    return MathOps.floor(n);
  }
  if (operand === "v") {
    return fractionDigits(n);
  }
  return n;
}

function inRanges(x: number, ranges: readonly PluralRange[]): boolean {
  for (const range of ranges) {
    if (x >= range.lo && x <= range.hi) {
      return true;
    }
  }
  return false;
}

function testPasses(test: PluralTest, n: number): boolean {
  let x = operandValue(test.operand, n);
  if (test.mod !== undefined && test.mod !== 0) {
    x = x % test.mod;
  }
  const hit = inRanges(x, test.ranges);
  return test.not === true ? !hit : hit;
}

/**
 * Select the plural category `value` takes under `rule`. Returns the first
 * clause whose condition passes, or `"other"` when none does.
 */
export function selectPluralCategory(rule: PluralRuleSpec, value: number): PluralCategory {
  const n = MathOps.abs(value);
  for (const clause of rule) {
    for (const group of clause.any) {
      let allPassed = true;
      for (const test of group) {
        if (!testPasses(test, n)) {
          allPassed = false;
          break;
        }
      }
      if (allPassed) {
        return clause.category;
      }
    }
  }
  return "other";
}
