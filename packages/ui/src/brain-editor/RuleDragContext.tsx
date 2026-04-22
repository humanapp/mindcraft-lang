import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { createContext, useContext } from "react";

export interface RuleDragController {
  /**
   * Numeric id of the rule currently being dragged, or null if no drag is active.
   * Consumers re-render when this changes and apply lifted styling to the
   * matching rule.
   */
  draggingRuleId: number | null;

  /**
   * Begin a drag interaction for the given rule starting from a pointer-down
   * event on its handle. The controller installs window-level listeners,
   * applies a movement threshold to differentiate click-from-drag, and
   * mutates the model directly during drag for fluid feedback. Only the
   * net move is recorded in the undo history on a successful drop.
   *
   * Returns true if drag tracking was installed (pointer was eligible);
   * false when the controller declined to start (e.g. wrong pointer type).
   */
  beginDrag(rule: BrainRuleDef, event: React.PointerEvent<HTMLElement>): boolean;
}

const noopController: RuleDragController = {
  draggingRuleId: null,
  beginDrag: () => false,
};

const RuleDragContext = createContext<RuleDragController>(noopController);

export const RuleDragProvider = RuleDragContext.Provider;

export function useRuleDragController(): RuleDragController {
  return useContext(RuleDragContext);
}
