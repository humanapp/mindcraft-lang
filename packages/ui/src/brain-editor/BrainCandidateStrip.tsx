import { RuleSide } from "@mindcraft-lang/core/brain";
import { ChevronDown, X } from "lucide-react";
import { type FocusEvent, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { staticAssetUrl } from "../asset-url";
import { adjustColor, readableInk, saturateColor } from "../lib/color";
import { useBrainEditorConfig } from "./BrainEditorContext";
import {
  activeStripOption,
  type CandidateEntry,
  decideStripEscape,
  decideStripFocusTarget,
  enterStripOptionsAt,
  isStripFilterTypingKey,
  kBestNextBandKey,
  moveActiveStripOption,
  moveActiveStripOption2D,
  type StripCandidate,
  type StripHighlightMode,
  type StripOptionBand,
  type StripOptionGeometry,
  stripBandPanelId,
  stripOptionId,
  stripSubcategoryHeadingId,
  tileCandidateGroupNames,
  visibleStripOptions,
} from "./candidate-strip-model";
import type { CandidateStripSection, CandidateStripState } from "./hooks/useCandidateStrip";
import { tileSourceNamespace } from "./tile-library-groups";
import { resolveTileVisual } from "./tile-visual-utils";

/** Drag payload format carrying a candidate key from a chip to the armed slot. */
export const kCandidateDragMimeType = "application/x-mindcraft-candidate";

const stripPanelStyle = {
  background: "linear-gradient(160deg, #191338 0%, #0E0A20 100%)",
  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 24px rgba(0, 0, 0, 0.45)",
};

/** Focus ring shared by the strip's tab stops, drawn against the panel's own backdrop. */
const focusRingClasses =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E0A20]";

/** Heading of a provenance subcategory: the accordion header's type, one step quieter. */
const subcategoryHeadingClasses = "w-full px-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/45";

/** Ring drawn around the band whose chips the keyboard is currently walking. */
const browsedBandClasses =
  "rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-2 focus:ring-offset-[#0E0A20]";

/** The row step a vertical arrow key takes, or undefined for every other key. */
function arrowDelta(key: string): 1 | -1 | undefined {
  if (key === "ArrowDown") return 1;
  if (key === "ArrowUp") return -1;
  return undefined;
}

/** The sequence step a horizontal arrow key takes, or undefined for every other key. */
function horizontalArrowDelta(key: string): 1 | -1 | undefined {
  if (key === "ArrowRight") return 1;
  if (key === "ArrowLeft") return -1;
  return undefined;
}

/**
 * Scroll the rule card `strip` is rendered inside back into view, moving each
 * scrollport as little as the card allows. The card carries the strip, so a
 * card taller than its scrollport settles with its tile row at the scrollport's
 * top edge and the strip overflowing below it.
 */
function revealArmedRuleCard(strip: HTMLElement | null): void {
  strip?.closest("[data-rule-id]")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
 * library attribution and any conversion carried in the accessible name.
 */
function CandidateChip({ entry, side, optionId, isActive, onCommit, libraryName }: CandidateChipProps) {
  const editorConfig = useBrainEditorConfig();
  const { candidate } = entry;
  const visual = resolveTileVisual(editorConfig, candidate.tileDef);
  const baseColor = (side === RuleSide.When ? visual.colorDef?.when : visual.colorDef?.do) || "#475569";
  const iconUrl = visual.iconUrl || staticAssetUrl("assets/brain/icons/question_mark.svg");
  const description = [
    `${candidate.tileDef.kind} tile: ${candidate.label}`,
    libraryName ? `from ${libraryName}` : undefined,
    candidate.viaConversion ? "fits by converting the value" : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(", ");

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
        background: `linear-gradient(180deg, ${adjustColor(baseColor, 0.35)}, ${baseColor})`,
        borderColor: adjustColor(saturateColor(baseColor, 0.5), -0.35),
        borderStyle: candidate.viaConversion ? "dashed" : "solid",
        // The label runs the full height of the chip, down to the gradient's dark stop.
        color: readableInk(baseColor),
      }}
      className={`inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-full border-2 px-3 py-1.5 shadow-sm transition-[filter,transform] hover:brightness-110 active:scale-95 ${focusRingClasses} ${
        candidate.viaConversion ? "opacity-80" : ""
      } ${isActive ? "ring-2 ring-white ring-offset-2 ring-offset-[#0E0A20] brightness-110" : ""}`}
      aria-label={description}
      data-presentation={entry.presentation}
      data-candidate-key={candidate.key}
      data-via-conversion={candidate.viaConversion ? "true" : undefined}
    >
      <img src={iconUrl} alt="" aria-hidden="true" className="h-6 w-6 shrink-0 object-contain" />
      <span className="truncate font-mono text-sm font-semibold">{candidate.label}</span>
    </button>
  );
}

/** Props for {@link BrainCandidateStrip}. */
export interface BrainCandidateStripProps {
  /** The offering and commit surface for the armed position. */
  state: CandidateStripState;
  /** The rule side being composed; selects the chip colors. */
  side: RuleSide;
  /** DOM id of the strip panel, so the arming control can point `aria-controls` at it. */
  id?: string;
  /** Called when the user dismisses the strip without placing a tile. */
  onDismiss: () => void;
}

/**
 * The inline candidate strip: the tiles valid at the armed position, offered as
 * word-chips that commit on tap, with a filter box that commits the top match on
 * Enter or Tab and an exact or unique-prefix match on Space. Filter text that
 * matches no candidate is shown as unknown and cannot commit.
 *
 * The filter box is an ARIA combobox over the rendered chips: the arrow keys
 * walk a highlight across them, Enter commits the highlighted chip, and Escape
 * clears typed text before closing the strip. Up and down step between the
 * wrapped rows the chips are drawn in, taking the chip nearest the highlighted
 * one's center; left and right step along the rendered sequence, and stay with
 * the text caret until a chip is highlighted.
 *
 * The highlight is anchored on whichever element holds the keyboard. Arrows
 * pressed in the filter box or on the close button keep it there. An arrow key
 * pressed on a group heading instead moves focus onto the band's own listbox
 * and keeps it there as the highlight crosses bands, so Tab reaches the next
 * heading from the group being browsed; typing or committing hands the keyboard
 * back to the filter box. Arrow down on a closed heading opens its group and
 * highlights its first chip.
 */
export function BrainCandidateStrip({ state, side, id, onDismiss }: BrainCandidateStripProps) {
  const editorConfig = useBrainEditorConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  const generatedId = useId();
  const stripId = id ?? generatedId;
  const candidatesId = `${stripId}-candidates`;
  const statusId = `${stripId}-status`;
  const unknownId = `${stripId}-unknown`;
  const hintId = `${stripId}-hint`;
  const [openSectionKey, setOpenSectionKey] = useState<string | null>(null);
  const [activeOptionId, setActiveOptionId] = useState<string | undefined>(undefined);
  const [highlightMode, setHighlightMode] = useState<StripHighlightMode>("typing");
  const [status, setStatus] = useState("");
  const [commitTick, setCommitTick] = useState(0);
  const placedLabelRef = useRef<string | null>(null);
  const isFiltering = state.filter.trim().length > 0;

  // The arming control keeps the keyboard's place: the strip takes focus while
  // it is open and hands it back when it closes. Taking focus never scrolls;
  // the reveal effect below settles the view.
  useEffect(() => {
    const armingControl = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      if (armingControl?.isConnected) armingControl.focus();
    };
  }, []);

  // Opening the strip and every placement made in it grow the rule card, which
  // is brought back into view once the card has been laid out at its new height.
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
    for (const section of state.sections) {
      if (isFiltering ? section.entries.length > 0 : openSectionKey === section.key) keys.add(section.key);
    }
    return keys;
  }, [state.sections, isFiltering, openSectionKey]);

  const bands = useMemo(
    () => buildStripBands(state.bestNext, state.sections, (key) => openSectionKeys.has(key)),
    [state.bestNext, state.sections, openSectionKeys]
  );

  const options = useMemo(() => visibleStripOptions(stripId, bands), [stripId, bands]);
  const activeOption = activeStripOption(options, activeOptionId);
  const candidatesByKey = useMemo(() => {
    const map = new Map<string, StripCandidate>();
    for (const band of bands) {
      for (const entry of band.entries) map.set(entry.candidate.key, entry.candidate);
    }
    return map;
  }, [bands]);
  const matchCount = useMemo(
    () => state.sections.reduce((total, section) => total + section.entries.length, 0),
    [state.sections]
  );

  useEffect(() => {
    if (!activeOption) return;
    document.getElementById(activeOption.optionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOption]);

  const focusTarget = useMemo(
    () => decideStripFocusTarget(options, activeOptionId, highlightMode),
    [options, activeOptionId, highlightMode]
  );

  // Browsing keeps focus on the band being walked, which an accordion header
  // renders only on the render after its arrow key. A band that stops rendering
  // the highlighted chip hands the keyboard back to the filter box.
  useEffect(() => {
    if (focusTarget.kind === "input") {
      if (highlightMode !== "browsing") return;
      setHighlightMode("typing");
      inputRef.current?.focus();
      return;
    }
    const band = document.getElementById(stripBandPanelId(stripId, focusTarget.bandKey));
    if (band && document.activeElement !== band) band.focus();
  }, [focusTarget, highlightMode, stripId]);

  // The filter text and the commit tick drive the announcement even when the
  // offering itself is unchanged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: state.filter and commitTick are intentional trigger signals
  useEffect(() => {
    const placed = placedLabelRef.current;
    placedLabelRef.current = null;
    if (placed !== null) {
      setStatus(`${placed} placed`);
      return;
    }
    setStatus(state.isUnknown ? "no tiles fit" : `${matchCount} ${matchCount === 1 ? "tile" : "tiles"}`);
  }, [state.filter, state.isUnknown, matchCount, commitTick]);

  // A placement re-queries the offering, so the keyboard starts over in the
  // filter box whether the strip stays open or closes behind the placement.
  const announcePlacement = (label: string) => {
    placedLabelRef.current = label;
    setCommitTick((tick) => tick + 1);
    setActiveOptionId(undefined);
    setHighlightMode("typing");
    inputRef.current?.focus({ preventScroll: true });
  };

  const commitCandidate = (candidate: StripCandidate) => {
    state.commit(candidate);
    announcePlacement(candidate.label);
  };

  const setFilterText = (next: string) => {
    state.setFilter(next);
    setActiveOptionId(undefined);
    setHighlightMode("typing");
  };

  /** Place the chip the highlight rests on, if it rests on one. True when a tile was placed. */
  const commitHighlight = (): boolean => {
    const highlighted = activeOption ? candidatesByKey.get(activeOption.candidateKey) : undefined;
    if (!highlighted) return false;
    commitCandidate(highlighted);
    return true;
  };

  const commitWithKey = (key: "enter" | "tab" | "space", event: KeyboardEvent<HTMLInputElement>) => {
    const placed = state.commitFromKey(key);
    if (!placed) return;
    announcePlacement(placed.label);
    event.preventDefault();
  };

  /** Where every rendered chip sits right now, in viewport coordinates. */
  const measureOptions = (): StripOptionGeometry[] => {
    const measured: StripOptionGeometry[] = [];
    for (const option of options) {
      const element = document.getElementById(option.optionId);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      measured.push({ optionId: option.optionId, left: rect.left, width: rect.width, top: rect.top });
    }
    return measured;
  };

  // The highlight is anchored on whichever element holds the keyboard: the
  // filter box while typing, and the band's own listbox while browsing it.
  // True when the highlight moved.
  const settleHighlight = (next: string | undefined, mode: StripHighlightMode): boolean => {
    if (next === undefined) return false;
    setActiveOptionId(next);
    setHighlightMode(mode);
    if (mode === "typing") inputRef.current?.focus();
    return true;
  };

  const moveHighlightAcross = (delta: 1 | -1) =>
    settleHighlight(moveActiveStripOption(options, activeOptionId, delta), highlightMode);

  const moveHighlightDown = (delta: 1 | -1) =>
    settleHighlight(moveActiveStripOption2D(measureOptions(), activeOptionId, delta), highlightMode);

  const enterHighlightAt = (sectionKey: string, delta: 1 | -1): boolean => {
    const sequence = buildStripBands(
      state.bestNext,
      state.sections,
      (key) => openSectionKeys.has(key) || key === sectionKey
    );
    const entered = enterStripOptionsAt(stripId, sequence, sectionKey, delta);
    if (entered === undefined) return false;
    if (delta === 1) setOpenSectionKey(sectionKey);
    return settleHighlight(entered, "browsing");
  };

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (decideStripEscape(state.filter) === "clear-filter") setFilterText("");
    else onDismiss();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Escape belongs to the panel, which serves every control in the strip.
    if (event.key === "Escape") return;
    event.stopPropagation();
    const rowDelta = arrowDelta(event.key);
    if (rowDelta !== undefined) {
      if (moveHighlightDown(rowDelta)) event.preventDefault();
      return;
    }
    const acrossDelta = horizontalArrowDelta(event.key);
    if (acrossDelta !== undefined) {
      // Until a chip is highlighted the horizontal arrows belong to the caret.
      if (activeOption && moveHighlightAcross(acrossDelta)) event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      if (commitHighlight()) {
        event.preventDefault();
        return;
      }
      commitWithKey("enter", event);
      return;
    }
    if (event.key === "Tab") {
      commitWithKey("tab", event);
      return;
    }
    if (event.key === " ") {
      commitWithKey("space", event);
    }
  };

  /**
   * The keys a focused band listbox serves while its chips are being browsed.
   * Tab is left to the browser so it reaches the next accordion heading, and
   * typing hands the keyboard back to the filter box with the keystroke intact.
   */
  const handleBandKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Escape belongs to the panel, and Tab to the browser's own focus order.
    if (event.key === "Escape" || event.key === "Tab") return;
    event.stopPropagation();
    const rowDelta = arrowDelta(event.key);
    if (rowDelta !== undefined) {
      if (moveHighlightDown(rowDelta)) event.preventDefault();
      return;
    }
    const acrossDelta = horizontalArrowDelta(event.key);
    if (acrossDelta !== undefined) {
      if (moveHighlightAcross(acrossDelta)) event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      if (commitHighlight()) event.preventDefault();
      return;
    }
    if (!isStripFilterTypingKey(event.key)) return;
    inputRef.current?.focus();
    // Focusing mid-keydown carries a printable character into the box on its
    // own; Backspace has no such follow-up, so its edit is applied here.
    if (event.key !== "Backspace") {
      setHighlightMode("typing");
      return;
    }
    event.preventDefault();
    setFilterText(state.filter.slice(0, -1));
  };

  /** Leaving a band for anything but another band ends the browse. */
  const handleBandBlur = (event: FocusEvent<HTMLElement>) => {
    const gaining = event.relatedTarget as HTMLElement | null;
    if (gaining?.getAttribute("role") === "listbox") return;
    setHighlightMode("typing");
  };

  /** The wiring every band's listbox shares; each band adds its own accessible name. */
  const bandListboxProps = (bandKey: string) => ({
    id: stripBandPanelId(stripId, bandKey),
    tabIndex: -1,
    "aria-activedescendant":
      focusTarget.kind === "band" && focusTarget.bandKey === bandKey ? activeOption?.optionId : undefined,
    onKeyDown: handleBandKeyDown,
    onBlur: handleBandBlur,
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
      <div key={section.key} className={`rounded-lg border border-white/10 ${hasMatches ? "" : "opacity-40"}`}>
        <button
          type="button"
          disabled={!hasMatches}
          onClick={() => setOpenSectionKey(isOpen ? null : section.key)}
          onKeyDown={(event) => {
            const delta = arrowDelta(event.key);
            if (delta === undefined || !enterHighlightAt(section.key, delta)) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          aria-expanded={isOpen}
          aria-controls={panelId}
          className={`flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-white/80 transition-colors hover:bg-white/5 disabled:cursor-default disabled:hover:bg-transparent ${focusRingClasses}`}
        >
          <span className="text-xs font-semibold uppercase tracking-wider">{groupName}</span>
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/70">
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

  return (
    <section
      ref={containerRef}
      id={stripId}
      style={stripPanelStyle}
      className="relative z-30 mt-2 flex w-[min(40rem,calc(100vw-5rem))] min-w-72 flex-col gap-3 rounded-xl p-3"
      aria-label="Tile candidates"
      onKeyDown={handlePanelKeyDown}
    >
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={candidatesId}
          aria-activedescendant={focusTarget.kind === "input" ? activeOption?.optionId : undefined}
          aria-autocomplete="list"
          value={state.filter}
          onChange={(event) => setFilterText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type or tap a tile"
          aria-label="Filter tile candidates"
          aria-invalid={state.isUnknown}
          aria-describedby={state.isUnknown ? `${unknownId} ${hintId}` : hintId}
          className={`h-10 min-w-0 flex-1 rounded-lg border-2 bg-black/40 px-3 font-mono text-sm outline-none transition-colors placeholder:font-sans placeholder:text-white/55 ${focusRingClasses} ${
            state.isUnknown
              ? "border-amber-400 text-amber-300 focus:border-amber-300"
              : "border-white/15 text-white focus:border-violet-400"
          }`}
        />
        <button
          type="button"
          onClick={onDismiss}
          onKeyDown={(event) => {
            const delta = arrowDelta(event.key);
            if (delta === undefined || !moveHighlightDown(delta)) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          aria-label="Close tile candidates"
          className={`flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 border-white/15 text-white/70 transition-colors hover:bg-white/10 hover:text-white ${focusRingClasses}`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <p id={hintId} className="sr-only">
        Arrow down to start browsing the tiles. Left and right move along a row, up and down move between rows, and
        Enter places the highlighted tile. Arrow down on a group heading opens it, and Tab moves from the group being
        browsed to the next heading.
      </p>

      <output id={statusId} aria-live="polite" className="sr-only">
        {status}
      </output>

      {state.isUnknown && (
        <p id={unknownId} className="text-xs font-semibold text-amber-300">
          No tile fits here by that name.
        </p>
      )}

      <div id={candidatesId} className="flex flex-col gap-3">
        {state.bestNext.length > 0 && (
          <div
            role="listbox"
            {...bandListboxProps(kBestNextBandKey)}
            aria-label="Best next tiles"
            className={`flex flex-wrap gap-2 ${browsedBandClasses}`}
          >
            {renderChips(kBestNextBandKey, state.bestNext)}
          </div>
        )}

        {state.sections.length > 0 && <div className="flex flex-col gap-1.5">{state.sections.map(renderSection)}</div>}
      </div>
    </section>
  );
}
