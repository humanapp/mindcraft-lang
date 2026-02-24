/**
 * Node.js/Browser time implementation
 */
export namespace Time {
  export function nowMs(): number {
    return Date.now();
  }
}
