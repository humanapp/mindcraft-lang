/**
 * Map a normalised value (0-1) to a green -> yellow -> red heat-map color.
 *
 * Returns a packed 0xRRGGBB integer.
 *
 * | t     | color   |
 * |-------|---------|
 * | 0.0   | green   |
 * | 0.5   | yellow  |
 * | 1.0   | red     |
 *
 * @param t - Normalised value; values outside 0-1 are clamped.
 * @returns Packed 0xRRGGBB color.
 */
export function heatColor(t: number): number {
  const clamped = math.min(math.max(t, 0), 1);
  const r = clamped < 0.5 ? math.floor(clamped * 2 * 255) : 255;
  const g = clamped < 0.5 ? 255 : math.floor((1 - (clamped - 0.5) * 2) * 255);
  return r * 0x10000 + g * 0x100;
}

/**
 * Converts a packed 0xRRGGBB integer into a Roblox Color3.
 *
 * @param packed - Packed 0xRRGGBB color.
 * @returns The equivalent Color3.
 */
export function packedToColor3(packed: number): Color3 {
  const r = math.floor(packed / 0x10000) % 0x100;
  const g = math.floor(packed / 0x100) % 0x100;
  const b = packed % 0x100;
  return Color3.fromRGB(r, g, b);
}
