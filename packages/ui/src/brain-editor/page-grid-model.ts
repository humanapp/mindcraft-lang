import { RuleSide } from "@mindcraft-lang/core/brain";
import type { CaretPosition } from "./caret-run";

/**
 * Attribute marking an element the page's selection rests on, valued by the
 * key of the cell it stands for. Exactly one such element carries `tabindex="0"`
 * at a time; the rest carry `tabindex="-1"` and are reached by the arrow keys.
 */
export const kPageGridCellAttribute = "data-page-grid-cell";

/**
 * One place the page's selection can rest. A rule stands two rows: its
 * structural row -- the handle, the tiles of each side, and the add-tile control
 * each side offers -- and its sentence row, which holds a single cell for the
 * whole line.
 */
export type PageGridCell =
  | { readonly kind: "handle"; readonly ruleId: number }
  | { readonly kind: "tile"; readonly ruleId: number; readonly side: RuleSide; readonly tileIndex: number }
  | { readonly kind: "append"; readonly ruleId: number; readonly side: RuleSide }
  | { readonly kind: "sentence"; readonly ruleId: number };

/**
 * What one rule contributes to the page's grid: how many tiles each side holds,
 * whether each side stands an add-tile control, and whether the rule reads a
 * sentence row.
 */
export interface RuleCellDescriptor {
  /** The rule these cells belong to, as {@link PageGridCell} names it. */
  readonly ruleId: number;
  /** How many tiles the WHEN side holds. */
  readonly whenTileCount: number;
  /** How many tiles the DO side holds. */
  readonly doTileCount: number;
  /** True when the WHEN side stands an add-tile control the selection can rest on. */
  readonly whenAppendable: boolean;
  /** True when the DO side stands an add-tile control the selection can rest on. */
  readonly doAppendable: boolean;
  /** True when the rule renders a sentence line, which is its second row's one cell. */
  readonly hasSentence: boolean;
}

/** Where the selection stands, and the column vertical movement is holding. */
export interface PageGridCursor {
  /** The cell the selection rests on. */
  readonly cell: PageGridCell;
  /**
   * The column vertical movement aims for, as an index along a row. A step onto
   * a shorter row rests at that row's last cell and carries this value on, so
   * the next step returns to it.
   */
  readonly desiredColumn: number;
}

/** Whether the keyboard rests on the cell itself or on something the cell contains. */
export type PageGridFocusPlacement = "on-cell" | "inside-cell";

/** One key press the page's selection reads. */
export interface PageGridKeyPress {
  /** The key pressed, as the keyboard event names it. */
  readonly key: string;
  /** True while the clipboard modifier is held, which is Meta or Control. */
  readonly withCommand: boolean;
  /** Where the keyboard rests relative to the selected cell. */
  readonly placement: PageGridFocusPlacement;
}

/** What a key asks be done to the selection's subject. */
type PageGridVerb = "delete" | "copy" | "cut" | "paste" | "insert-rule";

/**
 * What an operation acts on, which the selected cell decides: the tile a tile
 * cell stands, the rule a handle stands, and the end of the side an add-tile
 * control stands, which a paste appends to.
 */
export type PageGridSubject =
  | { readonly kind: "tile"; readonly ruleId: number; readonly side: RuleSide; readonly tileIndex: number }
  | { readonly kind: "rule"; readonly ruleId: number }
  | { readonly kind: "side-end"; readonly ruleId: number; readonly side: RuleSide };

/** One operation the selection asks for, and what it acts on. */
export interface PageGridOperation {
  readonly verb: PageGridVerb;
  readonly subject: PageGridSubject;
}

/** What the page reads about the rule the selection rests on. */
export interface PageGridRuleFacts {
  /** True when the rule is the empty one the page keeps standing at its end. */
  readonly isTrailingEmpty: boolean;
}

/** What a key press asks of the page's selection. */
export type PageGridKeyResult = { readonly kind: "inert" } | { readonly kind: "move"; readonly cursor: PageGridCursor };

/** The result returned for every key press the grid leaves alone. */
const inertResult: PageGridKeyResult = { kind: "inert" };

/** A step across the grid, named as the arrow key that asks for it. */
type PageGridDirection = "left" | "right" | "up" | "down";

/** The direction `key` asks for, or undefined for every key the grid leaves alone. */
function pageGridDirection(key: string): PageGridDirection | undefined {
  switch (key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    default:
      return undefined;
  }
}

/**
 * The key `cell` is addressed by, unique across the page and stable while the
 * rule holds that cell.
 */
export function pageGridCellKey(cell: PageGridCell): string {
  switch (cell.kind) {
    case "handle":
      return `${cell.ruleId}:handle`;
    case "tile":
      return `${cell.ruleId}:tile:${cell.side}:${cell.tileIndex}`;
    case "append":
      return `${cell.ruleId}:append:${cell.side}`;
    case "sentence":
      return `${cell.ruleId}:sentence`;
  }
}

/**
 * The cell of rule `ruleId` the selection rests on once composition there ends
 * at `caret`: the tile a caret resting on an element came to rest on, and the
 * rule's sentence for a caret resting in a gap and for a rule standing at no
 * caret at all.
 */
export function pageGridCellAfterComposing(ruleId: number, caret: CaretPosition | undefined): PageGridCell {
  if (caret?.kind === "element") return { kind: "tile", ruleId, side: caret.side, tileIndex: caret.tileIndex };
  return { kind: "sentence", ruleId };
}

/** The two sides in the order a rule's structural row reads them. */
const kRowSides = [RuleSide.When, RuleSide.Do] as const;

/**
 * The page's rows, in reading order: for each rule in `descriptors`, its
 * structural row -- the handle, the WHEN tiles, the WHEN add-tile control, the
 * DO tiles, the DO add-tile control -- followed by its sentence row where it
 * reads one. An add-tile control the side does not offer stands no cell, and a
 * rule reading no sentence contributes a structural row only.
 */
export function pageGridRows(descriptors: readonly RuleCellDescriptor[]): PageGridCell[][] {
  const rows: PageGridCell[][] = [];
  for (const descriptor of descriptors) {
    const ruleId = descriptor.ruleId;
    const structural: PageGridCell[] = [{ kind: "handle", ruleId }];
    for (const side of kRowSides) {
      const isWhen = side === RuleSide.When;
      const count = isWhen ? descriptor.whenTileCount : descriptor.doTileCount;
      for (let tileIndex = 0; tileIndex < count; tileIndex++) {
        structural.push({ kind: "tile", ruleId, side, tileIndex });
      }
      if (isWhen ? descriptor.whenAppendable : descriptor.doAppendable) {
        structural.push({ kind: "append", ruleId, side });
      }
    }
    rows.push(structural);
    if (descriptor.hasSentence) rows.push([{ kind: "sentence", ruleId }]);
  }
  return rows;
}

/** The place a cell stands in, as a row of the page and a column along it. */
export interface PageGridPosition {
  readonly row: number;
  readonly column: number;
}

/** Where `cell` stands in `rows`, or undefined when the grid no longer holds it. */
export function pageGridCellPosition(
  rows: readonly (readonly PageGridCell[])[],
  cell: PageGridCell
): PageGridPosition | undefined {
  const key = pageGridCellKey(cell);
  for (let row = 0; row < rows.length; row++) {
    const column = rows[row].findIndex((candidate) => pageGridCellKey(candidate) === key);
    if (column !== -1) return { row, column };
  }
  return undefined;
}

/** The cursor resting at `position` of `rows`, with both coordinates clamped into the grid. */
function cursorAtPosition(
  rows: readonly (readonly PageGridCell[])[],
  position: PageGridPosition
): PageGridCursor | undefined {
  const row = rows[Math.min(Math.max(position.row, 0), rows.length - 1)];
  if (row === undefined || row.length === 0) return undefined;
  const column = Math.min(Math.max(position.column, 0), row.length - 1);
  return { cell: row[column], desiredColumn: column };
}

/**
 * The cursor resting on `cell`, with the desired column set to the column that
 * cell stands in.
 *
 * A `cell` the grid no longer holds rests instead on whatever stands at
 * `landing`, the place the selection is to take when its cell leaves the page,
 * with both coordinates clamped into the grid. Without a `landing` it falls back
 * to its own rule's handle, and then to the grid's first cell, so the selection
 * always addresses a cell that exists. With no `cell` named, returns the
 * selection the editor opens at, which is the first rule's handle whatever that
 * rule holds. Returns undefined only for a grid holding no cells at all.
 */
export function resolvePageGridCursor(
  rows: readonly (readonly PageGridCell[])[],
  cell?: PageGridCell,
  landing?: PageGridPosition
): PageGridCursor | undefined {
  if (rows.length === 0) return undefined;
  const wanted = cell ?? rows[0][0];
  const at = pageGridCellPosition(rows, wanted);
  if (at !== undefined) return { cell: rows[at.row][at.column], desiredColumn: at.column };
  if (landing !== undefined) {
    const landed = cursorAtPosition(rows, landing);
    if (landed !== undefined) return landed;
  }
  const handle: PageGridCell = { kind: "handle", ruleId: wanted.ruleId };
  const handleAt = pageGridCellPosition(rows, handle);
  if (handleAt !== undefined) return { cell: handle, desiredColumn: handleAt.column };
  return { cell: rows[0][0], desiredColumn: 0 };
}

/**
 * What pressing `key` does to the page's selection.
 *
 * The arrow keys step the selection: left and right along the row the cursor
 * stands in, up and down between rows and so between rules. Vertical movement
 * carries `cursor.desiredColumn`, resting at the last cell of a shorter row and
 * returning to that column on the next step; horizontal movement sets it to the
 * column it lands in. Nothing wraps: a step off either end of a row, and off the
 * top or bottom of the page, is inert.
 *
 * Inert as well for every other key, for a cursor the grid no longer holds, and
 * for a `placement` of "inside-cell", which is the keyboard held by a control
 * the cell contains -- the filter box a sentence hosts while it is composed.
 */
export function decidePageGridKey(
  rows: readonly (readonly PageGridCell[])[],
  cursor: PageGridCursor | undefined,
  key: string,
  placement: PageGridFocusPlacement
): PageGridKeyResult {
  const direction = pageGridDirection(key);
  if (direction === undefined || placement !== "on-cell" || cursor === undefined) return inertResult;
  const at = pageGridCellPosition(rows, cursor.cell);
  if (at === undefined) return inertResult;
  if (direction === "left" || direction === "right") {
    const row = rows[at.row];
    const column = at.column + (direction === "right" ? 1 : -1);
    if (column < 0 || column >= row.length) return inertResult;
    return { kind: "move", cursor: { cell: row[column], desiredColumn: column } };
  }
  const row = rows[at.row + (direction === "down" ? 1 : -1)];
  if (row === undefined) return inertResult;
  const column = Math.min(cursor.desiredColumn, row.length - 1);
  return { kind: "move", cursor: { cell: row[column], desiredColumn: cursor.desiredColumn } };
}

/** The verb `press` asks for, or undefined for every key that asks for none. */
function pageGridVerb(press: PageGridKeyPress): PageGridVerb | undefined {
  if (press.withCommand) {
    switch (press.key) {
      case "c":
        return "copy";
      case "x":
        return "cut";
      case "v":
        return "paste";
      case "Enter":
        return "insert-rule";
      default:
        return undefined;
    }
  }
  return press.key === "Delete" || press.key === "Backspace" ? "delete" : undefined;
}

/**
 * What `cell` stands for, or undefined for a cell standing for nothing an
 * operation can act on, which the sentence line is.
 */
function pageGridSubject(cell: PageGridCell): PageGridSubject | undefined {
  switch (cell.kind) {
    case "handle":
      return { kind: "rule", ruleId: cell.ruleId };
    case "tile":
      return { kind: "tile", ruleId: cell.ruleId, side: cell.side, tileIndex: cell.tileIndex };
    case "append":
      return { kind: "side-end", ruleId: cell.ruleId, side: cell.side };
    case "sentence":
      return undefined;
  }
}

/** True when `verb` has something to do to `subject`. */
function verbActsOn(verb: PageGridVerb, subject: PageGridSubject, facts: PageGridRuleFacts): boolean {
  switch (verb) {
    case "delete":
    case "cut":
      if (subject.kind === "side-end") return false;
      return !(subject.kind === "rule" && facts.isTrailingEmpty);
    case "copy":
      return subject.kind !== "side-end";
    case "paste":
      return true;
    case "insert-rule":
      return subject.kind === "rule";
  }
}

/**
 * The operation pressing `press` on `cell` asks for, or undefined when the
 * press asks for none and the key stays the browser's.
 *
 * The cell decides the subject: a tile cell its tile, a handle its whole rule,
 * an add-tile control the end of that side, which a paste appends to. The
 * sentence line stands for no subject, so every operation there is left alone.
 *
 * Delete, and the clipboard keys Cmd/Ctrl+C, +X and +V, act on the subject;
 * Cmd/Ctrl+Enter inserts a rule after the one a handle stands for. A press that
 * arrives from inside the cell belongs to the control there, as does a press
 * naming a subject the verb has nothing to do to -- copying an add-tile control,
 * or deleting the empty rule the page keeps standing at its end.
 */
export function decidePageGridOperation(
  cell: PageGridCell,
  press: PageGridKeyPress,
  facts: PageGridRuleFacts
): PageGridOperation | undefined {
  if (press.placement !== "on-cell") return undefined;
  const verb = pageGridVerb(press);
  if (verb === undefined) return undefined;
  const subject = pageGridSubject(cell);
  if (subject === undefined || !verbActsOn(verb, subject, facts)) return undefined;
  return { verb, subject };
}
