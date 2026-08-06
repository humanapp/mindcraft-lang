/**
 * The seam a surface covering part of the viewport publishes its footprint
 * through, and the surfaces that lay themselves out around it read from.
 *
 * A publisher names a registered custom property and a value; every attached
 * surface carries that property as an inline style, so the surface's own CSS
 * reads it with `var()`. Attaching replays whatever is published, so a surface
 * mounting after a publish lays out at the current value.
 *
 * Attach only elements that read the property, never a shared ancestor: every
 * property published here is registered in `ui.css` with `inherits: false`, so
 * a value set on an ancestor does not reach its descendants. The registration
 * also declares the initial value consumers lay out at while nothing is
 * published.
 */

/** The custom property the documentation panel publishes its width through, as a CSS percentage. */
export const kDocsPanelInsetVar = "--docs-panel-inset";

/** A surface that carries the published insets. Any `HTMLElement` satisfies it. */
export interface InsetSurface {
  readonly style: {
    setProperty(property: string, value: string): void;
    removeProperty(property: string): string;
  };
}

/** Currently published values, keyed by custom property name. */
const published = new Map<string, string>();

/** Surfaces carrying the published values, in attachment order. */
const surfaces = new Set<InsetSurface>();

/**
 * Writes `value` onto every attached surface as `property`, and onto any
 * surface attached later.
 */
export function publishInset(property: string, value: string): void {
  published.set(property, value);
  for (const surface of surfaces) {
    surface.style.setProperty(property, value);
  }
}

/**
 * Stops publishing `property` and clears it from every attached surface, which
 * returns consumers to the initial value `ui.css` registers for it.
 */
export function withdrawInset(property: string): void {
  published.delete(property);
  for (const surface of surfaces) {
    surface.style.removeProperty(property);
  }
}

/**
 * Registers `surface` to carry the published insets, writing the current ones
 * onto it immediately. Returns the release function; releasing stops further
 * writes and leaves the surface as it stands.
 */
export function attachInsetSurface(surface: InsetSurface): () => void {
  surfaces.add(surface);
  for (const [property, value] of published) {
    surface.style.setProperty(property, value);
  }
  return () => {
    surfaces.delete(surface);
  };
}
