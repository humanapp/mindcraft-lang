import { createContext, useContext } from "react";
import type { PageGridCell, RuleCellDescriptor } from "./page-grid-model";

/** What the page's selection grid offers the rules it is assembled from. */
export interface PageGridBinding {
  /**
   * Adds `descriptor` to the page's grid, replacing whatever that rule
   * registered before. Returns the call that takes the rule's cells back out;
   * make it as the rule stops rendering them.
   */
  registerRule(descriptor: RuleCellDescriptor): () => void;
  /**
   * The cell the selection rests on, which holds the grid's one tab stop.
   * Undefined before any rule has registered its cells.
   */
  readonly currentCell: PageGridCell | undefined;
  /**
   * The rule an insertion asked be composed, which that rule's card takes up
   * once and then gives back. Undefined while no insertion is waiting.
   */
  readonly ruleToCompose: number | undefined;
  /** Asks that `ruleId` be composed, or gives the request back with undefined. */
  composeRule(ruleId: number | undefined): void;
  /**
   * Picks `ruleId` up: the arrow keys then move that rule until it is set down
   * or given back. Does nothing while another rule is already held.
   */
  grabRule(ruleId: number): void;
}

const PageGridContext = createContext<PageGridBinding | undefined>(undefined);

/** Supplies the page's selection grid to the rules rendered inside it. */
export const PageGridProvider = PageGridContext.Provider;

/**
 * The page's selection grid, or undefined for a rule rendered outside one,
 * whose cells stand no selection and take no tab stop.
 */
export function usePageGrid(): PageGridBinding | undefined {
  return useContext(PageGridContext);
}
