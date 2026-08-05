/**
 * Pins the contrast helpers behind tile label ink: the WCAG ratio itself, the
 * luminance boundary where black gives way to white, and the guarantee that the
 * chosen ink clears the AA 4.5:1 minimum for any background it is handed.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contrastRatio, readableInk, saturateColor } from "./color";

/** The WCAG AA minimum contrast ratio for normal-size text. */
const kAaMinimum = 4.5;

/** A grey whose luminance sits just below the black/white crossover. */
const kJustBelowCrossover = "#757575";

/** A grey whose luminance sits just above the black/white crossover. */
const kJustAboveCrossover = "#767676";

/** Channel values of a hex color, as `[r, g, b]`. */
function channels(hex: string): [number, number, number] {
  const num = Number.parseInt(hex.replace("#", ""), 16);
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

/** Spread between a hex color's strongest and weakest channel, which falls as the color mutes. */
function channelSpread(hex: string): number {
  const [r, g, b] = channels(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** Every hex color in an evenly spaced sweep of the sRGB cube, plus the greys. */
function sweepColors(): string[] {
  const colors: string[] = [];
  const channel = (v: number) => v.toString(16).padStart(2, "0");
  for (let v = 0; v <= 255; v++) colors.push(`#${channel(v)}${channel(v)}${channel(v)}`);
  for (let r = 0; r <= 255; r += 15) {
    for (let g = 0; g <= 255; g += 15) {
      for (let b = 0; b <= 255; b += 15) colors.push(`#${channel(r)}${channel(g)}${channel(b)}`);
    }
  }
  return colors;
}

describe("contrastRatio", () => {
  test("spans the full 1 to 21 range at the extremes", () => {
    assert.equal(Math.round(contrastRatio("#000000", "#ffffff") * 100) / 100, 21);
    assert.equal(contrastRatio("#000000", "#000000"), 1);
    assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  });

  test("does not depend on argument order", () => {
    assert.equal(contrastRatio("#475569", "#000000"), contrastRatio("#000000", "#475569"));
    assert.equal(contrastRatio("#aa94eb", "#ffffff"), contrastRatio("#ffffff", "#aa94eb"));
  });

  test("reads uppercase and lowercase hex identically", () => {
    assert.equal(contrastRatio("#AA94EB", "#000000"), contrastRatio("#aa94eb", "#000000"));
  });
});

describe("saturateColor", () => {
  const kSaturated = ["#3adcfe", "#3affb3", "#aa94eb", "#e57373"];

  test("a negative percent mutes the color toward grey", () => {
    for (const color of kSaturated) {
      assert.ok(channelSpread(saturateColor(color, -0.3)) < channelSpread(color), `${color} did not mute at -0.3`);
    }
  });

  test("mutes fully to grey at -1", () => {
    for (const color of kSaturated) {
      const [r, g, b] = channels(saturateColor(color, -1));
      assert.equal(r, g);
      assert.equal(g, b);
    }
  });

  test("muting keeps the dominant channel, so the hue survives", () => {
    for (const color of kSaturated) {
      const before = channels(color);
      const after = channels(saturateColor(color, -0.3));
      assert.equal(after.indexOf(Math.max(...after)), before.indexOf(Math.max(...before)));
    }
  });
});

describe("readableInk", () => {
  test("takes the opposite of each extreme", () => {
    assert.equal(readableInk("#000000"), "#ffffff");
    assert.equal(readableInk("#ffffff"), "#000000");
  });

  test("switches to white one step below the crossover luminance", () => {
    assert.equal(readableInk(kJustAboveCrossover), "#000000");
    assert.equal(readableInk(kJustBelowCrossover), "#ffffff");
  });

  test("both candidates clear AA on either side of the crossover", () => {
    for (const background of [kJustBelowCrossover, kJustAboveCrossover]) {
      assert.ok(contrastRatio("#000000", background) >= kAaMinimum);
      assert.ok(contrastRatio("#ffffff", background) >= kAaMinimum);
    }
  });

  test("returns the same ink for the same background on repeated calls", () => {
    for (const background of ["#475569", "#aa94eb", "#93a6eb", "#e57373"]) {
      assert.equal(readableInk(background), readableInk(background));
    }
  });

  test("reads uppercase and lowercase hex identically", () => {
    assert.equal(readableInk("#AA94EB"), readableInk("#aa94eb"));
    assert.equal(readableInk("#475569"), readableInk("#475569".toUpperCase()));
  });

  test("picks the higher-contrast ink for every background in the sweep", () => {
    for (const background of sweepColors()) {
      const ink = readableInk(background);
      const other = ink === "#000000" ? "#ffffff" : "#000000";
      assert.ok(
        contrastRatio(ink, background) >= contrastRatio(other, background),
        `${background} chose ${ink} over the higher-contrast ${other}`
      );
    }
  });

  test("clears AA against every background in the sweep", () => {
    for (const background of sweepColors()) {
      const ratio = contrastRatio(readableInk(background), background);
      assert.ok(ratio >= kAaMinimum, `${background} only reached ${ratio.toFixed(2)}:1`);
    }
  });
});
