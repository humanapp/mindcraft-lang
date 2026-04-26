/** Cross-platform `Error` class. Use this in shared `packages/core` code instead of the global `Error`. */
export declare class Error {
  constructor(message: string);
  message: string;
  name: string;
  stack?: string;
}
