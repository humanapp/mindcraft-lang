import type { Dict } from "../../platform/dict";
import { List } from "../../platform/list";
import type { IBrainPage, IBrainPageDef } from "../interfaces";
import type { Brain } from "./brain";
import { BrainRule } from "./rule";

/**
 * BrainPage runtime instance.
 *
 * The page is primarily a container for rule metadata. The Brain handles all
 * execution, spawning fibers for the active page's root rules.
 *
 * Responsibilities:
 * - Hold references to child BrainRule instances
 * - Respond to activate/deactivate lifecycle events
 * - Provide access to page definition metadata
 *
 * Execution is driven by the Brain:
 * - Brain calls activatePage(pageIndex) which spawns fibers
 * - Brain calls deactivatePage() which cancels fibers
 * - Page.think() is no longer needed (Brain drives execution)
 */
export class BrainPage implements IBrainPage {
  private readonly rules = new List<BrainRule>();

  constructor(
    private readonly brain_: Brain,
    pageDef_: IBrainPageDef
  ) {
    pageDef_.children().forEach((ruleDef) => {
      const rule = new BrainRule(this, undefined, ruleDef);
      this.rules.push(rule);
    });
  }

  brain(): Brain {
    return this.brain_;
  }

  /**
   * Get child rule instances.
   */
  children(): List<BrainRule> {
    return this.rules;
  }

  /**
   * Called when this page becomes the current page.
   * Note: Fiber spawning is handled by Brain.activatePage().
   */
  activate() {
    this.rules.forEach((rule) => {
      rule.activate();
    });
  }

  /**
   * Called when this page is no longer the current page.
   * Note: Fiber cancellation is handled by Brain.deactivateCurrentPage().
   */
  deactivate() {
    this.rules.forEach((rule) => {
      rule.deactivate();
    });
  }

  /**
   * Assign function IDs to all rules in this page.
   * Called by Brain after compilation.
   *
   * @param ruleIndex - Mapping from rule path to function ID
   * @param pageIndex - Index of this page
   */
  assignFuncIds(ruleIndex: Dict<string, number>, pageIndex: number): void {
    for (let i = 0; i < this.rules.size(); i++) {
      const rule = this.rules.get(i)!;
      rule.assignFuncIds(ruleIndex, `${pageIndex}/${i}`);
    }
  }
}
