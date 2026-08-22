import type { IBrainRuleDef } from "@wendoo/core/brain";
import { RuleSide } from "@wendoo/core/brain";
import type { SentenceSegment, SentenceTileRef } from "@wendoo/core/brain/language-service";
import type { ArmedTargetMode } from "./ArmedTargetContext";

/**
 * One stop of a rule's caret run: a tile of one side, or an insertion point
 * between that side's tiles.
 *
 * An `element` is the tile at `tileIndex` of `side`. A `gap` is the insertion
 * point before that tile; a gap whose `tileIndex` equals the side's tile count
 * is the end of that side.
 */
export interface CaretPosition {
  readonly kind: "element" | "gap";
  readonly side: RuleSide;
  readonly tileIndex: number;
}

/** The edit a caret position takes: how a chosen tile is applied, and where. */
export interface CaretEditIntent {
  readonly mode: ArmedTargetMode;
  readonly side: RuleSide;
  /** The tile the mode addresses; undefined for `append`. */
  readonly tileIndex?: number;
}

/** Append the run of `side`, holding `tileCount` tiles, to `run`. */
function appendSideRun(run: CaretPosition[], side: RuleSide, tileCount: number): void {
  for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
    run.push({ kind: "gap", side, tileIndex });
    run.push({ kind: "element", side, tileIndex });
  }
  run.push({ kind: "gap", side, tileIndex: tileCount });
}

/**
 * Every caret position of `ruleDef` in reading order: the WHEN side's positions
 * followed by the DO side's.
 *
 * Each side contributes a gap before each of its tiles, the tile itself, and a
 * gap at its own end, so both sides always contribute their end gap and a rule
 * with no tiles at all runs `gap(When,0) gap(Do,0)`. Each tile is one position
 * however many words a sentence reads it as.
 */
export function caretRun(ruleDef: IBrainRuleDef): readonly CaretPosition[] {
  const run: CaretPosition[] = [];
  appendSideRun(run, RuleSide.When, ruleDef.when().tiles().size());
  appendSideRun(run, RuleSide.Do, ruleDef.do().tiles().size());
  return run;
}

/** True when `a` and `b` name the same caret position. */
function isSamePosition(a: CaretPosition, b: CaretPosition): boolean {
  return a.kind === b.kind && a.side === b.side && a.tileIndex === b.tileIndex;
}

/**
 * True when `run` holds `position`, which is what {@link caretStep} requires of
 * the position it is given. A caret standing on a rule whose tiles then changed
 * is held by no run built after that change.
 */
export function caretRunHolds(run: readonly CaretPosition[], position: CaretPosition): boolean {
  return run.some((candidate) => isSamePosition(candidate, position));
}

/**
 * The position one step `direction` from `position` along `run`, clamped at both
 * ends: a step left off the first position and a step right off the last return
 * that same position.
 *
 * Throws when `position` is not a position of `run`.
 */
export function caretStep(
  run: readonly CaretPosition[],
  position: CaretPosition,
  direction: "left" | "right"
): CaretPosition {
  const index = run.findIndex((candidate) => isSamePosition(candidate, position));
  if (index < 0) {
    throw new Error("caret position is not on the run");
  }
  const stepped = direction === "left" ? index - 1 : index + 1;
  return stepped < 0 || stepped >= run.length ? run[index] : run[stepped];
}

/**
 * The end gap of `side` along `run`, which is the last position `run` holds of
 * that side. Undefined when `run` holds no position of that side at all, which
 * a run built from a rule never is.
 */
export function caretSideEnd(run: readonly CaretPosition[], side: RuleSide): CaretPosition | undefined {
  for (let index = run.length - 1; index >= 0; index--) {
    if (run[index].side === side) return run[index];
  }
  return undefined;
}

/**
 * `position` as `run` holds it: `position` itself, by identity, while the run
 * still holds it, and otherwise the position on its own side that stands where
 * it stood -- the gap an element vacated, clamped to that side's end gap once
 * the run no longer reaches that far.
 *
 * Undefined when `run` holds no position of that side at all.
 *
 * Read a caret against a run built after the rule changed through this, so what
 * is returned always names a position the rule holds now.
 */
export function caretOnRun(run: readonly CaretPosition[], position: CaretPosition): CaretPosition | undefined {
  if (caretRunHolds(run, position)) return position;
  const vacated: CaretPosition = { kind: "gap", side: position.side, tileIndex: position.tileIndex };
  if (caretRunHolds(run, vacated)) return vacated;
  return caretSideEnd(run, position.side);
}

/**
 * Where the caret stands as composition on a rule is entered: the position
 * `remembered` names, as `run` holds it now, and the end of what the rule reads
 * where it remembers none -- the DO side's end gap once that side holds a tile,
 * and the WHEN side's otherwise, so a rule holding no tiles opens at its one
 * WHEN position.
 *
 * `run` is the rule's own caret run.
 */
export function composerEntryCaret(
  run: readonly CaretPosition[],
  remembered: CaretPosition | undefined
): CaretPosition {
  const held = remembered === undefined ? undefined : caretOnRun(run, remembered);
  if (held !== undefined) return held;
  const doEnd = caretSideEnd(run, RuleSide.Do);
  if (doEnd !== undefined && doEnd.tileIndex > 0) return doEnd;
  return caretSideEnd(run, RuleSide.When) ?? run[0];
}

/**
 * The tile a deletion at `position` takes `direction` along `run`: the tile
 * `position` rests on, whichever direction is asked for, or from a gap the
 * nearest tile that way past the gaps between it, which carries the deletion
 * across the boundary between the rule's two sides.
 *
 * Undefined where `run` holds no tile that way, and where `run` does not hold
 * `position` at all.
 */
export function caretDeletionTarget(
  run: readonly CaretPosition[],
  position: CaretPosition,
  direction: "left" | "right"
): CaretPosition | undefined {
  const index = run.findIndex((candidate) => isSamePosition(candidate, position));
  if (index < 0) {
    return undefined;
  }
  if (position.kind === "element") {
    return run[index];
  }
  const step = direction === "left" ? -1 : 1;
  for (let scan = index + step; scan >= 0 && scan < run.length; scan += step) {
    if (run[scan].kind === "element") {
      return run[scan];
    }
  }
  return undefined;
}

/**
 * The edit `position` intends on a side holding `sideTileCount` tiles: an element
 * replaces the tile it rests on, a gap inserts before the tile it precedes, and a
 * gap at the side's end appends.
 *
 * `sideTileCount` is the tile count of `position.side`.
 */
export function caretEditIntent(position: CaretPosition, sideTileCount: number): CaretEditIntent {
  if (position.kind === "element") {
    return { mode: "replace", side: position.side, tileIndex: position.tileIndex };
  }
  if (position.tileIndex < sideTileCount) {
    return { mode: "insert", side: position.side, tileIndex: position.tileIndex };
  }
  return { mode: "append", side: position.side };
}

/**
 * Where in `segments` the caret at `position` stands: the index of the segment
 * it opens, `segments.length` being the end of the line.
 *
 * An element and the gap before it both stand at the first word reading that
 * tile. A position the line reads no such word for stands just past the last
 * word of its own side, so a side's end gap stands where that side's reading
 * ends. A side the line reads no word of at all takes the start of the line for
 * the WHEN side and its end for the DO side.
 *
 * `tiles` are the rule's tiles in sentence order, which a word segment's
 * `sourceTileIndex` indexes; take them from `flattenRuleTiles` of the same rule,
 * and take `segments` from the segment list actually rendered.
 */
export function caretSentenceSlot(
  segments: readonly SentenceSegment[],
  tiles: readonly SentenceTileRef[],
  position: CaretPosition
): number {
  let lastOfSide = -1;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.kind !== "word") {
      continue;
    }
    const tile = tiles[segment.sourceTileIndex];
    if (tile?.side !== position.side) {
      continue;
    }
    if (tile.tileIndex >= position.tileIndex) {
      return index;
    }
    lastOfSide = index;
  }
  if (lastOfSide >= 0) {
    return lastOfSide + 1;
  }
  return position.side === RuleSide.When ? 0 : segments.length;
}

/**
 * The caret position a hit on `segments[segmentIndex]` resolves to.
 *
 * A word resolves to the element of the tile it renders. Glue resolves to the
 * gap past the nearest word before it -- the gap that closes that word's tile --
 * and to the run's first position when no word precedes it.
 *
 * `tiles` are the rule's tiles in sentence order, which a word segment's
 * `sourceTileIndex` indexes; take them from `flattenRuleTiles` of the same rule,
 * and take `segments` from the segment list actually rendered.
 */
export function caretPositionForSegment(
  segments: readonly SentenceSegment[],
  tiles: readonly SentenceTileRef[],
  segmentIndex: number
): CaretPosition {
  const segment = segments[segmentIndex];
  if (segment.kind === "word") {
    const tile = tiles[segment.sourceTileIndex];
    return { kind: "element", side: tile.side, tileIndex: tile.tileIndex };
  }
  for (let index = segmentIndex - 1; index >= 0; index--) {
    const preceding = segments[index];
    if (preceding.kind !== "word") {
      continue;
    }
    const tile = tiles[preceding.sourceTileIndex];
    return { kind: "gap", side: tile.side, tileIndex: tile.tileIndex + 1 };
  }
  return { kind: "gap", side: RuleSide.When, tileIndex: 0 };
}
