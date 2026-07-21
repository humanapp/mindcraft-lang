import type { ReadonlyBitSet, UniqueSet } from "@mindcraft-lang/core";
import type { IBrainRuleDef } from "@mindcraft-lang/core/brain";
import {
  collectRuleHierarchyCapabilities,
  collectRuleHierarchyOutputKeys,
} from "@mindcraft-lang/core/brain/language-service";
import { useMemo } from "react";

/**
 * React hook that memoizes the OR'd capabilities from the rule hierarchy.
 * Returns a `ReadonlyBitSet` suitable for `InsertionContext.availableCapabilities`.
 *
 * @param updateCounter - Counter that increments whenever tiles change (the
 *   page editor's update counter). The result recomputes only when `ruleDef`
 *   or this value changes.
 */
export function useRuleCapabilities(ruleDef: IBrainRuleDef, updateCounter: number): ReadonlyBitSet {
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateCounter forces re-evaluation when tiles change
  return useMemo(() => collectRuleHierarchyCapabilities(ruleDef), [ruleDef, updateCounter]);
}

/**
 * React hook that memoizes the output identity keys provided across the rule
 * hierarchy. Returns a `UniqueSet<string>` suitable for `InsertionContext.availableOutputKeys`.
 *
 * @param updateCounter - Counter that increments whenever tiles change (the
 *   page editor's update counter). The result recomputes only when `ruleDef`
 *   or this value changes.
 */
export function useRuleOutputKeys(ruleDef: IBrainRuleDef, updateCounter: number): UniqueSet<string> {
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateCounter forces re-evaluation when tiles change
  return useMemo(() => collectRuleHierarchyOutputKeys(ruleDef), [ruleDef, updateCounter]);
}
