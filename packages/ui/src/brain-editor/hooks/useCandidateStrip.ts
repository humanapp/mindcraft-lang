import { List, type ReadonlyBitSet, type UniqueSet } from "@mindcraft-lang/core";
import { type IBrainTileDef, type ITileCatalog, RuleSide } from "@mindcraft-lang/core/brain";
import { suggestTiles, type TileSuggestion, tileSentenceWord } from "@mindcraft-lang/core/brain/language-service";
import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type ArmedTileTarget, useArmedTargetController } from "../ArmedTargetContext";
import { useBrainEditorConfig, useLocalizer } from "../BrainEditorContext";
import {
  arrangeCandidateSubcategories,
  buildStripCandidates,
  type CandidateCommitKey,
  type CandidateEntry,
  type CandidateSection,
  type CandidateSubcategory,
  categoryPriorityCandidateRanker,
  decideCandidateCommit,
  groupStripCandidates,
  mintTextLiteralCandidate,
  offersTextLiteral,
  resolveStripOffering,
  type StripCandidate,
  shouldOrderPagesFirst,
  toCandidateEntries,
} from "../candidate-strip-model";
import { buildInsertionContext } from "../insertion-context";
import { resolveTileVisual } from "../tile-visual-utils";
import { manufactureLiteralTile, manufactureVariableTile } from "./useTileSelection";

/** How many candidates the flat best-next row offers before the accordion takes over. */
export const kBestNextCandidateCount = 6;

/** Inputs {@link useCandidateStrip} resolves the offering from. */
export interface UseCandidateStripOptions {
  /** The rule owning the armed target. */
  ruleDef: BrainRuleDef;
  /** The armed target the offering is computed for; null offers nothing. */
  target: ArmedTileTarget | null;
  availableCapabilities?: ReadonlyBitSet;
  availableOutputKeys?: UniqueSet<string>;
  /** The page editor's update counter; re-queries the oracle when the document changes. */
  updateCounter: number;
  /** Called after each placement the strip completes, whichever commit path made it. */
  onCommitted?: () => void;
}

/** One accordion section of the offering: the whole group, plus the entries matching the filter. */
export interface CandidateStripSection extends Omit<CandidateSection, "candidates"> {
  /**
   * The section's matching entries arranged into provenance clusters. Empty when
   * the filter excludes the whole group.
   */
  readonly subcategories: readonly CandidateSubcategory[];
  /**
   * The section's candidates that match the current filter, in the order the
   * subcategories render them, so the keyboard walks the chips as they are drawn.
   */
  readonly entries: readonly CandidateEntry[];
  /** How many candidates the group holds regardless of the filter. */
  readonly totalCount: number;
}

/** The offering at the armed position plus the filter and commit surface the strip renders. */
export interface CandidateStripState {
  /** The leading cross-category entries, capped at {@link kBestNextCandidateCount}. */
  readonly bestNext: readonly CandidateEntry[];
  /** The filtered offering partitioned into accordion sections. */
  readonly sections: readonly CandidateStripSection[];
  /** The current filter text; every keystroke narrows the offering. */
  readonly filter: string;
  /** True when the filter text names nothing the strip can place, as opposed to naming nothing yet. */
  readonly isUnknown: boolean;
  /** True when the armed position accepts a text literal, so a typed quote opens one. */
  readonly acceptsTextLiteral: boolean;
  /**
   * The candidate a text value of `value` places at the armed position, or
   * undefined when the position accepts no text literal.
   */
  textLiteralCandidate(value: string): StripCandidate | undefined;
  setFilter(next: string): void;
  /** Place `candidate` at the armed position through the target's selection callback. */
  commit(candidate: StripCandidate): void;
  /** Place the candidate with `candidateKey`, ignoring keys absent from the offering. */
  commitByKey(candidateKey: string): void;
  /** The candidate a commit key places, or undefined when the key must not commit. */
  candidateFromKey(key: CandidateCommitKey): StripCandidate | undefined;
}

/**
 * Query the suggestion oracle for the armed position and expose the filter and
 * commit surface the inline candidate strip renders. Committing routes through
 * the armed target's selection callback, so the placement runs the same command
 * and factory-deferral path the caller armed with. A minted candidate is
 * manufactured and registered first, so what reaches that callback is always a
 * catalog tile. In append mode the target is re-armed after each placement so
 * composition continues at the next position.
 */
export function useCandidateStrip({
  ruleDef,
  target,
  availableCapabilities,
  availableOutputKeys,
  updateCounter,
  onCommitted,
}: UseCandidateStripOptions): CandidateStripState {
  const editorConfig = useBrainEditorConfig();
  const { brainServices, tileCatalogs } = editorConfig;
  const armedTarget = useArmedTargetController();
  const [filter, setFilter] = useState("");
  const [commitCounter, setCommitCounter] = useState(0);

  // Re-arming for a different position starts a fresh word in progress.
  // biome-ignore lint/correctness/useExhaustiveDependencies: target is an intentional trigger signal
  useEffect(() => {
    setFilter("");
  }, [target]);

  const catalogs = useMemo(() => {
    const list = tileCatalogs ? List.from<ITileCatalog>(tileCatalogs) : List.empty<ITileCatalog>();
    const localCatalog = ruleDef.brain()?.catalog();
    if (localCatalog) list.push(localCatalog);
    return list.asReadonly();
  }, [ruleDef, tileCatalogs]);

  // A placeable tile's chip carries the word its sentence reads it with. A
  // factory manufactures the tile that gets placed, and keeps the label the
  // host app presents it under.
  const localizer = useLocalizer();
  const labelOf = useCallback(
    (tileDef: IBrainTileDef) =>
      tileDef.kind === "factory"
        ? resolveTileVisual(editorConfig, tileDef).label
        : tileSentenceWord(tileDef, localizer),
    [editorConfig, localizer]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: updateCounter and commitCounter are intentional re-query signals
  const { candidates, pagesFirst } = useMemo(() => {
    if (!target) return { candidates: [] as StripCandidate[], pagesFirst: false };
    const tileSet = target.side === RuleSide.When ? ruleDef.when() : ruleDef.do();
    const isInsert = target.mode === "insert";
    const isReplace = target.mode === "replace";
    const existingTiles = isInsert ? tileSet.tiles().slice(0, target.tileIndex ?? 0) : tileSet.tiles();
    const replaceTileIndex = isReplace ? target.tileIndex : undefined;
    const context = buildInsertionContext({
      side: target.side,
      expr: isInsert ? undefined : tileSet.expr(),
      replaceTileIndex,
      availableCapabilities,
      availableOutputKeys,
      ruleDef,
      existingTiles,
    });
    const result = brainServices
      ? suggestTiles(context, catalogs, brainServices)
      : { exact: List.empty<TileSuggestion>(), withConversion: List.empty<TileSuggestion>() };
    return {
      candidates: buildStripCandidates(result, labelOf),
      pagesFirst: shouldOrderPagesFirst(existingTiles.toArray(), replaceTileIndex),
    };
  }, [
    ruleDef,
    target,
    availableCapabilities,
    availableOutputKeys,
    catalogs,
    brainServices,
    labelOf,
    updateCounter,
    commitCounter,
  ]);

  const ranked = useMemo(
    () => categoryPriorityCandidateRanker(candidates, target, { projectNamespace: editorConfig.projectNamespace }),
    [candidates, target, editorConfig.projectNamespace]
  );

  const offering = useMemo(() => resolveStripOffering(ranked, filter, labelOf), [ranked, filter, labelOf]);
  const { offered, visible } = offering;

  const bestNext = useMemo(() => toCandidateEntries(visible.slice(0, kBestNextCandidateCount)), [visible]);
  const sections = useMemo(() => {
    const matchesByGroup = new Map(
      groupStripCandidates(visible, pagesFirst).map((section) => [section.key, section.candidates])
    );
    const provenance = { projectNamespace: editorConfig.projectNamespace };
    return groupStripCandidates(offered, pagesFirst).map((section) => {
      const subcategories = arrangeCandidateSubcategories(
        toCandidateEntries(matchesByGroup.get(section.key) ?? []),
        provenance,
        editorConfig.libraries
      );
      return {
        key: section.key,
        group: section.group,
        subcategories,
        entries: subcategories.flatMap((subcategory) => subcategory.entries),
        totalCount: section.candidates.length,
      };
    });
  }, [offered, visible, pagesFirst, editorConfig.projectNamespace, editorConfig.libraries]);

  const commit = useCallback(
    (candidate: StripCandidate) => {
      if (!target) return;
      let tileDef = candidate.tileDef;
      if (candidate.origin.kind === "minted-literal") {
        const registered = manufactureLiteralTile(
          candidate.origin.factoryTileDef,
          ruleDef.brain()?.catalog(),
          candidate.origin.value,
          candidate.origin.displayFormat
        );
        if (!registered) return;
        tileDef = registered;
      } else if (candidate.origin.kind === "minted-variable") {
        const registered = manufactureVariableTile(
          candidate.origin.factoryTileDef,
          ruleDef.brain()?.catalog(),
          candidate.origin.varName
        );
        if (!registered) return;
        tileDef = registered;
      }
      const completed = target.onTileSelected(tileDef);
      setFilter("");
      if (!completed) return;
      onCommitted?.();
      setCommitCounter((count) => count + 1);
      // Appending continues at the next grammar position: re-arm the same
      // target so the strip re-queries the oracle and stays open. Insert and
      // replace complete with the placement.
      if (target.mode === "append") armedTarget.arm(target);
    },
    [ruleDef, target, armedTarget, onCommitted]
  );

  const commitByKey = useCallback(
    (candidateKey: string) => {
      const candidate = visible.find((entry) => entry.key === candidateKey);
      if (candidate) commit(candidate);
    },
    [visible, commit]
  );

  const candidateFromKey = useCallback(
    (key: CandidateCommitKey) => decideCandidateCommit(visible, filter, key),
    [visible, filter]
  );

  const acceptsTextLiteral = useMemo(() => offersTextLiteral(ranked), [ranked]);
  const textLiteralCandidate = useCallback(
    (value: string) => mintTextLiteralCandidate(ranked, value, labelOf),
    [ranked, labelOf]
  );

  return {
    bestNext,
    sections,
    filter,
    isUnknown: offering.isUnknown,
    acceptsTextLiteral,
    textLiteralCandidate,
    setFilter,
    commit,
    commitByKey,
    candidateFromKey,
  };
}
