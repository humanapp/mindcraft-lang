/**
 * Runtime settings for the @mindcraft-lang/ui package.
 *
 * All flags default to off. Enable them at application bootstrap as needed,
 * e.g.:
 *
 *   import { enableClipboardLogging } from "@mindcraft-lang/ui";
 *   enableClipboardLogging(true);
 */

// ---------------------------------------------------------------------------
// Clipboard logging
// ---------------------------------------------------------------------------

let clipboardLoggingEnabled = false;

/** Returns true when clipboard payload logging is currently enabled. */
export function isClipboardLoggingEnabled(): boolean {
  return clipboardLoggingEnabled;
}

/**
 * When enabled, clipboard copy operations log their JSON payload via
 * logger.info. Useful for generating brain code examples for docs.
 * Intended for development use only.
 */
export function enableClipboardLogging(enable: boolean): void {
  clipboardLoggingEnabled = enable;
}
