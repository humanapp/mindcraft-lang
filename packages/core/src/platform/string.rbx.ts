// String.rbx.ts (Roblox / roblox-ts implementation)
//
// Extends string interface with methods not available in roblox-ts
// rbxtsc automatically translates these to native Lua string methods

declare global {
  interface String {
    replace(searchValue: string, replaceValue: string): string;
    replaceAll(searchValue: string, replaceValue: string): string;
  }
}

/**
 * String utility functions for roblox-ts platform
 * These provide implementations for methods not available in roblox-ts
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
    return str.sub(position + 1, position + searchString.size()) === searchString;
  }

  /**
   * Extracts a substring from a string
   * @param str The source string
   * @param startIndex The starting index (0-based)
   * @param endIndex Optional ending index (0-based, exclusive). If omitted, extracts to end of string
   * @returns The extracted substring
   */
  export function substring(str: string, startIndex: number, endIndex?: number): string {
    const startPos = math.max(0, startIndex) + 1; // Convert to 1-based and ensure non-negative
    if (endIndex === undefined) {
      return str.sub(startPos);
    }
    const endPos = math.max(0, endIndex); // Ensure non-negative
    const actualStart = math.min(startPos - 1, endPos);
    const actualEnd = math.max(startPos - 1, endPos);
    return str.sub(actualStart + 1, actualEnd);
  }

  /**
   * Gets the length of a string
   * @param str The string to measure
   * @returns The length of the string
   */
  export function length(str: string): number {
    return str.size();
  }

  export function charCodeAt(str: string, index: number): number {
    return str.byte(index + 1, index + 1)[0];
  }

  export function fromCharCode(...codes: number[]): string {
    return string.char(...codes);
  }

  export function mkid(len: number = 16): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < len; i++) {
      const randIndex = math.floor(math.random() * chars.size()) + 1;
      result += chars.sub(randIndex, randIndex);
    }
    return result;
  }

  export function toString(value: unknown): string {
    return tostring(value);
  }

  /**
   * Repeats a string a specified number of times
   * @param str The string to repeat
   * @param count The number of times to repeat the string
   * @returns The repeated string
   */
  export function rep(str: string, count: number): string {
    let result = "";
    for (let i = 0; i < count; i++) {
      result += str;
    }
    return result;
  }

  export function trim(str: string): string {
    let [result] = str.gsub("^%s+", "");
    [result] = result.gsub("%s+$", "");
    return result;
  }

  export function hash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.size(); i++) {
      const char = charCodeAt(str, i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return math.abs(hash);
  }
}
