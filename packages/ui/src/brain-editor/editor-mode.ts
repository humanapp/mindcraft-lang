import type { ArmedTargetEntry } from "./ArmedTargetContext";

/**
 * The context the brain editor's keyboard stands in. Exactly one mode stands at
 * a time, and it names which keys act and what they do.
 *
 * - `grid-selection` -- the page's selection rests on a cell, nothing is armed
 * - `rule-held` -- a rule has been picked up from its handle, and the arrows step it
 * - `tray-armed` -- the tile picker is armed with its filter box hidden, standing at no caret
 * - `tray-filtering` -- the same arming with the filter box shown, which narrows the offering
 * - `composing` -- the picker is armed from a rule's sentence, at a caret along that rule's run
 * - `text-literal` -- a text value stands open in the picker's shown box
 */
export type EditorMode =
  | "grid-selection"
  | "rule-held"
  | "tray-armed"
  | "tray-filtering"
  | "composing"
  | "text-literal";

/**
 * Every mode, in the order a reader meets them: the page's two, then each
 * arming from the least to the most typed into.
 */
export const kEditorModes: readonly EditorMode[] = [
  "grid-selection",
  "rule-held",
  "tray-armed",
  "tray-filtering",
  "composing",
  "text-literal",
];

/** What an armed tile picker reads about itself. */
export interface EditorArmingFacts {
  /** Where the arming happened. A `sentence` entry composes at a caret; a `tray` entry stands at none. */
  readonly entry: ArmedTargetEntry;
  /**
   * True while the picker's filter box stands shown. Always true for a
   * `sentence` entry, whose box the rule's own line hosts; a `tray` entry hides
   * its box until something is typed or the tray's search control shows it.
   */
  readonly boxIsShown: boolean;
  /** True while a text value stands open in that box. */
  readonly textLiteralIsOpen: boolean;
}

/** What {@link deriveEditorMode} reads. */
export interface EditorModeFacts {
  /** The tile picker's arming, or undefined while nothing is armed. */
  readonly arming?: EditorArmingFacts;
  /** True while the page has picked a rule up. Read only while nothing is armed. */
  readonly ruleIsHeld?: boolean;
}

/**
 * The mode `facts` stand in.
 *
 * An arming decides the mode on its own: the keyboard is the picker's for as
 * long as one stands. A tray arming whose box is hidden is `tray-armed`
 * whatever that box holds, since the tray's own keys are the ones a hidden box
 * leaves standing. Otherwise an open text value takes every key, and the entry
 * decides the rest.
 *
 * With nothing armed the keyboard is the page's: `rule-held` while a rule has
 * been picked up, and `grid-selection` otherwise.
 */
export function deriveEditorMode(facts: EditorModeFacts): EditorMode {
  const arming = facts.arming;
  if (arming === undefined) return facts.ruleIsHeld === true ? "rule-held" : "grid-selection";
  if (arming.entry === "tray" && !arming.boxIsShown) return "tray-armed";
  if (arming.textLiteralIsOpen) return "text-literal";
  return arming.entry === "sentence" ? "composing" : "tray-filtering";
}
