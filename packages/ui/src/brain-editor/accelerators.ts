import type { EditorMode } from "./editor-mode";

/**
 * Which platform's names a chord's modifiers are drawn with. `mac` draws them
 * as glyphs; every other platform spells them out.
 */
export type AcceleratorPlatform = "mac" | "other";

/** The platform `platformName` is, read from a navigator's platform or user-agent string. */
export function acceleratorPlatform(platformName: string): AcceleratorPlatform {
  return /mac|iphone|ipad|ipod/i.test(platformName) ? "mac" : "other";
}

/** A modifier held down as part of a chord. */
export type AcceleratorModifier = "command" | "shift" | "alt" | "control";

/** How each platform draws each modifier. */
const kModifierNames: Record<AcceleratorModifier, Record<AcceleratorPlatform, string>> = {
  command: { mac: "⌘", other: "Ctrl" },
  shift: { mac: "⇧", other: "Shift" },
  alt: { mac: "⌥", other: "Alt" },
  control: { mac: "⌃", other: "Ctrl" },
};

/** The chip `modifier` reads as on `platform`. */
export function acceleratorModifierName(modifier: AcceleratorModifier, platform: AcceleratorPlatform): string {
  return kModifierNames[modifier][platform];
}

/** Keys whose chip reads differently from the spelling a `KeyboardEvent` gives them. */
const kKeyNames: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Esc",
};

/** The chip a key reads as, given the spelling a `KeyboardEvent` gives it. */
export function acceleratorKeyName(key: string): string {
  const named = kKeyNames[key];
  if (named !== undefined) return named;
  return key.length === 1 ? key.toUpperCase() : key;
}

/**
 * One way of invoking a contribution, drawn as a run of chips.
 *
 * - `chord` -- the modifiers held, then every key any one of which completes
 *   the chord. `[command] + [z]` is one chord; the four arrows held with
 *   command are one chord of four keys, not four chords.
 * - `gesture` -- something with no key spelling, drawn as the single chip
 *   `chip` names.
 */
export type AcceleratorBinding =
  | {
      readonly kind: "chord";
      /** Held for the whole chord. Absent for an unmodified press. */
      readonly modifiers?: readonly AcceleratorModifier[];
      /** Spelled as a `KeyboardEvent` spells them. Any one of them completes the chord. */
      readonly keys: readonly string[];
    }
  | { readonly kind: "gesture"; readonly chip: string };

/** The chips `binding` draws on `platform`, in order. */
export function acceleratorChips(binding: AcceleratorBinding, platform: AcceleratorPlatform): string[] {
  if (binding.kind === "gesture") return [binding.chip];
  const modifiers = (binding.modifiers ?? []).map((modifier) => acceleratorModifierName(modifier, platform));
  return [...modifiers, ...binding.keys.map(acceleratorKeyName)];
}

/**
 * What a contribution is bound to, in a form a test can run through the
 * editor's own key decisions.
 *
 * - `key` -- a press the editor acts on. `key` is the spelling a
 *   `KeyboardEvent` gives it, and `withCommand` is true for the chord held with
 *   Meta or Control.
 * - `browser` -- a press the editor deliberately leaves to the browser, such as
 *   the text editing a box does for itself. It must reach no editor decision.
 * - `typing` -- any character the surface takes as text.
 * - `pointer` -- a gesture with no key: a tap, a drag, a long press.
 */
export type AcceleratorClaim =
  | { readonly kind: "key"; readonly key: string; readonly withCommand?: boolean }
  | { readonly kind: "browser"; readonly key: string; readonly withCommand?: boolean }
  | { readonly kind: "typing" }
  | { readonly kind: "pointer" };

/**
 * One documented accelerator: the modes it stands in, the chips the help page
 * draws for it, and what it claims to be bound to.
 *
 * `claims` is the machine-readable half and the only half a test may assert.
 * `label` and `note` are display prose. Every key or browser claim must appear
 * in some binding; a binding may show a key no claim covers, which is how a
 * press live only at some moments is still documented.
 */
export interface AcceleratorContribution {
  /** Stable identity, unique across the registry. */
  readonly id: string;
  /** Every mode the contribution is live in. The help page shows it in those and no others. */
  readonly when: readonly EditorMode[];
  /** What the accelerator does, in a few words. */
  readonly label: string;
  /** A sentence qualifying the label. A search matches on it; no row draws it. */
  readonly note?: string;
  /** Every way of invoking it, in the order the chips are drawn. */
  readonly bindings: readonly AcceleratorBinding[];
  /** Every press or gesture the contribution claims. */
  readonly claims: readonly AcceleratorClaim[];
}

/** A key claim, spelled as a `KeyboardEvent` spells it. */
function key(name: string): AcceleratorClaim {
  return { kind: "key", key: name };
}

/** A chord claim held with the command modifier. */
function chord(name: string): AcceleratorClaim {
  return { kind: "key", key: name, withCommand: true };
}

/** The four arrow keys, as a `KeyboardEvent` spells them. */
const kArrows: readonly string[] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

/** The four arrow keys, claimed together. */
const arrowKeys: readonly AcceleratorClaim[] = kArrows.map(key);

/** The four arrow keys held with the command modifier. */
const arrowChords: readonly AcceleratorClaim[] = kArrows.map(chord);

/** The four arrow keys, drawn as one unmodified chord. */
const arrowBinding: AcceleratorBinding = { kind: "chord", keys: kArrows };

/** The four arrow keys, drawn as one chord held with the command modifier. */
const arrowChordBinding: AcceleratorBinding = { kind: "chord", modifiers: ["command"], keys: kArrows };

/** Every mode an armed tile picker stands in, each of which stands an offering. */
const armedModes: readonly EditorMode[] = ["tray-armed", "tray-filtering", "composing", "text-literal"];

/** Every mode the editor's command history is stepped from. */
const historyModes: readonly EditorMode[] = ["grid-selection", "tray-armed", "tray-filtering", "composing"];

/**
 * Every documented accelerator of the brain editor, filtered to the live set by
 * {@link acceleratorsForMode}.
 */
export const kAcceleratorContributions: readonly AcceleratorContribution[] = [
  // -- The editor's history ------------------------------------------------
  {
    id: "history-undo",
    when: historyModes,
    label: "Undo",
    note: "Works from anywhere in the editor.",
    bindings: [{ kind: "chord", modifiers: ["command"], keys: ["z"] }],
    claims: [chord("z")],
  },
  {
    id: "history-redo",
    when: historyModes,
    label: "Redo",
    bindings: [
      { kind: "chord", modifiers: ["command", "shift"], keys: ["Z"] },
      { kind: "chord", modifiers: ["command"], keys: ["y"] },
    ],
    claims: [chord("Z"), chord("y")],
  },

  // -- The page's selection ------------------------------------------------
  {
    id: "grid-move-selection",
    when: ["grid-selection"],
    label: "Move selection",
    note: "Left and right along a rule's row, up and down between rows and rules. Nothing wraps.",
    bindings: [arrowBinding],
    claims: arrowKeys,
  },
  {
    id: "grid-open-cell",
    when: ["grid-selection"],
    label: "Activate",
    note: "On a rule's number it picks the rule up, and on a rule's sentence it starts writing.",
    bindings: [{ kind: "chord", keys: ["Enter", " "] }],
    claims: [key("Enter"), key(" ")],
  },
  {
    id: "grid-type-into-sentence",
    when: ["grid-selection"],
    label: "Start writing",
    note: "Writing begins with the letter you typed.",
    bindings: [{ kind: "gesture", chip: "Type" }],
    claims: [{ kind: "typing" }],
  },
  {
    id: "grid-delete-subject",
    when: ["grid-selection"],
    label: "Delete",
    note: "A tile, or a whole rule from its number.",
    bindings: [{ kind: "chord", keys: ["Delete", "Backspace"] }],
    claims: [key("Delete"), key("Backspace")],
  },
  {
    id: "grid-clipboard",
    when: ["grid-selection"],
    label: "Copy, Cut, Paste",
    note: "A tile, or a whole rule from its number.",
    bindings: [{ kind: "chord", modifiers: ["command"], keys: ["c", "x", "v"] }],
    claims: [chord("c"), chord("x"), chord("v")],
  },
  {
    id: "grid-insert-rule",
    when: ["grid-selection"],
    label: "New rule",
    bindings: [{ kind: "chord", modifiers: ["command"], keys: ["Enter"] }],
    claims: [chord("Enter")],
  },
  {
    id: "grid-move-rule",
    when: ["grid-selection"],
    label: "Move rule",
    note: "Up and down past its neighbours, right to tuck it under the rule above, left to bring it back out. The selection stays where it is.",
    bindings: [arrowChordBinding],
    claims: arrowChords,
  },
  {
    id: "grid-tab-leaves",
    when: ["grid-selection"],
    label: "Move focus out",
    note: "The whole page of rules is one stop, so Tab never walks you through them one at a time.",
    bindings: [{ kind: "chord", keys: ["Tab"] }],
    claims: [{ kind: "browser", key: "Tab" }],
  },
  {
    id: "tile-menu-gesture",
    when: ["grid-selection"],
    label: "Tile menu",
    note: "On a touch screen a long press is meant to do the same, but that has not been exercised here, so treat it as unverified.",
    bindings: [
      { kind: "gesture", chip: "Right-click" },
      { kind: "gesture", chip: "Long press" },
    ],
    claims: [{ kind: "pointer" }],
  },

  // -- A rule picked up ----------------------------------------------------
  {
    id: "held-step-rule",
    when: ["rule-held"],
    label: "Move rule",
    note: "Up and down past its neighbours, right to tuck it under the rule above, left to bring it back out. Its children travel with it.",
    bindings: [arrowBinding, arrowChordBinding],
    claims: [...arrowKeys, ...arrowChords],
  },
  {
    id: "held-drop-rule",
    when: ["rule-held"],
    label: "Drop rule",
    note: "Every step it took becomes one undo.",
    bindings: [{ kind: "chord", keys: ["Enter"] }],
    claims: [key("Enter")],
  },
  {
    id: "held-cancel-rule",
    when: ["rule-held"],
    label: "Cancel move",
    note: "Nothing is left to undo, and the change before it stays where it is.",
    bindings: [
      { kind: "chord", keys: ["Escape"] },
      { kind: "chord", modifiers: ["command"], keys: ["z"] },
    ],
    claims: [key("Escape"), chord("z")],
  },

  // -- An armed tile picker ------------------------------------------------
  {
    id: "offering-browse",
    when: armedModes,
    label: "Move by row",
    note: "Up off the top row hands the keyboard back to where you were typing.",
    bindings: [{ kind: "chord", keys: ["ArrowUp", "ArrowDown"] }],
    claims: [key("ArrowDown")],
  },
  {
    id: "offering-walk-row",
    when: ["tray-armed", "tray-filtering"],
    label: "Move along a row",
    note: "Starting from the one already highlighted. Nothing wraps.",
    bindings: [{ kind: "chord", keys: ["ArrowLeft", "ArrowRight"] }],
    claims: [key("ArrowRight")],
  },
  {
    id: "offering-place",
    when: ["tray-armed", "tray-filtering", "composing"],
    label: "Place tile",
    note: "Space places the word you have typed as soon as it names exactly one tile.",
    bindings: [{ kind: "chord", keys: ["Enter", " "] }],
    claims: [key("Enter"), key(" ")],
  },
  {
    id: "offering-type",
    when: ["tray-armed", "tray-filtering", "composing"],
    label: "Filter tiles",
    note: "In the tray, typing also opens the search box.",
    bindings: [{ kind: "gesture", chip: "Type" }],
    claims: [{ kind: "typing" }],
  },
  {
    id: "offering-dismiss",
    when: ["tray-armed", "tray-filtering", "composing"],
    label: "Cancel",
    bindings: [{ kind: "chord", keys: ["Escape"] }],
    claims: [key("Escape")],
  },
  {
    id: "offering-chip-gesture",
    when: ["tray-armed", "tray-filtering", "composing"],
    label: "Place tile",
    bindings: [
      { kind: "gesture", chip: "Tap" },
      { kind: "gesture", chip: "Drag" },
    ],
    claims: [{ kind: "pointer" }],
  },
  {
    id: "tray-search-toggle",
    when: ["tray-armed", "tray-filtering"],
    label: "Toggle search",
    note: "The keyboard stays in it either way.",
    bindings: [{ kind: "gesture", chip: "Search button" }],
    claims: [{ kind: "pointer" }],
  },
  {
    id: "tray-delete-tile",
    when: ["tray-armed"],
    label: "Delete tile",
    note: "One undoable step. Once the search box is open, Delete belongs to the text in it.",
    bindings: [{ kind: "chord", keys: ["Delete"] }],
    claims: [key("Delete")],
  },
  {
    id: "armed-move-rule",
    when: armedModes,
    label: "Move rule",
    note: "Nothing else shifts, so you can carry straight on.",
    bindings: [arrowChordBinding],
    claims: arrowChords,
  },
  {
    id: "open-text-value",
    when: ["tray-armed", "tray-filtering", "composing"],
    label: "New text",
    note: "Wherever the rule will take one. Everything you type after it is the text itself.",
    bindings: [{ kind: "chord", keys: ['"'] }],
    claims: [key('"')],
  },

  // -- Writing a rule's sentence -------------------------------------------
  {
    id: "compose-caret",
    when: ["composing"],
    label: "Move by word",
    note: "Right off the end of a word you have typed places it.",
    bindings: [{ kind: "chord", keys: ["ArrowLeft", "ArrowRight"] }],
    claims: [key("ArrowLeft"), key("ArrowRight")],
  },
  {
    id: "compose-ends",
    when: ["composing"],
    label: "Start or end of line",
    bindings: [{ kind: "chord", keys: ["Home", "End"] }],
    claims: [key("Home"), key("End")],
  },
  {
    id: "compose-delete",
    when: ["composing"],
    label: "Delete word",
    note: "With a word half-typed, they edit that instead.",
    bindings: [{ kind: "chord", keys: ["Backspace", "Delete"] }],
    claims: [key("Backspace"), key("Delete")],
  },
  {
    id: "compose-pivot",
    when: ["composing"],
    label: "Go to the DO side",
    note: "Places what you have typed, from any point the trigger can end at.",
    bindings: [{ kind: "chord", keys: [","] }],
    claims: [key(",")],
  },
  {
    id: "compose-settle",
    when: ["composing"],
    label: "Finish rule",
    note: "Places what you have typed, from any point it can end at.",
    bindings: [{ kind: "chord", keys: ["."] }],
    claims: [key(".")],
  },
  {
    id: "compose-settle-and-insert",
    when: ["composing", "text-literal"],
    label: "Finish rule and add another",
    bindings: [{ kind: "chord", modifiers: ["command"], keys: ["Enter"] }],
    claims: [chord("Enter")],
  },

  // -- A piece of text in progress -----------------------------------------
  {
    id: "text-value-place",
    when: ["text-literal"],
    label: "Place text",
    note: "Right places it from the end of the text.",
    bindings: [{ kind: "chord", keys: ['"', "Enter", "ArrowRight"] }],
    claims: [key('"'), key("Enter"), key("ArrowRight")],
  },
  {
    id: "text-value-abandon",
    when: ["text-literal"],
    label: "Cancel text",
    bindings: [{ kind: "chord", keys: ["Escape"] }],
    claims: [key("Escape")],
  },
  {
    id: "text-value-edit",
    when: ["text-literal"],
    label: "Edit text",
    note: "Everything you type goes into the text, punctuation and all.",
    bindings: [
      { kind: "gesture", chip: "Type" },
      { kind: "chord", keys: ["Backspace", "ArrowLeft"] },
      { kind: "chord", modifiers: ["command"], keys: ["z"] },
    ],
    claims: [
      { kind: "typing" },
      { kind: "browser", key: "Backspace" },
      { kind: "browser", key: "ArrowLeft" },
      { kind: "browser", key: "z", withCommand: true },
    ],
  },
];

/**
 * The contributions live in `mode`, in registry order. An `undefined` mode --
 * no editor standing -- yields none.
 */
export function acceleratorsForMode(
  mode: EditorMode | undefined,
  contributions: readonly AcceleratorContribution[] = kAcceleratorContributions
): AcceleratorContribution[] {
  if (mode === undefined) return [];
  return contributions.filter((contribution) => contribution.when.includes(mode));
}

/** The live section of the keyboard help, as {@link liveAcceleratorSection} answers it. */
export interface LiveAcceleratorSection {
  /** The mode the editor stands in. */
  readonly mode: EditorMode;
  /** The contributions live in that mode, in registry order. Never empty. */
  readonly contributions: readonly AcceleratorContribution[];
}

/**
 * The section of accelerators live in the editor right now, or `undefined` when
 * no editor stands and the help page must show its static reference alone.
 */
export function liveAcceleratorSection(
  mode: EditorMode | undefined,
  contributions: readonly AcceleratorContribution[] = kAcceleratorContributions
): LiveAcceleratorSection | undefined {
  if (mode === undefined) return undefined;
  const live = acceleratorsForMode(mode, contributions);
  return live.length === 0 ? undefined : { mode, contributions: live };
}
