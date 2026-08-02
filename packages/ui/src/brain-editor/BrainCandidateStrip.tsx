import { RuleSide } from "@mindcraft-lang/core/brain";
import { tileSentenceWord } from "@mindcraft-lang/core/brain/language-service";
import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import type { BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import type { Localizer } from "@mindcraft-lang/core/localization";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { staticAssetUrl } from "../asset-url";
import { adjustColor, readableInk, saturateColor } from "../lib/color";
import type { ArmedTileTarget } from "./ArmedTargetContext";
import { resolveTypeDisplayName } from "./action-arg-tiles";
import { useBrainEditorConfig, useLocalizer } from "./BrainEditorContext";
import {
  activeStripOption,
  type CandidateEntry,
  decideStripFocusTarget,
  kBestNextBandKey,
  type StripCandidate,
  type StripCellGeometry,
  type StripCursor,
  type StripFocusTarget,
  type StripHighlightMode,
  type StripOptionBand,
  stripBandPanelId,
  stripOptionId,
  stripSectionHeadingId,
  stripSubcategoryHeadingId,
  tileCandidateGroupNames,
  toCandidateEntries,
  visibleStripOptions,
} from "./candidate-strip-model";
import { type CaretPosition, caretRun } from "./caret-run";
import {
  type ComposerInputFacts,
  type ComposerInputState,
  type ComposerInputToken,
  composerHeadingToken,
  composerTokenForKey,
  consumesKey,
  reduceComposerInput,
} from "./composer-input-model";
import { type EditPointPosition, kEditPointPositions } from "./edit-point";
import { kOfferingLayer } from "./editor-layers";
import type { CandidateStripSection, CandidateStripState } from "./hooks/useCandidateStrip";
import { kPageGridCellAttribute } from "./page-grid-model";
import { kSentenceTypeClasses } from "./sentence-type";
import { tileSourceNamespace } from "./tile-library-groups";
import { kDefaultTileHue, resolveTileVisual, tileBorderColor } from "./tile-visual-utils";

/** Drag payload format carrying a candidate key from a chip to the armed slot. */
export const kCandidateDragMimeType = "application/x-mindcraft-candidate";

/**
 * Attribute marking an element the offering's grid cursor can rest the keyboard
 * on: a band's listbox, or a section's accordion heading.
 */
const kStripCellAttribute = "data-strip-cell";

/**
 * Attribute a popup the strip's own controls open must carry, valued empty:
 * a menu, and a dialog such a menu opens. The keyboard moving into a marked
 * popup counts as staying in the strip, so the offering underneath it stays
 * open and the control the popup was opened from keeps rendering.
 */
export const kStripPopupAttribute = "data-strip-popup";

const stripPanelStyle = {
  background: "linear-gradient(160deg, var(--color-brain-desk-from) 0%, var(--color-brain-desk-to) 100%)",
  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 24px rgba(0, 0, 0, 0.45)",
};

/** Heading of a provenance subcategory: the accordion header's type, one step quieter. */
const subcategoryHeadingClasses = "w-full px-0.5 text-[11px] font-semibold uppercase tracking-wider text-brain-ink/45";

/** Ring drawn around the band whose chips the keyboard is currently walking. */
const browsedBandClasses =
  "rounded-lg focus:outline-none focus:ring-2 focus:ring-brain-accent focus:ring-offset-2 focus:ring-offset-brain-desk-to";

/**
 * Right padding the panel's topmost row keeps, so the close button laid over the
 * panel's corner covers nothing the user can reach.
 */
const kCornerReserveClass = "pr-11";

/**
 * The panel's position row, fixed at the height of the tallest control it can
 * hold and kept at that height whichever controls the armed position shows.
 */
const kPositionRowClasses = "flex h-12 shrink-0 items-center";

/**
 * The caret's place, read as the row's standing text. It takes whatever width
 * the row has left over from the controls, never narrowing past its own
 * minimum, and clips what will not fit, so a longer place name moves nothing
 * standing after it.
 */
const kPositionNameClasses =
  "min-w-20 flex-1 truncate text-xs font-semibold uppercase tracking-wider text-brain-ink/45";

/**
 * Context tag the offering's own prose is looked up under, which reads the
 * caret's announcements, the removal control's name, and the filter box's name
 * as the one surface they stand on.
 */
const kOfferingPhraseContext = "tile-offering";

/** The accordion an open text value shows: none, since only its own chip is offered. */
const noSections: readonly CandidateStripSection[] = [];

/** The run of a strip armed from the tray, which stands on no rule's caret run. */
const noCaretRun: readonly CaretPosition[] = [];

/**
 * How a reveal moves the view: animated, or in one step for a user who has asked
 * for reduced motion.
 */
function revealBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/**
 * Scroll the rule card `strip` is rendered inside back into view, moving each
 * scrollport as little as the card allows. A card taller than its scrollport
 * settles with its tile row at the scrollport's top edge.
 */
function revealArmedRuleCard(strip: HTMLElement | null): void {
  strip?.closest("[data-rule-id]")?.scrollIntoView({ block: "nearest", behavior: revealBehavior() });
}

/**
 * Scroll the filter box into view, moving each scrollport the least distance
 * that leaves the whole box visible. A box already fully visible moves nothing.
 */
function revealFilterInput(input: HTMLElement | null): void {
  input?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: revealBehavior() });
}

/**
 * The chip bands in display order: the best-next row when it holds a chip, then
 * every section `isOpen` accepts, in section order.
 */
function buildStripBands(
  bestNext: readonly CandidateEntry[],
  sections: readonly CandidateStripSection[],
  isOpen: (sectionKey: string) => boolean
): StripOptionBand[] {
  const list: StripOptionBand[] = [];
  if (bestNext.length > 0) list.push({ key: kBestNextBandKey, entries: bestNext });
  for (const section of sections) {
    if (isOpen(section.key)) list.push({ key: section.key, entries: section.entries });
  }
  return list;
}

/**
 * True when nothing that can hold the keyboard holds it: the document body, or
 * a container that only took it because the element holding it was removed. A
 * cell of the page's selection grid holds the keyboard whichever way its roving
 * tab stop currently stands, and so does anything inside a popup one of the
 * strip's own controls opened, wherever the portal rendering that popup stands
 * it in the document.
 */
export function keyboardIsUnheld(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (active === null || active === document.body) return true;
  if (active.closest(`[${kStripPopupAttribute}]`) !== null) return false;
  return !active.hasAttribute(kPageGridCellAttribute) && active.tabIndex < 0;
}

/**
 * DOM id of the element `target` names in the strip `stripId`, or undefined for
 * the filter box, which the strip holds a ref to instead.
 */
function stripFocusTargetId(stripId: string, target: StripFocusTarget): string | undefined {
  if (target.kind === "input") return undefined;
  return target.kind === "band"
    ? stripBandPanelId(stripId, target.bandKey)
    : stripSectionHeadingId(stripId, target.sectionKey);
}

/**
 * The filter box in the place it is read from, with the quote marks an open text
 * value reads between drawn on either side of it. The wrapper and the input's
 * place inside it do not change with `quoteMark`, so a text value opens and
 * closes around the same input element and leaves the line it sits in as it is.
 *
 * @param input the filter box itself
 * @param quoteMark the mark drawn on both sides of the box, or undefined while
 * no text value is open
 * @param inSentence true when the field sits in a rule's sentence line, where it
 * runs inline with the words; false when it sits in the strip's own tray row
 * @param isEmpty true while the box holds no text, which drops the space a
 * sentence field otherwise keeps from the word before it
 */
export function filterFieldWithQuotes(
  input: ReactNode,
  quoteMark: ReactNode | undefined,
  inSentence: boolean,
  isEmpty = false
): ReactElement {
  return (
    <span
      className={
        inSentence ? (isEmpty ? "whitespace-nowrap" : "ml-1 whitespace-nowrap") : "flex min-w-0 flex-1 items-center"
      }
    >
      {quoteMark}
      {input}
      {quoteMark}
    </span>
  );
}

interface CandidateChipProps {
  entry: CandidateEntry;
  side: RuleSide;
  /** DOM id the active-descendant highlight addresses this chip by. */
  optionId: string;
  /** True while the keyboard highlight rests on this chip. */
  isActive: boolean;
  onCommit: (candidate: StripCandidate) => void;
  libraryName?: string;
}

/**
 * One candidate as a word-chip: the tile's icon and its label, with the tile's
 * library attribution and any conversion carried in the accessible name. A
 * minting candidate is drawn as an outline of the variable it creates, named by
 * the typed word and badged with the type the armed position expects.
 */
function CandidateChip({ entry, side, optionId, isActive, onCommit, libraryName }: CandidateChipProps) {
  const editorConfig = useBrainEditorConfig();
  const { candidate } = entry;
  const isMinting = entry.presentation === "minting";
  const visual = resolveTileVisual(editorConfig, candidate.tileDef);
  const baseColor = (side === RuleSide.When ? visual.colorDef?.when : visual.colorDef?.do) || kDefaultTileHue;
  const iconUrl = visual.iconUrl || staticAssetUrl("assets/brain/icons/question_mark.svg");
  const mintedTypeName = isMinting
    ? resolveTypeDisplayName((candidate.tileDef as BrainTileVariableDef).varType, {
        dataTypeNames: editorConfig.dataTypeNames,
        getTypeName: (typeId) => editorConfig.brainServices?.runtime.types.get(typeId)?.name,
      })
    : undefined;
  const description = [
    isMinting
      ? `make ${candidate.label} a new ${mintedTypeName} variable`
      : `${candidate.tileDef.kind} tile: ${candidate.label}`,
    libraryName ? `from ${libraryName}` : undefined,
    candidate.viaConversion ? "fits by converting the value" : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(", ");
  const outlineColor = adjustColor(saturateColor(baseColor, 0.5), 0.2);

  return (
    <button
      type="button"
      role="option"
      id={optionId}
      aria-selected={isActive}
      tabIndex={-1}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(kCandidateDragMimeType, candidate.key);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onCommit(candidate)}
      style={{
        background: isMinting ? "color-mix(in srgb, var(--color-brain-ink) 8%, transparent)" : baseColor,
        borderColor: isMinting ? outlineColor : tileBorderColor(baseColor),
        borderStyle: candidate.viaConversion ? "dashed" : "solid",
        color: isMinting ? "var(--color-brain-ink)" : readableInk(baseColor),
      }}
      className={`inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-full border-2 px-3 py-1.5 shadow-sm transition-[filter,transform] hover:brightness-110 active:scale-95 ${
        candidate.viaConversion ? "opacity-80" : ""
      } ${isActive ? "ring-2 ring-brain-ink ring-offset-2 ring-offset-brain-desk-to brightness-110" : ""}`}
      aria-label={description}
      data-presentation={entry.presentation}
      data-candidate-key={candidate.key}
      data-via-conversion={candidate.viaConversion ? "true" : undefined}
    >
      {isMinting ? (
        <Plus className="h-5 w-5 shrink-0" style={{ color: outlineColor }} aria-hidden="true" />
      ) : (
        <img src={iconUrl} alt="" aria-hidden="true" className="h-6 w-6 shrink-0 object-contain" />
      )}
      <span className="truncate font-mono text-sm font-semibold">{candidate.label}</span>
      {isMinting && (
        <span
          aria-hidden="true"
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: "color-mix(in srgb, var(--color-brain-ink) 14%, transparent)", color: outlineColor }}
        >
          {mintedTypeName}
        </span>
      )}
    </button>
  );
}

/**
 * What composing in a rule's sentence line needs: the rule being composed, the
 * caret the composition stands at, the sentence-only key behaviours, and the
 * arming its words and carets take. Supplied for a target armed from the
 * sentence, which hands the filter input to the rule's sentence line; a target
 * armed from a `+` button or a placed tile leaves the input in the panel's own
 * tray row.
 */
export interface StripComposerBinding {
  /** The caret the composition stands at, which the input reads its place from. */
  readonly caretPosition: CaretPosition;
  /** True while composition sits on the DO side of a typed pivot. */
  readonly pivoted: boolean;
  /** True when the tiles of the armed side may end as they stand. Read after each placement. */
  canEndArmedSide(): boolean;
  /** True when the rule holds no tiles on either side. */
  isRuleEmpty(): boolean;
  /** How many tiles the rule's DO side holds. */
  doTileCount(): number;
  /**
   * The element this composition's own newest placement stands at, while that
   * placement is still the history's newest undoable entry; undefined otherwise.
   * Read after each placement.
   */
  ownNewestPlacement(): CaretPosition | undefined;
  /** Undo the composition's own last commit, removing the tile it placed. */
  undoOwnLastCommit(): void;
  /** Put an empty rule after the composed rule and carry composing on in it. */
  insertRuleAfter(): void;
  /**
   * Key of the page-grid cell the keyboard returns to once composition on the
   * rule ends. Called on every render of the composed rule.
   */
  exitCellKey(): string;
}

/**
 * The edits the strip makes to the rule it is armed on. Supplied for every
 * target armed on a position of that rule, whether or not the rule is being
 * composed; a strip given none of it edits nothing.
 */
export interface StripRuleBinding {
  /** Move editing to `position`, which re-queries the offering there. */
  placeCaret(position: CaretPosition): void;
  /** Remove the tile the element `position` stands at. */
  deleteTile(position: CaretPosition): void;
}

/**
 * The tile the armed position stands on: the element `target` replaces, and
 * undefined where the position addresses no placed tile.
 */
function armedElement(target: ArmedTileTarget | null): CaretPosition | undefined {
  if (target === null || target.mode !== "replace" || target.tileIndex === undefined) return undefined;
  return { kind: "element", side: target.side, tileIndex: target.tileIndex };
}

/**
 * The position the armed `target` addresses, read as a caret: the caret a target
 * armed from the sentence carries, and otherwise the element or gap the tray's
 * arming stands at. Undefined while nothing is armed.
 */
function armedCaretPosition(target: ArmedTileTarget | null): CaretPosition | undefined {
  if (target === null) return undefined;
  if (target.caret !== undefined) return target.caret;
  if (target.mode !== "append" && target.tileIndex !== undefined) {
    return { kind: target.mode === "replace" ? "element" : "gap", side: target.side, tileIndex: target.tileIndex };
  }
  return { kind: "gap", side: target.side, tileIndex: target.ruleDef.side(target.side).tiles().size() };
}

/**
 * How the caret's place reads: what typing there does, named against the tile
 * the caret rests on or stands next to. A caret on a tile replaces it, a caret
 * with a tile after it inserts before that tile, and a caret past the last tile
 * of its side inserts after that tile. A caret on a side holding no tiles has no
 * tile to name itself against, and reads as the first word it will place.
 */
function caretPositionName(position: CaretPosition, ruleDef: BrainRuleDef, localizer: Localizer): string {
  const tiles = ruleDef.side(position.side).tiles();
  const count = tiles.size();
  if (position.tileIndex < count) {
    const word = tileSentenceWord(tiles.get(position.tileIndex), localizer);
    const source = position.kind === "element" ? "replacing {word}" : "inserting before {word}";
    return localizer.tr(source, { word }, kOfferingPhraseContext);
  }
  if (count > 0) {
    const word = tileSentenceWord(tiles.get(count - 1), localizer);
    return localizer.tr("inserting after {word}", { word }, kOfferingPhraseContext);
  }
  return localizer.tr("inserting first", undefined, kOfferingPhraseContext);
}

/**
 * The pivot a strip shows for an edit point opened on a placed tile: which of
 * the tile's three positions the offering is being asked for, and how to ask
 * for another.
 */
export interface StripEditPointBinding {
  /** The position the edit point stands at. */
  readonly position: EditPointPosition;
  /** Arm the edit point at `position`, which re-queries the offering there. */
  arm(position: EditPointPosition): void;
  /**
   * The control opening the menu of the tile the edit point stands on, which
   * the position row stands at its end. A tile whose menu offers nothing
   * supplies none.
   */
  readonly menu: ReactNode;
}

/** How each pivot position reads in the strip's header. */
const editPointPivotLabels: Record<EditPointPosition, string> = {
  before: "insert before",
  replace: "replace",
  after: "insert after",
};

/** What {@link useCandidateStripSurface} builds its surface from. */
export interface CandidateStripSurfaceOptions {
  /** The offering and commit surface for the armed position. */
  state: CandidateStripState;
  /** The armed target the offering was resolved for; its side selects the chip colors. Null arms nothing. */
  target: ArmedTileTarget | null;
  /** DOM id of the offering panel, so the arming control can point `aria-controls` at it. */
  id?: string;
  /** Called when the user dismisses the strip without placing a tile. */
  onDismiss: () => void;
  /** Hands the filter input to the rule's sentence line, at the caret it carries. */
  composer?: StripComposerBinding;
  /** The edits the strip makes to the rule the armed position stands on. */
  rule?: StripRuleBinding;
  /** The position pivot, for a target armed on a placed tile. */
  editPoint?: StripEditPointBinding;
}

/** The two pieces of the candidate strip, each rendered where the rule card puts it. */
export interface CandidateStripSurface {
  /**
   * The filter input for the rule's sentence line to host, at the caret the
   * composer names. Undefined without a {@link StripComposerBinding}, which
   * leaves the input in the panel's own tray row.
   */
  readonly composerInput: ReactNode | undefined;
  /** True while the input holds text the caret's position will take. */
  readonly pending: boolean;
  /**
   * How many times the keyboard has come back to the sentence from the
   * offering. Every new value is one return, which the line flashes the caret's
   * place for; the count itself carries no meaning.
   */
  readonly landingCount: number;
  /** The offering panel, or null while the offering is closed. */
  readonly panel: ReactNode;
}

/**
 * The candidate strip: the tiles valid at the armed position, offered as
 * word-chips that commit on tap, with a filter box that commits the top match on
 * Enter and an exact or unique-prefix match on Space. Filter text that
 * matches no candidate is shown as unknown and cannot commit; where the position
 * accepts a variable, that text also offers a chip per accepted type that mints
 * the variable, placed by tap or by highlighting it. Text opening with `$` names
 * a variable outright: the offering scopes to the variables matching the rest of
 * the text plus the mint, which the commit keys then place.
 *
 * Returns the two pieces the rule card places: the filter input its sentence line
 * hosts, and the offering panel, which stands while `state.offeringOpen` and is
 * null otherwise. A null `target` arms nothing and yields neither.
 *
 * A position the armed side offers no tile at stands no panel: none opens there,
 * and one standing closes as soon as a placement or a move of the caret leaves
 * the position offering nothing. A position armed from the tray is disarmed with
 * it, since the panel is all the tray stands; one armed from the sentence keeps
 * its box and its caret, which still deletes and still takes typed text.
 *
 * Where the position accepts a text literal, a double quote opens a text value:
 * the filter box holds the value between rendered quotes, the offering narrows to
 * the one chip that places it, and the closing quote, Enter, or a tap on that
 * chip places it. While the value is open every typed character is content,
 * Backspace edits it and leaves the value once it is empty, and Escape abandons
 * it.
 *
 * Where the position pivot stands, the panel also offers the removal of the tile
 * the armed position stands on, which takes that tile out in one undoable step
 * and leaves editing in the gap it vacated, as deleting it from the keyboard
 * does, and the control opening that tile's own menu. A position armed at a
 * caret in the rule's sentence offers no removal, and neither does one standing
 * on no placed tile.
 *
 * The filter box is an ARIA combobox over the rendered chips: the arrow keys
 * walk one cursor across the offering, Enter commits the chip it stands on, and
 * Escape clears typed text before closing the strip. The offering is one grid of
 * rows -- the chips as they wrap, and a group heading between one section and
 * the next. Up and down step between those rows, taking the cell nearest the
 * cursor's own center, and neither end wraps: up from the first row leaves the
 * offering for the sentence, flashing the caret's place there, and down from the
 * last stands where it is. Left and
 * right step along the chips once the cursor stands on one, stopping at the last
 * chip and at the first, and belong to the caret until then. On a group heading
 * they open and close that group instead: right opens it, left closes it, and a
 * closed group draws no chip, so the row below its heading is the next heading.
 *
 * The cursor is anchored on whichever element holds the keyboard: the filter
 * box while typing narrows the offering, the band's own listbox while its chips
 * are browsed, and a heading itself. Typing or committing hands the keyboard
 * back to the filter box. The cursor lasts as long as the keyboard stays on the
 * element it is anchored on: the keyboard leaving the offering, and the offering
 * closing, both release it, and left and right are the caret's again. The chips
 * are reached by the arrow keys rather than by Tab, which moves on past them;
 * the keyboard leaving the strip altogether closes the offering behind it.
 *
 * With a {@link StripComposerBinding} the same input renders inside the rule's
 * sentence line, where the caret the binding carries is what the keyboard edits
 * at. Left and Right step it one position along the rule's run and Home and End
 * take that run's ends; a text cursor standing inside typed text keeps the key
 * for itself. Left off the start of typed text abandons it and steps back, while
 * Right off its end places it exactly as Space would and comes to rest past the
 * tile placed, refusing the key where that text names nothing to place. Four
 * more keys apply as well. A comma places the word in progress as Space would
 * and then moves composition to the DO side, from any point the WHEN expression
 * may end at; where it may not, or where the word in progress resolves to
 * nothing, the comma does nothing. A period places the word in progress the same
 * way and then ends composition on the rule, from any point the armed side may
 * end at, closing the strip and leaving the sentence to read itself; it places
 * no tile of its own, and Enter with nothing to place ends composition on those
 * same terms. Backspace with no word in progress takes back the comma, and then
 * deletes the tile the caret rests on or stands behind, as Delete deletes the
 * one it stands in front of.
 */
export function useCandidateStripSurface({
  state,
  target,
  id,
  onDismiss,
  composer,
  rule,
  editPoint,
}: CandidateStripSurfaceOptions): CandidateStripSurface {
  const side = target?.side ?? RuleSide.When;
  const armedRule = target?.ruleDef;
  const armedTile = armedElement(target);
  const editorConfig = useBrainEditorConfig();
  const localizer = useLocalizer();
  const inputRef = useRef<HTMLInputElement>(null);
  // True when the filter box held the keyboard as its element was detached.
  const inputHeldKeyboard = useRef(false);
  const containerRef = useRef<HTMLElement>(null);

  /**
   * Holds the filter box's element, and keeps the keyboard on the box across a
   * render that stands a new element in its place: the box moves along the
   * sentence line with the caret, and the element it is rebuilt as takes the
   * keyboard back within that same commit, so the keyboard is never left
   * standing on the document for anything else to pick up.
   *
   * A box that did not hold the keyboard, and a keyboard some other element has
   * since taken, are both left alone.
   */
  const bindInput = useCallback((element: HTMLInputElement | null) => {
    if (element === null) {
      inputHeldKeyboard.current = document.activeElement === inputRef.current;
      inputRef.current = null;
      return;
    }
    inputRef.current = element;
    if (inputHeldKeyboard.current && document.activeElement === document.body) {
      element.focus({ preventScroll: true });
    }
    inputHeldKeyboard.current = false;
  }, []);
  const generatedId = useId();
  const stripId = id ?? generatedId;
  const candidatesId = `${stripId}-candidates`;
  const statusId = `${stripId}-status`;
  const unknownId = `${stripId}-unknown`;
  const hintId = `${stripId}-hint`;
  const [openSectionKey, setOpenSectionKey] = useState<string | null>(null);
  const [cursor, setCursor] = useState<StripCursor | undefined>(undefined);
  const [highlightMode, setHighlightMode] = useState<StripHighlightMode>("typing");
  const [status, setStatus] = useState("");
  const [commitTick, setCommitTick] = useState(0);
  const [landingCount, setLandingCount] = useState(0);
  const [openTextLiteral, setOpenTextLiteral] = useState<string | undefined>(undefined);
  const placedLabelRef = useRef<string | null>(null);
  // The token a `reask` effect asked for, waiting for the render that carries
  // everything asked for before it.
  const reaskRef = useRef<ComposerInputToken | undefined>(undefined);
  const isFiltering = state.filter.trim().length > 0;
  const offeringOpen = state.offeringOpen;

  // A text value in progress is the whole offering: the one chip that places it.
  const pendingTextCandidate = useMemo(
    () => (openTextLiteral === undefined ? undefined : state.textLiteralCandidate(openTextLiteral)),
    [openTextLiteral, state]
  );
  const pendingTextEntries = useMemo(
    () => (pendingTextCandidate ? toCandidateEntries([pendingTextCandidate]) : []),
    [pendingTextCandidate]
  );
  const shownBestNext = openTextLiteral === undefined ? state.bestNext : pendingTextEntries;
  const shownSections = openTextLiteral === undefined ? state.sections : noSections;

  // The filter box takes the keyboard for every position the strip is armed at,
  // not only the first: a menu re-arming an open strip must move the keyboard
  // with the offering. The move waits a frame, so a menu handing focus back to
  // its trigger as it closes does not take it away again. Taking focus never
  // scrolls; the reveal effect below settles the view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: target is an intentional trigger signal
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [target]);

  // The cell composition returns the keyboard to, as of the last render of the
  // composed rule.
  const exitCellKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    exitCellKeyRef.current = composer?.exitCellKey();
  });

  // The keyboard comes back when the strip closes while nothing else holds it.
  // A keyboard some other element already holds -- the one Tab moved on to,
  // another rule's arming control -- is left where it is. A composed rule takes
  // it to the cell its caret came to rest at; every other arming takes it to the
  // control read as the rule became armed. A control the placement took away --
  // the add-tile button of a side nothing may follow any more -- hands the
  // keyboard to its rule's handle, which every rule stands.
  const isArmed = target !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the armed rule is read once, as the strip becomes armed
  useEffect(() => {
    if (!isArmed) return;
    const armingControl = document.activeElement as HTMLElement | null;
    const armedRuleId = target?.ruleDef.id();
    return () => {
      if (!keyboardIsUnheld()) return;
      const exitCellKey = exitCellKeyRef.current;
      const exitCell =
        exitCellKey === undefined
          ? null
          : document.querySelector<HTMLElement>(`[${kPageGridCellAttribute}="${exitCellKey}"]`);
      if (exitCell !== null) {
        exitCell.focus();
        return;
      }
      if (armingControl?.isConnected) {
        armingControl.focus();
        return;
      }
      document.querySelector<HTMLElement>(`[data-rule-handle="${armedRuleId}"]`)?.focus();
    };
  }, [isArmed]);

  // The offering appearing brings the filter box into view, which the panel can
  // open below the fold of. Its appearance is the whole trigger: while the
  // offering stands open, typing, the caret moving, and the panel changing
  // height as candidates are filtered all leave the view where the user left it.
  useEffect(() => {
    if (!offeringOpen) return;
    revealFilterInput(inputRef.current);
  }, [offeringOpen]);

  // Every placement lays the rule out again, after which its card is brought
  // back into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitTick is an intentional trigger signal
  useEffect(() => {
    const frame = requestAnimationFrame(() => revealArmedRuleCard(containerRef.current));
    return () => cancelAnimationFrame(frame);
  }, [commitTick]);

  const libraryNames = useMemo(
    () => new Map((editorConfig.libraries ?? []).map((library) => [library.coordinate, library.name])),
    [editorConfig.libraries]
  );
  const libraryNameFor = (candidate: StripCandidate) => {
    const namespace = tileSourceNamespace(candidate.tileDef);
    return namespace !== undefined ? libraryNames.get(namespace) : undefined;
  };

  // Filtering opens every group that still has a match; otherwise one group at a time.
  const openSectionKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const section of shownSections) {
      if (isFiltering ? section.entries.length > 0 : openSectionKey === section.key) keys.add(section.key);
    }
    return keys;
  }, [shownSections, isFiltering, openSectionKey]);

  const bands = useMemo(
    () => buildStripBands(shownBestNext, shownSections, (key) => openSectionKeys.has(key)),
    [shownBestNext, shownSections, openSectionKeys]
  );

  const options = useMemo(() => visibleStripOptions(stripId, bands), [stripId, bands]);
  const activeOption = cursor?.kind === "chip" ? activeStripOption(options, cursor.optionId) : undefined;
  const candidatesByKey = useMemo(() => {
    const map = new Map<string, StripCandidate>();
    for (const band of bands) {
      for (const entry of band.entries) map.set(entry.candidate.key, entry.candidate);
    }
    return map;
  }, [bands]);
  const matchCount = useMemo(
    () =>
      openTextLiteral === undefined
        ? shownSections.reduce((total, section) => total + section.entries.length, 0)
        : pendingTextEntries.length,
    [openTextLiteral, shownSections, pendingTextEntries]
  );

  useEffect(() => {
    if (!activeOption) return;
    document.getElementById(activeOption.optionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOption]);

  const focusTarget = useMemo(
    () => decideStripFocusTarget(options, cursor, highlightMode),
    [options, cursor, highlightMode]
  );

  // Browsing keeps focus on the cell being walked, which an accordion header
  // renders only on the render after its arrow key. A band that stops rendering
  // the highlighted chip hands the keyboard back to the filter box.
  useEffect(() => {
    const cellId = stripFocusTargetId(stripId, focusTarget);
    if (cellId === undefined) {
      if (highlightMode !== "browsing") return;
      setHighlightMode("typing");
      inputRef.current?.focus();
      return;
    }
    const cell = document.getElementById(cellId);
    if (cell && document.activeElement !== cell) cell.focus();
  }, [focusTarget, highlightMode, stripId]);

  // The filter text and the commit tick drive the announcement even when the
  // offering itself is unchanged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: state.filter and commitTick are intentional trigger signals
  useEffect(() => {
    if (!isArmed) return;
    const placed = placedLabelRef.current;
    placedLabelRef.current = null;
    if (placed !== null) {
      setStatus(`${placed} placed`);
      return;
    }
    setStatus(state.isUnknown ? "no tiles fit" : `${matchCount} ${matchCount === 1 ? "tile" : "tiles"}`);
  }, [isArmed, state.filter, state.isUnknown, matchCount, commitTick]);

  /**
   * Where every cell of the offering's grid sits right now, in viewport
   * coordinates and in reading order: the best-next chips, then each section's
   * heading followed by the chips it heads while it is open. A section the
   * filter leaves empty offers no cell, since its heading cannot be reached.
   */
  const measureCells = (): StripCellGeometry[] => {
    const measured: StripCellGeometry[] = [];
    const measure = (cellCursor: StripCursor, elementId: string) => {
      const element = document.getElementById(elementId);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      measured.push({ cursor: cellCursor, left: rect.left, width: rect.width, top: rect.top });
    };
    const measureChips = (bandKey: string, entries: readonly CandidateEntry[]) => {
      for (const entry of entries) {
        const optionId = stripOptionId(stripId, bandKey, entry.candidate.key);
        measure({ kind: "chip", optionId }, optionId);
      }
    };
    measureChips(kBestNextBandKey, shownBestNext);
    for (const section of shownSections) {
      if (section.entries.length === 0) continue;
      measure({ kind: "heading", sectionKey: section.key }, stripSectionHeadingId(stripId, section.key));
      if (openSectionKeys.has(section.key)) measureChips(section.key, section.entries);
    }
    return measured;
  };

  const composerState = (): ComposerInputState => ({
    caret: composer?.caretPosition,
    armedSide: side,
    armedEntry: composer ? "sentence" : "tray",
    filter: state.filter,
    cursor,
    highlightMode,
    pivoted: composer?.pivoted ?? false,
    textLiteral: openTextLiteral,
  });

  // Every fact is read on demand: a token that asks nothing of the document
  // reads nothing of it.
  const composerFacts = (): ComposerInputFacts => ({
    get caretRun() {
      return armedRule === undefined ? noCaretRun : caretRun(armedRule);
    },
    get textCursor() {
      const input = inputRef.current;
      const start = input?.selectionStart ?? 0;
      return { start, end: input?.selectionEnd ?? start };
    },
    get armedSideCanEnd() {
      return composer?.canEndArmedSide() ?? false;
    },
    positionOffersTile: offeringOpen,
    get ruleIsEmpty() {
      return composer?.isRuleEmpty() ?? true;
    },
    get doTileCount() {
      return composer?.doTileCount() ?? 0;
    },
    get ownNewestPlacement() {
      return composer?.ownNewestPlacement();
    },
    get topCandidate() {
      return state.candidateFromKey("enter");
    },
    get spaceCandidate() {
      return state.candidateFromKey("space");
    },
    get highlightedCandidate() {
      return activeOption ? candidatesByKey.get(activeOption.candidateKey) : undefined;
    },
    acceptsTextLiteral: state.acceptsTextLiteral,
    pendingTextLiteral: pendingTextCandidate,
    options,
    get cellGeometry() {
      return measureCells();
    },
  });

  /**
   * Interpret one input through the composer's model and carry out what it asks
   * for, in the order it asks. True when the keystroke was consumed.
   */
  const dispatchInput = (token: ComposerInputToken | undefined, event?: KeyboardEvent<HTMLElement>): boolean => {
    if (token === undefined) return false;
    const { effects } = reduceComposerInput(composerState(), token, composerFacts());
    for (const effect of effects) {
      switch (effect.kind) {
        case "consume-key":
          event?.preventDefault();
          break;
        case "set-filter":
          state.setFilter(effect.text);
          break;
        case "set-text-literal":
          setOpenTextLiteral(effect.value);
          break;
        case "highlight":
          setCursor(effect.cursor);
          setHighlightMode(effect.mode);
          break;
        case "open-section":
          setOpenSectionKey(effect.sectionKey);
          break;
        case "close-section":
          setOpenSectionKey((current) => (current === effect.sectionKey ? null : current));
          break;
        case "place-tile":
          state.commit(effect.candidate);
          break;
        case "announce-placement":
          placedLabelRef.current = effect.label;
          setCommitTick((tick) => tick + 1);
          break;
        case "move-focus": {
          const cellId = stripFocusTargetId(stripId, effect.target);
          if (cellId === undefined) inputRef.current?.focus(effect.keepScroll ? { preventScroll: true } : undefined);
          else document.getElementById(cellId)?.focus();
          break;
        }
        case "reask":
          reaskRef.current = effect.token;
          break;
        case "move-caret":
          rule?.placeCaret(effect.position);
          break;
        case "delete-tile":
          rule?.deleteTile(effect.position);
          break;
        case "undo-own-commit":
          composer?.undoOwnLastCommit();
          break;
        case "flash-caret":
          setLandingCount((count) => count + 1);
          break;
        case "close-strip":
          onDismiss();
          break;
        case "insert-rule":
          composer?.insertRuleAfter();
          break;
      }
    }
    return consumesKey(effects);
  };

  // A re-ask is taken once the render carrying everything asked for before it
  // has landed, so the token reads the document, the offering, and the word in
  // progress as that render leaves them.
  useEffect(() => {
    const token = reaskRef.current;
    if (token === undefined) return;
    reaskRef.current = undefined;
    dispatchInput(token);
  });

  // The offering closing releases the cursor. The tray stands nothing but the
  // offering, so a tray-armed position whose offering closed holds no element of
  // the strip at all and the keyboard has left it, which ends the arming; a
  // position armed from the sentence keeps the box the sentence hosts, and the
  // caret standing at it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: offeringOpen is an intentional trigger signal
  useEffect(() => {
    if (!offeringOpen) dispatchInput({ kind: "focus-lost", leftStrip: isArmed && composer === undefined });
  }, [offeringOpen]);

  const commitCandidate = (candidate: StripCandidate) => {
    dispatchInput({ kind: "candidate-tapped", candidate });
  };

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    dispatchInput({ kind: "escape" }, event);
  };

  // Escape is served here as well as on the panel, since the composer renders
  // this input outside the panel's subtree.
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    dispatchInput(composerTokenForKey(event.key, "filter", event.metaKey || event.ctrlKey), event);
  };

  /**
   * The keys a focused band listbox serves while its chips are being browsed.
   * Tab is left to the browser, which takes it out of the offering, and typing
   * hands the keyboard back to the filter box with the keystroke intact.
   */
  const handleBandKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Escape belongs to the panel, and Tab to the browser's own focus order.
    if (event.key === "Escape" || event.key === "Tab") return;
    event.stopPropagation();
    dispatchInput(composerTokenForKey(event.key, "band", event.metaKey || event.ctrlKey), event);
  };

  /**
   * True when `element` is one of the strip's own: the filter box, anything the
   * panel holds, or anything inside a popup one of the panel's controls opened,
   * which a portal puts outside the panel's own subtree.
   */
  const isStripElement = (element: HTMLElement | null): boolean =>
    element !== null &&
    (element === inputRef.current ||
      containerRef.current?.contains(element) === true ||
      element.closest(`[${kStripPopupAttribute}]`) !== null);

  /**
   * The keyboard leaving the element the cursor is anchored on, which releases
   * the cursor, and leaving the strip for another element of the document, which
   * ends composition as well. A move to another cell of the offering's grid
   * carries the same browse on, and releases nothing; a blur naming no element
   * gaining the keyboard leaves the strip as it stands.
   */
  const handleHighlightBlur = (event: FocusEvent<HTMLElement>) => {
    const gaining = event.relatedTarget as HTMLElement | null;
    if (gaining?.hasAttribute(kStripCellAttribute)) return;
    dispatchInput({ kind: "focus-lost", leftStrip: gaining !== null && !isStripElement(gaining) });
  };

  /** The wiring every band's listbox shares; each band adds its own accessible name. */
  const bandListboxProps = (bandKey: string) => ({
    id: stripBandPanelId(stripId, bandKey),
    tabIndex: -1,
    [kStripCellAttribute]: "",
    "aria-activedescendant":
      focusTarget.kind === "band" && focusTarget.bandKey === bandKey ? activeOption?.optionId : undefined,
    onKeyDown: handleBandKeyDown,
  });

  /** The chips of one band, each addressed by the option id the highlight walks it by. */
  const renderChips = (bandKey: string, entries: readonly CandidateEntry[]) =>
    entries.map((entry) => {
      const optionId = stripOptionId(stripId, bandKey, entry.candidate.key);
      return (
        <CandidateChip
          key={entry.candidate.key}
          entry={entry}
          side={side}
          optionId={optionId}
          isActive={activeOption?.optionId === optionId}
          onCommit={commitCandidate}
          libraryName={libraryNameFor(entry.candidate)}
        />
      );
    });

  const renderSection = (section: CandidateStripSection) => {
    const hasMatches = section.entries.length > 0;
    const isOpen = openSectionKeys.has(section.key);
    const count = isFiltering ? section.entries.length : section.totalCount;
    const panelId = stripBandPanelId(stripId, section.key);
    const groupName = tileCandidateGroupNames[section.group];
    return (
      <div key={section.key} className={`rounded-lg border border-brain-ink/10 ${hasMatches ? "" : "opacity-40"}`}>
        <button
          type="button"
          id={stripSectionHeadingId(stripId, section.key)}
          disabled={!hasMatches}
          tabIndex={-1}
          {...{ [kStripCellAttribute]: "" }}
          onClick={() => setOpenSectionKey(isOpen ? null : section.key)}
          onKeyDown={(event) => {
            if (dispatchInput(composerHeadingToken(event.key, section.key), event)) event.stopPropagation();
          }}
          aria-expanded={isOpen}
          aria-controls={panelId}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-brain-ink/80 transition-colors hover:bg-brain-ink/5 disabled:cursor-default disabled:hover:bg-transparent"
        >
          <span className="text-xs font-semibold uppercase tracking-wider">{groupName}</span>
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-brain-ink/10 px-2 py-0.5 text-[11px] font-semibold text-brain-ink/70">
              {count}
            </span>
            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </span>
        </button>
        {isOpen && hasMatches ? (
          <div
            role="listbox"
            {...bandListboxProps(section.key)}
            aria-label={groupName}
            className={`flex flex-wrap gap-2 px-3 pb-3 ${browsedBandClasses}`}
          >
            {section.subcategories.length === 1
              ? renderChips(section.key, section.subcategories[0].entries)
              : section.subcategories.map((subcategory) => {
                  const headingId = stripSubcategoryHeadingId(stripId, section.key, subcategory.key);
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: a listbox owns option groups by role; a fieldset would add form semantics
                    <div
                      key={subcategory.key}
                      role="group"
                      aria-labelledby={headingId}
                      className="mt-1 flex w-full flex-wrap items-center gap-2 first:mt-0"
                    >
                      <div
                        id={headingId}
                        className={subcategory.band === "application" ? "sr-only" : subcategoryHeadingClasses}
                      >
                        {subcategory.heading}
                      </div>
                      {renderChips(section.key, subcategory.entries)}
                    </div>
                  );
                })}
          </div>
        ) : (
          <div id={panelId} hidden />
        )}
      </div>
    );
  };

  // The ids the filter box describes itself by. The browsing hint and the
  // unknown-text explanation are elements the panel renders.
  const describedBy = offeringOpen ? (state.isUnknown ? `${unknownId} ${hintId}` : hintId) : undefined;

  // The text standing in the box: the open text value's content, or the word in
  // progress. An open text value counts as pending even while it is empty.
  const typedText = openTextLiteral ?? state.filter;
  const hasPendingText = typedText.length > 0 || openTextLiteral !== undefined;

  const filterInput = (
    <input
      ref={bindInput}
      type="text"
      role="combobox"
      aria-expanded={offeringOpen && options.length > 0}
      aria-controls={offeringOpen ? candidatesId : undefined}
      aria-activedescendant={offeringOpen && focusTarget.kind === "input" ? activeOption?.optionId : undefined}
      aria-autocomplete="list"
      value={typedText}
      onChange={(event) => dispatchInput({ kind: "text", text: event.target.value })}
      onKeyDown={handleKeyDown}
      // The sentence hosts this input outside the panel, whose own handler serves every element it holds.
      onBlur={composer ? handleHighlightBlur : undefined}
      placeholder={composer || openTextLiteral !== undefined ? "" : "Type or tap a tile"}
      aria-label={
        composer && armedRule
          ? caretPositionName(composer.caretPosition, armedRule, localizer)
          : localizer.tr("Filter tile candidates", undefined, kOfferingPhraseContext)
      }
      aria-invalid={state.isUnknown}
      aria-describedby={describedBy}
      data-strip-filter={composer ? "sentence" : "tray"}
      className={
        composer
          ? `bg-transparent p-0 align-baseline ${kSentenceTypeClasses} outline-none ${
              hasPendingText
                ? `max-w-full border-b-2 px-1 italic field-sizing-content ${
                    state.isUnknown
                      ? "border-brain-amber text-brain-amber-ink"
                      : "border-brain-accent-ink/80 text-brain-ink"
                  }`
                : "w-0"
            }`
          : `h-10 min-w-0 flex-1 rounded-lg border-2 bg-brain-recess/40 px-3 font-mono text-sm outline-none transition-colors placeholder:font-sans placeholder:text-brain-ink/55 ${
              state.isUnknown
                ? "border-brain-amber/50 text-brain-amber-ink focus:border-brain-amber"
                : "border-brain-ink/15 text-brain-ink focus:border-brain-accent"
            }`
      }
    />
  );

  // An open text value reads as the quoted text it will place, with the input
  // between the quotes the user typed and will type.
  const quoteMark = (
    <span
      aria-hidden="true"
      className={composer ? `${kSentenceTypeClasses} text-brain-ink/70 italic` : "font-mono text-sm text-brain-ink/70"}
    >
      "
    </span>
  );
  const filterField = filterFieldWithQuotes(
    filterInput,
    openTextLiteral === undefined ? undefined : quoteMark,
    composer !== undefined,
    !hasPendingText
  );

  const armedPosition = armedCaretPosition(target);
  const positionName = armedPosition && armedRule ? caretPositionName(armedPosition, armedRule, localizer) : undefined;

  // How the removal control reads: the word the sentence gives the tile it takes.
  const removalName =
    armedTile && armedRule
      ? localizer.tr(
          "Delete {word}",
          { word: tileSentenceWord(armedRule.side(armedTile.side).tiles().get(armedTile.tileIndex), localizer) },
          kOfferingPhraseContext
        )
      : undefined;

  const panel = offeringOpen ? (
    <section
      ref={containerRef}
      id={stripId}
      style={stripPanelStyle}
      className={`absolute top-full left-0 ${kOfferingLayer} mt-2 flex w-[min(40rem,calc(100vw-5rem))] min-w-72 flex-col gap-3 rounded-xl p-3`}
      aria-label="Tile candidates"
      onKeyDown={handlePanelKeyDown}
      onBlur={handleHighlightBlur}
    >
      <div data-strip-position-row="" className={`${kPositionRowClasses} ${kCornerReserveClass}`}>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          <span className={kPositionNameClasses}>{positionName}</span>
          {editPoint && armedTile && (
            <button
              type="button"
              data-strip-delete=""
              aria-label={removalName}
              title={removalName}
              // The press acts without taking the keyboard from the box being typed in.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => dispatchInput({ kind: "delete-element", position: armedTile })}
              className="inline-flex min-h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 border-destructive/40 bg-destructive/15 text-destructive transition-colors hover:border-destructive hover:bg-destructive/30 hover:text-destructive-foreground"
            >
              <Trash2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            </button>
          )}
          {editPoint && (
            <div
              data-edit-point-pivot={editPoint.position}
              className="flex w-fit shrink-0 items-center gap-1 rounded-full border border-brain-ink/10 bg-brain-recess/30 p-1"
            >
              {kEditPointPositions.map((position) => {
                const isCurrent = position === editPoint.position;
                return (
                  <button
                    key={position}
                    type="button"
                    aria-pressed={isCurrent}
                    data-edit-point-position={position}
                    onClick={() => editPoint.arm(position)}
                    className={`min-h-9 cursor-pointer rounded-full px-3 text-xs font-semibold whitespace-nowrap uppercase tracking-wider transition-colors ${
                      isCurrent
                        ? "bg-brain-accent/90 text-brain-on-accent"
                        : "text-brain-ink/60 hover:bg-brain-ink/10 hover:text-brain-ink"
                    }`}
                  >
                    {editPointPivotLabels[position]}
                  </button>
                );
              })}
            </div>
          )}
          {editPoint?.menu}
        </div>
      </div>

      {composer ? null : <div className="flex items-center gap-2">{filterField}</div>}

      <button
        type="button"
        onClick={onDismiss}
        onKeyDown={(event) => {
          if (dispatchInput(composerTokenForKey(event.key, "close", event.metaKey || event.ctrlKey), event))
            event.stopPropagation();
        }}
        aria-label="Close tile candidates"
        data-strip-close=""
        className="absolute top-1.5 right-1.5 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 border-brain-ink/15 bg-brain-desk-to text-brain-ink/70 transition-colors hover:border-brain-ink/40 hover:text-brain-ink"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>

      <p id={hintId} className="sr-only">
        Arrow down to start browsing the tiles. Up and down move between rows, group headings included, and stop at the
        top and the bottom; left and right move along a row of tiles. On a group heading, arrow right opens that group
        and arrow left closes it, so arrow down moves on to the next heading while a group is closed and into its tiles
        once it is open. Enter places the highlighted tile, or the best match for what you have typed when nothing is
        highlighted, as a space does. Arrow up from the first row leaves the tiles and returns to the sentence, and Tab
        leaves them altogether, closing them. Start the text with a dollar sign to name a variable, which Enter then
        places, creating it when no variable has that name. An operator symbol or a bracket ends the word before it and
        places that word, so a formula such as one plus three needs no spaces in it. Where a text value fits, a double
        quote starts one and the next double quote places it, as Enter does, with everything between them taken as the
        text, and nothing typed into it places a tile.
        {composer
          ? " Type a comma to end the when side and start typing what to do, and a period when the rule says what you want. With nothing typed, Backspace takes back the comma, and then the word you placed last."
          : ""}
      </p>

      <output id={statusId} aria-live="polite" className="sr-only">
        {status}
      </output>

      {state.isUnknown && (
        <p id={unknownId} className="text-xs font-semibold text-brain-amber-ink">
          No tile fits here by that name.
        </p>
      )}

      <div id={candidatesId} className="flex flex-col gap-3">
        {shownBestNext.length > 0 && (
          <div
            role="listbox"
            {...bandListboxProps(kBestNextBandKey)}
            aria-label="Best next tiles"
            className={`flex flex-wrap gap-2 ${browsedBandClasses}`}
          >
            {renderChips(kBestNextBandKey, shownBestNext)}
          </div>
        )}

        {shownSections.length > 0 && (
          <div className="flex flex-col gap-1.5">{shownSections.map((section) => renderSection(section))}</div>
        )}
      </div>
    </section>
  ) : null;

  return { composerInput: composer ? filterField : undefined, pending: hasPendingText, landingCount, panel };
}
