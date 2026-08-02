/**
 * Pins the rule-movement marker's generator: that it reproduces the shape the
 * editor ships at that shape's numbers, and that its arc base and its point
 * respond to `gap` and `reach` the way the geometry says.
 *
 * The shape numbers themselves are tuning, so nothing here reads them or pins
 * any other coordinate.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type RuleMoveMarkerShape,
  ruleMoveMarkerOverlaySize,
  ruleMoveMarkerOverlayViewBox,
  ruleMoveMarkerPath,
} from "./rule-move-marker";

/** The shape the shipped path was authored at. */
const kShippedShape: RuleMoveMarkerShape = { reach: 24, spread: 40, gap: 4.5, corners: 6 };

/** The `d` the editor drew before the path was generated. */
const kShippedPath = "M 91.28 76.04 A 25.5 25.5 0 0 1 108.72 76.04 L 100 56.5 Z";

/** The radius of the wedge's arc base, read back out of a generated path. */
function baseOf(d: string): number {
  const match = /A (\S+) \S+ 0 0 1/.exec(d);
  if (!match) throw new Error(`no arc in path: ${d}`);
  return Number(match[1]);
}

/** How far the wedge's unstroked point stands from the handle's centre, read back out of a generated path. */
function farOf(d: string): number {
  const match = /L \S+ (\S+) Z$/.exec(d);
  if (!match) throw new Error(`no point in path: ${d}`);
  return 100 - Number(match[1]);
}

describe("rule move marker path", () => {
  test("reproduces the shipped wedge at the shape it was authored at", () => {
    assert.equal(ruleMoveMarkerPath(kShippedShape), kShippedPath);
  });

  test("gap pushes both the arc base and the point away from the handle", () => {
    const wider = { ...kShippedShape, gap: kShippedShape.gap + 3 };
    const before = ruleMoveMarkerPath(kShippedShape);
    const after = ruleMoveMarkerPath(wider);
    assert.equal(baseOf(after) - baseOf(before), 3);
    assert.equal(farOf(after) - farOf(before), 3);
  });

  test("reach moves the point out and leaves the arc base where it is", () => {
    const longer = { ...kShippedShape, reach: kShippedShape.reach + 10 };
    const before = ruleMoveMarkerPath(kShippedShape);
    const after = ruleMoveMarkerPath(longer);
    assert.equal(baseOf(after), baseOf(before));
    assert.equal(farOf(after) - farOf(before), 10);
  });
});

describe("rule move marker overlay", () => {
  test("clears the painted point at every reach the generator is given", () => {
    for (const reach of [4, kShippedShape.reach, 60]) {
      const shape = { ...kShippedShape, reach };
      const painted = farOf(ruleMoveMarkerPath(shape)) + shape.corners / 2;
      assert.ok(
        ruleMoveMarkerOverlaySize(shape) / 2 > painted,
        `overlay half-side does not clear the painted point at reach ${reach}`
      );
    }
  });

  test("maps one user-space unit to one pixel, centred on the handle", () => {
    const size = ruleMoveMarkerOverlaySize(kShippedShape);
    assert.equal(ruleMoveMarkerOverlayViewBox(kShippedShape), `${100 - size / 2} ${100 - size / 2} ${size} ${size}`);
  });
});
