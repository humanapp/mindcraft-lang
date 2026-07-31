import type { ReadonlyList } from "@mindcraft-lang/core";
import { type IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import { parseBrainTiles } from "@mindcraft-lang/core/brain/compiler";
import type { SentenceSegment } from "@mindcraft-lang/core/brain/language-service";
import { isOperatorSymbolPrefix } from "./candidate-strip-model";

/**
 * True when `tiles` parse as an expression that may end where they stop. An
 * empty side may end; a side left mid-expression -- a trailing infix operator, a
 * prefix operator with no operand, an unclosed group -- may not.
 */
export function canEndSideExpression(tiles: ReadonlyList<IBrainTileDef>): boolean {
  return parseBrainTiles(tiles).diags.size() === 0;
}

/** True when `segment` is glue holding nothing but the space between two words. */
function isSeparatorGlue(segment: SentenceSegment): boolean {
  return segment.kind === "glue" && segment.text.trim() === "";
}

/**
 * The sentence a rule reads while it is being composed: the settled `segments`
 * with the reading the projection completes for itself removed, so the line
 * shows only what the user has placed.
 *
 * Two kinds of segment go: the completion word a sensor's frame supplies for an
 * object position no tile fills, together with the separator that joined it to
 * the words around it, and the punctuation the sentence ends on. Every tile of a
 * sentence reads as one word, so the frame's completion is the segment that
 * repeats a tile's `sourceTileIndex`; the terminator is the glue that trails the
 * last word. The glue between two placed words is untouched, so a clause the
 * user has both sides of still reads as one.
 */
export function composeSentenceReading(segments: readonly SentenceSegment[]): SentenceSegment[] {
  const reading: SentenceSegment[] = [];
  const alreadyRead = new Set<number>();
  let dropNextSeparator = false;
  for (const segment of segments) {
    if (segment.kind === "glue") {
      if (dropNextSeparator && isSeparatorGlue(segment)) {
        dropNextSeparator = false;
        continue;
      }
      dropNextSeparator = false;
      reading.push(segment);
      continue;
    }
    dropNextSeparator = false;
    if (!alreadyRead.has(segment.sourceTileIndex)) {
      alreadyRead.add(segment.sourceTileIndex);
      reading.push(segment);
      continue;
    }
    const last = reading[reading.length - 1];
    if (last !== undefined && isSeparatorGlue(last)) reading.pop();
    else dropNextSeparator = true;
  }
  while (reading.length > 0 && reading[reading.length - 1].kind === "glue") reading.pop();
  return reading;
}

/**
 * What the sentence line reads at the typed pivot, after the words `reading`
 * already holds: the visible pivot comma, preceded by `triggerWord` when
 * `reading` holds nothing, which is how a WHEN side with no tiles on it reads.
 * The comma is always the last segment.
 *
 * Call it only while the pivot stands.
 */
export function composePivotReading(reading: readonly SentenceSegment[], triggerWord: string): SentenceSegment[] {
  const pivot: SentenceSegment[] = [];
  if (reading.length === 0) pivot.push({ kind: "glue", text: triggerWord });
  pivot.push({ kind: "glue", text: "," });
  return pivot;
}

/**
 * What the comma key does at the composer's armed position:
 *
 * - `commit-then-pivot` -- place the word in progress, then decide the pivot
 *   again against the side that word joined
 * - `pivot-to-do` -- end the WHEN side and continue composing on the DO side,
 *   placing no tile
 * - `filter-text` -- the comma is ordinary filter text, which matches no
 *   candidate and so reads as unknown
 */
export type ComposerCommaAction = "commit-then-pivot" | "pivot-to-do" | "filter-text";

/** What {@link decideComposerComma} reads to decide the comma. */
export interface ComposerCommaFacts {
  /** The rule side composition is armed on. */
  readonly armedSide: RuleSide;
  /** The word in progress in the composer's input. */
  readonly filter: string;
  /** True when the tiles of the armed side may end where composition stands. */
  readonly armedSideCanEnd: boolean;
  /** True when the word in progress resolves to one candidate, as Space asks before committing. */
  readonly wordInProgressCommits: boolean;
}

/**
 * The comma's action for `facts`. The comma pivots only from the WHEN side. A
 * word in progress is placed first, exactly as Space would place it, and the
 * pivot is then decided against the side that word joined; a word that resolves
 * to nothing places nothing and pivots nothing. With no word in progress the
 * comma pivots wherever the WHEN expression may end, and is filter text
 * everywhere else -- untypeable exactly as unknown text is.
 */
export function decideComposerComma(facts: ComposerCommaFacts): ComposerCommaAction {
  if (facts.armedSide !== RuleSide.When) return "filter-text";
  if (facts.filter.length > 0) return facts.wordInProgressCommits ? "commit-then-pivot" : "filter-text";
  return facts.armedSideCanEnd ? "pivot-to-do" : "filter-text";
}

/**
 * What the period key does at the composer's armed position:
 *
 * - `commit-then-settle` -- place the word in progress, then decide the period
 *   again against the side that word joined
 * - `settle` -- end composition on the rule, placing no tile
 * - `filter-text` -- the period continues the number in progress, so it is
 *   ordinary filter text
 * - `refuse` -- swallow the key: it settles nothing here and reaches neither the
 *   word in progress nor the rule
 * - `none` -- nothing at all: the rule holds no tiles, so there is nothing to
 *   settle
 */
export type ComposerPeriodAction = "commit-then-settle" | "settle" | "filter-text" | "refuse" | "none";

/** What {@link decideComposerPeriod} reads to decide the period. */
export interface ComposerPeriodFacts {
  /** The word in progress in the composer's input. */
  readonly filter: string;
  /** True when the tiles of the armed side may end where composition stands. */
  readonly armedSideCanEnd: boolean;
  /** True when the rule holds no tiles on either side. */
  readonly ruleIsEmpty: boolean;
  /** True when the word in progress resolves to one candidate, as Space asks before committing. */
  readonly wordInProgressCommits: boolean;
}

const bareIntegerPattern = /^-?\d+$/;

/**
 * True when `filter` is a whole number with no decimal point on it yet: an
 * optional minus sign followed by one or more digits, and nothing else.
 */
function isBareInteger(filter: string): boolean {
  return bareIntegerPattern.test(filter.trim());
}

/**
 * The period's action for `facts`. A period on a whole number continues that
 * number, so it is filter text and "1.5" is typeable; once the number carries a
 * decimal point it settles like any other resolvable word. Otherwise the period
 * settles either side. A word in progress is placed first, exactly as Space
 * would place it, and the settle is then decided against the side that word
 * joined. With no word in progress the period settles wherever the armed side
 * may end. A period that can settle nowhere -- over a word that resolves to
 * nothing, or on a side left mid-expression -- is refused. A rule with no tiles
 * at all has nothing to settle, so the key is inert there.
 */
export function decideComposerPeriod(facts: ComposerPeriodFacts): ComposerPeriodAction {
  if (isBareInteger(facts.filter)) return "filter-text";
  if (facts.filter.length > 0) return facts.wordInProgressCommits ? "commit-then-settle" : "refuse";
  if (facts.ruleIsEmpty) return "none";
  return facts.armedSideCanEnd ? "settle" : "refuse";
}

/**
 * What one typed character does to the word in progress:
 *
 * - `extend` -- the character joins the word, which is what every character of
 *   one word does
 * - `place-alone` -- the character is a whole word of its own and is placed at
 *   once, which is what a grouping bracket is
 * - `commit-then-start` -- place the word in progress, exactly as Space places
 *   it, and start the next word with the character
 * - `refuse` -- the word in progress places nothing here, so the character is
 *   dropped and that word stands as it is
 */
export type ComposerCharAction = "extend" | "place-alone" | "commit-then-start" | "refuse";

/** What {@link decideComposerCharacter} reads to decide one typed character. */
export interface ComposerCharFacts {
  /** The character typed onto the end of the word in progress. */
  readonly char: string;
  /** The word in progress, as it stands before the character. */
  readonly word: string;
  /** True when the word in progress resolves to one candidate, as Space asks before committing. */
  readonly wordCommits: boolean;
}

/**
 * The classes a character belongs to. A character of a different class than the
 * word in progress ends that word.
 *
 * - `value` -- what a name, a number, or a display-format suffix is written
 *   with: every character that is neither an operator's nor a bracket
 * - `operator` -- a character an operator is typed with
 * - `bracket` -- a grouping bracket, which is always a word of its own
 */
type ComposerCharClass = "value" | "operator" | "bracket";

/** The grouping brackets, each of which is always a word of its own. */
const kBracketChars = "()";

/** The class `char` belongs to. */
function characterClass(char: string): ComposerCharClass {
  if (kBracketChars.includes(char)) return "bracket";
  return isOperatorSymbolPrefix(char) ? "operator" : "value";
}

/**
 * The class the word in progress belongs to. A word of operator characters is an
 * operator, except for a bare minus sign naming no operator here, which opens a
 * negative number instead.
 */
function wordClass(word: string, wordCommits: boolean): ComposerCharClass {
  if (kBracketChars.includes(word)) return "bracket";
  for (const char of word) {
    if (characterClass(char) !== "operator") return "value";
  }
  if (word === "-" && !wordCommits) return "value";
  return "operator";
}

/**
 * What `facts.char` does to the word in progress. A character of the word's own
 * class joins it; a character of another class ends it, placing it as Space
 * would and starting the next word. Two operator characters stay one word only
 * while what they spell still opens an operator, so `>=` is one word and `>=-`
 * is two. A word that places nothing here refuses the character that would end
 * it, leaving that word standing.
 */
export function decideComposerCharacter(facts: ComposerCharFacts): ComposerCharAction {
  const charClass = characterClass(facts.char);
  if (facts.word.length === 0) return charClass === "bracket" ? "place-alone" : "extend";
  const openClass = wordClass(facts.word, facts.wordCommits);
  if (openClass === charClass && charClass !== "bracket") {
    if (charClass !== "operator") return "extend";
    if (isOperatorSymbolPrefix(facts.word + facts.char)) return "extend";
  }
  return facts.wordCommits ? "commit-then-start" : "refuse";
}

/**
 * What Backspace does in the composer's input:
 *
 * - `edit-filter` -- shorten the word in progress, as the key ordinarily does
 * - `unpivot` -- take back the typed pivot, returning composition to the WHEN side
 * - `delete-at-caret` -- delete the tile the caret stands at or behind
 */
export type ComposerBackspaceAction = "edit-filter" | "unpivot" | "delete-at-caret";

/** What {@link decideComposerBackspace} reads to decide Backspace. */
export interface ComposerBackspaceFacts {
  /** The word in progress in the composer's input. */
  readonly filter: string;
  /** True when composition sits on the DO side of a typed pivot. */
  readonly pivoted: boolean;
  /** How many tiles the rule's DO side holds. */
  readonly doTileCount: number;
}

/**
 * Backspace's action for `facts`. The word in progress goes first, then the
 * typed pivot once nothing stands on the DO side behind it -- neither of which
 * is a tile of the rule. Everywhere else the key deletes at the caret.
 */
export function decideComposerBackspace(facts: ComposerBackspaceFacts): ComposerBackspaceAction {
  if (facts.filter.length > 0) return "edit-filter";
  if (facts.pivoted && facts.doTileCount === 0) return "unpivot";
  return "delete-at-caret";
}
