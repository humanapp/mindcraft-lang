import type { ReadonlyBitSet, UniqueSet } from "@wendoo/core";
import type { IBrainRuleDef } from "@wendoo/core/brain";
import { collectRuleHierarchyCapabilities, collectRuleHierarchyOutputKeys } from "@wendoo/core/brain/language-service";
import { useMemo } from "react";

/**
 * React hook that memoizes the OR'd capabilities from the rule hierarchy.
 * Returns a `ReadonlyBitSet` suitable for `InsertionContext.availableCapabilities`.
 *
 * @param revision - The rule's revision, from `ruleRevisions`. The result
 *   recomputes only when `ruleDef` or this value changes.
 */
export function useRuleCapabilities(ruleDef: IBrainRuleDef, revision: string): ReadonlyBitSet {
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision forces re-evaluation when tiles change
  return useMemo(() => collectRuleHierarchyCapabilities(ruleDef), [ruleDef, revision]);
}

/**
 * React hook that memoizes the output identity keys provided across the rule
 * hierarchy. Returns a `UniqueSet<string>` suitable for `InsertionContext.availableOutputKeys`.
 *
 * @param revision - The rule's revision, from `ruleRevisions`. The result
 *   recomputes only when `ruleDef` or this value changes.
 */
export function useRuleOutputKeys(ruleDef: IBrainRuleDef, revision: string): UniqueSet<string> {
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision forces re-evaluation when tiles change
  return useMemo(() => collectRuleHierarchyOutputKeys(ruleDef), [ruleDef, revision]);
}
