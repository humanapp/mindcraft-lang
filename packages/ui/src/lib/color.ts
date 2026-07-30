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
 * Adjust a hex color's saturation by a percentage (-1 to +1), preserving its
 * hue and lightness. A positive percent saturates; a negative percent mutes
 * toward grey, reaching full grey at -1.
 */
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

// -- Contrast Utilities -----------------------------------------------------

/** Relative luminance of a hex color per WCAG 2.x, from 0 (black) to 1 (white). */
function relativeLuminance(hex: string): number {
  const num = Number.parseInt(hex.replace("#", ""), 16);
  const toLinear = (channel: number): number => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear((num >> 16) & 0xff) + 0.7152 * toLinear((num >> 8) & 0xff) + 0.0722 * toLinear(num & 0xff);
}

/**
 * Contrast ratio between two hex colors per WCAG 2.x, from 1 (identical colors)
 * to 21 (black against white). The argument order does not affect the result.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The text color -- black or white -- that reads better on `background`, given
 * as a hex color. The winner always clears the WCAG AA 4.5:1 minimum for normal
 * text: black and white cross over at 4.58:1 against the same background, so
 * the better of the two is never below that.
 */
export function readableInk(background: string): "#000000" | "#ffffff" {
  return contrastRatio("#000000", background) >= contrastRatio("#ffffff", background) ? "#000000" : "#ffffff";
}
