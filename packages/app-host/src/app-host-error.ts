/** Stable identifiers for errors thrown by app-host APIs. */
export type AppHostErrorCode =
  | "ACTIVE_PROJECT_COLLECTION_DELETE_BLOCKED"
  | "ACTIVE_PROJECT_DELETE_BLOCKED"
  | "DEFAULT_PROJECT_COLLECTION_DELETE_BLOCKED"
  | "INVALID_PROJECT_COLLECTION_NAME"
  | "NO_ACTIVE_PROJECT"
  | "NO_ACTIVE_PROJECT_COLLECTION"
  | "PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB"
  | "PROJECT_COLLECTION_NOT_FOUND"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_NOT_IN_ACTIVE_COLLECTION";

/**
 * Error thrown by app-host APIs.
 *
 * Match {@link code} in tests and app logic. The inherited `message` property
 * is a human-readable description.
 */
export class AppHostError extends Error {
  /** Stable error identifier. */
  readonly code: AppHostErrorCode;

  constructor(code: AppHostErrorCode, message: string) {
    super(message);
    this.name = "AppHostError";
    this.code = code;
  }
}

/** Create an {@link AppHostError} with a stable code and descriptive message. */
export function appHostError(code: AppHostErrorCode, message: string): AppHostError {
  return new AppHostError(code, message);
}
