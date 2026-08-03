import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import type {
  SentenceSegment,
  SentenceTileRef,
  SentenceWordSegment,
} from "@mindcraft-lang/core/brain/language-service";
import { flattenRuleTiles, projectRuleSentence, whenTriggerWord } from "@mindcraft-lang/core/brain/language-service";
import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import type { BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";
import { CoreTypeIds } from "@mindcraft-lang/core/runtime";
import { type CSSProperties, Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { type BrainEditorConfig, useBrainEditorConfig, useLocalizer } from "./BrainEditorContext";
import { type CaretPosition, caretPositionForSegment, caretSentenceSlot } from "./caret-run";
import { kRuleContentLayer } from "./editor-layers";
import { usePageGrid } from "./PageGridContext";
import { kPageGridCellAttribute, pageGridCellKey } from "./page-grid-model";
import { pageGridSelectionProps } from "./page-grid-selection";
import { composePivotReading, composeSentenceReading } from "./sentence-composer";
import {
  changedSentenceSegments,
  type SentenceSegmentIdentity,
  sentenceSegmentIdentities,
} from "./sentence-reflection";
import { kSentenceTypeClasses } from "./sentence-type";
import { kDefaultTileHue, resolveTileVisual } from "./tile-visual-utils";

/** How long a changed word stays lit before its highlight fades, in milliseconds. */
const kSentenceHighlightMs = 260;

/** How long the caret's place stays flashed before the flash fades, in milliseconds. */
const kCaretLandingMs = 220;

const noHighlight: ReadonlySet<number> = new Set<number>();

/** Keeps a mouse press from moving the keyboard off whatever currently holds it. */
function keepKeyboard(event: React.MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/** Whether `tileDef` is a literal holding a number or a text value. */
function isValueLiteral(tileDef: IBrainTileDef): boolean {
  if (tileDef.kind !== "literal") {
    return false;
  }
  const valueType = (tileDef as BrainTileLiteralDef).valueType;
  return valueType === CoreTypeIds.Number || valueType === CoreTypeIds.String;
}

/** The register a word renders in, or undefined for the sentence's plain reading register. */
function sentenceRegister(tileDef: IBrainTileDef | undefined): string | undefined {
  if (tileDef === undefined) {
    return undefined;
  }
  if (tileDef.kind === "variable") {
    return "variable";
  }
  return isValueLiteral(tileDef) ? "literal" : undefined;
}

/** The type styles of each sentence register, keyed by the register's name. */
const registerClasses: Record<string, string> = {
  variable: "font-mono text-[0.92em] text-brain-accent-ink",
  literal: "font-semibold text-brain-ink/90",
};

/** Chrome a tappable word keeps so it reads as part of the sentence, not as a control. */
const sentenceWordButtonClasses = `cursor-pointer rounded-sm border-0 bg-transparent p-0 text-left align-baseline ${kSentenceTypeClasses} text-inherit hover:bg-brain-ink/10`;

/**
 * Chrome the run of text inside a word keeps: the box the caret's focus
 * treatment is painted on, which takes and drops that paint in 100ms.
 */
const sentenceWordFocusClasses = "rounded-sm bg-transparent transition-colors duration-100";

/**
 * Chrome a tappable run of the projection's own structure keeps: the text it
 * already reads, laid out as the plain span it stands in place of, with its
 * spaces held exactly as projected.
 */
const sentenceGlueButtonClasses = `inline cursor-pointer whitespace-pre rounded-sm border-0 bg-transparent p-0 ${kSentenceTypeClasses} text-inherit hover:bg-brain-ink/10`;

/**
 * Chrome of the hit target standing in a word boundary: a finger-sized hit area
 * laid over the space between two words, out of the line's flow and taking no
 * layout width.
 */
const sentenceCaretClasses =
  "group absolute -top-1.5 -left-1.5 flex h-6 w-3 cursor-text items-center justify-center border-0 bg-transparent p-0";

/** The mark a hit target paints inside its hit area, which shows itself on approach. */
const sentenceCaretMarkClasses =
  "h-4 w-0.5 rounded-full bg-transparent transition-colors group-hover:bg-brain-accent-ink/70";

/**
 * The mark the caret itself paints, standing in the boundary it rests in: the
 * stem of an I-beam, centered on the line's text and running past it above and
 * below, out of the line's flow and taking no layout width. Its left offset
 * stands it in the middle of the space before the word it opens, clear of the
 * glyphs on either side. Sets the caret's ink, which its contents inherit.
 */
const sentenceCaretStandingMarkClasses =
  "absolute top-1/2 -left-[3.5px] h-7 w-0.5 -translate-y-1/2 rounded-full bg-brain-accent-ink";

/**
 * One crossbar of the caret's I-beam, drawn in the stem's own ink and centered
 * across it, narrow enough to stand inside a word space. Carries the end of the
 * stem it caps.
 */
const sentenceCaretCrossbarClasses = "absolute -left-px h-0.5 w-1 rounded-full bg-inherit";

/**
 * The bloom marking where the keyboard came back to: a soft pill of the caret's
 * own ink standing in the boundary the caret rests in, centered on the line's
 * text, out of the line's flow and taking no layout width. It is painted while
 * the flash is held and paints nothing at rest.
 */
const sentenceCaretLandingClasses =
  "pointer-events-none absolute top-1/2 -left-2.5 h-7 w-5 -translate-y-1/2 rounded-full bg-brain-accent-ink blur-[2px]";

/** The zero-width anchor a caret is positioned against, standing where the caret's word boundary is. */
const sentenceCaretAnchorClasses = "relative";

/** The hue `side` reads `tileDef` in, which the caret paints its focus treatment with. */
function tileHue(config: BrainEditorConfig, tileDef: IBrainTileDef, side: RuleSide): string {
  const colorDef = resolveTileVisual(config, tileDef).colorDef;
  return (side === RuleSide.When ? colorDef?.when : colorDef?.do) || kDefaultTileHue;
}

/**
 * How a word of the tile the caret rests on is painted: a soft fill of the
 * tile's own `hue` under an underline of the same hue. A `superseded` word is
 * the one the pending text will take the place of, and reads struck through and
 * faded.
 */
function caretFocusStyle(hue: string, superseded: boolean): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${hue} 12%, transparent)`,
    textDecorationLine: superseded ? "line-through" : "underline",
    textDecorationColor: hue,
    textDecorationThickness: "2px",
    textUnderlineOffset: "3px",
    opacity: superseded ? 0.45 : undefined,
  };
}

/**
 * Whether a caret hit target stands before each segment: before a word that
 * opens a tile the sentence has not read yet, so a tile read by several words
 * carries one target ahead of its first word and none inside it.
 */
function caretsBeforeSegments(segments: readonly SentenceSegment[]): boolean[] {
  const carets: boolean[] = [];
  let lastTileIndex: number | undefined;
  for (const segment of segments) {
    const opensTile = segment.kind === "word" && segment.sourceTileIndex !== lastTileIndex;
    carets.push(opensTile);
    if (segment.kind === "word") lastTileIndex = segment.sourceTileIndex;
  }
  return carets;
}

/** The rule's sentence in the active locale, with the tiles its words render. */
function useRuleSentence(ruleDef: BrainRuleDef, revision: number) {
  const localizer = useLocalizer();
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is an intentional recompute signal
  return useMemo(() => {
    const tiles = flattenRuleTiles(ruleDef).toArray();
    return { segments: projectRuleSentence(ruleDef, localizer).toArray(), tiles };
  }, [ruleDef, localizer, revision]);
}

interface BrainRuleSentenceProps {
  ruleDef: BrainRuleDef;
  /** The page editor's update counter; every document change re-reads the sentence. */
  updateCounter: number;
  /**
   * The composer's filter input, rendered where `caretPosition` stands. Present
   * while the rule holds the caret, which is also what keeps the line rendered
   * for a rule that projects no segments yet, and what puts the line in its
   * composition reading.
   */
  composerInput?: ReactNode;
  /**
   * Where the caret stands. Supply it with `composerInput`; without it the input
   * stands at the end of the line and the line marks no caret at all.
   */
  caretPosition?: CaretPosition;
  /** True while the composer's input holds typed text the caret's position will take. */
  pending?: boolean;
  /**
   * How many times the keyboard has come back to the line from the composer's
   * offering. Every new value flashes the caret's place; the count itself is
   * read for nothing else.
   */
  landingCount?: number;
  /**
   * True while the composer sits on the DO side of a typed pivot, which the line
   * reads as a comma -- preceded by the trigger word when the WHEN side it
   * pivoted from has no words of its own.
   */
  pivotComma?: boolean;
  /**
   * Places the caret from the sentence. With it the line's words and the
   * structure the projection supplies are tappable, and every word boundary but
   * the one the caret rests in carries a hit target; without it the line is
   * reading only.
   */
  placeCaret?: (position: CaretPosition) => void;
  /**
   * How the line reads as the rule's sentence cell in the page's selection
   * grid. Supply it from inside a page grid; without it, or outside one, the
   * line stands no cell and takes no tab stop.
   */
  cellName?: string;
  /**
   * The keys pressed while the selection rests on the line itself. A key
   * pressed in the composer's box the line hosts never reaches it. Supply it
   * with `cellName`.
   */
  onCellKeyDown?: (event: React.KeyboardEvent<HTMLParagraphElement>) => void;
}

/**
 * The rule read as a sentence, under its tile row. The sentence is derived at
 * render from the rule and the active locale -- nothing is stored and nothing
 * enters the command history -- so it re-reads itself on every edit, briefly
 * lighting the words whose tiles changed. A rule that projects no segments and
 * hosts no composer input renders nothing.
 *
 * While the composer's input is hosted here the line reads in composition:
 * see {@link composeSentenceReading} for what a rule under composition shows,
 * and {@link composePivotReading} for what a typed pivot adds to it. The settled
 * reading returns as soon as the input leaves.
 *
 * Each return of the keyboard from the offering, counted by `landingCount`,
 * blooms the caret's place for {@link kCaretLandingMs} and then fades it to
 * nothing, so the line keeps no mark of the return.
 *
 * With `placeCaret` the line is also an editing surface. A word places the caret
 * on its tile, the structure around it places the caret in the gap that closes
 * the tile it trails, and the hit target in each word boundary places the caret
 * in that boundary. Exactly one position is marked: a caret in a gap paints its
 * own mark in the boundary it rests in, and a caret on a tile underlines that
 * tile's words in the tile's own hue.
 */
export function BrainRuleSentence({
  ruleDef,
  updateCounter,
  composerInput,
  caretPosition,
  pending = false,
  landingCount = 0,
  pivotComma,
  placeCaret,
  cellName,
  onCellKeyDown,
}: BrainRuleSentenceProps) {
  const { segments: settled, tiles } = useRuleSentence(ruleDef, updateCounter);
  const localizer = useLocalizer();
  const editorConfig = useBrainEditorConfig();
  const pageGrid = usePageGrid();
  const isComposing = composerInput !== undefined;
  const segments = useMemo(() => (isComposing ? composeSentenceReading(settled) : settled), [isComposing, settled]);
  const pivot = useMemo(
    () => (pivotComma ? composePivotReading(segments, whenTriggerWord(localizer)) : []),
    [pivotComma, segments, localizer]
  );
  const carets = useMemo(() => caretsBeforeSegments(segments), [segments]);
  const inputSlot = useMemo(
    () => (caretPosition === undefined ? segments.length : caretSentenceSlot(segments, tiles, caretPosition)),
    [caretPosition, segments, tiles]
  );
  const identities = useMemo(() => sentenceSegmentIdentities(segments, tiles), [segments, tiles]);
  const previousRef = useRef<SentenceSegmentIdentity[]>([]);
  const [highlighted, setHighlighted] = useState<ReadonlySet<number>>(noHighlight);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    const changed = changedSentenceSegments(previousRef.current, identities);
    previousRef.current = identities;
    if (changed.size === 0) {
      return;
    }
    setHighlighted(changed);
    const timer = setTimeout(() => setHighlighted(noHighlight), kSentenceHighlightMs);
    return () => clearTimeout(timer);
  }, [identities]);

  useEffect(() => {
    if (landingCount === 0) {
      return;
    }
    setLanded(true);
    const timer = setTimeout(() => setLanded(false), kCaretLandingMs);
    return () => clearTimeout(timer);
  }, [landingCount]);

  if (segments.length === 0 && !isComposing) {
    return null;
  }

  // The whole line is one cell of the page's selection grid, rendered as a
  // named group holding the line's own controls.
  const cellKey = pageGridCellKey({ kind: "sentence", ruleId: ruleDef.id() });
  const isSelectedCell = pageGrid?.currentCell !== undefined && pageGridCellKey(pageGrid.currentCell) === cellKey;
  const cellProps =
    pageGrid === undefined || cellName === undefined
      ? undefined
      : {
          [kPageGridCellAttribute]: cellKey,
          tabIndex: isSelectedCell ? 0 : -1,
          ...pageGridSelectionProps("line", isSelectedCell),
          role: "group",
          "aria-label": cellName,
          onKeyDown: onCellKeyDown,
        };

  // The mark stands for a caret in a gap while nothing is typed.
  const showCaretMark = caretPosition?.kind === "gap" && !pending;
  const focused = caretPosition?.kind === "element" ? caretPosition : undefined;
  const landingClass = landed
    ? `${sentenceCaretLandingClasses} opacity-45`
    : `${sentenceCaretLandingClasses} opacity-0 transition-opacity duration-300`;

  /**
   * What stands in the boundary before the segment at `index`, the end of the
   * line being the index past the last segment: the caret's landing bloom, its
   * mark, and the composer's input where the caret rests, otherwise the hit
   * target opening the tile `word` reads.
   */
  const boundary = (index: number, word?: SentenceWordSegment): ReactNode => {
    if (index === inputSlot) {
      return (
        <>
          {caretPosition !== undefined && (
            <span className={sentenceCaretAnchorClasses}>
              <span data-caret-landing="" className={landingClass} aria-hidden="true" />
              {showCaretMark && (
                <span data-caret-mark="" className={sentenceCaretStandingMarkClasses} aria-hidden="true">
                  <span className={`${sentenceCaretCrossbarClasses} top-0`} />
                  <span className={`${sentenceCaretCrossbarClasses} bottom-0`} />
                </span>
              )}
            </span>
          )}
          {composerInput}
        </>
      );
    }
    const tileRef = word === undefined ? undefined : (tiles[word.sourceTileIndex] as SentenceTileRef | undefined);
    if (!placeCaret || !word || !tileRef || !carets[index]) return null;
    return (
      <span className={sentenceCaretAnchorClasses}>
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={keepKeyboard}
          data-sentence-caret={word.sourceTileIndex}
          className={sentenceCaretClasses}
          aria-label="Insert a tile here"
          onClick={() => placeCaret({ kind: "gap", side: tileRef.side, tileIndex: tileRef.tileIndex })}
        >
          <span className={sentenceCaretMarkClasses} aria-hidden="true" />
        </button>
      </span>
    );
  };

  return (
    <p
      className={`relative ${kRuleContentLayer} mt-1.5 ml-11 max-w-2xl ${kSentenceTypeClasses} text-brain-ink/70`}
      data-rule-sentence={ruleDef.id()}
      {...cellProps}
    >
      {segments.map((segment: SentenceSegment, index: number) => {
        if (segment.kind !== "word") {
          // Only structure carrying more than space is tappable.
          const isStructureTappable = placeCaret !== undefined && segment.text.trim().length > 0;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments have no identity beyond their position
            <Fragment key={index}>
              {boundary(index)}
              {isStructureTappable && placeCaret ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={keepKeyboard}
                  data-sentence-structure={index}
                  className={sentenceGlueButtonClasses}
                  onClick={() => placeCaret(caretPositionForSegment(segments, tiles, index))}
                >
                  {segment.text}
                </button>
              ) : (
                <span>{segment.text}</span>
              )}
            </Fragment>
          );
        }
        const tileRef = tiles[segment.sourceTileIndex] as SentenceTileRef | undefined;
        const register = sentenceRegister(tileRef?.tileDef);
        const isLit = highlighted.has(index);
        const isFocused =
          focused !== undefined && tileRef?.side === focused.side && tileRef.tileIndex === focused.tileIndex;
        const registerClass = register === undefined ? "" : registerClasses[register];
        const litClass = isLit
          ? "rounded-sm bg-brain-amber-wash/25 text-brain-ink"
          : "rounded-sm bg-transparent transition-colors duration-300";
        const wordProps = {
          className: cn(registerClass, litClass),
          "data-sentence-register": register,
          "data-sentence-tile-index": segment.sourceTileIndex,
        };
        const wordText = (
          <span
            className={sentenceWordFocusClasses}
            style={
              isFocused && tileRef
                ? caretFocusStyle(tileHue(editorConfig, tileRef.tileDef, tileRef.side), pending)
                : undefined
            }
            data-caret-focus={isFocused ? segment.sourceTileIndex : undefined}
            data-caret-superseded={isFocused && pending ? segment.sourceTileIndex : undefined}
          >
            {segment.text}
          </span>
        );
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments have no identity beyond their position
          <Fragment key={index}>
            {boundary(index, segment)}
            {placeCaret && tileRef ? (
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={keepKeyboard}
                {...wordProps}
                className={cn(sentenceWordButtonClasses, wordProps.className)}
                onClick={() => placeCaret(caretPositionForSegment(segments, tiles, index))}
              >
                {wordText}
              </button>
            ) : (
              <span {...wordProps}>{wordText}</span>
            )}
          </Fragment>
        );
      })}
      {pivot.length > 0 && (
        <span data-composer-pivot-comma={ruleDef.id()}>{pivot.map((segment) => segment.text).join("")}</span>
      )}
      {boundary(segments.length)}
    </p>
  );
}

/**
 * The rule's sentence as static print text, with no reflection. Renders nothing
 * for a rule that projects no segments.
 */
export function BrainPrintRuleSentence({ ruleDef }: { ruleDef: BrainRuleDef }) {
  const { segments } = useRuleSentence(ruleDef, 0);
  if (segments.length === 0) {
    return null;
  }
  return <div className="brain-print-rule-sentence">{segments.map((segment) => segment.text).join("")}</div>;
}
