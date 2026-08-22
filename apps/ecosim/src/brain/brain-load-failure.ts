import { AppHostError, type AppHostErrorCode } from "@wendoo/app-host";

/** Why the archetype brains could not be loaded when the simulation started. */
export interface BrainLoadFailure {
  /** Stable host error code, present only when the failure came from an app-host API. */
  code?: AppHostErrorCode;
  /** The failure's own message; the stringified value when it was not an `Error`. */
  message: string;
}

/**
 * Classifies a rejected brain load into the code and message the UI reports.
 * An `AppHostError` contributes its stable code alongside its message; any
 * other value contributes only a message.
 */
export function toBrainLoadFailure(error: unknown): BrainLoadFailure {
  if (error instanceof AppHostError) {
    return { code: error.code, message: error.message };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}
