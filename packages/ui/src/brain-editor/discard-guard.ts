/**
 * What the brain editor knows about the work its session has accumulated, read
 * at the moment a discarding exit is requested.
 */
export interface DiscardGuardReading {
  /** Entries on the command history's undo stack right now. */
  undoDepth: number;
  /**
   * Undo depth the editor had reached on its own before the user could act: 1
   * when the editor appended a starting rule to a brain that held none, else 0.
   */
  openingDepth: number;
  /**
   * True once the working brain has been swapped for another wholesale -- loaded
   * from a file, or reset to the host's default brain. Those replacements clear
   * the command history, so the undo depth no longer measures the work at risk.
   */
  brainReplaced: boolean;
}

/**
 * Whether closing the brain editor now would throw away work the user did.
 *
 * A brain the user only opened is not dirty, including one the editor gave a
 * starting rule to on open. Undoing back to the opening state clears the
 * reading again, since the working copy then matches what the editor opened.
 *
 * @param reading - The editor's session counters and replacement flag.
 * @returns True when the session holds user work that a discard would lose.
 */
export function hasDiscardableEdits(reading: DiscardGuardReading): boolean {
  if (reading.brainReplaced) return true;
  return reading.undoDepth > reading.openingDepth;
}
