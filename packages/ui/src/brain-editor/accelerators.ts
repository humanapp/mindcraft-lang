import type { EditorMode } from "./editor-mode";

/**
 * Which platform's modifier names a contribution's markdown is written for.
 * `mac` names the command modifier Cmd; every other platform names it Ctrl.
 */
export type AcceleratorPlatform = "mac" | "other";

/** The platform `platformName` is, read from a navigator's platform or user-agent string. */
export function acceleratorPlatform(platformName: string): AcceleratorPlatform {
  return /mac|iphone|ipad|ipod/i.test(platformName) ? "mac" : "other";
}

/** The name `platform` gives the command modifier. */
export function commandKeyName(platform: AcceleratorPlatform): string {
  return platform === "mac" ? "Cmd" : "Ctrl";
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
 * One documented accelerator: the modes it stands in, what it claims to be
 * bound to, and the markdown the help page renders for it.
 *
 * `claims` is the machine-readable half and the only half a test may assert.
 * `markdown` is display prose, written afresh per platform so a modifier reads
 * as that platform names it.
 */
export interface AcceleratorContribution {
  /** Stable identity, unique across the registry. */
  readonly id: string;
  /** Every mode the contribution is live in. The help page shows it in those and no others. */
  readonly when: readonly EditorMode[];
  /** Every press or gesture the contribution claims. */
  readonly claims: readonly AcceleratorClaim[];
  /** The markdown rendered for `platform`. */
  readonly markdown: (platform: AcceleratorPlatform) => string;
}

/** A key claim, spelled as a `KeyboardEvent` spells it. */
function key(name: string): AcceleratorClaim {
  return { kind: "key", key: name };
}

/** A chord claim held with the command modifier. */
function chord(name: string): AcceleratorClaim {
  return { kind: "key", key: name, withCommand: true };
}

/** The four arrow keys, claimed together. */
const arrowKeys: readonly AcceleratorClaim[] = [key("ArrowUp"), key("ArrowDown"), key("ArrowLeft"), key("ArrowRight")];

/** The four arrow keys held with the command modifier. */
const arrowChords: readonly AcceleratorClaim[] = [
  chord("ArrowUp"),
  chord("ArrowDown"),
  chord("ArrowLeft"),
  chord("ArrowRight"),
];

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
    claims: [chord("z")],
    markdown: (platform) =>
      `**${commandKeyName(platform)}+Z** takes back the last change, from anywhere in the editor.`,
  },
  {
    id: "history-redo",
    when: historyModes,
    claims: [chord("Z"), chord("y")],
    markdown: (platform) => {
      const cmd = commandKeyName(platform);
      return `**${cmd}+Shift+Z** or **${cmd}+Y** puts back a change you have taken back.`;
    },
  },

  // -- The page's selection ------------------------------------------------
  {
    id: "grid-move-selection",
    when: ["grid-selection"],
    claims: arrowKeys,
    markdown: () =>
      "**Arrow keys** move the selection: left and right along a rule's row, up and down between rows and rules. Nothing wraps.",
  },
  {
    id: "grid-open-cell",
    when: ["grid-selection"],
    claims: [key("Enter"), key(" ")],
    markdown: () =>
      "**Enter** or **Space** acts on the selected cell: on a rule's number it picks the rule up, and on a rule's sentence it starts writing.",
  },
  {
    id: "grid-type-into-sentence",
    when: ["grid-selection"],
    claims: [{ kind: "typing" }],
    markdown: () => "**Just type** on a rule's sentence to start writing there, beginning with the letter you typed.",
  },
  {
    id: "grid-delete-subject",
    when: ["grid-selection"],
    claims: [key("Delete"), key("Backspace")],
    markdown: () => "**Delete** removes what is selected: a tile, or a whole rule from its number.",
  },
  {
    id: "grid-clipboard",
    when: ["grid-selection"],
    claims: [chord("c"), chord("x"), chord("v")],
    markdown: (platform) => {
      const cmd = commandKeyName(platform);
      return `**${cmd}+C**, **${cmd}+X**, **${cmd}+V** copy, cut and paste what is selected -- a tile, or a whole rule from its number.`;
    },
  },
  {
    id: "grid-insert-rule",
    when: ["grid-selection"],
    claims: [chord("Enter")],
    markdown: (platform) =>
      `**${commandKeyName(platform)}+Enter** adds a new rule below this one and starts writing in it.`,
  },
  {
    id: "grid-move-rule",
    when: ["grid-selection"],
    claims: arrowChords,
    markdown: (platform) =>
      `**${commandKeyName(platform)}+arrow keys** move the rule the selection is on, without picking it up: up and down past its neighbours, right to tuck it under the rule above, left to bring it back out.`,
  },
  {
    id: "grid-tab-leaves",
    when: ["grid-selection"],
    claims: [{ kind: "browser", key: "Tab" }],
    markdown: () =>
      "**Tab** leaves the rules altogether. The whole page of rules is one stop, so Tab never walks you through them one at a time.",
  },
  {
    id: "tile-menu-gesture",
    when: ["grid-selection"],
    claims: [{ kind: "pointer" }],
    markdown: () =>
      "**Right-click a tile** for its menu. On a touch screen a long press is meant to do the same, but that has not been exercised here, so treat it as unverified.",
  },

  // -- A rule picked up ----------------------------------------------------
  {
    id: "held-step-rule",
    when: ["rule-held"],
    claims: [...arrowKeys, ...arrowChords],
    markdown: () =>
      "**Arrow keys** move the rule you are holding: up and down past its neighbours, right to tuck it under the rule above, left to bring it back out. Its children travel with it.",
  },
  {
    id: "held-drop-rule",
    when: ["rule-held"],
    claims: [key("Enter")],
    markdown: () => "**Enter** puts the rule down where it stands. Every step it took becomes one undo.",
  },
  {
    id: "held-cancel-rule",
    when: ["rule-held"],
    claims: [key("Escape"), chord("z")],
    markdown: (platform) =>
      `**Escape** or **${commandKeyName(platform)}+Z** puts the rule back where you picked it up, leaving nothing to undo. The change before it stays where it is.`,
  },

  // -- An armed tile picker ------------------------------------------------
  {
    id: "offering-browse",
    when: armedModes,
    claims: [key("ArrowDown")],
    markdown: () =>
      "**Down** and **Up** walk the tiles on offer, row by row. Up off the top row hands the keyboard back to where you were typing.",
  },
  {
    id: "offering-walk-row",
    when: ["tray-armed", "tray-filtering"],
    claims: [key("ArrowRight")],
    markdown: () =>
      "**Right** and **Left** walk the tiles on offer along a row, starting from the one already highlighted. Nothing wraps.",
  },
  {
    id: "offering-place",
    when: ["tray-armed", "tray-filtering", "composing"],
    claims: [key("Enter"), key(" ")],
    markdown: () =>
      "**Enter** places the highlighted tile. **Space** places the word you have typed as soon as it names exactly one tile.",
  },
  {
    id: "offering-type",
    when: ["tray-armed", "tray-filtering", "composing"],
    claims: [{ kind: "typing" }],
    markdown: () => "**Just type** to narrow the tiles on offer. In the tray, typing also opens the search box.",
  },
  {
    id: "offering-dismiss",
    when: ["tray-armed", "tray-filtering", "composing"],
    claims: [key("Escape")],
    markdown: () => "**Escape** clears the word you are typing, and clears the picker away once there is nothing left.",
  },
  {
    id: "offering-chip-gesture",
    when: ["tray-armed", "tray-filtering", "composing"],
    claims: [{ kind: "pointer" }],
    markdown: () => "**Tap a tile** on offer to place it, or drag it onto the rule.",
  },
  {
    id: "tray-search-toggle",
    when: ["tray-armed", "tray-filtering"],
    claims: [{ kind: "pointer" }],
    markdown: () => "**The search button** shows and hides the box you type into. The keyboard stays in it either way.",
  },
  {
    id: "tray-delete-tile",
    when: ["tray-armed"],
    claims: [key("Delete")],
    markdown: () =>
      "**Delete** removes the tile you opened the picker on, in one undoable step. Once the search box is open, Delete belongs to the text in it.",
  },
  {
    id: "armed-move-rule",
    when: armedModes,
    claims: arrowChords,
    markdown: (platform) =>
      `**${commandKeyName(platform)}+arrow keys** move the rule you are working on. Nothing else shifts, so you can carry straight on.`,
  },
  {
    id: "open-text-value",
    when: ["tray-armed", "tray-filtering", "composing"],
    claims: [key('"')],
    markdown: () =>
      "A **double quote** starts a piece of text wherever the rule will take one. Everything you type after it is the text itself.",
  },

  // -- Writing a rule's sentence -------------------------------------------
  {
    id: "compose-caret",
    when: ["composing"],
    claims: [key("ArrowLeft"), key("ArrowRight")],
    markdown: () =>
      "**Left** and **Right** move where you are writing, one word at a time along the sentence. Right off the end of a word you have typed places it.",
  },
  {
    id: "compose-ends",
    when: ["composing"],
    claims: [key("Home"), key("End")],
    markdown: () => "**Home** and **End** jump to the start and the end of the sentence.",
  },
  {
    id: "compose-delete",
    when: ["composing"],
    claims: [key("Backspace"), key("Delete")],
    markdown: () =>
      "**Backspace** removes the word behind you and **Delete** the word ahead. With a word half-typed, they edit that instead.",
  },
  {
    id: "compose-pivot",
    when: ["composing"],
    claims: [key(",")],
    markdown: () =>
      "**A comma** places what you have typed and moves on to what the rule should *do*, from any point the trigger can end at.",
  },
  {
    id: "compose-settle",
    when: ["composing"],
    claims: [key(".")],
    markdown: () => "**A full stop** places what you have typed and finishes the rule, from any point it can end at.",
  },
  {
    id: "compose-settle-and-insert",
    when: ["composing", "text-literal"],
    claims: [chord("Enter")],
    markdown: (platform) =>
      `**${commandKeyName(platform)}+Enter** finishes the rule and starts a fresh one below it, ready to write in.`,
  },

  // -- A piece of text in progress -----------------------------------------
  {
    id: "text-value-place",
    when: ["text-literal"],
    claims: [key('"'), key("Enter"), key("ArrowRight")],
    markdown: () =>
      "**A closing quote**, **Enter**, or **Right** off the end places the text you have written as a tile.",
  },
  {
    id: "text-value-abandon",
    when: ["text-literal"],
    claims: [key("Escape")],
    markdown: () => "**Escape** throws the text away and leaves the rule as it was.",
  },
  {
    id: "text-value-edit",
    when: ["text-literal"],
    claims: [
      { kind: "typing" },
      { kind: "browser", key: "Backspace" },
      { kind: "browser", key: "ArrowLeft" },
      { kind: "browser", key: "z", withCommand: true },
    ],
    markdown: (platform) =>
      `**Everything you type** goes into the text, punctuation and all. **Backspace**, **Left** and **${commandKeyName(platform)}+Z** edit it exactly as they would in any text box.`,
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
