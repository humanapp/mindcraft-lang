/**
 * Pins the rule-movement marker's generator against a fixed reference shape and
 * the path that shape must produce: that the generator reproduces it, and that
 * its arc base and its point respond to `gap` and `reach` the way the geometry
 * says.
 *
 * The reference shape is a constant of this file, chosen once from the design
 * study. The numbers the editor ships are tuning and move freely; nothing here
 * reads them or pins any other coordinate.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type RuleMoveMarkerShape,
  ruleMoveMarkerOverlaySize,
  ruleMoveMarkerOverlayViewBox,
  ruleMoveMarkerPath,
} from "./rule-move-marker";

/** The fixed reference shape the generator is checked against. */
const kReferenceShape: RuleMoveMarkerShape = { reach: 24, spread: 40, gap: 4.5, corners: 6 };

/** The `d` the generator must return for {@link kReferenceShape}. */
const kReferencePath = "M 91.28 76.04 A 25.5 25.5 0 0 1 108.72 76.04 L 100 56.5 Z";

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
  test("reproduces the reference wedge at the reference shape", () => {
    assert.equal(ruleMoveMarkerPath(kReferenceShape), kReferencePath);
  });

  test("gap pushes both the arc base and the point away from the handle", () => {
    const wider = { ...kReferenceShape, gap: kReferenceShape.gap + 3 };
    const before = ruleMoveMarkerPath(kReferenceShape);
    const after = ruleMoveMarkerPath(wider);
    assert.equal(baseOf(after) - baseOf(before), 3);
    assert.equal(farOf(after) - farOf(before), 3);
  });

  test("reach moves the point out and leaves the arc base where it is", () => {
    const longer = { ...kReferenceShape, reach: kReferenceShape.reach + 10 };
    const before = ruleMoveMarkerPath(kReferenceShape);
    const after = ruleMoveMarkerPath(longer);
    assert.equal(baseOf(after), baseOf(before));
    assert.equal(farOf(after) - farOf(before), 10);
  });
});

describe("rule move marker overlay", () => {
  test("clears the painted point at every reach the generator is given", () => {
    for (const reach of [4, kReferenceShape.reach, 60]) {
      const shape = { ...kReferenceShape, reach };
      const painted = farOf(ruleMoveMarkerPath(shape)) + shape.corners / 2;
      assert.ok(
        ruleMoveMarkerOverlaySize(shape) / 2 > painted,
        `overlay half-side does not clear the painted point at reach ${reach}`
      );
    }
  });

  test("maps one user-space unit to one pixel, centred on the handle", () => {
    const size = ruleMoveMarkerOverlaySize(kReferenceShape);
    assert.equal(ruleMoveMarkerOverlayViewBox(kReferenceShape), `${100 - size / 2} ${100 - size / 2} ${size} ${size}`);
  });
});
