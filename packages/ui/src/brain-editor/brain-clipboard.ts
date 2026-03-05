import type { BrainDef, BrainJson } from "@mindcraft-lang/core/brain/model";

/**
 * Serialized clipboard payload for a copied brain.
 * Stored in a module-level variable so it persists across editor open/close
 * within the same browser tab.
 */
interface BrainClipboardData {
  brainJson: BrainJson;
}

let clipboardData: BrainClipboardData | undefined;
const clipboardListeners = new Set<() => void>();

function notifyClipboardChanged(): void {
  for (const listener of clipboardListeners) {
    listener();
  }
}

/**
 * Subscribe to brain clipboard changes. Returns an unsubscribe function.
 */
export function onBrainClipboardChanged(listener: () => void): () => void {
  clipboardListeners.add(listener);
  return () => {
    clipboardListeners.delete(listener);
  };
}

/**
 * Copy a brain to the module-level clipboard.
 *
 * Serializes the brain via its JSON representation so the clipboard is
 * self-contained and independent of the original brain instance.
 */
export function copyBrainToClipboard(brain: BrainDef): void {
  clipboardData = { brainJson: brain.toJson() };
  notifyClipboardChanged();
}

/**
 * Whether the clipboard contains a copied brain.
 */
export function hasBrainInClipboard(): boolean {
  return clipboardData !== undefined;
}

/**
 * Return the clipboard's brain JSON, or undefined if the clipboard is empty.
 */
export function getBrainFromClipboard(): BrainJson | undefined {
  return clipboardData?.brainJson;
}
