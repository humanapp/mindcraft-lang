/**
 * FourCC (Four Character Code) utilities for compact string identifiers.
 * Roblox-specific implementation using Luau string functions directly.
 */

/**
 * Convert a 4-character string to a 32-bit integer identifier.
 * @param s - A string exactly 4 characters long
 * @returns A 32-bit unsigned integer representation
 * @throws Error if string is not exactly 4 characters
 */
export function fourCC(s: string): number {
  if (s.size() !== 4) {
    throw `FourCC must be 4 chars`;
  }
  const [c0, c1, c2, c3] = string.byte(s, 1, 4);
  return ((c0 << 24) | (c1 << 16) | (c2 << 8) | c3) >>> 0;
}

/**
 * Convert a 32-bit integer back to a 4-character string.
 * @param n - A 32-bit unsigned integer
 * @returns A 4-character string
 */
export function fromFourCC(n: number): string {
  return string.char((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}
