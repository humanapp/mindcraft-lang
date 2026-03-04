/**
 * Display format tests -- verifies that applyDisplayFormat correctly formats
 * numeric values for all supported display formats.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { applyDisplayFormat } from "@mindcraft-lang/core/brain/tiles";

describe("applyDisplayFormat", () => {
  describe("default", () => {
    test("integer value", () => {
      assert.equal(applyDisplayFormat(42, "default"), "42");
    });

    test("decimal value", () => {
      assert.equal(applyDisplayFormat(3.14, "default"), "3.14");
    });

    test("zero", () => {
      assert.equal(applyDisplayFormat(0, "default"), "0");
    });

    test("negative value", () => {
      assert.equal(applyDisplayFormat(-7.5, "default"), "-7.5");
    });
  });

  describe("percent", () => {
    test("half becomes 50%", () => {
      assert.equal(applyDisplayFormat(0.5, "percent"), "50%");
    });

    test("zero becomes 0%", () => {
      assert.equal(applyDisplayFormat(0, "percent"), "0%");
    });

    test("one becomes 100%", () => {
      assert.equal(applyDisplayFormat(1, "percent"), "100%");
    });

    test("negative value", () => {
      assert.equal(applyDisplayFormat(-0.25, "percent"), "-25%");
    });
  });

  describe("percent:N", () => {
    test("two decimal places", () => {
      assert.equal(applyDisplayFormat(0.1234, "percent:2"), "12.34%");
    });

    test("zero decimal places truncates", () => {
      assert.equal(applyDisplayFormat(0.1, "percent:0"), "10%");
    });

    test("pads trailing zeros", () => {
      assert.equal(applyDisplayFormat(0.1, "percent:2"), "10.00%");
    });

    test("handles zero with decimals", () => {
      assert.equal(applyDisplayFormat(0, "percent:3"), "0.000%");
    });
  });

  describe("fixed:N", () => {
    test("two decimal places", () => {
      const PI = Math.PI;
      assert.equal(applyDisplayFormat(PI, "fixed:2"), "3.14");
    });

    test("pads trailing zeros", () => {
      assert.equal(applyDisplayFormat(3, "fixed:2"), "3.00");
    });

    test("zero decimal places returns integer string", () => {
      assert.equal(applyDisplayFormat(3.9, "fixed:0"), "4");
    });

    test("negative value", () => {
      assert.equal(applyDisplayFormat(-1.5, "fixed:1"), "-1.5");
    });

    test("zero with fixed places", () => {
      assert.equal(applyDisplayFormat(0, "fixed:2"), "0.00");
    });
  });

  describe("thousands", () => {
    test("adds comma separator for thousands", () => {
      assert.equal(applyDisplayFormat(1000, "thousands"), "1,000");
    });

    test("adds multiple separators for large numbers", () => {
      assert.equal(applyDisplayFormat(1000000, "thousands"), "1,000,000");
    });

    test("leaves small numbers unchanged", () => {
      assert.equal(applyDisplayFormat(999, "thousands"), "999");
    });

    test("handles negative values", () => {
      assert.equal(applyDisplayFormat(-1234567, "thousands"), "-1,234,567");
    });

    test("preserves decimal portion", () => {
      assert.equal(applyDisplayFormat(1234.56, "thousands"), "1,234.56");
    });
  });

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

  describe("edge cases -- floating point exposure", () => {
    // Without N, `percent` passes value*100 raw to toString, which exposes
    // IEEE 754 artifacts. These tests document the current behavior.
    test("percent: 0.07 exposes floating-point multiplication artifact", () => {
      assert.equal(applyDisplayFormat(0.07, "percent"), "7.000000000000001%");
    });

    test("percent: 0.57 exposes floating-point artifact below 57", () => {
      assert.equal(applyDisplayFormat(0.57, "percent"), "56.99999999999999%");
    });

    // The :N variant runs through toFixed, which normalizes the FP artifact.
    test("percent:N cleans up floating-point artifact for 0.07", () => {
      assert.equal(applyDisplayFormat(0.07, "percent:2"), "7.00%");
    });

    test("percent:N cleans up floating-point artifact for 0.57", () => {
      assert.equal(applyDisplayFormat(0.57, "percent:2"), "57.00%");
    });

    // 1.005 in IEEE 754 is slightly below the mathematical value, so
    // 1.005 * 100 = 100.4999..., which rounds down to 100. Result is "1.00",
    // not the intuitively expected "1.01".
    test("fixed:2 on 1.005 rounds down due to IEEE 754 representation", () => {
      assert.equal(applyDisplayFormat(1.005, "fixed:2"), "1.00");
    });
  });

  describe("edge cases -- negative rounding (half-up toward +infinity)", () => {
    // JS Math.round rounds half toward positive infinity.
    // -0.5 rounds to -0, which stringifies as "0" (no minus sign).
    test("fixed:0 on -0.5 rounds to 0 not -1", () => {
      assert.equal(applyDisplayFormat(-0.5, "fixed:0"), "0");
    });

    // -3.5 rounds to -3 (toward +inf), not -4 (away from zero).
    test("fixed:0 on -3.5 rounds toward positive infinity to -3", () => {
      assert.equal(applyDisplayFormat(-3.5, "fixed:0"), "-3");
    });
  });

  describe("edge cases -- time_seconds rounding threshold", () => {
    // Values whose absolute magnitude is below 0.005 round entirely to zero.
    test("0.004 rounds to 0s (below half-cent threshold)", () => {
      assert.equal(applyDisplayFormat(0.004, "time_seconds"), "0s");
    });

    test("0.005 is exactly the rounding threshold and produces 0.01s", () => {
      assert.equal(applyDisplayFormat(0.005, "time_seconds"), "0.01s");
    });
  });

  describe("edge cases -- thousands format", () => {
    test("zero returns 0 with no separator", () => {
      assert.equal(applyDisplayFormat(0, "thousands"), "0");
    });

    test("nine-digit number gets three separators", () => {
      assert.equal(applyDisplayFormat(1234567890, "thousands"), "1,234,567,890");
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
