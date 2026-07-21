import type { ExtensionResolutionWarning } from "./embedded-extensions.js";

/** App-data key holding a project's extension install log. */
export const EXTENSION_INSTALL_LOG_APP_DATA_KEY = "extension-install-log";

/**
 * One entry of a project's install log. The log is a record: nothing in it
 * requires action, and where an application surfaces it is the application's
 * choice.
 */
export type ExtensionInstallLogEvent =
  | {
      /** An origin entered the project's resolved closure. */
      readonly kind: "install";
      /** Unix epoch milliseconds. */
      readonly at: number;
      /** The origin's `<owner>/<repo>` coordinate. */
      readonly origin: string;
      /** The winning reference the origin resolved through. */
      readonly reference: string;
      /** The immutable routing specifier a fetched origin was installed at; absent for other transports. */
      readonly specifier?: string;
    }
  | {
      /** An origin left the project's resolved closure. */
      readonly kind: "remove";
      /** Unix epoch milliseconds. */
      readonly at: number;
      /** The origin's `<owner>/<repo>` coordinate. */
      readonly origin: string;
    }
  | {
      /** An install transaction was refused because a reference's fetch failed; the project was left unchanged. */
      readonly kind: "fetch-refusal";
      /** Unix epoch milliseconds. */
      readonly at: number;
      /** The reference whose fetch failed, as written. */
      readonly reference: string;
      /** Stable failure code of the fetch attempt. */
      readonly code: string;
      /** Human-readable failure message. */
      readonly message: string;
    }
  | {
      /** Resolution selected between conflicting requesters (take-newer or reference tie-break). */
      readonly kind: "resolution-warning";
      /** Unix epoch milliseconds. */
      readonly at: number;
      /** The structured resolution warning. */
      readonly warning: ExtensionResolutionWarning;
    };

/**
 * Parse a project's install log from its app-data text. Returns an empty log
 * when the text is absent or malformed. Entries with event kinds no longer
 * produced (historical logs) parse and round-trip unchanged.
 */
export function parseExtensionInstallLog(raw: string | undefined): readonly ExtensionInstallLogEvent[] {
  if (raw === undefined) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExtensionInstallLogEvent[]) : [];
  } catch {
    return [];
  }
}

/** Append events to a log's app-data text, returning the updated text. */
export function appendExtensionInstallLog(
  raw: string | undefined,
  events: readonly ExtensionInstallLogEvent[]
): string {
  return JSON.stringify([...parseExtensionInstallLog(raw), ...events]);
}
