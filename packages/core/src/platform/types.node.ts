// Node.js/browser implementation of type checking utilities

export namespace TypeUtils {
  export function isNumber(value: unknown): value is number {
    return typeof value === "number";
  }

  export function isString(value: unknown): value is string {
    return typeof value === "string";
  }

  export function isBoolean(value: unknown): value is boolean {
    return typeof value === "boolean";
  }

  /**
   * Checks if a value is a function
   * @param value The value to check
   * @returns true if value is a function
   */
  export function isFunction(value: unknown): value is Function {
    return typeof value === "function";
  }

  /**
   * Checks if a value is an object (but not null)
   * @param value The value to check
   * @returns true if value is an object
   * Note: In JavaScript, `typeof null` is "object", so we need to exclude null explicitly.
   */
  export function isObject(value: unknown): value is object {
    return typeof value === "object" && value !== null;
  }

  /**
   * Checks if a value is an array
   * @param value The value to check
   * @returns true if value is an array
   */
  export function isArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
  }
}
