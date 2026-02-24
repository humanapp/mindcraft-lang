import { BitSet, type ReadonlyBitSet } from "@mindcraft-lang/core";
import type { IBrainRuleDef, IBrainTileSet } from "@mindcraft-lang/core/brain";
import { useMemo } from "react";

/**
 * OR all tile capabilities from a single tile set into the accumulator.
 */
function orTileSetCapabilities(tileSet: IBrainTileSet, result: BitSet): BitSet {
  let acc = result;
  const tiles = tileSet.tiles();
  for (let i = 0; i < tiles.size(); i++) {
    const cap = tiles.get(i).capabilities();
    if (!cap.isEmpty()) {
      acc = acc.or(cap as BitSet);
    }
  }
  return acc;
}

/**
 * Computes the OR'd capabilities of all tiles in the given rule and all its
 * ancestor rules. This determines which capability-gated tiles (those with
 * non-empty `requirements()`) are valid for suggestion at the current position.
 *
 * For example, the "see" sensor provides TargetActor capability, so the "it"
 * literal (which requires TargetActor) is only suggested when "see" appears
 * in the rule hierarchy.
 */
function collectRuleHierarchyCapabilities(ruleDef: IBrainRuleDef): ReadonlyBitSet {
  let result = new BitSet();
  let current: IBrainRuleDef | undefined = ruleDef;
  while (current) {
    result = orTileSetCapabilities(current.when(), result);
    result = orTileSetCapabilities(current.do(), result);
    current = current.ancestor();
  }
  return result;
}

/**
 * React hook that memoizes the OR'd capabilities from the rule hierarchy.
 * Returns a `ReadonlyBitSet` suitable for `InsertionContext.availableCapabilities`.
 *
 * @param updateCounter - Pass an external counter to re-compute when tiles change.
 *   Not used inside the memo closure, but forces re-evaluation.
 */
export function useRuleCapabilities(ruleDef: IBrainRuleDef, updateCounter?: number): ReadonlyBitSet {
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateCounter forces re-evaluation when tiles change
  return useMemo(() => collectRuleHierarchyCapabilities(ruleDef), [ruleDef, updateCounter]);
}
