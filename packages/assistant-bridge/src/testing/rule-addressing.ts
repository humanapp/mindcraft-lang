import type { BrainDef } from "@mindcraft-lang/core/brain/model";
import { locateRules } from "../tools/workspace.js";

/**
 * The durable id of the rule standing at `rulePath` in `brainDef`, where
 * `rulePath` is the rule's `pageIndex/ruleIndex[/childIndex...]` position.
 *
 * Exercises name a rule by where it stands in the document they set up, which
 * is fixed and readable; the tools address rules by the id the document minted
 * for them. Resolve the position to an id at the moment the call is made, the
 * way a model resolves it from `read_project`. Throws when the document holds
 * no rule at that position.
 */
export function ruleIdAt(brainDef: BrainDef, rulePath: string): string {
  const located = locateRules(brainDef).find((entry) => entry.rulePath === rulePath);
  if (!located) throw new Error(`the document holds no rule at ${rulePath}`);
  return located.ruleId;
}
