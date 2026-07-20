import { Error } from "./error";

/**
 * Asserts an unreachable code path. Use in the `default` branch of an
 * exhaustive `switch` over a finite union; the `never` parameter makes an
 * unhandled union member a compile error. Throws if reached at runtime.
 */
export function assertUnreachable(value: never): never {
  throw new Error(`Unhandled case: ${value}`);
}
