/**
 * Where a closing dialog hands the keyboard back to, and how it takes it.
 *
 * The pass runs in two steps: record a chain while the opener still renders,
 * then resolve that chain against the document at close time.
 */

/** The landmark that takes the keyboard when no link of a recorded chain still renders. */
const kLandmarkSelector = "main";

/** Marks the brain editor's dialog content, the element {@link editorContentStands} counts. */
export const kEditorContentAttribute = "data-brain-editor-content";

/**
 * True when `doc` still stands a brain editor content.
 *
 * Radix swaps its dialog content between a modal and a non-modal
 * implementation, unmounting one focus scope while the editor stays open. The
 * replacement content is already standing when the unmounted scope runs its
 * focus pass, and an editor that really closed leaves none, so a close pass
 * reads this to tell the two apart.
 */
export function editorContentStands(doc: Document): boolean {
  return doc.querySelector(`[${kEditorContentAttribute}]`) !== null;
}

/**
 * The element holding the keyboard, followed by each of its ancestors below the
 * document body, nearest first.
 *
 * Record this while the whole chain still renders, so a later pass can hand the
 * keyboard to the nearest link that survived. `active` is the element holding
 * the keyboard, or null when nothing holds it; the body counts as nothing and
 * yields an empty chain, and the body itself is never a link.
 */
export function returnFocusChain(active: HTMLElement | null, doc: Document): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let node: HTMLElement | null = active;
  while (node !== null && node !== doc.body) {
    chain.push(node);
    node = node.parentElement;
  }
  return chain;
}

/**
 * The element a closing dialog hands the keyboard to.
 *
 * `chain` is what {@link returnFocusChain} recorded when the dialog opened. The
 * nearest link still connected to `doc` takes the keyboard, so an opener that
 * stopped rendering gives way to the container it stood in. When no link
 * survives, and when the dialog opened with the keyboard held nowhere, the
 * document's `main` landmark takes it. Returns null for a document rendering no
 * `main` landmark, and the caller then leaves the keyboard where it stands.
 */
export function returnFocusTarget(chain: readonly HTMLElement[], doc: Document): HTMLElement | null {
  for (const link of chain) {
    if (link.isConnected) return link;
  }
  return doc.querySelector<HTMLElement>(kLandmarkSelector);
}

/**
 * Give `target` the keyboard without moving the view.
 *
 * A container that is not focusable by nature is given `tabindex="-1"` for as
 * long as it holds the keyboard, and has it taken back off when it loses it, so
 * the document keeps no focus target it did not declare. An element carrying a
 * tabindex of its own keeps the one it declared.
 */
export function takeReturnFocus(target: HTMLElement): void {
  if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
    target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
  }
  target.focus({ preventScroll: true });
}
