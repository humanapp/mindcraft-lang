/**
 * Pins the inset a dialog subtracts to stay clear of the soft keyboard.
 * The viewport reports its metrics for far more than a keyboard, so the cases
 * here cover the movements that must read as no occlusion at all: a pinch-zoom,
 * which shrinks the visual viewport without covering anything, and a panned
 * visual viewport, which moves it without covering anything either.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { keyboardInsetPx } from "./keyboard-inset";

/** A 768px-tall layout viewport with nothing covering it and no zoom. */
const unoccluded = { layoutHeight: 768, visualHeight: 768, offsetTop: 0, scale: 1 };

describe("keyboardInsetPx", () => {
  test("reads zero when the whole layout viewport is reachable", () => {
    assert.equal(keyboardInsetPx(unoccluded), 0);
  });

  test("reads the covered height when a keyboard takes the bottom of the viewport", () => {
    assert.equal(keyboardInsetPx({ ...unoccluded, visualHeight: 768 - 336 }), 336);
  });

  test("reads zero under a pinch-zoom, which shrinks the visual viewport without covering anything", () => {
    assert.equal(keyboardInsetPx({ ...unoccluded, visualHeight: 384, scale: 2 }), 0);
  });

  test("reads the covered height under a pinch-zoom with the keyboard also up", () => {
    assert.equal(keyboardInsetPx({ layoutHeight: 768, visualHeight: (768 - 336) / 2, offsetTop: 0, scale: 2 }), 336);
  });

  test("reads zero once the visual viewport has been scrolled onto the layout viewport's bottom edge", () => {
    assert.equal(keyboardInsetPx({ layoutHeight: 768, visualHeight: 384, offsetTop: 384, scale: 1 }), 0);
  });

  test("clamps to zero when the reachable height exceeds the layout viewport", () => {
    assert.equal(keyboardInsetPx({ ...unoccluded, visualHeight: 820 }), 0);
  });
});
