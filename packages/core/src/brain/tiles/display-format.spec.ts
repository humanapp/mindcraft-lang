/**
 * Display format tests -- verifies that applyDisplayFormat correctly formats
 * numeric values for all supported display formats.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { applyDisplayFormat } from "@mindcraft-lang/core/brain/tiles";

describe("applyDisplayFormat", () => {
  describe("time_seconds", () => {
    test("integer value has no decimals", () => {
      assert.equal(applyDisplayFormat(1, "time_seconds"), "1s");
    });

    test("single decimal place is preserved", () => {
      assert.equal(applyDisplayFormat(1.2, "time_seconds"), "1.2s");
    });

    test("rounds to two decimal places", () => {
      assert.equal(applyDisplayFormat(1.283, "time_seconds"), "1.28s");
    });

    test("rounds up at third decimal", () => {
      assert.equal(applyDisplayFormat(1.285, "time_seconds"), "1.29s");
    });

    test("handles zero", () => {
      assert.equal(applyDisplayFormat(0, "time_seconds"), "0s");
    });

    test("handles negative values", () => {
      assert.equal(applyDisplayFormat(-3.719, "time_seconds"), "-3.72s");
    });
  });

  describe("time_ms", () => {
    test("multiplies by 1000 and appends ms", () => {
      assert.equal(applyDisplayFormat(1, "time_ms"), "1000ms");
    });

    test("rounds after multiplying", () => {
      assert.equal(applyDisplayFormat(1.5006, "time_ms"), "1501ms");
    });

    test("handles fractional seconds", () => {
      assert.equal(applyDisplayFormat(0.25, "time_ms"), "250ms");
    });

    test("handles zero", () => {
      assert.equal(applyDisplayFormat(0, "time_ms"), "0ms");
    });

    test("handles negative values", () => {
      assert.equal(applyDisplayFormat(-2.5, "time_ms"), "-2500ms");
    });
  });
});
