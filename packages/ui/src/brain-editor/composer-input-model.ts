import { RuleSide } from "@mindcraft-lang/core/brain";
import type { BrainCommand } from "@mindcraft-lang/core/brain/model";
import type { ArmedTargetEntry } from "./ArmedTargetContext";
import {
  decideStripEscape,
  enterStripOptionsAt,
  isStripFilterTypingKey,
  moveActiveStripOption,
  moveActiveStripOption2D,
  type StripCandidate,
  type StripFocusTarget,
  type StripHighlightMode,
  type StripOption,
  type StripOptionBand,
  type StripOptionGeometry,
} from "./candidate-strip-model";
import { decideComposerBackspace, decideComposerComma, decideComposerPeriod } from "./sentence-composer";

/**
 * The composer's input state: what the keyboard is aimed at, and what it has
 * built up that no other surface owns.
 */
export interface ComposerInputState {
  /** The rule side composition is armed on. */
  readonly armedSide: RuleSide;
  /** Where the arming happened; the sentence-only gestures apply to `sentence` alone. */
  readonly armedEntry: ArmedTargetEntry;
  /** The word in progress. */
  readonly filter: string;
  /** Option id of the chip the highlight rests on, or undefined when it rests on none. */
  readonly activeOptionId: string | undefined;
  /** Which element the highlight is anchored on. */
  readonly highlightMode: StripHighlightMode;
  /** True while composition sits on the DO side of a typed pivot. */
  readonly pivoted: boolean;
  /**
   * The text value the opening quote started: the content typed into it so far,
   * empty while it holds none, and undefined when no text value is open.
   */
  readonly textLiteral: string | undefined;
  /**
   * The commands this composition placed, newest last. The placement path
   * appends the command it executed; the `undo-own-commit` effect pops it.
   */
  readonly ownCommits: readonly BrainCommand[];
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
 * - `text` -- the filter box's content changed
 * - `space`, `tab`, `enter` -- the commit keys
 * - `comma`, `period` -- the pivot and the settle
 * - `quote` -- open a text value, or place the one already open
 * - `escape` -- clear the word in progress, then close
 * - `backspace` -- the composer's ladder, or an edit of the word in progress
 * - `printable` -- a character typed while a band's chips are being browsed
 * - `candidate-tapped` -- a chip was tapped or dropped on the armed position
 * - `arrow` -- a step of the highlight
 * - `heading-arrow` -- an arrow pressed on an accordion heading
 * - `placement-landed` -- the placement a `reask-after-placement` effect asked
 *   about has run, so the gesture behind it is decided again
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
  | { readonly kind: "candidate-tapped"; readonly candidate: StripCandidate }
  | { readonly kind: "enter"; readonly from: "filter" | "band" }
  | { readonly kind: "backspace"; readonly from: "filter" | "band" }
  | { readonly kind: "arrow"; readonly direction: ComposerArrowDirection; readonly from: ComposerKeySurface }
  | { readonly kind: "heading-arrow"; readonly direction: "up" | "down"; readonly sectionKey: string }
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
 * - `highlight` -- the highlight rests on `optionId`, anchored per `mode`
 * - `open-section` -- the accordion section `sectionKey` opens
 * - `place-tile` -- `candidate` is placed at the armed position
 * - `announce-placement` -- assistive technology hears that `label` was placed
 * - `move-focus` -- the keyboard goes to `target`
 * - `reask-after-placement` -- once the placement has run, ask the model again
 *   with a `placement-landed` token
 * - `arm-side` -- composition continues on `side`, placing no tile
 * - `undo-own-commit` -- the composition's own last commit is taken back
 * - `close-strip` -- composition on the rule ends
 */
export type ComposerInputEffect =
  | { readonly kind: "consume-key" }
  | { readonly kind: "set-filter"; readonly text: string }
  | { readonly kind: "set-text-literal"; readonly value: string | undefined }
  | { readonly kind: "highlight"; readonly optionId: string | undefined; readonly mode: StripHighlightMode }
  | { readonly kind: "open-section"; readonly sectionKey: string }
  | { readonly kind: "place-tile"; readonly candidate: StripCandidate }
  | { readonly kind: "announce-placement"; readonly label: string }
  | {
      readonly kind: "move-focus";
      /** Where the keyboard goes. */
      readonly target: StripFocusTarget;
      /** True when the move must leave the scroll position where it is. */
      readonly keepScroll: boolean;
    }
  | { readonly kind: "reask-after-placement"; readonly gesture: ComposerGesture }
  | { readonly kind: "arm-side"; readonly side: RuleSide }
  | { readonly kind: "undo-own-commit" }
  | { readonly kind: "close-strip"; readonly reason: ComposerCloseReason };

/**
 * What the composer reads about the offering and the rule around it. Every field
 * is read at the moment the token arrives, so a token dispatched after a
 * placement carries the facts that placement produced.
 */
export interface ComposerInputFacts {
  /** True when the tiles of the armed side may end where composition stands. */
  readonly armedSideCanEnd: boolean;
  /** True when the rule holds no tiles on either side. */
  readonly ruleIsEmpty: boolean;
  /** How many tiles the rule's DO side holds. */
  readonly doTileCount: number;
  /** The command history's newest undoable entry; undefined when the history holds none. */
  readonly newestCommand: BrainCommand | undefined;
  /** The candidate Enter and Tab place, or undefined when they must not commit. */
  readonly topCandidate: StripCandidate | undefined;
  /** The candidate Space places, or undefined when it must not commit. */
  readonly spaceCandidate: StripCandidate | undefined;
  /** The candidate the highlight rests on, or undefined when it rests on no chip. */
  readonly highlightedCandidate: StripCandidate | undefined;
  /** True when the armed position accepts a text literal, so a typed quote opens one. */
  readonly acceptsTextLiteral: boolean;
  /**
   * The candidate the open text value places, or undefined when no text value is
   * open and when the armed position accepts none.
   */
  readonly pendingTextLiteral: StripCandidate | undefined;
  /** Every rendered chip, in the order the highlight walks them. */
  readonly options: readonly StripOption[];
  /** Where every rendered chip sits, for the steps between wrapped rows. */
  readonly optionGeometry: readonly StripOptionGeometry[];
  /** Identity of the strip, which the option ids are built from. */
  readonly stripId: string;
  /**
   * The band sequence in display order with the section `sectionKey` at its own
   * position, whether or not its chips are rendered yet.
   */
  bandsWithSection(sectionKey: string): readonly StripOptionBand[];
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
 * band, and every key the close button does not steer the highlight with.
 */
export function composerTokenForKey(key: string, surface: ComposerKeySurface): ComposerInputToken | undefined {
  const direction = arrowDirection(key);
  if (direction !== undefined) return { kind: "arrow", direction, from: surface };
  if (surface === "close") return undefined;
  if (key === "Escape") return surface === "filter" ? { kind: "escape" } : undefined;
  if (key === "Enter") return { kind: "enter", from: surface };
  if (key === "Backspace") return { kind: "backspace", from: surface };
  if (surface === "band") return isStripFilterTypingKey(key) ? { kind: "printable" } : undefined;
  if (key === ",") return { kind: "comma" };
  if (key === ".") return { kind: "period" };
  if (key === '"') return { kind: "quote" };
  if (key === " ") return { kind: "space" };
  if (key === "Tab") return { kind: "tab" };
  return undefined;
}

/**
 * The token a press of `key` on the accordion heading of `sectionKey` means, or
 * undefined for every key that does not step the highlight into the section.
 */
export function composerHeadingToken(key: string, sectionKey: string): ComposerInputToken | undefined {
  const direction = arrowDirection(key);
  if (direction !== "up" && direction !== "down") return undefined;
  return { kind: "heading-arrow", direction, sectionKey };
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
function isRowDirection(direction: ComposerArrowDirection): boolean {
  return direction === "up" || direction === "down";
}

/** The outcome that leaves the composer as it stands and lets the browser have the keystroke. */
function inert(state: ComposerInputState): ComposerInputOutcome {
  return { state, effects: [] };
}

/**
 * Rest the highlight on `optionId` anchored per `mode`, keeping the keyboard
 * with the filter box while typing. An undefined `optionId` leaves the composer
 * as it stands, which is what an offering with no chip in the asked-for
 * direction returns.
 */
function moveHighlight(
  state: ComposerInputState,
  optionId: string | undefined,
  mode: StripHighlightMode
): ComposerInputOutcome {
  if (optionId === undefined) return inert(state);
  const effects: ComposerInputEffect[] = [{ kind: "highlight", optionId, mode }];
  if (mode === "typing") effects.push({ kind: "move-focus", target: filterFocus, keepScroll: false });
  effects.push({ kind: "consume-key" });
  return { state: { ...state, activeOptionId: optionId, highlightMode: mode }, effects };
}

/**
 * Place `candidate` and start the next word: the word in progress and the
 * highlight begin again in the filter box, and `then` carries whatever gesture
 * the placement was made on the way to.
 */
function placeCandidate(
  state: ComposerInputState,
  candidate: StripCandidate,
  then: readonly ComposerInputEffect[] = []
): ComposerInputOutcome {
  return {
    state: { ...state, filter: "", activeOptionId: undefined, highlightMode: "typing" },
    effects: [
      { kind: "consume-key" },
      { kind: "place-tile", candidate },
      { kind: "announce-placement", label: candidate.label },
      { kind: "highlight", optionId: undefined, mode: "typing" },
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
    state: { ...state, filter: text, activeOptionId: undefined, highlightMode: "typing" },
    effects: [...leading, { kind: "set-filter", text }, { kind: "highlight", optionId: undefined, mode: "typing" }],
  };
}

/** Carry the open text value on at `value`, with the highlight back in the filter box. */
function retypeTextLiteral(
  state: ComposerInputState,
  value: string,
  leading: readonly ComposerInputEffect[]
): ComposerInputOutcome {
  return {
    state: { ...state, textLiteral: value, activeOptionId: undefined, highlightMode: "typing" },
    effects: [
      ...leading,
      { kind: "set-text-literal", value },
      { kind: "highlight", optionId: undefined, mode: "typing" },
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
      state: { ...state, filter: "", textLiteral: "", activeOptionId: undefined, highlightMode: "typing" },
      effects: [
        { kind: "consume-key" },
        { kind: "set-filter", text: "" },
        { kind: "set-text-literal", value: "" },
        { kind: "highlight", optionId: undefined, mode: "typing" },
      ],
    };
  }
  return commitOpenTextLiteral(state, facts);
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

/** End the WHEN side and continue composing on the DO side, placing no tile. */
function pivotToDo(state: ComposerInputState, leading: readonly ComposerInputEffect[]): ComposerInputOutcome {
  return {
    state: { ...state, armedSide: RuleSide.Do, pivoted: true },
    effects: [...leading, { kind: "arm-side", side: RuleSide.Do }],
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
  if (action === "pivot-to-do") return pivotToDo(state, [{ kind: "consume-key" }]);
  if (facts.spaceCandidate === undefined) return { state, effects: [{ kind: "consume-key" }] };
  return placeCandidate(state, facts.spaceCandidate, [{ kind: "reask-after-placement", gesture: "pivot" }]);
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
  if (action === "none") return { state, effects: [{ kind: "consume-key" }] };
  if (action === "settle") {
    return { state, effects: [{ kind: "consume-key" }, { kind: "close-strip", reason: "settled" }] };
  }
  if (facts.spaceCandidate === undefined) return { state, effects: [{ kind: "consume-key" }] };
  return placeCandidate(state, facts.spaceCandidate, [{ kind: "reask-after-placement", gesture: "settle" }]);
}

/**
 * Backspace's outcome while a text value is open: an edit of `content`, and past
 * the opening quote the value closes, placing nothing and taking nothing back.
 * The composer's own ladder is out of reach until the value closes.
 */
function reduceTextLiteralBackspace(
  state: ComposerInputState,
  content: string,
  from: "filter" | "band"
): ComposerInputOutcome {
  if (content.length === 0) return abandonTextLiteral(state, [{ kind: "consume-key" }]);
  // A band carries no text caret, so the edit of the content is made here.
  if (from === "band") {
    return retypeTextLiteral(state, content.slice(0, -1), [
      { kind: "move-focus", target: filterFocus, keepScroll: false },
      { kind: "consume-key" },
    ]);
  }
  return inert(state);
}

/** Backspace's outcome: an edit of the word in progress, or one rung of the composer's ladder. */
function reduceBackspace(
  state: ComposerInputState,
  facts: ComposerInputFacts,
  from: "filter" | "band"
): ComposerInputOutcome {
  if (state.textLiteral !== undefined) return reduceTextLiteralBackspace(state, state.textLiteral, from);
  // A band carries no text caret, so the edit of the word in progress is made here.
  if (from === "band") {
    return retypeFilter(state, state.filter.slice(0, -1), [
      { kind: "move-focus", target: filterFocus, keepScroll: false },
      { kind: "consume-key" },
    ]);
  }
  if (state.armedEntry !== "sentence") return inert(state);
  const action = decideComposerBackspace({
    filter: state.filter,
    ownLastCommit: state.ownCommits[state.ownCommits.length - 1],
    newestCommand: facts.newestCommand,
    pivoted: state.pivoted,
    doTileCount: facts.doTileCount,
  });
  if (action === "unpivot") {
    return {
      state: { ...state, armedSide: RuleSide.When, pivoted: false },
      effects: [{ kind: "consume-key" }, { kind: "arm-side", side: RuleSide.When }],
    };
  }
  if (action === "uncommit-word") {
    return {
      state: { ...state, ownCommits: state.ownCommits.slice(0, -1) },
      effects: [{ kind: "consume-key" }, { kind: "undo-own-commit" }],
    };
  }
  return inert(state);
}

/** An arrow key's outcome: a step of the highlight across the rendered chips. */
function reduceArrow(
  state: ComposerInputState,
  facts: ComposerInputFacts,
  direction: ComposerArrowDirection,
  from: ComposerKeySurface
): ComposerInputOutcome {
  const delta = arrowStep(direction);
  if (isRowDirection(direction)) {
    return moveHighlight(
      state,
      moveActiveStripOption2D(facts.optionGeometry, state.activeOptionId, delta),
      state.highlightMode
    );
  }
  // Until a chip is highlighted the horizontal arrows belong to the text caret,
  // and the close button steers no sequence of its own.
  if (from === "close") return inert(state);
  if (from === "filter" && state.activeOptionId === undefined) return inert(state);
  return moveHighlight(state, moveActiveStripOption(facts.options, state.activeOptionId, delta), state.highlightMode);
}

/** An accordion heading arrow's outcome: the highlight steps into the section's chips. */
function reduceHeadingArrow(
  state: ComposerInputState,
  facts: ComposerInputFacts,
  direction: "up" | "down",
  sectionKey: string
): ComposerInputOutcome {
  const delta = arrowStep(direction);
  const entered = enterStripOptionsAt(facts.stripId, facts.bandsWithSection(sectionKey), sectionKey, delta);
  if (entered === undefined) return inert(state);
  const opened: readonly ComposerInputEffect[] = delta === 1 ? [{ kind: "open-section", sectionKey }] : [];
  const moved = moveHighlight(state, entered, "browsing");
  return { state: moved.state, effects: [...opened, ...moved.effects] };
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
 * While `state.textLiteral` holds an open text value, every typed character
 * edits that value and the punctuation keys reach it as content; the keys that
 * act are the closing quote, Enter and Tab, which place the value exactly as the
 * closing quote does, Backspace, and Escape.
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
      return retypeFilter(state, token.text, []);
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
      if (token.gesture === "pivot") return pivotToDo(state, []);
      return { state, effects: [{ kind: "close-strip", reason: "settled" }] };
    case "backspace":
      return reduceBackspace(state, facts, token.from);
    case "enter":
      if (state.textLiteral !== undefined) return commitOpenTextLiteral(state, facts);
      if (facts.highlightedCandidate !== undefined) return placeCandidate(state, facts.highlightedCandidate);
      if (token.from === "band" || facts.topCandidate === undefined) return inert(state);
      return placeCandidate(state, facts.topCandidate);
    case "tab":
      if (state.textLiteral !== undefined) return commitOpenTextLiteral(state, facts);
      return facts.topCandidate === undefined ? inert(state) : placeCandidate(state, facts.topCandidate);
    case "space":
      return facts.spaceCandidate === undefined ? inert(state) : placeCandidate(state, facts.spaceCandidate);
    case "candidate-tapped":
      if (state.textLiteral !== undefined) return commitTextLiteral(state, token.candidate);
      return placeCandidate(state, token.candidate);
    case "printable":
      return {
        state: { ...state, highlightMode: "typing" },
        effects: [
          { kind: "move-focus", target: filterFocus, keepScroll: false },
          { kind: "highlight", optionId: state.activeOptionId, mode: "typing" },
        ],
      };
    case "arrow":
      return reduceArrow(state, facts, token.direction, token.from);
    case "heading-arrow":
      return reduceHeadingArrow(state, facts, token.direction, token.sectionKey);
  }
}
