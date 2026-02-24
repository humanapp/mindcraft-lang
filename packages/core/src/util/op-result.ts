import { Error } from "../platform/error";

export type OpResult<T = void> =
  | {
      success: true;
      value: T;
    }
  | {
      success: false;
      error: Error;
    };

export function opSuccess<T = void>(value: T): OpResult<T> {
  return { success: true, value };
}

export function opFailure<T = void>(errorCode: string): OpResult<T> {
  return { success: false, error: new Error(errorCode) };
}
