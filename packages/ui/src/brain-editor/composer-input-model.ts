import { RuleSide } from "@mindcraft-lang/core/brain";
import type { ArmedTargetEntry } from "./ArmedTargetContext";
import {
  decideStripEscape,
  isStripFilterTypingKey,
  moveStripCursorAlongChips,
  moveStripCursorBetweenRows,
  type StripCandidate,
  type StripCellGeometry,
  type StripCursor,
  type StripFocusTarget,
  type StripHighlightMode,
  type StripOption,
} from "./candidate-strip-model";
import { type CaretPosition, caretDeletionTarget, caretOnRun, caretSideEnd, caretStep } from "./caret-run";
import {
  decideComposerBackspace,
  decideComposerCharacter,
  decideComposerComma,
  decideComposerPeriod,
} from "./sentence-composer";

/**
 * The composer's input state: what the keyboard is aimed at, and what it has
 * built up that no other surface owns.
 */
export interface ComposerInputState {
  /**
   * Where the caret stands along the rule's run, which the position being edited
   * is projected from. Undefined for a strip armed from the tray, which stands
   * at no caret of the rule's own.
   */
  readonly caret: CaretPosition | undefined;
  /** The rule side composition is armed on. */
  readonly armedSide: RuleSide;
  /** Where the arming happened; the sentence-only gestures apply to `sentence` alone. */
  readonly armedEntry: ArmedTargetEntry;
  /** The word in progress. */
  readonly filter: string;
  /** The cell of the offering's grid the cursor stands on, or undefined when it stands on none. */
  readonly cursor: StripCursor | undefined;
  /** Which element the highlight is anchored on. */
  readonly highlightMode: StripHighlightMode;
  /** True while composition sits on the DO side of a typed pivot. */
  readonly pivoted: boolean;
  /**
   * The text value the opening quote started: the content typed into it so far,
   * empty while it holds none, and undefined when no text value is open.
   */
  readonly textLiteral: string | undefined;
}

/** Which way an arrow key steps. */
export type ComposerArrowDirection = "up" | "down" | "left" | "right";

/**
 * Which of the composer's keyboard surfaces a keystroke arrived from: the filter
 * box, the listbox of the band whose chips are being browsed, or the strip's
 * close button.
 */
export type ComposerKeySurface = "filter" | "band" | "close";

/** The gesture a word was placed on the way to, re-decided once the placement lands. */
export type ComposerGesture = "pivot" | "settle";

/**
 * One input the composer interprets. Every token is raw input -- a key on a
 * named surface, or the filter box's own content change -- so
 * {@link reduceComposerInput} is the only place that decides what it means.
 *
 * - `text` -- the filter box's content changed, which is how every character
 *   that is not a key of its own arrives
 * - `space`, `tab`, `enter` -- the commit keys
 * - `comma`, `period` -- the pivot and the settle
 * - `quote` -- open a text value, or place the one already open
 * - `escape` -- clear the word in progress, then close
 * - `backspace` -- the composer's ladder, or an edit of the word in progress
 * - `delete-forward` -- delete the tile the caret stands at or in front of
 * - `delete-element` -- delete the tile the element `position` stands at,
 *   whatever the box is holding
 * - `printable` -- a character typed while the offering is being browsed
 * - `candidate-tapped` -- a chip was tapped or dropped on the armed position
 * - `arrow` -- a step of the cursor, or of the caret
 * - `home`, `end` -- the run's first and last position
 * - `heading-arrow` -- an arrow pressed on an accordion heading
 * - `focus-lost` -- the element the highlight was anchored on no longer holds
 *   the keyboard, whether it was left, was clicked away from, or stopped being
 *   rendered; `leftStrip` says the keyboard went outside the strip altogether,
 *   which ends composition as well as releasing the cursor
 * - `placement-landed` -- the placement a `reask` effect asked about has run, so
 *   the gesture behind it is decided again
 */
export type ComposerInputToken =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "space" }
  | { readonly kind: "tab" }
  | { readonly kind: "comma" }
  | { readonly kind: "period" }
  | { readonly kind: "quote" }
  | { readonly kind: "escape" }
  | { readonly kind: "printable" }
  | { readonly kind: "home" }
  | { readonly kind: "end" }
  | { readonly kind: "delete-forward" }
  | { readonly kind: "delete-element"; readonly position: CaretPosition }
  | { readonly kind: "candidate-tapped"; readonly candidate: StripCandidate }
  | { readonly kind: "enter"; readonly from: "filter" | "band" }
  | { readonly kind: "backspace"; readonly from: "filter" | "band" | "heading" }
  | { readonly kind: "arrow"; readonly direction: ComposerArrowDirection; readonly from: ComposerKeySurface }
  | { readonly kind: "heading-arrow"; readonly direction: ComposerArrowDirection; readonly sectionKey: string }
  | { readonly kind: "focus-lost"; readonly leftStrip: boolean }
  | { readonly kind: "placement-landed"; readonly gesture: ComposerGesture };

/** Why the strip closes: the rule was settled with a period, or the strip was dismissed. */
export type ComposerCloseReason = "settled" | "dismissed";

/**
 * What the composer asks its driver to do. Every member is a description; the
 * model performs none of it.
 *
 * - `consume-key` -- the keystroke belongs to the composer, not the browser
 * - `set-filter` -- the word in progress becomes `text`
 * - `set-text-literal` -- the open text value becomes `value`, and closes when
 *   `value` is undefined
 * - `highlight` -- the cursor stands at `cursor`, anchored per `mode`
 * - `open-section` -- the accordion section `sectionKey` opens
 * - `close-section` -- the accordion section `sectionKey` closes, leaving any
 *   other open section as it stands
 * - `place-tile` -- `candidate` is placed at the armed position
 * - `announce-placement` -- assistive technology hears that `label` was placed
 * - `move-focus` -- the keyboard goes to `target`
 * - `reask` -- once everything asked for above has taken effect, ask the model
 *   again with `token`, which reads the offering and the rule as they stand
 *   then
 * - `move-caret` -- the caret stands at `position`, which arms the edit that
 *   position intends and asks the offering there
 * - `delete-tile` -- the tile at `position` leaves the rule
 * - `undo-own-commit` -- the composition's own last commit is taken back, which
 *   removes the tile that commit placed
 * - `flash-caret` -- the caret's place is flashed, showing where the keyboard
 *   came back to
 * - `close-strip` -- composition on the rule ends
 */
export type ComposerInputEffect =
  | { readonly kind: "consume-key" }
  | { readonly kind: "set-filter"; readonly text: string }
  | { readonly kind: "set-text-literal"; readonly value: string | undefined }
  | { readonly kind: "highlight"; readonly cursor: StripCursor | undefined; readonly mode: StripHighlightMode }
  | { readonly kind: "open-section"; readonly sectionKey: string }
  | { readonly kind: "close-section"; readonly sectionKey: string }
  | { readonly kind: "place-tile"; readonly candidate: StripCandidate }
  | { readonly kind: "announce-placement"; readonly label: string }
  | {
      readonly kind: "move-focus";
      /** Where the keyboard goes. */
      readonly target: StripFocusTarget;
      /** True when the move must leave the scroll position where it is. */
      readonly keepScroll: boolean;
    }
  | { readonly kind: "reask"; readonly token: ComposerInputToken }
  | { readonly kind: "move-caret"; readonly position: CaretPosition }
  | { readonly kind: "delete-tile"; readonly position: CaretPosition }
  | { readonly kind: "undo-own-commit" }
  | { readonly kind: "flash-caret" }
  | { readonly kind: "close-strip"; readonly reason: ComposerCloseReason };

/**
 * What the composer reads about the offering and the rule around it. Every field
 * is read at the moment the token arrives, so a token dispatched after a
 * placement carries the facts that placement produced.
 */
export interface ComposerInputFacts {
  /**
   * Every caret position of the rule, in reading order. Empty for a strip armed
   * from the tray, which stands on no rule's run.
   */
  readonly caretRun: readonly CaretPosition[];
  /**
   * Where the text cursor stands in the composer's box: the character offsets
   * its selection runs between, equal while it selects nothing.
   */
  readonly textCursor: { readonly start: number; readonly end: number };
  /** True when the tiles of the armed side may end where composition stands. */
  readonly armedSideCanEnd: boolean;
  /** True when the rule holds no tiles on either side. */
  readonly ruleIsEmpty: boolean;
  /** How many tiles the rule's DO side holds. */
  readonly doTileCount: number;
  /**
   * The element the composition's own newest placement stands at, while that
   * placement is still the history's newest undoable entry. Undefined where the
   * composition has placed nothing, and once anything else has changed the
   * document.
   */
  readonly ownNewestPlacement: CaretPosition | undefined;
  /** The candidate Enter and Tab place, or undefined when they must not commit. */
  readonly topCandidate: StripCandidate | undefined;
  /** The candidate Space places, or undefined when it must not commit. */
  readonly spaceCandidate: StripCandidate | undefined;
  /** The candidate the cursor stands on, or undefined when it stands on no chip. */
  readonly highlightedCandidate: StripCandidate | undefined;
  /** True when the armed position accepts a text literal, so a typed quote opens one. */
  readonly acceptsTextLiteral: boolean;
  /**
   * The candidate the open text value places, or undefined when no text value is
   * open and when the armed position accepts none.
   */
  readonly pendingTextLiteral: StripCandidate | undefined;
  /** Every rendered chip, in the order the cursor walks them. */
  readonly options: readonly StripOption[];
  /** Where every cell of the offering's grid sits: its chips and its group headings. */
  readonly cellGeometry: readonly StripCellGeometry[];
}

/** The state the composer moves to for one token, and what it asks its driver to do. */
export interface ComposerInputOutcome {
  readonly state: ComposerInputState;
  readonly effects: readonly ComposerInputEffect[];
}

const filterFocus: StripFocusTarget = { kind: "input" };

/** The direction an arrow key steps, or undefined for every other key. */
function arrowDirection(key: string): ComposerArrowDirection | undefined {
  if (key === "ArrowDown") return "down";
  if (key === "ArrowUp") return "up";
  if (key === "ArrowRight") return "right";
  if (key === "ArrowLeft") return "left";
  return undefined;
}

/**
 * The token a press of `key` on `surface` means, or undefined when the key is
 * the browser's: a character the filter box types for itself, Tab out of a
 * band, and every key the close button does not steer the cursor with.
 */
export function composerTokenForKey(key: string, surface: ComposerKeySurface): ComposerInputToken | undefined {
  const direction = arrowDirection(key);
  if (direction !== undefined) return { kind: "arrow", direction, from: surface };
  if (surface === "close") return undefined;
  if (key === "Escape") return surface === "filter" ? { kind: "escape" } : undefined;
  if (key === "Enter") return { kind: "enter", from: surface };
  if (key === "Backspace") return { kind: "backspace", from: surface };
  if (surface === "band") return isStripFilterTypingKey(key) ? { kind: "printable" } : undefined;
  if (key === "Home") return { kind: "home" };
  if (key === "End") return { kind: "end" };
  if (key === "Delete") return { kind: "delete-forward" };
  if (key === ",") return { kind: "comma" };
  if (key === ".") return { kind: "period" };
  if (key === '"') return { kind: "quote" };
  if (key === " ") return { kind: "space" };
  if (key === "Tab") return { kind: "tab" };
  return undefined;
}

/**
 * The token a press of `key` on the accordion heading of `sectionKey` means, or
 * undefined when the key is the heading button's own: Enter and every key that
 * neither steers the offering nor edits the word in progress. All four arrows
 * reach the offering here; the keys that type hand the keyboard back to the
 * filter box.
 */
export function composerHeadingToken(key: string, sectionKey: string): ComposerInputToken | undefined {
  const direction = arrowDirection(key);
  if (direction !== undefined) return { kind: "heading-arrow", direction, sectionKey };
  if (key === "Backspace") return { kind: "backspace", from: "heading" };
  return isStripFilterTypingKey(key) ? { kind: "printable" } : undefined;
}

/**
 * The character a press of `key` starts composition with from a rule's entry
 * point, or undefined when the press starts none: Space, Enter, Backspace, and
 * every key that types nothing. `withModifier` is true while Meta, Control, or
 * Alt is held, which yields undefined for every key.
 */
export function composerEntryCharacter(key: string, withModifier: boolean): string | undefined {
  if (withModifier || key === " " || key === "Backspace") return undefined;
  return isStripFilterTypingKey(key) ? key : undefined;
}

/** True when `effects` asks the driver to keep the keystroke from the browser. */
export function consumesKey(effects: readonly ComposerInputEffect[]): boolean {
  return effects.some((effect) => effect.kind === "consume-key");
}

/** The step an arrow direction takes along a sequence or between rows. */
function arrowStep(direction: ComposerArrowDirection): 1 | -1 {
  return direction === "down" || direction === "right" ? 1 : -1;
}

/** True when the direction steps between the wrapped rows the chips are drawn in. */
function isRowDirection(direction: ComposerArrowDirection): direction is "up" | "down" {
  return direction === "up" || direction === "down";
}

/** The outcome that leaves the composer as it stands and lets the browser have the keystroke. */
function inert(state: ComposerInputState): ComposerInputOutcome {
  return { state, effects: [] };
}

/** The gap of `side` before the tile at `tileIndex`, clamped to that side's opening gap. */
function gapAt(side: RuleSide, tileIndex: number): CaretPosition {
  return { kind: "gap", side, tileIndex: Math.max(0, tileIndex) };
}

/** The text the composer's box holds: an open text value's content, or the word in progress. */
function pendingText(state: ComposerInputState): string {
  return state.textLiteral ?? state.filter;
}

/** True while the box holds an edit the caret's position will take. */
function hasPendingEdit(state: ComposerInputState): boolean {
  return state.textLiteral !== undefined || state.filter.length > 0;
}

/**
 * Stand the caret at `position`: whatever the box was holding is abandoned,
 * placing nothing and leaving the rule's tiles as they stand, and the cursor
 * resolved against the position left behind is released.
 */
function moveCaret(state: ComposerInputState, position: CaretPosition): ComposerInputOutcome {
  const abandoned: ComposerInputEffect[] = [];
  if (state.textLiteral !== undefined) abandoned.push({ kind: "set-text-literal", value: undefined });
  if (state.filter.length > 0) abandoned.push({ kind: "set-filter", text: "" });
  return {
    state: {
      ...state,
      caret: position,
      filter: "",
      textLiteral: undefined,
      cursor: undefined,
      highlightMode: "typing",
    },
    effects: [
      { kind: "consume-key" },
      ...abandoned,
      { kind: "move-caret", position },
      { kind: "highlight", cursor: undefined, mode: "typing" },
    ],
  };
}

/**
 * Stand the cursor at `cursor` anchored per `mode`, keeping the keyboard with
 * the filter box while typing. A cursor on a heading always anchors on that
 * heading, which holds the keyboard itself. An undefined `cursor` leaves the
 * composer as it stands, which is what a grid with no cell in the asked-for
 * direction returns.
 */
function moveHighlight(
  state: ComposerInputState,
  cursor: StripCursor | undefined,
  mode: StripHighlightMode
): ComposerInputOutcome {
  if (cursor === undefined) return inert(state);
  const anchored: StripHighlightMode = cursor.kind === "heading" ? "browsing" : mode;
  const effects: ComposerInputEffect[] = [{ kind: "highlight", cursor, mode: anchored }];
  if (anchored === "typing") effects.push({ kind: "move-focus", target: filterFocus, keepScroll: false });
  effects.push({ kind: "consume-key" });
  return { state: { ...state, cursor, highlightMode: anchored }, effects };
}

/**
 * Place `candidate` and start the next word: the caret comes to rest in the gap
 * past the tile just placed, the word in progress and the highlight begin again
 * in the filter box, and `then` carries whatever gesture the placement was made
 * on the way to.
 */
function placeCandidate(
  state: ComposerInputState,
  candidate: StripCandidate,
  then: readonly ComposerInputEffect[] = []
): ComposerInputOutcome {
  const caret = state.caret === undefined ? undefined : gapAt(state.caret.side, state.caret.tileIndex + 1);
  const moved: readonly ComposerInputEffect[] = caret === undefined ? [] : [{ kind: "move-caret", position: caret }];
  return {
    state: { ...state, caret, filter: "", cursor: undefined, highlightMode: "typing" },
    effects: [
      { kind: "consume-key" },
      { kind: "place-tile", candidate },
      { kind: "announce-placement", label: candidate.label },
      ...moved,
      { kind: "highlight", cursor: undefined, mode: "typing" },
      { kind: "move-focus", target: filterFocus, keepScroll: true },
      ...then,
    ],
  };
}

/** Start the word in progress over at `text`, with the highlight back in the filter box. */
function retypeFilter(
  state: ComposerInputState,
  text: string,
  leading: readonly ComposerInputEffect[]
): ComposerInputOutcome {
  return {
    state: { ...state, filter: text, cursor: undefined, highlightMode: "typing" },
    effects: [...leading, { kind: "set-filter", text }, { kind: "highlight", cursor: undefined, mode: "typing" }],
  };
}

/** Carry the open text value on at `value`, with the highlight back in the filter box. */
function retypeTextLiteral(
  state: ComposerInputState,
  value: string,
  leading: readonly ComposerInputEffect[]
): ComposerInputOutcome {
  return {
    state: { ...state, textLiteral: value, cursor: undefined, highlightMode: "typing" },
    effects: [
      ...leading,
      { kind: "set-text-literal", value },
      { kind: "highlight", cursor: undefined, mode: "typing" },
    ],
  };
}

/** Leave the open text value, placing nothing and leaving the rule's tiles as they stand. */
function abandonTextLiteral(state: ComposerInputState, leading: readonly ComposerInputEffect[]): ComposerInputOutcome {
  return {
    state: { ...state, textLiteral: undefined },
    effects: [...leading, { kind: "set-text-literal", value: undefined }],
  };
}

/** Place the open text value as a literal tile, close the value, and start the next word. */
function commitTextLiteral(state: ComposerInputState, candidate: StripCandidate): ComposerInputOutcome {
  return placeCandidate({ ...state, textLiteral: undefined }, candidate, [
    { kind: "set-text-literal", value: undefined },
  ]);
}

/**
 * Place the open text value, or leave it when the armed position offers no
 * candidate to place it with.
 */
function commitOpenTextLiteral(state: ComposerInputState, facts: ComposerInputFacts): ComposerInputOutcome {
  if (facts.pendingTextLiteral === undefined) return abandonTextLiteral(state, [{ kind: "consume-key" }]);
  return commitTextLiteral(state, facts.pendingTextLiteral);
}

/**
 * The quote's outcome: at a position that accepts a text literal it opens an
 * empty text value and takes over the filter box, and the next quote commits what
 * was typed into it. Where the position accepts no text literal the quote is
 * ordinary filter text.
 */
function reduceQuote(state: ComposerInputState, facts: ComposerInputFacts): ComposerInputOutcome {
  if (state.textLiteral === undefined) {
    if (!facts.acceptsTextLiteral) return inert(state);
    return {
      state: { ...state, filter: "", textLiteral: "", cursor: undefined, highlightMode: "typing" },
      effects: [
        { kind: "consume-key" },
        { kind: "set-filter", text: "" },
        { kind: "set-text-literal", value: "" },
        { kind: "highlight", cursor: undefined, mode: "typing" },
      ],
    };
  }
  return commitOpenTextLiteral(state, facts);
}

/** The token that places the word in progress, exactly as the Space key places it. */
const commitWordToken: ComposerInputToken = { kind: "space" };

/**
 * The one character `text` adds to the end of `word`, or undefined for every
 * other edit of the box: a deletion, a paste, and an edit made anywhere but at
 * the end.
 */
function appendedCharacter(word: string, text: string): string | undefined {
  if (text.length !== word.length + 1 || !text.startsWith(word)) return undefined;
  return text[text.length - 1];
}

/** Leave the word in progress standing as it is, which the box reverts to. */
function refuseCharacter(state: ComposerInputState): ComposerInputOutcome {
  return { state, effects: [{ kind: "set-filter", text: state.filter }] };
}

/**
 * The box's own content change: an edit of the word in progress, or the one
 * character that ends it. A character of another class than the word in
 * progress places that word exactly as Space places it, and the next word
 * starts with that character once the placement has taken effect; a bracket is a
 * word of its own and is placed as soon as it stands alone. Every other edit --
 * a deletion, a paste, an edit made away from the end -- is the word in progress
 * becoming `text`.
 */
function reduceTypedText(state: ComposerInputState, facts: ComposerInputFacts, text: string): ComposerInputOutcome {
  const char = appendedCharacter(state.filter, text);
  if (char === undefined) return retypeFilter(state, text, []);
  const spaceCandidate = facts.spaceCandidate;
  const action = decideComposerCharacter({ char, word: state.filter, wordCommits: spaceCandidate !== undefined });
  switch (action) {
    case "refuse":
      return refuseCharacter(state);
    case "commit-then-start":
      if (spaceCandidate === undefined) return refuseCharacter(state);
      return placeCandidate(state, spaceCandidate, [{ kind: "reask", token: { kind: "text", text: char } }]);
    case "place-alone": {
      const typed = retypeFilter(state, text, []);
      return { state: typed.state, effects: [...typed.effects, { kind: "reask", token: commitWordToken }] };
    }
    case "extend":
      return retypeFilter(state, text, []);
  }
}

/**
 * True when the open text value suspends `token`: the punctuation keys, which
 * the filter box types into the value.
 */
function isSuspendedByTextLiteral(token: ComposerInputToken): boolean {
  switch (token.kind) {
    case "space":
    case "comma":
    case "period":
      return true;
    default:
      return false;
  }
}

/**
 * Continue composing on `side`, placing no tile: the caret comes to rest in that
 * side's end gap.
 */
function composeOnSide(
  state: ComposerInputState,
  facts: ComposerInputFacts,
  side: RuleSide,
  leading: readonly ComposerInputEffect[]
): ComposerInputOutcome {
  const caret = caretSideEnd(facts.caretRun, side) ?? state.caret;
  const moved: readonly ComposerInputEffect[] = caret === undefined ? [] : [{ kind: "move-caret", position: caret }];
  return {
    state: { ...state, armedSide: side, pivoted: side === RuleSide.Do, caret },
    effects: [...leading, ...moved],
  };
}

/** The comma's outcome: place the word in progress if there is one, then pivot. */
function reduceComma(state: ComposerInputState, facts: ComposerInputFacts): ComposerInputOutcome {
  if (state.armedEntry !== "sentence") return inert(state);
  const action = decideComposerComma({
    armedSide: state.armedSide,
    filter: state.filter,
    armedSideCanEnd: facts.armedSideCanEnd,
    wordInProgressCommits: facts.spaceCandidate !== undefined,
  });
  if (action === "filter-text") return inert(state);
  if (action === "pivot-to-do") return composeOnSide(state, facts, RuleSide.Do, [{ kind: "consume-key" }]);
  if (facts.spaceCandidate === undefined) return { state, effects: [{ kind: "consume-key" }] };
  return placeCandidate(state, facts.spaceCandidate, [
    { kind: "reask", token: { kind: "placement-landed", gesture: "pivot" } },
  ]);
}

/** The period's outcome: place the word in progress if there is one, then settle. */
function reducePeriod(state: ComposerInputState, facts: ComposerInputFacts): ComposerInputOutcome {
  if (state.armedEntry !== "sentence") return inert(state);
  const action = decideComposerPeriod({
    filter: state.filter,
    armedSideCanEnd: facts.armedSideCanEnd,
    ruleIsEmpty: facts.ruleIsEmpty,
    wordInProgressCommits: facts.spaceCandidate !== undefined,
  });
  if (action === "filter-text") return inert(state);
  if (action === "none" || action === "refuse") return { state, effects: [{ kind: "consume-key" }] };
  if (action === "settle") {
    return { state, effects: [{ kind: "consume-key" }, { kind: "close-strip", reason: "settled" }] };
  }
  if (facts.spaceCandidate === undefined) return { state, effects: [{ kind: "consume-key" }] };
  return placeCandidate(state, facts.spaceCandidate, [
    { kind: "reask", token: { kind: "placement-landed", gesture: "settle" } },
  ]);
}

/**
 * Backspace's outcome while a text value is open: an edit of `content`, and past
 * the opening quote the value closes, placing nothing and taking nothing back.
 * The composer's own ladder is out of reach until the value closes.
 */
function reduceTextLiteralBackspace(
  state: ComposerInputState,
  content: string,
  from: "filter" | "band" | "heading"
): ComposerInputOutcome {
  if (content.length === 0) return abandonTextLiteral(state, [{ kind: "consume-key" }]);
  // A cell of the grid carries no text caret, so the edit of the content is made here.
  if (from !== "filter") {
    return retypeTextLiteral(state, content.slice(0, -1), [
      { kind: "move-focus", target: filterFocus, keepScroll: false },
      { kind: "consume-key" },
    ]);
  }
  return inert(state);
}

/**
 * Delete the tile the caret addresses `direction`, which is the tile the caret
 * rests on or, from a gap, the nearest tile that way along the run. The caret
 * comes to rest in the gap that tile vacated. A caret with no tile that way, and
 * a caret the rule's run no longer holds, leave the key alone.
 *
 * The tile the composition itself placed last, still standing as the newest
 * thing done to the document, leaves by that placement being taken back rather
 * than by a removal of its own; either way the same tile goes.
 */
function reduceDeleteAtCaret(
  state: ComposerInputState,
  facts: ComposerInputFacts,
  direction: "left" | "right"
): ComposerInputOutcome {
  const caret = state.caret === undefined ? undefined : caretOnRun(facts.caretRun, state.caret);
  if (caret === undefined) return inert(state);
  const target = caretDeletionTarget(facts.caretRun, caret, direction);
  if (target === undefined) return inert(state);
  const own = facts.ownNewestPlacement;
  const takesBackOwnCommit = own !== undefined && own.side === target.side && own.tileIndex === target.tileIndex;
  const vacated = gapAt(target.side, target.tileIndex);
  return {
    state: { ...state, caret: vacated },
    effects: [
      { kind: "consume-key" },
      takesBackOwnCommit ? { kind: "undo-own-commit" } : { kind: "delete-tile", position: target },
      { kind: "move-caret", position: vacated },
    ],
  };
}

/** Backspace's outcome: an edit of the word in progress, or one rung of the composer's ladder. */
function reduceBackspace(
  state: ComposerInputState,
  facts: ComposerInputFacts,
  from: "filter" | "band" | "heading"
): ComposerInputOutcome {
  if (state.textLiteral !== undefined) return reduceTextLiteralBackspace(state, state.textLiteral, from);
  // A cell of the grid carries no text caret, so the edit of the word in progress is made here.
  if (from !== "filter") {
    return retypeFilter(state, state.filter.slice(0, -1), [
      { kind: "move-focus", target: filterFocus, keepScroll: false },
      { kind: "consume-key" },
    ]);
  }
  if (state.armedEntry !== "sentence") return inert(state);
  const action = decideComposerBackspace({
    filter: state.filter,
    pivoted: state.pivoted,
    doTileCount: facts.doTileCount,
  });
  if (action === "edit-filter") return inert(state);
  if (action === "unpivot") {
    return composeOnSide(state, facts, RuleSide.When, [{ kind: "consume-key" }]);
  }
  return reduceDeleteAtCaret(state, facts, "left");
}

/**
 * Place what the box is holding, exactly as the key that commits it would: the
 * word in progress as Space places it, and an open text value as its closing
 * quote places it. Text that names nothing to place is refused -- the key is
 * swallowed and that text stands as it is.
 */
function commitPendingText(state: ComposerInputState, facts: ComposerInputFacts): ComposerInputOutcome {
  if (state.textLiteral !== undefined) {
    if (facts.pendingTextLiteral === undefined) return { state, effects: [{ kind: "consume-key" }] };
    return commitTextLiteral(state, facts.pendingTextLiteral);
  }
  if (facts.spaceCandidate === undefined) return { state, effects: [{ kind: "consume-key" }] };
  return placeCandidate(state, facts.spaceCandidate);
}

/**
 * A horizontal arrow's outcome in the composer's box: one step of the caret
 * along the rule's run, clamped at both ends. An edit in progress takes the key
 * while the text cursor stands inside it or holds a selection. The key that
 * would carry that cursor off the end of the edit places it, coming to rest past
 * the tile placed; the key that would carry it off the start abandons it and
 * steps the caret back.
 */
function reduceCaretArrow(
  state: ComposerInputState,
  facts: ComposerInputFacts,
  caret: CaretPosition,
  direction: "left" | "right"
): ComposerInputOutcome {
  if (hasPendingEdit(state)) {
    const { start, end } = facts.textCursor;
    if (start !== end) return inert(state);
    const leavesText = direction === "left" ? start === 0 : start === pendingText(state).length;
    if (!leavesText) return inert(state);
    if (direction === "right") return commitPendingText(state, facts);
  }
  // A rule changed under the caret leaves it addressing a position no run built
  // since holds; the key steps from where that position stands on this run.
  const standing = caretOnRun(facts.caretRun, caret);
  if (standing === undefined) return inert(state);
  return moveCaret(state, caretStep(facts.caretRun, standing, direction));
}

/**
 * Release the cursor: it stands on no cell afterwards and anchors on the
 * composer's box. The keyboard, the rule's tiles, the caret, and the word in
 * progress are all left as they stand.
 */
function releaseHighlight(state: ComposerInputState): ComposerInputOutcome {
  return {
    state: { ...state, cursor: undefined, highlightMode: "typing" },
    effects: [{ kind: "highlight", cursor: undefined, mode: "typing" }],
  };
}

/**
 * Leave the offering: the cursor is released, the keyboard goes back to the
 * composer's box, where the caret stands, and the caret's place is flashed.
 */
function leaveOffering(state: ComposerInputState): ComposerInputOutcome {
  const released = releaseHighlight(state);
  return {
    state: released.state,
    effects: [
      { kind: "consume-key" },
      ...released.effects,
      { kind: "move-focus", target: filterFocus, keepScroll: false },
      { kind: "flash-caret" },
    ],
  };
}

/**
 * A vertical arrow's outcome: one step of the cursor between the grid's rows,
 * which nothing wraps. Stepping up off the grid's first row leaves the offering,
 * releasing the cursor, returning the keyboard to the composer's box, and
 * flashing the caret's place; stepping down off its last row keeps the key and
 * stands the cursor where it is.
 */
function reduceRowArrow(
  state: ComposerInputState,
  facts: ComposerInputFacts,
  direction: "up" | "down",
  cursor: StripCursor | undefined
): ComposerInputOutcome {
  const stepped = moveStripCursorBetweenRows(facts.cellGeometry, cursor, arrowStep(direction));
  if (stepped !== undefined) return moveHighlight(state, stepped, state.highlightMode);
  if (cursor === undefined) return inert(state);
  if (direction === "up") return leaveOffering(state);
  return { state, effects: [{ kind: "consume-key" }] };
}

/**
 * An arrow key's outcome: a step of the cursor across the offering's grid, or of
 * the caret. A horizontal step off either end of the chip sequence keeps the key
 * and stands the cursor where it is.
 */
function reduceArrow(
  state: ComposerInputState,
  facts: ComposerInputFacts,
  direction: ComposerArrowDirection,
  from: ComposerKeySurface
): ComposerInputOutcome {
  if (isRowDirection(direction)) return reduceRowArrow(state, facts, direction, state.cursor);
  // Until the cursor stands on a chip the horizontal arrows belong to the caret.
  if (from === "close") return inert(state);
  if (from === "filter" && state.cursor === undefined) {
    const caret = state.caret;
    if (caret === undefined) return inert(state);
    return reduceCaretArrow(state, facts, caret, direction);
  }
  const stepped = moveStripCursorAlongChips(facts.options, state.cursor, arrowStep(direction));
  if (stepped !== undefined) return moveHighlight(state, stepped, state.highlightMode);
  if (state.cursor === undefined) return inert(state);
  return { state, effects: [{ kind: "consume-key" }] };
}

/**
 * End composition on the rule, which the period settles it on the same terms as:
 * from any point the armed side may end at, and nowhere else. A rule holding no
 * tiles at all has nothing to settle. The key is the composer's either way.
 */
function reduceSettle(state: ComposerInputState, facts: ComposerInputFacts): ComposerInputOutcome {
  if (state.armedEntry !== "sentence") return inert(state);
  const action = decideComposerPeriod({
    filter: "",
    armedSideCanEnd: facts.armedSideCanEnd,
    ruleIsEmpty: facts.ruleIsEmpty,
    wordInProgressCommits: false,
  });
  if (action !== "settle") return { state, effects: [{ kind: "consume-key" }] };
  return { state, effects: [{ kind: "consume-key" }, { kind: "close-strip", reason: "settled" }] };
}

/**
 * Home's and End's outcome: the caret takes the run's first or last position.
 * An edit in progress keeps the keys, which carry the text cursor to its own
 * ends.
 */
function reduceCaretJump(
  state: ComposerInputState,
  facts: ComposerInputFacts,
  edge: "first" | "last"
): ComposerInputOutcome {
  if (state.caret === undefined || hasPendingEdit(state)) return inert(state);
  const run = facts.caretRun;
  if (run.length === 0) return inert(state);
  return moveCaret(state, edge === "first" ? run[0] : run[run.length - 1]);
}

/**
 * An accordion heading arrow's outcome, taken from that heading whether or not
 * the cursor already stood on it: up and down are the ordinary steps between the
 * grid's rows, taken from the heading's own row, and right and left open and
 * close the section the heading names.
 */
function reduceHeadingArrow(
  state: ComposerInputState,
  facts: ComposerInputFacts,
  direction: ComposerArrowDirection,
  sectionKey: string
): ComposerInputOutcome {
  if (isRowDirection(direction)) return reduceRowArrow(state, facts, direction, { kind: "heading", sectionKey });
  const toggled: ComposerInputEffect =
    direction === "right" ? { kind: "open-section", sectionKey } : { kind: "close-section", sectionKey };
  return { state, effects: [{ kind: "consume-key" }, toggled] };
}

/**
 * What the composer does with one input. The token says what arrived and where
 * from; `facts` says what the offering and the rule around it read at that
 * moment; the outcome says where the composer stands and what its driver must
 * do, in the order it must do it.
 *
 * The sentence-only gestures -- the comma pivot, the period settle, and the
 * ladder Backspace walks -- apply only while `state.armedEntry` is `sentence`;
 * a strip armed from the tray leaves those keys to the filter box.
 *
 * `state.caret` is where editing stands, and the position armed is projected
 * from it rather than the other way about. Left and Right step it one position
 * along `facts.caretRun`, Home and End take that run's ends, a placement leaves
 * it in the gap past the tile placed, and the pivot takes the end of the side it
 * moves to. Backspace deletes the tile the caret rests on or stands behind and
 * Delete the one it stands in front of, each leaving the caret in the gap that
 * tile vacated. A strip standing at no caret leaves all of those keys alone; a
 * `delete-element` token names the tile that goes itself, so it reaches the same
 * deletion from a strip standing at no caret and with text in the box.
 *
 * `state.cursor` is the one place the offering is being steered at, over a grid
 * whose rows are the chips as they wrap and the group headings between them. Up
 * and Down step it between those rows and Left and Right along a row of chips,
 * and neither end wraps. On a heading Right and Left open and close the section
 * that heading names. It stands only while the keyboard is on the element it is
 * anchored on -- the filter box for a chip being narrowed toward by typing, the
 * band's listbox for a chip being browsed, the heading itself for a heading --
 * so a `focus-lost` token releases it, and the horizontal arrows are the
 * caret's again. The offering stands as long as the keyboard is somewhere in
 * the strip: a `focus-lost` token carrying `leftStrip` closes it as a
 * dismissal, ending composition.
 *
 * A typed character that belongs to another word than the one in progress ends
 * that word: the word is placed exactly as Space places it, and the character
 * starts the next one. Operator symbols and grouping brackets are the characters
 * this reaches, so `1+3` and `((foo+3)*energy)` are typeable without spaces;
 * Space keeps placing a word wherever it is pressed. The order tiles are placed
 * in is the order they are typed in, and how they group is the language's own.
 *
 * While `state.textLiteral` holds an open text value, every typed character
 * edits that value and the punctuation keys reach it as content; nothing is
 * placed by a character there. The keys that act are the closing quote, Enter
 * and Tab, which place the value exactly as the closing quote does, Backspace,
 * and Escape.
 */
export function reduceComposerInput(
  state: ComposerInputState,
  token: ComposerInputToken,
  facts: ComposerInputFacts
): ComposerInputOutcome {
  if (state.textLiteral !== undefined && isSuspendedByTextLiteral(token)) return inert(state);
  switch (token.kind) {
    case "text":
      if (state.textLiteral !== undefined) return retypeTextLiteral(state, token.text, []);
      return reduceTypedText(state, facts, token.text);
    case "quote":
      return reduceQuote(state, facts);
    case "escape":
      if (state.textLiteral !== undefined) return abandonTextLiteral(state, [{ kind: "consume-key" }]);
      if (decideStripEscape(state.filter) === "clear-filter") {
        return retypeFilter(state, "", [{ kind: "consume-key" }]);
      }
      return { state, effects: [{ kind: "consume-key" }, { kind: "close-strip", reason: "dismissed" }] };
    case "comma":
      return reduceComma(state, facts);
    case "period":
      return reducePeriod(state, facts);
    case "placement-landed":
      if (!facts.armedSideCanEnd) return inert(state);
      if (token.gesture === "pivot") return composeOnSide(state, facts, RuleSide.Do, []);
      return { state, effects: [{ kind: "close-strip", reason: "settled" }] };
    case "backspace":
      return reduceBackspace(state, facts, token.from);
    case "enter":
      if (state.textLiteral !== undefined) return commitOpenTextLiteral(state, facts);
      if (facts.highlightedCandidate !== undefined) return placeCandidate(state, facts.highlightedCandidate);
      if (token.from === "band") return inert(state);
      if (facts.topCandidate !== undefined) return placeCandidate(state, facts.topCandidate);
      return reduceSettle(state, facts);
    case "tab":
      if (state.textLiteral !== undefined) return commitOpenTextLiteral(state, facts);
      return facts.topCandidate === undefined ? inert(state) : placeCandidate(state, facts.topCandidate);
    case "space":
      return facts.spaceCandidate === undefined ? inert(state) : placeCandidate(state, facts.spaceCandidate);
    case "candidate-tapped":
      if (state.textLiteral !== undefined) return commitTextLiteral(state, token.candidate);
      return placeCandidate(state, token.candidate);
    case "printable": {
      // A heading anchors the cursor on itself, so the cursor comes away with the keyboard.
      const kept = state.cursor?.kind === "heading" ? undefined : state.cursor;
      return {
        state: { ...state, cursor: kept, highlightMode: "typing" },
        effects: [
          { kind: "move-focus", target: filterFocus, keepScroll: false },
          { kind: "highlight", cursor: kept, mode: "typing" },
        ],
      };
    }
    case "arrow":
      return reduceArrow(state, facts, token.direction, token.from);
    case "home":
      return reduceCaretJump(state, facts, "first");
    case "end":
      return reduceCaretJump(state, facts, "last");
    case "delete-forward":
      // An edit in progress keeps the key, which deletes forward in that text.
      if (hasPendingEdit(state)) return inert(state);
      return reduceDeleteAtCaret(state, facts, "right");
    case "delete-element":
      // An element addresses its own tile, whichever way the deletion is taken.
      return reduceDeleteAtCaret({ ...state, caret: token.position }, facts, "right");
    case "heading-arrow":
      return reduceHeadingArrow(state, facts, token.direction, token.sectionKey);
    case "focus-lost": {
      const released =
        state.cursor === undefined && state.highlightMode === "typing" ? inert(state) : releaseHighlight(state);
      if (!token.leftStrip) return released;
      return {
        state: released.state,
        effects: [...released.effects, { kind: "close-strip", reason: "dismissed" }],
      };
    }
  }
}
