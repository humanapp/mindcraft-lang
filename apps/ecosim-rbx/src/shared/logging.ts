import { type Logger, logger } from "@wendoo-lang/core/app";

/** Log category prefix shared by every server and client subsystem in this app. */
export const APP_LOG_CATEGORY = "ecosim-rbx";

/**
 * Creates a logger scoped to one subsystem of this app.
 *
 * @param subsystem - Subsystem name appended to {@link APP_LOG_CATEGORY}, for example `"server"`.
 * @returns A logger whose category is `ecosim-rbx:<subsystem>`.
 */
export function createAppLogger(subsystem: string): Logger {
  return logger.child(APP_LOG_CATEGORY).child(subsystem);
}
