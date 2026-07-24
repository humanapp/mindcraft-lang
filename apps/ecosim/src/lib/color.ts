// -- Color Conversion Utilities ---------------------------------------------

/** Convert RGB (0-255) to HSL (0-1). */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;

  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case rf:
        h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
        break;
      case gf:
        h = ((bf - rf) / d + 2) / 6;
        break;
      case bf:
        h = ((rf - gf) / d + 4) / 6;
        break;
    }
  }

  return { h, s, l };
}

/** Convert HSL (0-1) to RGB (0-255). */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let rf: number, gf: number, bf: number;

  if (s === 0) {
    rf = gf = bf = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rf = hue2rgb(p, q, h + 1 / 3);
    gf = hue2rgb(p, q, h);
    bf = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(rf * 255),
    g: Math.round(gf * 255),
    b: Math.round(bf * 255),
  };
}

// -- Heat-map Interpolation -------------------------------------------------

/**
 * Map a normalised value (0-1) to a green -> yellow -> red heat-map color.
 *
 * Returns a packed 0xRRGGBB integer suitable for Phaser/Canvas fill styles.
 *
 * | t     | color   |
 * |-------|---------|
 * | 0.0   | green   |
 * | 0.5   | yellow  |
 * | 1.0   | red     |
 */
export function heatColor(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  const r = clamped < 0.5 ? Math.floor(clamped * 2 * 255) : 255;
  const g = clamped < 0.5 ? 255 : Math.floor((1 - (clamped - 0.5) * 2) * 255);
  return (r << 16) | (g << 8);
}

// -- Color Adjustment Utilities ---------------------------------------------

/** Adjust a hex color's brightness by a percentage (-1 to +1). */
export function adjustColor(hex: string, percent: number): string {
  const num = Number.parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + Math.round(((num >> 16) & 0xff) * percent)));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + Math.round(((num >> 8) & 0xff) * percent)));
  const b = Math.min(255, Math.max(0, (num & 0xff) + Math.round((num & 0xff) * percent)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/**
 * Return a Phaser-style tint color (packed 0xRRGGBB) for an actor at the given energy ratio.
 *
 * Full energy (ratio = 1.0) -> 0xffffff (no tint, passthrough).
 * Zero energy (ratio = 0.0) -> 0x444444 (heavily darkened / greyed out).
 *
 * Because Phaser's setTint() multiplies the texture color by the tint, using a
 * neutral grey ramp uniformly reduces each channel, darkening and effectively
 * de-saturating the sprite appearance at low energy.
 */
export function energyTint(energyRatio: number): number {
  const t = Math.min(1, Math.max(0, energyRatio));
  const lo = 0x44;
  const hi = 0xff;
  const v = Math.round(lo + (hi - lo) * t);
  return (v << 16) | (v << 8) | v;
}

/** Increase a hex color's saturation by a percentage (0 to 1). */
export function saturateColor(hex: string, percent: number): string {
  const num = Number.parseInt(hex.replace("#", ""), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;

  const { h, s, l } = rgbToHsl(r, g, b);
  const newS = Math.min(1, Math.max(0, s + s * percent));
  const { r: newR, g: newG, b: newB } = hslToRgb(h, newS, l);

  return `#${((1 << 24) + (newR << 16) + (newG << 8) + newB).toString(16).slice(1)}`;
}
