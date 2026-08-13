import type { BrainCommandHistory } from "@mindcraft-lang/core/brain/model";
import { BrainEditOrigin } from "@mindcraft-lang/core/brain/model";
import type { RulePickupController } from "./RulePickupContext";

/**
 * Gives back the rule `rulePickup` holds, aborting the batch that pick-up
 * opened as the editor's own change. A controller holding no rule leaves
 * `commandHistory` alone, batch open or not.
 */
export function releaseHeldRule(commandHistory: BrainCommandHistory, rulePickup: RulePickupController): void {
  if (rulePickup.pickup === null) return;
  commandHistory.runAs(BrainEditOrigin.Editor, () => commandHistory.abortBatch());
  rulePickup.setPickup(null);
}
