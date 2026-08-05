import { createContext, useContext } from "react";
import type { PageGridCell } from "./page-grid-model";

const RuleSelectionContext = createContext<PageGridCell | undefined>(undefined);

/**
 * Supplies one rule with the cell of its own the page's selection rests on,
 * which `ruleSelectionCell` reads from the page's cursor. Every rule the
 * selection is neither leaving nor arriving at is given the same value it
 * already stood at, so a move concerns the two rules it names and no other.
 */
export const RuleSelectionProvider = RuleSelectionContext.Provider;

/**
 * The cell of the surrounding rule the page's selection rests on, or undefined
 * while it rests elsewhere and for a rule rendered outside a page.
 */
export function useRuleSelection(): PageGridCell | undefined {
  return useContext(RuleSelectionContext);
}
