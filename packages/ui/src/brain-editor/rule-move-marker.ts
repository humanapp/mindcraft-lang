/**
 * The wedge a grabbed rule's handle wears as a movement marker, and the square
 * overlay it is drawn in.
 *
 * One wedge is generated pointing up, from the four shape numbers below; the
 * handle's four directions come from rotating that one path about the handle's
 * centre.
 *
 * Everything here is in the overlay's user space, which is scaled so one unit is
 * one CSS pixel.
 */

// ---------------------------------------------------------------------------
// TUNING -- the four numbers that shape the marker, meant to be edited. The path
// and the overlay box are computed from them.
// ---------------------------------------------------------------------------

/** How far the wedge's painted point reaches past the gap, in pixels. */
export const kRuleMoveMarkerReach = 18;

/** The angle the wedge's arc base spans, in degrees. */
export const kRuleMoveMarkerSpread = 40;

/** Clear space between the handle's edge and the wedge's painted base, in pixels. */
export const kRuleMoveMarkerGap = 7;

/** Diameter of the wedge's rounded corners, in pixels, drawn as the width of its self-stroke. */
export const kRuleMoveMarkerCorners = 3;

// ---------------------------------------------------------------------------
// End of tuning.
// ---------------------------------------------------------------------------

/** Radius of the rule handle the markers stand off, in pixels. */
const kHandleRadius = 18;

/** The handle's centre in the overlay's user space, on both axes. */
const kOverlayCentre = 100;

/** Clear space the overlay box keeps outside the marker's painted extent, in pixels. */
const kOverlaySlack = 1.5;

/** The shape numbers a wedge is generated from, all in pixels except `spread`, which is degrees. */
export interface RuleMoveMarkerShape {
  /** How far the painted point reaches past the gap. */
  readonly reach: number;
  /** The angle the arc base spans, in degrees. */
  readonly spread: number;
  /** Clear space between the handle's edge and the painted base. */
  readonly gap: number;
  /** Diameter of the rounded corners, drawn as the width of the wedge's self-stroke. */
  readonly corners: number;
}

/** The shipped wedge: the shape {@link ruleMoveMarkerPath} is called with. */
export const kRuleMoveMarkerShape: RuleMoveMarkerShape = {
  reach: kRuleMoveMarkerReach,
  spread: kRuleMoveMarkerSpread,
  gap: kRuleMoveMarkerGap,
  corners: kRuleMoveMarkerCorners,
};

/** Rounds a user-space coordinate to the two decimals a path datum carries. */
function round(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Builds the `d` of the up-pointing wedge for `shape`: an arc base concentric
 * with the handle, straight sides, and a point directly above the centre.
 *
 * The wedge must be stroked in its own fill, `corners` wide with a round join
 * and cap and `paint-order: stroke fill`, or it comes to bare points. That
 * stroke grows the shape by half its width all round, so the returned path is
 * inset by that much and the painted result honours `gap` and `reach`.
 */
export function ruleMoveMarkerPath(shape: RuleMoveMarkerShape): string {
  const inset = shape.corners / 2;
  const base = kHandleRadius + shape.gap + inset;
  const far = kHandleRadius + shape.gap + shape.reach - inset;
  const half = (shape.spread * Math.PI) / 360;
  const axis = -Math.PI / 2;
  const x0 = round(kOverlayCentre + base * Math.cos(axis - half));
  const y0 = round(kOverlayCentre + base * Math.sin(axis - half));
  const x1 = round(kOverlayCentre + base * Math.cos(axis + half));
  const y1 = round(kOverlayCentre + base * Math.sin(axis + half));
  const tipX = round(kOverlayCentre + far * Math.cos(axis));
  const tipY = round(kOverlayCentre + far * Math.sin(axis));
  return `M ${x0} ${y0} A ${round(base)} ${round(base)} 0 0 1 ${x1} ${y1} L ${tipX} ${tipY} Z`;
}

/**
 * The side, in pixels, of the square overlay that holds four wedges of `shape`
 * rotated about the handle's centre. It clears the painted extent -- the point
 * plus the half of the self-stroke that grows past it -- so no reach can clip.
 */
export function ruleMoveMarkerOverlaySize(shape: RuleMoveMarkerShape): number {
  return 2 * (kHandleRadius + shape.gap + shape.reach + kOverlaySlack);
}

/**
 * The `viewBox` of the overlay {@link ruleMoveMarkerOverlaySize} gives the side
 * of, centred on the handle and scaled so one user-space unit is one pixel.
 */
export function ruleMoveMarkerOverlayViewBox(shape: RuleMoveMarkerShape): string {
  const size = ruleMoveMarkerOverlaySize(shape);
  const origin = round(kOverlayCentre - size / 2);
  return `${origin} ${origin} ${round(size)} ${round(size)}`;
}
