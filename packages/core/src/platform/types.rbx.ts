// Roblox implementation of type checking utilities

export namespace TypeUtils {
  export function isNumber(value: unknown): value is number {
    return typeIs(value, "number");
  }

  export function isString(value: unknown): value is string {
    return typeIs(value, "string");
  }

  export function isBoolean(value: unknown): value is boolean {
    return typeIs(value, "boolean");
  }

  export function isFunction(value: unknown): value is Function {
    return typeIs(value, "function");
  }

  export function isObject(value: unknown): value is object {
    return typeIs(value, "table");
  }

  export function isArray(value: unknown): value is unknown[] {
    // This doesn't work in Roblox-TS (no instanceof)
    //return typeIs(value, "table") && value instanceof Array;
    return typeIs(value, "table") && (value as never)["size"] !== undefined && (value as never)["push"] !== undefined;
  }
}
