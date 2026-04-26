import { Error } from "../platform/error";

/** Discriminated union representing the result of an operation that may fail. Discriminate on `success`. */
export type OpResult<T = void> =
  | {
      success: true;
      value: T;
    }
  | {
      success: false;
      error: Error;
    };

/** Build a successful {@link OpResult} carrying `value`. */
export function opSuccess<T = void>(value: T): OpResult<T> {
  return { success: true, value };
}

/** Build a failed {@link OpResult} carrying an `Error` constructed from `errorCode`. */
export function opFailure<T = void>(errorCode: string): OpResult<T> {
  return { success: false, error: new Error(errorCode) };
}
