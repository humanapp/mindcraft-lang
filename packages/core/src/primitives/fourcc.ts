/**
 * FourCC (Four Character Code) utilities for compact string identifiers.
 * These are primitive operations with no dependencies on other modules.
 *
 * Platform-specific implementations are in fourcc.node.ts and fourcc.rbx.ts
 */

/**
 * Convert a 4-character string to a 32-bit integer identifier.
 * @param s - A string exactly 4 characters long
 * @returns A 32-bit unsigned integer representation
 * @throws Error if string is not exactly 4 characters
 */
export declare function fourCC(s: string): number;

/**
 * Convert a 32-bit integer back to a 4-character string.
 * @param n - A 32-bit unsigned integer
 * @returns A 4-character string
 */
export declare function fromFourCC(n: number): string;
