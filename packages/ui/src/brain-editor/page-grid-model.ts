import { RuleSide } from "@wendoo/core/brain";
import type { CaretPosition } from "./caret-run";
import { isUndoChord } from "./history-shortcut";

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
 * whole line. The page itself stands one further row, holding the control that
 * adds a rule at the end.
 */
export type PageGridCell =
  | { readonly kind: "handle"; readonly ruleId: string }
  | { readonly kind: "tile"; readonly ruleId: string; readonly side: RuleSide; readonly tileIndex: number }
  | { readonly kind: "append"; readonly ruleId: string; readonly side: RuleSide }
  | { readonly kind: "sentence"; readonly ruleId: string }
  | { readonly kind: "append-rule" };

/** The page's add-rule control, which stands the last row of every grid. */
export const kAppendRuleCell: PageGridCell = { kind: "append-rule" };

/**
 * What one rule contributes to the page's grid: how many tiles each side holds,
 * whether each side stands an add-tile control, and whether the rule reads a
 * sentence row.
 */
export interface RuleCellDescriptor {
  /** The rule these cells belong to, as {@link PageGridCell} names it. */
  readonly ruleId: string;
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
 * A step a rule picked up from its handle takes: `up` and `down` reorder it
 * among its siblings, `indent` makes it a child of the sibling above it, and
 * `outdent` moves it out of its parent to sit just past it. Each carries the
 * rule's children with it.
 */
export type RuleMoveDirection = "up" | "down" | "indent" | "outdent";

/** Which of a rule's four moves the model would carry out from where it stands. */
export interface RuleMoveCapabilities {
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly canIndent: boolean;
  readonly canOutdent: boolean;
}

/**
 * The steps `capabilities` says the rule can take, in reading order: up, down,
 * outdent, indent. A direction absent from the list is one the model would
 * refuse, so asking for it is left alone.
 */
export function ruleMoveDirections(capabilities: RuleMoveCapabilities): RuleMoveDirection[] {
  const directions: RuleMoveDirection[] = [];
  if (capabilities.canMoveUp) directions.push("up");
  if (capabilities.canMoveDown) directions.push("down");
  if (capabilities.canOutdent) directions.push("outdent");
  if (capabilities.canIndent) directions.push("indent");
  return directions;
}

/**
 * True when `press` picks `cell`'s rule up: Enter or a space held on a rule
 * handle, with no clipboard modifier. A press arriving from inside the cell and
 * a cell standing for anything but a handle both pick nothing up.
 */
export function decidePageGridGrab(cell: PageGridCell, press: PageGridKeyPress): boolean {
  if (press.placement !== "on-cell" || press.withCommand) return false;
  if (cell.kind !== "handle") return false;
  return press.key === "Enter" || press.key === " ";
}

/**
 * What an operation acts on, which the selected cell decides: the tile a tile
 * cell stands, the rule a handle stands, and the end of the side an add-tile
 * control stands, which a paste appends to.
 */
export type PageGridSubject =
  | { readonly kind: "tile"; readonly ruleId: string; readonly side: RuleSide; readonly tileIndex: number }
  | { readonly kind: "rule"; readonly ruleId: string }
  | { readonly kind: "side-end"; readonly ruleId: string; readonly side: RuleSide };

/**
 * Where a rule an insertion makes is put: straight after the rule `ruleId`
 * names, or at the end of the page.
 */
export type PageGridInsertionPoint =
  | { readonly kind: "after-rule"; readonly ruleId: string }
  | { readonly kind: "page-end" };

/**
 * One operation the selection asks for, and what it is aimed at: the subject
 * every verb but the insertion acts on, and the point an insertion puts its rule
 * at.
 */
export type PageGridOperation =
  | { readonly verb: Exclude<PageGridVerb, "insert-rule">; readonly subject: PageGridSubject }
  | { readonly verb: "insert-rule"; readonly at: PageGridInsertionPoint };

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
    case "append-rule":
      return "append-rule";
  }
}

/**
 * The cell of rule `ruleId` the selection rests on once composition there ends
 * at `caret`: the tile a caret resting on an element came to rest on, and the
 * rule's sentence for a caret resting in a gap and for a rule standing at no
 * caret at all.
 */
export function pageGridCellAfterComposing(ruleId: string, caret: CaretPosition | undefined): PageGridCell {
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
 *
 * The last row is always the page's add-rule control, so a page holding no
 * rules still stands one cell.
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
  rows.push([kAppendRuleCell]);
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
 * rule holds, and the page's add-rule control for a page holding no rules.
 *
 * Pass the rows {@link pageGridRows} builds, which always hold at least the
 * add-rule row.
 */
export function resolvePageGridCursor(
  rows: readonly (readonly PageGridCell[])[],
  cell?: PageGridCell,
  landing?: PageGridPosition
): PageGridCursor {
  const wanted = cell ?? rows[0][0];
  const at = pageGridCellPosition(rows, wanted);
  if (at !== undefined) return { cell: rows[at.row][at.column], desiredColumn: at.column };
  if (landing !== undefined) {
    const landed = cursorAtPosition(rows, landing);
    if (landed !== undefined) return landed;
  }
  if (wanted.kind !== "append-rule") {
    const handle: PageGridCell = { kind: "handle", ruleId: wanted.ruleId };
    const handleAt = pageGridCellPosition(rows, handle);
    if (handleAt !== undefined) return { cell: handle, desiredColumn: handleAt.column };
  }
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

/**
 * The step `key` takes a rule by: ArrowUp and ArrowDown reorder it among its
 * siblings, ArrowLeft outdents it and ArrowRight indents it. Undefined for every
 * other key.
 */
export function ruleMoveDirectionForKey(key: string): RuleMoveDirection | undefined {
  switch (key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "outdent";
    case "ArrowRight":
      return "indent";
    default:
      return undefined;
  }
}

/**
 * What a key press does to the page, whether or not a rule is held. `consume`
 * is a press the page claims that asks nothing of it, which the browser is not
 * left to act on.
 */
export type PageKeyResult =
  | { readonly kind: "inert" }
  | { readonly kind: "consume" }
  | { readonly kind: "select"; readonly cursor: PageGridCursor }
  | { readonly kind: "move-rule"; readonly ruleId: string; readonly direction: RuleMoveDirection }
  | { readonly kind: "drop" }
  | { readonly kind: "cancel" };

const inertPageKey: PageKeyResult = { kind: "inert" };
const consumedPageKey: PageKeyResult = { kind: "consume" };

/**
 * What pressing `press` does to the page. `heldRuleId` names the rule the page
 * has picked up, or is undefined while it holds none.
 *
 * The arrows step a rule wherever they are pressed with the clipboard modifier,
 * and while a rule is held they step it with or without one: up and down reorder
 * it among its siblings, left outdents it and right indents it. A held rule
 * takes every such step; with none held the step goes to the rule the
 * selection's cell belongs to. The selection does not move either way. Enter
 * sets a held rule down, Escape and the undo chord both give it back, and no
 * other key reaches a held rule.
 *
 * With no rule held the plain arrows move the selection, as
 * {@link decidePageGridKey} decides.
 *
 * A modified arrow pressed on the page's add-rule control, which belongs to no
 * rule, is consumed: the horizontal pair is the browser's back and forward
 * gestures.
 */
export function decidePageKey(
  rows: readonly (readonly PageGridCell[])[],
  cursor: PageGridCursor | undefined,
  press: PageGridKeyPress,
  heldRuleId: string | undefined
): PageKeyResult {
  if (heldRuleId === undefined) {
    if (press.withCommand && press.placement === "on-cell") {
      const direction = ruleMoveDirectionForKey(press.key);
      if (direction === undefined) return inertPageKey;
      const ruleId = cursor === undefined ? undefined : pageGridOwningRule(cursor.cell);
      return ruleId === undefined ? consumedPageKey : { kind: "move-rule", ruleId, direction };
    }
    const stepped = decidePageGridKey(rows, cursor, press.key, press.placement);
    return stepped.kind === "move" ? { kind: "select", cursor: stepped.cursor } : inertPageKey;
  }
  if (press.placement !== "on-cell") return inertPageKey;
  const direction = ruleMoveDirectionForKey(press.key);
  if (direction !== undefined) return { kind: "move-rule", ruleId: heldRuleId, direction };
  if (press.withCommand) return isUndoChord(press) ? { kind: "cancel" } : inertPageKey;
  if (press.key === "Enter") return { kind: "drop" };
  if (press.key === "Escape") return { kind: "cancel" };
  return inertPageKey;
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
 * operation can act on, which the sentence line and the page's add-rule control
 * both are.
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
    case "append-rule":
      return undefined;
  }
}

/**
 * The rule `cell` belongs to, or undefined for the page's add-rule control,
 * which belongs to no rule. A tile belongs to the rule holding it and a sentence
 * to the rule it reads for, so every cell of a rule names that one rule.
 *
 * Use it for an insertion's starting point only; read the subject an operation
 * acts on from {@link pageGridSubject}.
 */
function pageGridOwningRule(cell: PageGridCell): string | undefined {
  return cell.kind === "append-rule" ? undefined : cell.ruleId;
}

/** True when `verb` has something to do to `subject`. */
function verbActsOn(verb: Exclude<PageGridVerb, "insert-rule">, subject: PageGridSubject): boolean {
  switch (verb) {
    case "delete":
    case "cut":
    case "copy":
      return subject.kind !== "side-end";
    case "paste":
      return true;
  }
}

/**
 * The operation pressing `press` on `cell` asks for, or undefined when the
 * press asks for none and the key stays the browser's.
 *
 * Delete, and the clipboard keys Cmd/Ctrl+C, +X and +V, act on the subject the
 * cell stands for: a tile cell its tile, a handle its whole rule, an add-tile
 * control the end of that side, which a paste appends to. The sentence line and
 * the page's add-rule control stand for no subject, so those keys are left alone
 * there.
 *
 * Cmd/Ctrl+Enter inserts a rule, which every cell asks for: after the rule the
 * cell belongs to, and at the page's end from the add-rule control, which
 * belongs to no rule.
 *
 * A press that arrives from inside the cell belongs to the control there, as
 * does a press naming a subject the verb has nothing to do to, which copying or
 * deleting an add-tile control is.
 */
export function decidePageGridOperation(cell: PageGridCell, press: PageGridKeyPress): PageGridOperation | undefined {
  if (press.placement !== "on-cell") return undefined;
  const verb = pageGridVerb(press);
  if (verb === undefined) return undefined;
  if (verb === "insert-rule") {
    const owner = pageGridOwningRule(cell);
    return { verb, at: owner === undefined ? { kind: "page-end" } : { kind: "after-rule", ruleId: owner } };
  }
  const subject = pageGridSubject(cell);
  if (subject === undefined || !verbActsOn(verb, subject)) return undefined;
  return { verb, subject };
}
