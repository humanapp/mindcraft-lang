/**
 * FourCC (Four Character Code) utilities for compact string identifiers.
 * Node.js-specific implementation using standard JavaScript string methods.
 */

/**
 * Convert a 4-character string to a 32-bit integer identifier.
 * @param s - A string exactly 4 characters long
 * @returns A 32-bit unsigned integer representation
 * @throws Error if string is not exactly 4 characters
 */
export function fourCC(s: string): number {
  if (s.length !== 4) {
    throw new Error("FourCC must be 4 chars");
  }
  return ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
}

/**
 * Convert a 32-bit integer back to a 4-character string.
 * @param n - A 32-bit unsigned integer
 * @returns A 4-character string
 */
export function fromFourCC(n: number): string {
  return String.fromCharCode((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}
