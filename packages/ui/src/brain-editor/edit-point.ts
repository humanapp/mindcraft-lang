import type { ArmedTargetMode } from "./ArmedTargetContext";

/**
 * Where an edit point sits relative to the placed tile it was opened on:
 * before that tile, in its place, or after it.
 */
export type EditPointPosition = "before" | "replace" | "after";

/** The edit point's positions in the order the pivot offers them. */
export const kEditPointPositions: readonly EditPointPosition[] = ["before", "replace", "after"];

/** How an edit-point position is armed: the target mode, and the tile index that mode addresses. */
export type EditPointArming =
  | { readonly mode: "append" }
  | { readonly mode: "insert"; readonly tileIndex: number }
  | { readonly mode: "replace"; readonly tileIndex: number };

/**
 * The arming for `position` on the tile at `anchorTileIndex` of a side holding
 * `tileCount` tiles. `after` the last tile is the side's end, which is the same
 * position the trailing add-tile button arms, so it arms `append`.
 */
export function armEditPoint(position: EditPointPosition, anchorTileIndex: number, tileCount: number): EditPointArming {
  if (position === "replace") return { mode: "replace", tileIndex: anchorTileIndex };
  if (position === "before") return { mode: "insert", tileIndex: anchorTileIndex };
  const after = anchorTileIndex + 1;
  return after < tileCount ? { mode: "insert", tileIndex: after } : { mode: "append" };
}

/**
 * The position `arming` expresses for an edit point opened on the tile at
 * `anchorTileIndex`. An insert addressing the anchor reads as `before` and one
 * addressing the tile past it as `after`; an append reads as `after`, the
 * side's end.
 */
export function editPointPositionOf(
  arming: { readonly mode: ArmedTargetMode; readonly tileIndex?: number },
  anchorTileIndex: number
): EditPointPosition {
  if (arming.mode === "replace") return "replace";
  if (arming.mode === "append") return "after";
  return arming.tileIndex === anchorTileIndex ? "before" : "after";
}
