/**
 * Cross-platform time utilities
 * Platform-specific implementations provide the actual functionality
 */
export declare namespace Time {
  /**
   * Returns the current timestamp in milliseconds since epoch
   * - Node/Browser: Date.now()
   * - Roblox: DateTime.now().UnixTimestampMillis
   */
  function nowMs(): number;
}
