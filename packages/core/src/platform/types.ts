// Cross-platform type checking utilities
// This file contains type declarations
// Platform-specific implementations are in types.node.ts and types.rbx.ts

/**
 * Cross-platform type checking utilities
 */
export namespace TypeUtils {
  /**
   * Checks if a value is a number
   * @param value The value to check
   * @returns true if value is a number
   */
  export declare function isNumber(value: unknown): value is number;

  /**
   * Checks if a value is a string
   * @param value The value to check
   * @returns true if value is a string
   */
  export declare function isString(value: unknown): value is string;

  /**
   * Checks if a value is a boolean
   * @param value The value to check
   * @returns true if value is a boolean
   */
  export declare function isBoolean(value: unknown): value is boolean;

  /**
   * Checks if a value is a function
   * @param value The value to check
   * @returns true if value is a function
   */
  export declare function isFunction(value: unknown): value is Function;

  /**
   * Checks if a value is an object (but not null)
   * @param value The value to check
   * @returns true if value is an object
   * Note: In JavaScript, `typeof null` is "object", so we need to exclude null explicitly.
   */
  export declare function isObject(value: unknown): value is object;

  /**
   * Checks if a value is an array
   * @param value The value to check
   * @returns true if value is an array
   */
  export declare function isArray(value: unknown): value is unknown[];
}
