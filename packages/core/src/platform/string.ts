// Base string interface extensions and utils
// This file exists for TypeScript module resolution consistency
// Actual implementations are platform-specific

/**
 * Cross-platform string utility functions
 * Platform-specific implementations provide the actual functionality
 */
export namespace StringUtils {
  /**
   * Checks if a string starts with the specified prefix
   * @param str The string to check
   * @param searchString The prefix to search for
   * @param position Optional starting position (default: 0)
   * @returns true if str starts with searchString at the given position
   */
  export declare function startsWith(str: string, searchString: string, position?: number): boolean;

  /**
   * Extracts a substring from a string
   * @param str The source string
   * @param start The starting index (0-based)
   * @param end Optional ending index (0-based, exclusive). If omitted, extracts to end of string
   * @returns The extracted substring
   */
  export declare function substring(str: string, start: number, end?: number): string;

  /**
   * Gets the length of a string
   * @param str The string to measure
   * @returns The length of the string
   */
  export declare function length(str: string): number;

  /**
   * Gets the character code at the specified index in a string
   * @param str The source string
   * @param index The index of the character (0-based)
   * @returns The character code at the specified index
   */
  export declare function charCodeAt(str: string, index: number): number;

  /**
   * Creates a string from one or more character codes
   * @param codes One or more character codes
   * @returns The string created from the character codes
   */
  export declare function fromCharCode(...codes: number[]): string;

  /**
   * Generates a UUID-like string identifier
   * @returns A UUID-like string
   */
  export declare function mkid(len?: number): string;

  /**
   * Converts a value to its string representation
   * @param value The value to convert
   * @returns The string representation of the value
   */
  export declare function toString(value: unknown): string;

  /**
   * Repeats a string a specified number of times
   * @param str The string to repeat
   * @param count The number of times to repeat the string
   * @returns The repeated string
   */
  export declare function rep(str: string, count: number): string;

  /**
   * Trims whitespace from both ends of a string
   * @param str The string to trim
   * @returns The trimmed string
   */
  export declare function trim(str: string): string;

  /**
   * Simple string hashing function.
   * @param str The string to hash
   * @returns A non-negative integer hash of the string
   */
  export declare function hash(str: string): number;
}
