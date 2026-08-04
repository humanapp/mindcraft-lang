import type { EditorMode } from "./editor-mode";

/** A step along the editor's command history. */
export type HistoryStep = "undo" | "redo";

/** One press, as the history shortcut reads it. */
export interface HistoryPress {
  /** The key, spelled as a `KeyboardEvent` spells it. */
  readonly key: string;
  /** True while Meta or Control is held. */
  readonly withCommand: boolean;
  /** True while Shift is held. Read as not held when omitted. */
  readonly withShift?: boolean;
}

/**
 * True when `press` is the undo chord: Z held with the command modifier and
 * without Shift.
 */
export function isUndoChord(press: HistoryPress): boolean {
  return press.withCommand && press.withShift !== true && press.key === "z";
}

/**
 * The history step `press` asks for in `mode`, or undefined for every press the
 * editor's history leaves alone.
 *
 * Undo is the undo chord; redo is the same chord with Shift, which spells the
 * key as `Z`, or Y held with the command modifier.
 *
 * Undefined for every press in `text-literal` and `rule-held`.
 */
export function decideHistoryShortcut(mode: EditorMode, press: HistoryPress): HistoryStep | undefined {
  if (mode === "text-literal" || mode === "rule-held") return undefined;
  if (!press.withCommand) return undefined;
  if (isUndoChord(press)) return "undo";
  return press.key === "z" || press.key === "Z" || press.key === "y" ? "redo" : undefined;
}
