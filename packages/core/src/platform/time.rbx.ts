/**
 * Roblox time implementation
 */
export namespace Time {
  export function nowMs(): number {
    return DateTime.now().UnixTimestampMillis;
  }
}
