/** Stable identifiers for errors thrown by app-host APIs. */
export const AppHostErrorCode = {
  ACTIVE_PROJECT_COLLECTION_DELETE_BLOCKED: "ACTIVE_PROJECT_COLLECTION_DELETE_BLOCKED",
  ACTIVE_PROJECT_DELETE_BLOCKED: "ACTIVE_PROJECT_DELETE_BLOCKED",
  BRAIN_RECORD_UNREADABLE: "BRAIN_RECORD_UNREADABLE",
  DEFAULT_PROJECT_COLLECTION_DELETE_BLOCKED: "DEFAULT_PROJECT_COLLECTION_DELETE_BLOCKED",
  EXTENSION_RECORD_UNREADABLE: "EXTENSION_RECORD_UNREADABLE",
  INVALID_PROJECT_COLLECTION_NAME: "INVALID_PROJECT_COLLECTION_NAME",
  INVALID_PROJECT_COLLECTION_PIN: "INVALID_PROJECT_COLLECTION_PIN",
  NO_ACTIVE_PROJECT: "NO_ACTIVE_PROJECT",
  NO_ACTIVE_PROJECT_COLLECTION: "NO_ACTIVE_PROJECT_COLLECTION",
  PROJECT_COLLECTION_LOCKED: "PROJECT_COLLECTION_LOCKED",
  PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB: "PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB",
  PROJECT_COLLECTION_PIN_CAPABILITY_UNAVAILABLE: "PROJECT_COLLECTION_PIN_CAPABILITY_UNAVAILABLE",
  PROJECT_COLLECTION_PIN_INVALID: "PROJECT_COLLECTION_PIN_INVALID",
  PROJECT_COLLECTION_NOT_FOUND: "PROJECT_COLLECTION_NOT_FOUND",
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  PROJECT_NOT_IN_ACTIVE_COLLECTION: "PROJECT_NOT_IN_ACTIVE_COLLECTION",
} as const;

/** Union of all {@link AppHostErrorCode} values. */
export type AppHostErrorCode = (typeof AppHostErrorCode)[keyof typeof AppHostErrorCode];

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
