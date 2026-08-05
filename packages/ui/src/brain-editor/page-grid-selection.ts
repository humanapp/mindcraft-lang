import type { PageGridCell } from "./page-grid-model";

/**
 * How the page's selection is painted on the cell it rests on, which that cell's
 * own shape decides: `chip` for a placed tile, `circle` for a rule handle and for
 * the round add controls, and `line` for a rule's sentence.
 */
export type PageGridSelectionShape = "chip" | "circle" | "line";

/**
 * Attribute the one cell the page's selection rests on carries, valued by the
 * {@link PageGridSelectionShape} its treatment is painted in.
 *
 * It follows the grid's own cursor, so it stands whichever way that cell was
 * reached: by an arrow key, by a click, or by a programmatic move.
 */
export const kPageGridSelectionAttribute = "data-page-grid-selection";

/**
 * The selection attributes a cell of `shape` renders, spread alongside the cell's
 * own grid attributes. A cell the selection does not rest on renders none.
 */
export function pageGridSelectionProps(shape: PageGridSelectionShape, selected: boolean): Record<string, string> {
  return selected ? { [kPageGridSelectionAttribute]: shape } : {};
}

/**
 * The cell of the rule `ruleId` names that the page's selection rests on, or
 * undefined while it rests on another rule, on the page's own add-rule control,
 * or nowhere at all.
 *
 * The cell is returned as it was passed, so two reads taken across a move the
 * rule is neither the source nor the destination of are the same value.
 */
export function ruleSelectionCell(cursorCell: PageGridCell | undefined, ruleId: number): PageGridCell | undefined {
  if (cursorCell === undefined || cursorCell.kind === "append-rule") return undefined;
  return cursorCell.ruleId === ruleId ? cursorCell : undefined;
}
