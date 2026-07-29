import { assertUnreachable } from "@mindcraft-lang/core";
import {
  CoreCapabilityBits,
  type IBrainTileDef,
  isCoreLiteralFactoryTileId,
  isVariableFactoryTileId,
  RuleSide,
  TilePlacement,
} from "@mindcraft-lang/core/brain";
import type { TileSuggestion, TileSuggestionResult } from "@mindcraft-lang/core/brain/language-service";
import type { BrainTileFactoryDef, BrainTileOperatorDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import { CoreHostActions, CoreTypeIds, mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/runtime";
import type { ArmedTileTarget } from "./ArmedTargetContext";
import { groupTilesByLibrary, type TileSourceLibrary, tileSourceNamespace } from "./tile-library-groups";

/** The category a candidate is filed under in the strip's accordion. */
export type TileCandidateGroup =
  | "actuator"
  | "sensor"
  | "output"
  | "function"
  | "parameter+modifier"
  | "variable"
  | "accessor"
  | "literal"
  | "page"
  | "operator+controlFlow"
  | "other";

/** Display heading for each {@link TileCandidateGroup}. */
export const tileCandidateGroupNames: Record<TileCandidateGroup, string> = {
  actuator: "Actuators",
  sensor: "Sensors",
  output: "Outputs",
  function: "Functions",
  "parameter+modifier": "Parameters",
  variable: "Variables",
  accessor: "Field Accessors",
  literal: "Literals",
  page: "Pages",
  "operator+controlFlow": "Operators",
  other: "Other",
};

function allTileCandidateGroups<const T extends readonly TileCandidateGroup[]>(
  groups: T & ([TileCandidateGroup] extends [T[number]] ? T : never)
): T {
  return groups;
}

const defaultGroupOrder = allTileCandidateGroups([
  "actuator",
  "sensor",
  "output",
  "function",
  "parameter+modifier",
  "variable",
  "accessor",
  "literal",
  "page",
  "operator+controlFlow",
  "other",
]);

const pagesFirstGroupOrder = allTileCandidateGroups([
  "page",
  "literal",
  "variable",
  "output",
  "function",
  "actuator",
  "sensor",
  "parameter+modifier",
  "accessor",
  "operator+controlFlow",
  "other",
]);

/** The {@link TileCandidateGroup} a tile is filed under, keyed by kind, placement, and capability. */
export function tileCandidateGroup(tileDef: IBrainTileDef): TileCandidateGroup {
  if (
    tileDef.kind === "sensor" &&
    tileDef.placement !== undefined &&
    (tileDef.placement & TilePlacement.Inline) !== 0
  ) {
    if (tileDef.capabilities().get(CoreCapabilityBits.PageSensor) !== 0) return "page";
    return "function";
  }
  if (tileDef.kind === "factory") {
    if (tileDef.tileId.includes("var.factory")) return "variable";
    if (tileDef.tileId.includes("lit.factory")) return "literal";
    return "other";
  }
  switch (tileDef.kind) {
    case "parameter":
    case "modifier":
      return "parameter+modifier";
    case "operator":
    case "controlFlow":
      return "operator+controlFlow";
    case "actuator":
    case "sensor":
    case "output":
    case "variable":
    case "accessor":
    case "literal":
    case "page":
      return tileDef.kind;
    case "undefined":
    case "missing":
      return "other";
    default:
      return assertUnreachable(tileDef.kind);
  }
}

/**
 * True when the tile preceding the armed position switches pages, in which
 * case page tiles lead the group order.
 */
export function shouldOrderPagesFirst(
  existingTiles: readonly IBrainTileDef[],
  replaceTileIndex: number | undefined
): boolean {
  const precedingIndex = replaceTileIndex != null ? replaceTileIndex - 1 : existingTiles.length - 1;
  if (precedingIndex < 0) return false;
  return existingTiles[precedingIndex]?.tileId === mkActuatorTileId(CoreHostActions.SwitchPage.key);
}

/**
 * Where a candidate's tile came from:
 *
 * - `suggested` -- the suggestion oracle offered it
 * - `minted-literal` -- typed digits mint it, carrying the value it places
 * - `minted-variable` -- a typed word mints it, carrying the name it places
 *
 * A minted candidate carries the factory that manufactures its tile, so
 * committing it runs the same manufacture and registration path the factory
 * tiles run.
 */
export type CandidateOrigin =
  | { readonly kind: "suggested" }
  | { readonly kind: "minted-literal"; readonly factoryTileDef: BrainTileFactoryDef; readonly value: unknown }
  | { readonly kind: "minted-variable"; readonly factoryTileDef: BrainTileFactoryDef; readonly varName: string };

/** One tile offered at the armed position. */
export interface StripCandidate {
  /** Stable identity within one offering; unique across the candidate list. */
  readonly key: string;
  /** The tile placed when this candidate commits. Minted candidates carry an unregistered preview def. */
  readonly tileDef: IBrainTileDef;
  /** Word-chip label, resolved by the caller from the tile's visual. */
  readonly label: string;
  readonly group: TileCandidateGroup;
  /** True when the tile fits the position only through a conversion. */
  readonly viaConversion: boolean;
  readonly origin: CandidateOrigin;
}

const suggestedOrigin: CandidateOrigin = { kind: "suggested" };

function toCandidate(suggestion: TileSuggestion, label: string, viaConversion: boolean): StripCandidate {
  return {
    key: viaConversion ? `conv:${suggestion.tileDef.tileId}` : suggestion.tileDef.tileId,
    tileDef: suggestion.tileDef,
    label,
    group: tileCandidateGroup(suggestion.tileDef),
    viaConversion,
    origin: suggestedOrigin,
  };
}

/**
 * Flatten a {@link TileSuggestionResult} into candidates in oracle order:
 * exact matches first as returned, then conversion matches ordered by
 * conversion cost. `labelOf` supplies each tile's word-chip label.
 */
export function buildStripCandidates(
  result: TileSuggestionResult,
  labelOf: (tileDef: IBrainTileDef) => string
): StripCandidate[] {
  const candidates: StripCandidate[] = [];
  for (let i = 0; i < result.exact.size(); i++) {
    const suggestion = result.exact.get(i);
    candidates.push(toCandidate(suggestion, labelOf(suggestion.tileDef), false));
  }
  const conversions: TileSuggestion[] = [];
  for (let i = 0; i < result.withConversion.size(); i++) {
    conversions.push(result.withConversion.get(i));
  }
  conversions.sort((a, b) => a.conversionCost - b.conversionCost);
  for (const suggestion of conversions) {
    candidates.push(toCandidate(suggestion, labelOf(suggestion.tileDef), true));
  }
  return candidates;
}

/** One accordion section: the candidates of a single group, whether they fit directly or by conversion. */
export interface CandidateSection {
  /** Stable identity of the section, unique within one offering. */
  readonly key: string;
  readonly group: TileCandidateGroup;
  readonly candidates: readonly StripCandidate[];
}

/**
 * Partition candidates into one accordion section per group, in group order.
 * Candidate order within a section is the input order. `pagesFirst` leads with
 * page tiles.
 */
export function groupStripCandidates(
  candidates: readonly StripCandidate[],
  pagesFirst: boolean = false
): CandidateSection[] {
  const order = pagesFirst ? pagesFirstGroupOrder : defaultGroupOrder;
  const sections: CandidateSection[] = [];
  for (const group of order) {
    const items = candidates.filter((c) => c.group === group);
    if (items.length === 0) continue;
    sections.push({ key: group, group, candidates: items });
  }
  return sections;
}

/** Fuzzy character-bag match: every character in `filter` exists in `text` (case-insensitive, order-independent). */
function fuzzyTileMatch(filter: string, text: string): boolean {
  const lowerFilter = filter.toLowerCase();
  const pool = text.toLowerCase().split("");
  for (let fi = 0; fi < lowerFilter.length; fi++) {
    const idx = pool.indexOf(lowerFilter[fi]);
    if (idx === -1) return false;
    pool.splice(idx, 1);
  }
  return true;
}

/**
 * How well a label matches filter text, best quality first:
 *
 * - "exact" -- the whole label is the filter text
 * - "prefix" -- the label starts with the filter text
 * - "substring" -- the filter text appears contiguously inside the label
 * - "fuzzy" -- every character of the filter text appears in the label, in any order
 */
type LabelMatchQuality = "exact" | "prefix" | "substring" | "fuzzy";

const labelMatchRank: Record<LabelMatchQuality, number> = { exact: 0, prefix: 1, substring: 2, fuzzy: 3 };

/**
 * The quality with which `label` matches `filter`, or undefined when the label
 * does not match at all. Both sides are compared trimmed and case-insensitively;
 * empty filter text matches nothing, so callers handle it before classifying.
 */
function classifyLabelMatch(filter: string, label: string): LabelMatchQuality | undefined {
  const needle = filter.trim().toLowerCase();
  if (needle.length === 0) return undefined;
  const haystack = label.trim().toLowerCase();
  if (haystack === needle) return "exact";
  if (haystack.startsWith(needle)) return "prefix";
  if (haystack.includes(needle)) return "substring";
  return fuzzyTileMatch(needle, haystack) ? "fuzzy" : undefined;
}

/**
 * The candidates whose labels match `filter`, best match first: exact labels,
 * then prefixes, then substrings, then fuzzy matches, with candidates of equal
 * quality left in input order. An empty filter matches everything, in input order.
 */
export function filterStripCandidates(candidates: readonly StripCandidate[], filter: string): StripCandidate[] {
  const trimmed = filter.trim();
  if (trimmed.length === 0) return [...candidates];
  const matched: { candidate: StripCandidate; rank: number; index: number }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const quality = classifyLabelMatch(trimmed, candidates[i].label);
    if (quality === undefined) continue;
    matched.push({ candidate: candidates[i], rank: labelMatchRank[quality], index: i });
  }
  matched.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.index - b.index));
  return matched.map((entry) => entry.candidate);
}

/** The key the user pressed to commit the word in progress. */
export type CandidateCommitKey = "enter" | "tab" | "space";

/**
 * The candidate a commit key places, or undefined when the key must not
 * commit. Enter and Tab take the top visible candidate, which is the best
 * match once `visible` comes from {@link filterStripCandidates}; Space takes an
 * exact label match, or a unique prefix match when no label matches exactly.
 * Empty filter text and text matching no candidate never commit.
 *
 * A minted variable is committed by a key only when the filter text declares
 * variable intent with the `$` accelerator, so a mistyped word never becomes a
 * variable; without it the mint is placed by tap or by highlighting its chip.
 */
export function decideCandidateCommit(
  visible: readonly StripCandidate[],
  filter: string,
  key: CandidateCommitKey
): StripCandidate | undefined {
  const intent = parseStripFilter(filter);
  if (intent.text.length === 0) return undefined;
  const eligible = intent.variableIntent
    ? visible
    : visible.filter((candidate) => candidate.origin.kind !== "minted-variable");
  if (eligible.length === 0) return undefined;
  if (key === "enter" || key === "tab") return eligible[0];
  const exact = eligible.find((candidate) => classifyLabelMatch(intent.text, candidate.label) === "exact");
  if (exact) return exact;
  const prefixed = eligible.filter((candidate) => classifyLabelMatch(intent.text, candidate.label) === "prefix");
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

/** True when the user has typed text that matches no candidate; such text can never commit. */
export function isUnknownFilterText(visible: readonly StripCandidate[], filter: string): boolean {
  return filter.trim().length > 0 && visible.length === 0;
}

const numericLiteralPattern = /^-?(\d+(\.\d+)?|\.\d+)$/;

/** The core number-literal factory among `candidates`, or undefined when the armed position accepts no numeric literal. */
function findNumberLiteralFactory(candidates: readonly StripCandidate[]): BrainTileFactoryDef | undefined {
  for (const candidate of candidates) {
    const tileDef = candidate.tileDef;
    if (tileDef.kind !== "factory" || !isCoreLiteralFactoryTileId(tileDef.tileId)) continue;
    const factoryTileDef = tileDef as BrainTileFactoryDef;
    if (factoryTileDef.producedDataType === CoreTypeIds.Number) return factoryTileDef;
  }
  return undefined;
}

/**
 * The literal candidate minted from typed digits: present when `filter` is a
 * complete number and the armed position accepts a numeric literal. The
 * candidate's tile is a preview def manufactured by the factory; committing it
 * re-manufactures through the catalog so the placed tile is registered.
 */
export function mintNumberLiteralCandidate(
  candidates: readonly StripCandidate[],
  filter: string,
  labelOf: (tileDef: IBrainTileDef) => string
): StripCandidate | undefined {
  const trimmed = filter.trim();
  if (!numericLiteralPattern.test(trimmed)) return undefined;
  const factoryTileDef = findNumberLiteralFactory(candidates);
  if (!factoryTileDef) return undefined;
  const value = Number(trimmed);
  const preview = factoryTileDef.manufacture(factoryTileDef, { value });
  if (!preview) return undefined;
  return {
    key: `mint:${preview.tileId}`,
    tileDef: preview,
    label: labelOf(preview),
    group: "literal",
    viaConversion: false,
    origin: { kind: "minted-literal", factoryTileDef, value },
  };
}

/**
 * The filter text split into the variable gesture and the text it filters by. A
 * leading `$` declares that the word being typed names a variable; it is an
 * input gesture only and never reaches a placed tile.
 */
export interface StripFilterIntent {
  /** True when the text opened with the `$` accelerator. */
  readonly variableIntent: boolean;
  /** The text the offering is filtered by: the text after `$`, or the whole text. */
  readonly text: string;
}

/** Split `filter` into its {@link StripFilterIntent}. */
export function parseStripFilter(filter: string): StripFilterIntent {
  const trimmed = filter.trim();
  if (!trimmed.startsWith("$")) return { variableIntent: false, text: trimmed };
  return { variableIntent: true, text: trimmed.slice(1).trim() };
}

/** True when `name` names a variable the create-variable path would accept. */
function isMintableVariableName(name: string): boolean {
  return name.trim().length > 0;
}

/** True when the candidate places an existing variable, as opposed to creating one. */
function isExistingVariableCandidate(candidate: StripCandidate): boolean {
  return candidate.tileDef.kind === "variable";
}

/**
 * The variable factories among `candidates`, one per type the armed position
 * accepts, in offering order. A type the oracle offers twice keeps its first
 * factory, and a factory reached only by a conversion carries that on the
 * candidate it was found on.
 */
function acceptedVariableFactories(candidates: readonly StripCandidate[]): StripCandidate[] {
  const byType = new Map<string, StripCandidate>();
  for (const candidate of candidates) {
    const tileDef = candidate.tileDef;
    if (tileDef.kind !== "factory" || !isVariableFactoryTileId(tileDef.tileId)) continue;
    const producedDataType = (tileDef as BrainTileFactoryDef).producedDataType;
    if (!producedDataType || byType.has(producedDataType)) continue;
    byType.set(producedDataType, candidate);
  }
  return [...byType.values()];
}

/** True when `candidates` already offers a variable named `name` of type `varType`. */
function offersVariable(candidates: readonly StripCandidate[], name: string, varType: string): boolean {
  const needle = name.trim().toLowerCase();
  return candidates.some((candidate) => {
    if (!isExistingVariableCandidate(candidate)) return false;
    const varTileDef = candidate.tileDef as BrainTileVariableDef;
    return varTileDef.varType === varType && varTileDef.varName.trim().toLowerCase() === needle;
  });
}

/**
 * The variable candidates minted from the typed word `name`: one per type the
 * armed position accepts, in the order the position offers those types, so the
 * minted type is always the oracle's own. A type that already holds a variable
 * of this name mints nothing, since that variable is the answer. Each
 * candidate's tile is a preview def manufactured by the factory; committing it
 * re-manufactures through the catalog so the placed tile is registered.
 */
export function mintVariableCandidates(
  candidates: readonly StripCandidate[],
  name: string,
  labelOf: (tileDef: IBrainTileDef) => string
): StripCandidate[] {
  const varName = name.trim();
  if (!isMintableVariableName(varName)) return [];
  const minted: StripCandidate[] = [];
  for (const factory of acceptedVariableFactories(candidates)) {
    const factoryTileDef = factory.tileDef as BrainTileFactoryDef;
    const producedDataType = factoryTileDef.producedDataType as string;
    if (offersVariable(candidates, varName, producedDataType)) continue;
    const preview = factoryTileDef.manufacture(factoryTileDef, { name: varName });
    if (!preview) continue;
    minted.push({
      key: `mint:var:${producedDataType}:${varName}`,
      tileDef: preview,
      label: labelOf(preview),
      group: "variable",
      viaConversion: factory.viaConversion,
      origin: { kind: "minted-variable", factoryTileDef, varName },
    });
  }
  return minted;
}

/**
 * `matches` with `mints` spliced in behind the exact and prefix matches that
 * lead it, so a name that is also the start of an existing variable's name
 * offers that variable first and the new one right after it.
 */
function demoteMintsBehindMatches(
  matches: readonly StripCandidate[],
  mints: readonly StripCandidate[],
  name: string
): StripCandidate[] {
  if (mints.length === 0) return [...matches];
  let at = 0;
  while (at < matches.length) {
    const quality = classifyLabelMatch(name, matches[at].label);
    if (quality !== "exact" && quality !== "prefix") break;
    at++;
  }
  return [...matches.slice(0, at), ...mints, ...matches.slice(at)];
}

/** What the strip offers for one filter text over the position's ranked candidates. */
export interface StripOffering {
  /** Every candidate the position offers, minted entries included, before the filter narrows it. */
  readonly offered: readonly StripCandidate[];
  /** The candidates the filter text leaves, best match first, with the minted entries in their ranked place. */
  readonly visible: readonly StripCandidate[];
  /** True when the filter text names nothing the strip can place. */
  readonly isUnknown: boolean;
}

/**
 * The offering `filter` leaves of the ranked `candidates`, with the candidates
 * the typed text mints merged into it:
 *
 * - typed digits mint a literal, which commits like any other candidate
 * - a typed word that matches nothing mints a variable per accepted type, which
 *   the unknown state stands alongside because only a tap or a highlighted
 *   chip commits it
 * - text opening with `$` scopes the offering to the existing variables matching
 *   the rest of the text, plus a mint of every accepted type the name is free at
 */
export function resolveStripOffering(
  candidates: readonly StripCandidate[],
  filter: string,
  labelOf: (tileDef: IBrainTileDef) => string
): StripOffering {
  const intent = parseStripFilter(filter);
  const literalMint = intent.variableIntent ? undefined : mintNumberLiteralCandidate(candidates, intent.text, labelOf);
  const offered = literalMint ? [literalMint, ...candidates] : [...candidates];
  const scope = intent.variableIntent ? offered.filter(isExistingVariableCandidate) : offered;
  const matches = filterStripCandidates(scope, intent.text);
  const mints =
    intent.variableIntent || matches.length === 0 ? mintVariableCandidates(candidates, intent.text, labelOf) : [];
  return {
    offered: [...offered, ...mints],
    visible: demoteMintsBehindMatches(matches, mints, intent.text),
    isUnknown: !(intent.variableIntent && mints.length > 0) && isUnknownFilterText(matches, filter),
  };
}

/**
 * The layer a candidate's tile is defined at, nearest first:
 *
 * - `application` -- the host application's own platform tiles, plus the tiles
 *   compiled from the active project's TypeScript
 * - `library` -- tiles compiled from an installed library
 * - `core` -- the language's built-in tiles: pages, timeouts, operators,
 *   control flow, and the variable and literal machinery
 */
export type CandidateProvenanceBand = "application" | "library" | "core";

const candidateProvenanceBandOrder: Record<CandidateProvenanceBand, number> = {
  application: 0,
  library: 1,
  core: 2,
};

/** Tile ids of the sensor and actuator tiles core registers for its built-in host actions. */
const coreHostActionTileIds: ReadonlySet<string> = new Set(
  Object.values(CoreHostActions).flatMap((action) => [mkSensorTileId(action.key), mkActuatorTileId(action.key)])
);

/** What {@link candidateProvenanceBand} resolves a tile's defining layer against. */
export interface CandidateProvenanceContext {
  /**
   * Namespace of the active project. Tiles compiled from the project's own
   * TypeScript carry it as their identity namespace. When omitted, no tile is
   * attributed to the project and every namespaced tile bands as `library`.
   */
  readonly projectNamespace?: string;
}

/**
 * The layer `tileDef` is defined at. A tile carrying an identity namespace is
 * compiled code, banded by whether that namespace is the active project's own.
 * A sensor or actuator without one is a core built-in when its tile id is one of
 * core's host actions, and an application platform tile otherwise. Every other
 * tile kind bands as `core`.
 */
export function candidateProvenanceBand(
  tileDef: IBrainTileDef,
  context: CandidateProvenanceContext
): CandidateProvenanceBand {
  const namespace = tileSourceNamespace(tileDef);
  if (namespace !== undefined) {
    return namespace === context.projectNamespace ? "application" : "library";
  }
  if (tileDef.kind === "sensor" || tileDef.kind === "actuator") {
    return coreHostActionTileIds.has(tileDef.tileId) ? "core" : "application";
  }
  return "core";
}

/**
 * Reorders and emphasizes the offering at an armed position. The strip's
 * default is {@link categoryPriorityCandidateRanker}. `provenance` supplies the
 * project identity a ranker needs to band candidates by defining layer; an
 * omitted context bands every namespaced tile as `library`.
 */
export type CandidateRanker = (
  candidates: readonly StripCandidate[],
  target: ArmedTileTarget | null,
  provenance?: CandidateProvenanceContext
) => readonly StripCandidate[];

/** A {@link CandidateRanker} that returns the candidates in oracle order, unchanged. */
export const identityCandidateRanker: CandidateRanker = (candidates) => candidates;

/**
 * The priority tiers {@link categoryPriorityCandidateRanker} orders by, best first:
 *
 * - `leading` -- the group a leading position opens with: sensors on the WHEN
 *   side, actuators on the DO side
 * - `content` -- every other tile that places concrete content, infix
 *   operators included
 * - `factory` -- create-variable factory tiles, which place a tile only after
 *   the new variable is named
 * - `structural` -- bare structure: grouping parens and prefix or postfix
 *   operators, which read as nothing until an operand joins them
 */
type CandidateRankTier = "leading" | "content" | "factory" | "structural";

const candidateRankTierOrder: Record<CandidateRankTier, number> = {
  leading: 0,
  content: 1,
  factory: 2,
  structural: 3,
};

/** True when the tile places bare structure: a grouping paren, or a prefix or postfix operator. */
function isBareStructuralTile(tileDef: IBrainTileDef): boolean {
  if (tileDef.kind === "controlFlow") return true;
  if (tileDef.kind !== "operator") return false;
  const fixity = (tileDef as BrainTileOperatorDef).op.parse.fixity;
  return fixity === "prefix" || fixity === "postfix";
}

/** True when no tile precedes the armed position on its side. */
function isLeadingPosition(target: ArmedTileTarget): boolean {
  if (target.mode !== "append") return (target.tileIndex ?? 0) === 0;
  const tileSet = target.side === RuleSide.When ? target.ruleDef.when() : target.ruleDef.do();
  return tileSet.tiles().size() === 0;
}

/** The group that leads the offering at `target`, or undefined when the position is not a leading one. */
function leadingGroupFor(target: ArmedTileTarget | null): TileCandidateGroup | undefined {
  if (!target || !isLeadingPosition(target)) return undefined;
  return target.side === RuleSide.When ? "sensor" : "actuator";
}

/** The tier `candidate` ranks in, given the group that leads the offering. */
function candidateRankTier(candidate: StripCandidate, leadingGroup: TileCandidateGroup | undefined): CandidateRankTier {
  if (isBareStructuralTile(candidate.tileDef)) return "structural";
  if (candidate.tileDef.kind === "factory" && candidate.group === "variable") return "factory";
  return candidate.group === leadingGroup ? "leading" : "content";
}

/**
 * The strip's default {@link CandidateRanker}: a pure, deterministic ordering
 * by category priority, then by provenance. Sensors lead an empty WHEN side and
 * actuators lead an empty DO side; bare structural tokens and create-variable
 * factories fall behind every concrete content tile. Inside one tier, the
 * nearest defining layer leads: application tiles, then library tiles, then core
 * built-ins. Candidates of one tier and band keep the oracle's relative order.
 */
export const categoryPriorityCandidateRanker: CandidateRanker = (candidates, target, provenance) => {
  const leadingGroup = leadingGroupFor(target);
  const context = provenance ?? {};
  const ranked = candidates.map((candidate, index) => ({
    candidate,
    tier: candidateRankTierOrder[candidateRankTier(candidate, leadingGroup)],
    band: candidateProvenanceBandOrder[candidateProvenanceBand(candidate.tileDef, context)],
    index,
  }));
  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.band !== b.band) return a.band - b.band;
    return a.index - b.index;
  });
  return ranked.map((entry) => entry.candidate);
};

/**
 * How a candidate's chip is drawn:
 *
 * - `seated` -- a tile the position already holds, offered as it will be placed
 * - `minting` -- a variable the typed word creates, drawn as the new tile it makes
 */
export type CandidatePresentation = "seated" | "minting";

/** A candidate paired with the presentation its chip renders in. */
export interface CandidateEntry {
  readonly candidate: StripCandidate;
  readonly presentation: CandidatePresentation;
}

/** The presentation `candidate` renders in, keyed by where its tile came from. */
function candidatePresentation(candidate: StripCandidate): CandidatePresentation {
  return candidate.origin.kind === "minted-variable" ? "minting" : "seated";
}

/** Pair each candidate with its presentation, preserving order. */
export function toCandidateEntries(candidates: readonly StripCandidate[]): CandidateEntry[] {
  return candidates.map((candidate) => ({ candidate, presentation: candidatePresentation(candidate) }));
}

/** Heading of the subcategory holding the host application's own tiles. */
const kApplicationSubcategoryHeading = "Application";

/** Heading of the subcategory holding the language's built-in tiles. */
const kCoreSubcategoryHeading = "Core";

/** One provenance cluster of an open accordion section: the chips of a single defining layer. */
export interface CandidateSubcategory {
  /** Stable identity of the cluster within its section. */
  readonly key: string;
  /** The defining layer the cluster holds, as {@link candidateProvenanceBand} resolves it. */
  readonly band: CandidateProvenanceBand;
  /** Heading naming the cluster: an installed library's display name, or the layer's own name. */
  readonly heading: string;
  /** The chips of the cluster: those that fit directly, then those that fit by conversion. */
  readonly entries: readonly CandidateEntry[];
}

/** The entries that fit directly, in input order, followed by those that fit by conversion. */
function directEntriesFirst(entries: readonly CandidateEntry[]): CandidateEntry[] {
  return [
    ...entries.filter((entry) => !entry.candidate.viaConversion),
    ...entries.filter((entry) => entry.candidate.viaConversion),
  ];
}

/**
 * Arrange one section's chips into provenance clusters, in display order: the
 * application's own tiles first, then one cluster per installed library ordered
 * by display name, then the core built-ins. A cluster holds its direct chips in
 * the input order, followed by its via-conversion chips. Only layers with a chip
 * produce a cluster, so a single-provenance section arranges into one cluster
 * and a filtered-out layer disappears. An entry whose namespace names no
 * installed library files under the core cluster.
 */
export function arrangeCandidateSubcategories(
  entries: readonly CandidateEntry[],
  provenance: CandidateProvenanceContext,
  libraries: readonly TileSourceLibrary[] | undefined
): CandidateSubcategory[] {
  const byLibrary = groupTilesByLibrary(entries, (entry) => entry.candidate.tileDef, libraries);
  const application: CandidateEntry[] = [];
  const core: CandidateEntry[] = [];
  for (const entry of byLibrary.unattributed) {
    const band = candidateProvenanceBand(entry.candidate.tileDef, provenance);
    (band === "application" ? application : core).push(entry);
  }
  const clusters: CandidateSubcategory[] = [];
  if (application.length > 0) {
    clusters.push({
      key: "application",
      band: "application",
      heading: kApplicationSubcategoryHeading,
      entries: directEntriesFirst(application),
    });
  }
  for (const cluster of byLibrary.clusters) {
    clusters.push({
      key: `library:${cluster.library.coordinate}`,
      band: "library",
      heading: cluster.library.name,
      entries: directEntriesFirst(cluster.items),
    });
  }
  if (core.length > 0) {
    clusters.push({
      key: "core",
      band: "core",
      heading: kCoreSubcategoryHeading,
      entries: directEntriesFirst(core),
    });
  }
  return clusters;
}

/** Band key of the strip's leading cross-category row of chips. */
export const kBestNextBandKey = "best";

/** One rendered row of candidate chips: the best-next row, or one open accordion section. */
export interface StripOptionBand {
  /** Identity of the band, unique among the bands of one render. */
  readonly key: string;
  /** The chips the band renders, in display order. */
  readonly entries: readonly CandidateEntry[];
}

/** One rendered chip, addressable by the active-descendant highlight. */
export interface StripOption {
  /** DOM id of the chip element, unique within one strip. */
  readonly optionId: string;
  /** Band the chip renders in. */
  readonly bandKey: string;
  /** Key of the candidate the chip commits. */
  readonly candidateKey: string;
}

/**
 * Encode `value` so it is safe in a DOM id: every character outside
 * `[A-Za-z0-9]` becomes an underscore followed by its four-digit hex code
 * point. Distinct inputs always encode to distinct output.
 */
function encodeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, (char) => `_${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** DOM id of the chip that offers `candidateKey` in the band `bandKey` of the strip `stripId`. */
export function stripOptionId(stripId: string, bandKey: string, candidateKey: string): string {
  return `${stripId}-${encodeIdPart(bandKey)}-${encodeIdPart(candidateKey)}`;
}

/**
 * DOM id of the element the band `bandKey` renders its chips into: the
 * `role="listbox"` container while the band shows its chips, and the collapsed
 * placeholder an accordion header points `aria-controls` at while it is closed.
 */
export function stripBandPanelId(stripId: string, bandKey: string): string {
  return `${stripId}-panel-${encodeIdPart(bandKey)}`;
}

/**
 * DOM id of the heading naming the subcategory `subcategoryKey` inside the band
 * `bandKey`, which the subcategory's group points `aria-labelledby` at.
 */
export function stripSubcategoryHeadingId(stripId: string, bandKey: string, subcategoryKey: string): string {
  return `${stripId}-${encodeIdPart(bandKey)}-sub-${encodeIdPart(subcategoryKey)}`;
}

/**
 * Every chip the strip renders, in the order the highlight walks them: the
 * best-next row first, then the chips of each open section in band order.
 */
export function visibleStripOptions(stripId: string, bands: readonly StripOptionBand[]): StripOption[] {
  const options: StripOption[] = [];
  for (const band of bands) {
    for (const entry of band.entries) {
      options.push({
        optionId: stripOptionId(stripId, band.key, entry.candidate.key),
        bandKey: band.key,
        candidateKey: entry.candidate.key,
      });
    }
  }
  return options;
}

/** The option `activeOptionId` addresses, or undefined when no rendered chip carries that id. */
export function activeStripOption(
  options: readonly StripOption[],
  activeOptionId: string | undefined
): StripOption | undefined {
  if (activeOptionId === undefined) return undefined;
  return options.find((option) => option.optionId === activeOptionId);
}

/**
 * The band key of the option `activeOptionId` addresses, or undefined when no
 * rendered chip carries that id.
 */
export function bandOfStripOption(
  options: readonly StripOption[],
  activeOptionId: string | undefined
): string | undefined {
  return activeStripOption(options, activeOptionId)?.bandKey;
}

/**
 * The element the active-descendant highlight is anchored on:
 *
 * - `typing` -- the filter box, which the user is typing into
 * - `browsing` -- the listbox of the band whose chips the user is walking
 */
export type StripHighlightMode = "typing" | "browsing";

/** The element DOM focus belongs on while the highlight rests where it does. */
export type StripFocusTarget = { readonly kind: "input" } | { readonly kind: "band"; readonly bandKey: string };

const inputFocusTarget: StripFocusTarget = { kind: "input" };

/**
 * Where DOM focus belongs for a highlight on `activeOptionId` in `mode`. Typing
 * mode always keeps focus in the filter box; browsing mode follows the
 * highlight to the listbox of the band that renders it, and falls back to the
 * filter box when the offering no longer renders the highlighted chip.
 */
export function decideStripFocusTarget(
  options: readonly StripOption[],
  activeOptionId: string | undefined,
  mode: StripHighlightMode
): StripFocusTarget {
  if (mode === "typing") return inputFocusTarget;
  const bandKey = bandOfStripOption(options, activeOptionId);
  return bandKey === undefined ? inputFocusTarget : { kind: "band", bandKey };
}

/**
 * True when pressing `key` enters or edits the filter text, so the keystroke
 * belongs in the filter box: any single printable character, or Backspace.
 */
export function isStripFilterTypingKey(key: string): boolean {
  return key === "Backspace" || key.length === 1;
}

/**
 * The option id the highlight moves to along the rendered sequence: `delta` 1
 * steps toward the end of the offering and -1 toward its start, both wrapping
 * around. With nothing highlighted, stepping forward takes the first chip and
 * stepping back the last. Returns undefined when no chip is rendered.
 */
export function moveActiveStripOption(
  options: readonly StripOption[],
  activeOptionId: string | undefined,
  delta: 1 | -1
): string | undefined {
  if (options.length === 0) return undefined;
  const current = options.findIndex((option) => option.optionId === activeOptionId);
  if (current === -1) return delta === 1 ? options[0].optionId : options[options.length - 1].optionId;
  const next = (current + delta + options.length) % options.length;
  return options[next].optionId;
}

/** Where one rendered chip sits, measured from the strip's rendered layout. */
export interface StripOptionGeometry {
  /** DOM id of the chip, as {@link StripOption.optionId} carries it. */
  readonly optionId: string;
  /** Left edge of the chip. */
  readonly left: number;
  /** Rendered width of the chip. */
  readonly width: number;
  /** Top edge of the chip. */
  readonly top: number;
}

/**
 * How far two chips' top edges may differ and still count as the same wrapped
 * row, in the units the geometry is measured in.
 */
const kStripRowTolerance = 8;

/**
 * The chips grouped into wrapped visual rows, topmost row first and each row
 * ordered left to right.
 */
function stripVisualRows(geometry: readonly StripOptionGeometry[]): StripOptionGeometry[][] {
  const ordered = geometry.map((box, index) => ({ box, index }));
  ordered.sort((a, b) => (a.box.top !== b.box.top ? a.box.top - b.box.top : a.index - b.index));
  const rows: StripOptionGeometry[][] = [];
  let rowTop = 0;
  for (const entry of ordered) {
    if (rows.length === 0 || entry.box.top - rowTop > kStripRowTolerance) {
      rows.push([entry.box]);
      rowTop = entry.box.top;
      continue;
    }
    rows[rows.length - 1].push(entry.box);
  }
  for (const row of rows) row.sort((a, b) => a.left - b.left);
  return rows;
}

/** The horizontal center of a measured chip. */
function stripOptionCenter(box: StripOptionGeometry): number {
  return box.left + box.width / 2;
}

/**
 * The option id the highlight moves to across the strip's wrapped layout:
 * `delta` 1 steps to the visual row below and -1 to the row above, both
 * wrapping around, taking the chip in that row whose horizontal center is
 * nearest the highlighted chip's center and the leading chip of two equally
 * near ones. Rows are read from `geometry`, so the step crosses band boundaries
 * wherever the layout puts one row under another. With nothing highlighted,
 * stepping forward takes the first chip of `geometry` and stepping back the
 * last. Returns undefined when no chip is measured.
 */
export function moveActiveStripOption2D(
  geometry: readonly StripOptionGeometry[],
  activeOptionId: string | undefined,
  delta: 1 | -1
): string | undefined {
  if (geometry.length === 0) return undefined;
  const active = geometry.find((box) => box.optionId === activeOptionId);
  if (!active) return delta === 1 ? geometry[0].optionId : geometry[geometry.length - 1].optionId;
  const rows = stripVisualRows(geometry);
  const rowIndex = rows.findIndex((row) => row.some((box) => box.optionId === active.optionId));
  const target = rows[(rowIndex + delta + rows.length) % rows.length];
  const center = stripOptionCenter(active);
  let nearest = target[0];
  let nearestDistance = Math.abs(stripOptionCenter(nearest) - center);
  for (const box of target) {
    const distance = Math.abs(stripOptionCenter(box) - center);
    if (distance < nearestDistance) {
      nearest = box;
      nearestDistance = distance;
    }
  }
  return nearest.optionId;
}

/**
 * The option id the highlight enters at when an arrow key is pressed on the
 * band `bandKey`: `delta` 1 takes the band's first chip and -1 takes the chip
 * immediately before the band, wrapping to the last chip when the band leads
 * the sequence. `bands` is the display sequence with `bandKey` at its own
 * position, whether or not its chips are rendered yet. Returns undefined when
 * the band renders no chip or is absent from `bands`.
 */
export function enterStripOptionsAt(
  stripId: string,
  bands: readonly StripOptionBand[],
  bandKey: string,
  delta: 1 | -1
): string | undefined {
  const bandIndex = bands.findIndex((band) => band.key === bandKey);
  if (bandIndex === -1 || bands[bandIndex].entries.length === 0) return undefined;
  const options = visibleStripOptions(stripId, bands);
  if (delta === 1) return options.find((option) => option.bandKey === bandKey)?.optionId;
  let precedingCount = 0;
  for (let i = 0; i < bandIndex; i++) precedingCount += bands[i].entries.length;
  return precedingCount === 0 ? options[options.length - 1].optionId : options[precedingCount - 1].optionId;
}

/** What Escape does while the strip is open. */
export type StripEscapeAction = "clear-filter" | "dismiss";

/**
 * Escape's action for the given filter text: typed text is cleared first, and
 * a second Escape on empty text closes the strip.
 */
export function decideStripEscape(filter: string): StripEscapeAction {
  return filter.length > 0 ? "clear-filter" : "dismiss";
}
