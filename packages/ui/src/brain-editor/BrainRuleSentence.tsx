import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { SentenceSegment } from "@mindcraft-lang/core/brain/language-service";
import { flattenRuleTiles, projectRuleSentence, whenTriggerWord } from "@mindcraft-lang/core/brain/language-service";
import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocalizer } from "./BrainEditorContext";
import { composePivotReading, composeSentenceReading } from "./sentence-composer";
import {
  changedSentenceSegments,
  type SentenceSegmentIdentity,
  sentenceSegmentIdentities,
} from "./sentence-reflection";

/** How long a changed word stays lit before its highlight fades, in milliseconds. */
const kSentenceHighlightMs = 900;

const noHighlight: ReadonlySet<number> = new Set<number>();

/** The register a word renders in, or undefined for the sentence's plain reading register. */
function sentenceRegister(tileDef: IBrainTileDef | undefined): string | undefined {
  return tileDef?.kind === "variable" ? "variable" : undefined;
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
   * The composer's filter input, rendered at the position the sentence grows
   * from. Present while the rule is armed from its sentence line, which is also
   * what keeps the line rendered for a rule that projects no segments yet, and
   * what puts the line in its composition reading.
   */
  composerInput?: ReactNode;
  /**
   * True while the composer sits on the DO side of a typed pivot, which the line
   * reads as a comma -- preceded by the trigger word when the WHEN side it
   * pivoted from has no words of its own.
   */
  pivotComma?: boolean;
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
 */
export function BrainRuleSentence({ ruleDef, updateCounter, composerInput, pivotComma }: BrainRuleSentenceProps) {
  const { segments: settled, tiles } = useRuleSentence(ruleDef, updateCounter);
  const localizer = useLocalizer();
  const isComposing = composerInput !== undefined;
  const segments = useMemo(() => (isComposing ? composeSentenceReading(settled) : settled), [isComposing, settled]);
  const pivot = useMemo(
    () => (pivotComma ? composePivotReading(segments, whenTriggerWord(localizer)) : []),
    [pivotComma, segments, localizer]
  );
  const identities = useMemo(() => sentenceSegmentIdentities(segments, tiles), [segments, tiles]);
  const previousRef = useRef<SentenceSegmentIdentity[]>([]);
  const [highlighted, setHighlighted] = useState<ReadonlySet<number>>(noHighlight);

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

  if (segments.length === 0 && !isComposing) {
    return null;
  }

  return (
    <p
      className="relative z-10 mt-1.5 ml-11 max-w-2xl font-serif text-sm leading-relaxed text-white/70"
      data-rule-sentence={ruleDef.id()}
    >
      {segments.map((segment: SentenceSegment, index: number) => {
        if (segment.kind !== "word") {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments have no identity beyond their position
            <span key={index}>{segment.text}</span>
          );
        }
        const register = sentenceRegister(tiles[segment.sourceTileIndex]?.tileDef);
        const isLit = highlighted.has(index);
        const registerClass = register === "variable" ? "font-mono text-[0.92em] text-violet-200" : "";
        const litClass = isLit
          ? "rounded-sm bg-amber-200/25 text-white"
          : "rounded-sm bg-transparent transition-colors duration-700";
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: segments have no identity beyond their position
            key={index}
            className={`${registerClass} ${litClass}`.trim()}
            data-sentence-register={register}
            data-sentence-tile-index={segment.sourceTileIndex}
          >
            {segment.text}
          </span>
        );
      })}
      {pivot.length > 0 && (
        <span data-composer-pivot-comma={ruleDef.id()}>{pivot.map((segment) => segment.text).join("")}</span>
      )}
      {composerInput}
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
