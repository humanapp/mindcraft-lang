import { BitSet, type ReadonlyBitSet, UniqueSet } from "@mindcraft-lang/core";
import type { BrainServices, IBrainRuleDef, IBrainTileSet } from "@mindcraft-lang/core/brain";
import { getRuleWhenResultType } from "@mindcraft-lang/core/brain/language-service";
import type { TypeId } from "@mindcraft-lang/core/runtime";
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

/** Add every output identity key provided by the tiles of one tile set into the accumulator. */
function orTileSetOutputKeys(tileSet: IBrainTileSet, result: UniqueSet<string>): void {
  const tiles = tileSet.tiles();
  for (let i = 0; i < tiles.size(); i++) {
    const keys = tiles.get(i).providedOutputs();
    for (let j = 0; j < keys.size(); j++) {
      result.add(keys.get(j));
    }
  }
}

/**
 * Collects the output identity keys provided by every tile in the given rule and
 * its ancestor rules. An output value-tile is offered only when its `outputKey`
 * is among these (a declaring sensor is present in the hierarchy).
 */
function collectRuleHierarchyOutputKeys(ruleDef: IBrainRuleDef): UniqueSet<string> {
  const result = new UniqueSet<string>();
  let current: IBrainRuleDef | undefined = ruleDef;
  while (current) {
    orTileSetOutputKeys(current.when(), result);
    orTileSetOutputKeys(current.do(), result);
    current = current.ancestor();
  }
  return result;
}

/**
 * React hook that memoizes the output identity keys provided across the rule
 * hierarchy. Returns a `UniqueSet<string>` suitable for `InsertionContext.availableOutputKeys`.
 *
 * @param updateCounter - Pass an external counter to re-compute when tiles change.
 */
export function useRuleOutputKeys(ruleDef: IBrainRuleDef, updateCounter?: number): UniqueSet<string> {
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateCounter forces re-evaluation when tiles change
  return useMemo(() => collectRuleHierarchyOutputKeys(ruleDef), [ruleDef, updateCounter]);
}

/**
 * React hook that memoizes the rule's WHEN-result type (see `getRuleWhenResultType`),
 * including the empty-WHEN fall-through to the nearest ancestor that produces one.
 * Returns a `TypeId` suitable for `InsertionContext.whenResultType`, or undefined
 * when services are unavailable or the rule produces no WHEN result.
 *
 * @param updateCounter - Pass an external counter to re-compute when tiles change.
 */
export function useRuleWhenResultType(
  ruleDef: IBrainRuleDef,
  brainServices: BrainServices | undefined,
  updateCounter?: number
): TypeId | undefined {
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateCounter forces re-evaluation when tiles change
  return useMemo(
    () => (brainServices ? getRuleWhenResultType(ruleDef, brainServices) : undefined),
    [ruleDef, brainServices, updateCounter]
  );
}
