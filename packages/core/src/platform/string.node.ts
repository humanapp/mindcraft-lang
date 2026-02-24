// String.node.ts (Node.js implementation)
//
// Node.js target uses native JavaScript string methods
// No extensions needed - all string methods are available by default

/**
 * String utility functions for Node.js platform
 * These delegate to native JavaScript string methods
 */
export namespace StringUtils {
  /**
   * Checks if a string starts with the specified prefix
   * @param str The string to check
   * @param searchString The prefix to search for
   * @param position Optional starting position (default: 0)
   * @returns true if str starts with searchString at the given position
   */
  export function startsWith(str: string, searchString: string, position = 0): boolean {
    return str.startsWith(searchString, position);
  }

  /**
   * Extracts a substring from a string
   * @param str The source string
   * @param start The starting index (0-based)
   * @param end Optional ending index (0-based, exclusive). If omitted, extracts to end of string
   * @returns The extracted substring
   */
  export function substring(str: string, start: number, end?: number): string {
    return str.substring(start, end);
  }

  /**
   * Gets the length of a string
   * @param str The string to measure
   * @returns The length of the string
   */
  export function length(str: string): number {
    return str.length;
  }

  export function charCodeAt(str: string, index: number): number {
    return str.charCodeAt(index);
  }

  export function fromCharCode(...codes: number[]): string {
    return String.fromCharCode(...codes);
  }

  export function mkid(len: number = 16): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < len; i++) {
      const randIndex = Math.floor(Math.random() * chars.length);
      result += chars.charAt(randIndex);
    }
    return result;
  }

  export function toString(value: unknown): string {
    return String(value);
  }

  /**
   * Repeats a string a specified number of times
   * @param str The string to repeat
   * @param count The number of times to repeat the string
   * @returns The repeated string
   */
  export function rep(str: string, count: number): string {
    return str.repeat(count);
  }

  export function trim(str: string): string {
    return str.trim();
  }

  export function hash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
