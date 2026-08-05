/**
 * Custom property published on the document root while at least one dialog is
 * open: the height of the layout viewport's bottom edge that the soft keyboard
 * covers, written in CSS pixels (`0px` when nothing is covered). Surfaces that
 * must stay reachable while the keyboard is up subtract it from their own
 * geometry.
 */
export const kKeyboardInsetVar = "--keyboard-inset";

/**
 * The viewport measurements the inset is derived from, all in CSS pixels
 * except `scale`.
 */
export interface ViewportOcclusionMetrics {
  /** Layout viewport height, as `window.innerHeight` reports it. */
  layoutHeight: number;
  /** Visual viewport height, as `VisualViewport.height` reports it. */
  visualHeight: number;
  /** Distance from the layout viewport's top edge to the visual viewport's, as `VisualViewport.offsetTop` reports it. */
  offsetTop: number;
  /** Pinch-zoom factor, as `VisualViewport.scale` reports it; `1` when unzoomed. */
  scale: number;
}

/**
 * How much of the layout viewport's bottom edge nothing can reach, which on a
 * touch device is the soft keyboard. Returns `0` whenever the whole layout
 * viewport is reachable, and never a negative number.
 *
 * `visualHeight` shrinks under pinch-zoom as well as under a keyboard, so it
 * is scaled back into layout pixels before the comparison; a pinch-zoom alone
 * therefore reads `0`.
 */
export function keyboardInsetPx(metrics: ViewportOcclusionMetrics): number {
  const reachable = metrics.visualHeight * metrics.scale + metrics.offsetTop;
  const covered = metrics.layoutHeight - reachable;
  return covered > 0 ? covered : 0;
}

/** Number of live subscriptions; the listeners are attached for the first and detached with the last. */
let subscriberCount = 0;

/** Removes the listeners attached for the first subscriber, or `null` when none are attached. */
let stopListening: (() => void) | null = null;

/** Writes the current inset onto the document root. */
function publishKeyboardInset(): void {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const inset = keyboardInsetPx({
    layoutHeight: window.innerHeight,
    visualHeight: viewport.height,
    offsetTop: viewport.offsetTop,
    scale: viewport.scale,
  });
  document.documentElement.style.setProperty(kKeyboardInsetVar, `${inset}px`);
}

/**
 * Publishes {@link kKeyboardInsetVar} and keeps it current from the visual
 * viewport's own `resize` and `scroll` events. Returns the release function
 * for this subscription; the last release outstanding detaches the listeners
 * and removes the property. Subscriptions nest, so a dialog opened over
 * another leaves the property published until both have released.
 *
 * Does nothing in an environment with no `visualViewport`, where the property
 * stays unset and every consumer falls back to `0px`.
 */
export function attachKeyboardInsetPublisher(): () => void {
  subscriberCount += 1;
  if (subscriberCount === 1) {
    const viewport = window.visualViewport;
    publishKeyboardInset();
    viewport?.addEventListener("resize", publishKeyboardInset);
    viewport?.addEventListener("scroll", publishKeyboardInset);
    stopListening = () => {
      viewport?.removeEventListener("resize", publishKeyboardInset);
      viewport?.removeEventListener("scroll", publishKeyboardInset);
    };
  }
  return () => {
    subscriberCount -= 1;
    if (subscriberCount > 0) return;
    stopListening?.();
    stopListening = null;
    document.documentElement.style.removeProperty(kKeyboardInsetVar);
  };
}
