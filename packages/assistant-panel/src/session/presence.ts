/**
 * Where the page stands for a quiet reopen: whether it is in view, and when
 * that or the browser's connection changes.
 */
export interface SessionPresence {
  /** Whether the page is in view. */
  inView(): boolean;
  /**
   * Call `listener` whenever the page's visibility changes or the browser comes
   * back online. Returns the unsubscribe.
   */
  subscribe(listener: () => void): () => void;
}

/**
 * Presence taken from the document's visibility and the window's `online`
 * event. A host holding neither reads as in view and never changes.
 */
export function documentPresence(): SessionPresence {
  const doc = typeof document === "undefined" ? undefined : document;
  const win = typeof window === "undefined" ? undefined : window;
  return {
    inView: () => doc?.visibilityState !== "hidden",
    subscribe: (listener: () => void) => {
      doc?.addEventListener("visibilitychange", listener);
      win?.addEventListener("online", listener);
      return () => {
        doc?.removeEventListener("visibilitychange", listener);
        win?.removeEventListener("online", listener);
      };
    },
  };
}
