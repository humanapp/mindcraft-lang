import type { ReadonlyBitSet } from "@wendoo/core";
import type { Value } from "@wendoo/core/app";
import type { IBrainTileDef } from "@wendoo/core/brain";
import { isActionTileDef, TilePlacement } from "@wendoo/core/brain";
import { tileSentenceWord } from "@wendoo/core/brain/language-service";
import type { BrainTileParameterDef } from "@wendoo/core/brain/tiles";
import type { Localizer } from "@wendoo/core/localization";
import type { BrainActionCallArgSpec, BrainActionCallSpec } from "@wendoo/core/runtime";
import { CATALOG_TEXT_LIMITS, sanitizeArgsText, sanitizeCatalogTile } from "../catalog/sanitize.js";
import type { CatalogScope } from "../catalog/scope.js";
import { createValueLabeler, renderValue } from "../kit/value-text.js";
import { admitsLongFormDocs } from "./featuring.js";
import { assistantSectionFromMarkdown, descriptionFromMarkdown } from "./tile-descriptions.js";
import type { ToolInput } from "./tool-schemas.js";
import { type AuthoringWorkspace, tileCatalogsOf, tilesByScope } from "./workspace.js";

/** One tile as `read_catalog` describes it. */
export interface CatalogTile {
  readonly tileId: string;
  /** The word the tile reads by in the environment's locale. */
  readonly label: string;
  /** Tile kind, for example "sensor", "actuator", "modifier". */
  readonly kind: string;
  /** The author's description of what the tile senses or does; absent when undocumented. */
  readonly description?: string;
  /**
   * The tile's model-facing teaching prose, taken from the assistant section of
   * its documentation. Absent for a tile documenting none, and for one whose
   * long-form documentation this session withholds.
   */
  readonly assistant?: string;
  /** Value type the tile produces; absent for tiles that produce none. */
  readonly outputType?: string;
  /** Compact rendering of the tile's argument grammar; absent for tiles that take no arguments. */
  readonly args?: string;
  /**
   * Where the tile may be placed: the rule sides that accept it, plus `inline`
   * for a tile that also stands inside a value expression.
   */
  readonly placement: readonly string[];
  /** Capability bits the tile requires some tile above it to provide. */
  readonly requires: readonly string[];
  /** Capability bits the tile provides to tiles below it. */
  readonly provides: readonly string[];
  /** Output identity keys the tile provides, which downstream value tiles read. */
  readonly outputs: readonly string[];
  /** Type of WHEN result the tile consumes; absent for tiles that consume none. */
  readonly consumesWhenResult?: string;
  /** `true` for a tile the editor hides from its pickers. */
  readonly hidden?: boolean;
  /** `true` for a tile kept only for documents that already use it. */
  readonly deprecated?: boolean;
}

/** One scope's tiles, as `read_catalog` groups them. */
export interface CatalogGroup {
  /** Which of the workspace's catalogs these tiles came from. */
  readonly scope: CatalogScope;
  /** The scope's tiles matching the request, sorted by tile id. */
  readonly tiles: readonly CatalogTile[];
}

/** The catalog as `read_catalog` returns it. */
export interface CatalogView {
  /** Tiles matching the request, grouped by scope; a scope matching none is left out. */
  readonly groups: readonly CatalogGroup[];
  /** Tiles the workspace lists across every scope, before `filter` narrowed them. */
  readonly total: number;
}

/** Every tile of `view`, group by group, each group's tiles sorted by tile id. */
export function catalogTiles(view: CatalogView): readonly CatalogTile[] {
  return view.groups.flatMap((group) => group.tiles);
}

/** The tiles `view` lists under `scope`; empty when it lists none. */
export function catalogTilesInScope(view: CatalogView, scope: CatalogScope): readonly CatalogTile[] {
  return view.groups.find((group) => group.scope === scope)?.tiles ?? [];
}

/** Capability bit indices set in `bits`, rendered as `cap:<index>`. */
function capabilityNames(bits: ReadonlyBitSet): string[] {
  // An empty set reports its most significant bit as infinity.
  if (bits.isEmpty()) return [];
  const names: string[] = [];
  const highest = bits.msb();
  for (let bit = 0; bit <= highest; bit++) {
    if (bits.get(bit) !== 0) names.push(`cap:${bit}`);
  }
  return names;
}

/**
 * The placement flags set on `tile` that the editor enforces, as names: the
 * rule sides `validateTilePlacement` admits it on, and `inline` when the parser
 * takes it as a value expression.
 */
function placementNames(tile: IBrainTileDef): string[] {
  const placement = tile.placement ?? 0;
  const names: string[] = [];
  if ((placement & TilePlacement.WhenSide) !== 0) names.push("when");
  if ((placement & TilePlacement.DoSide) !== 0) names.push("do");
  if ((placement & TilePlacement.Inline) !== 0) names.push("inline");
  return names;
}

/**
 * How the argument grammar renders the values a slot declares: `value` renders
 * a declared default, `number` renders a numeric bound.
 */
interface ValueRendering {
  readonly value: (value: Value) => string;
  readonly number: (value: number) => string;
}

/**
 * Render what an argument slot declares of the value it carries, as the unit it
 * is measured in, what an empty slot means, and the bounds it is held to:
 * `(Hz)=880[0..9999 clamp]`. Empty for a slot declaring none of them. The unit
 * and the rendered default are the author's text, each cut to its
 * {@link CATALOG_TEXT_LIMITS} entry by {@link sanitizeArgsText}.
 *
 * @param values How a declared default and a numeric bound each render.
 */
function renderArgDeclarations(spec: BrainActionCallArgSpec, values: ValueRendering): string {
  const unit = spec.unit === undefined ? "" : `(${sanitizeArgsText(spec.unit, CATALOG_TEXT_LIMITS.argUnit)})`;
  let empty = "";
  if (spec.derived === true) empty = "=derived";
  else if (spec.default !== undefined) {
    empty = `=${sanitizeArgsText(values.value(spec.default), CATALOG_TEXT_LIMITS.argDefault)}`;
  }
  const bound = (value: number | undefined) => (value === undefined ? "" : values.number(value));
  const range =
    spec.range === undefined ? "" : `[${bound(spec.range.min)}..${bound(spec.range.max)} ${spec.range.onExceed}]`;
  return `${unit}${empty}${range}`;
}

/**
 * Render one call-spec node as a compact grammar string. A named argument reads
 * as the tile id to place, suffixed with `!` when required; an anonymous
 * argument takes no tile of its own and reads as `<name>:<typeId>`, the type of
 * the value expression that fills it, under the name the slot declares and
 * `value` when it declares none. Either carries what the slot declares of its
 * value; see {@link renderArgDeclarations}.
 *
 * @param slotType The value type an anonymous slot keyed by a parameter tile id takes.
 */
function renderCallSpec(
  spec: BrainActionCallSpec,
  slotType: (tileId: string) => string | undefined,
  values: ValueRendering
): string {
  const render = (item: BrainActionCallSpec) => renderCallSpec(item, slotType, values);
  switch (spec.type) {
    case "arg": {
      const slotName = sanitizeArgsText(spec.name ?? "value", CATALOG_TEXT_LIMITS.argName);
      const named = spec.anonymous ? `${slotName}:${slotType(spec.tileId) ?? "unknown"}` : spec.tileId;
      return `${named}${spec.required ? "!" : ""}${renderArgDeclarations(spec, values)}`;
    }
    case "seq":
      return `seq(${spec.items.map(render).join(", ")})`;
    case "bag":
      return `any-order(${spec.items.map(render).join(", ")})`;
    case "choice":
      return `one-of(${spec.options.map(render).join(" | ")})`;
    case "optional":
      return `optional(${render(spec.item)})`;
    case "repeat":
      return `repeat(${render(spec.item)}, ${spec.min ?? 0}..${spec.max ?? "many"})`;
    case "conditional":
      return `if-matched(${spec.condition}, ${render(spec.then)}${spec.else ? `, ${render(spec.else)}` : ""})`;
  }
}

/** Walk every arg node of `spec`, whether or not it is anonymous. */
function forEachArgSpec(spec: BrainActionCallSpec, visit: (arg: BrainActionCallArgSpec) => void): void {
  switch (spec.type) {
    case "arg":
      visit(spec);
      return;
    case "seq":
    case "bag":
      for (const item of spec.items) forEachArgSpec(item, visit);
      return;
    case "choice":
      for (const option of spec.options) forEachArgSpec(option, visit);
      return;
    case "optional":
    case "repeat":
      forEachArgSpec(spec.item, visit);
      return;
    case "conditional":
      forEachArgSpec(spec.then, visit);
      if (spec.else) forEachArgSpec(spec.else, visit);
      return;
  }
}

/**
 * Tile ids some action's argument grammar names as a tile to place. An
 * anonymous argument names its parameter tile only to key the slot's value
 * type; that tile id is not a member.
 */
function placeableArgTileIds(tiles: readonly IBrainTileDef[]): Set<string> {
  const placeable = new Set<string>();
  for (const tile of tiles) {
    if (!isActionTileDef(tile)) continue;
    forEachArgSpec(tile.action.callDef.callSpec, (arg) => {
      if (arg.anonymous !== true) placeable.add(arg.tileId);
    });
  }
  return placeable;
}

/** Output identity keys `tile` provides. */
function outputKeys(tile: IBrainTileDef): string[] {
  const provided = tile.providedOutputs();
  const keys: string[] = [];
  for (let i = 0; i < provided.size(); i++) keys.push(provided.get(i)!);
  return keys;
}

/**
 * Where one `read_catalog` call reads the author text of each tile it
 * describes, and which tiles it may show long-form documentation of.
 */
interface TileTextSource {
  /** Author descriptions keyed by tile id, for tiles the environment's modules registered. */
  readonly descriptions: ReadonlyMap<string, string>;
  /** Author assistant sections keyed by tile id, for tiles the environment's modules registered. */
  readonly assistantSections: ReadonlyMap<string, string>;
  /** Whether `tile` may show the model its long-form documentation. */
  readonly admitsLongForm: (tile: IBrainTileDef) => boolean;
}

/**
 * The text `extract` reads out of `tile`'s documentation. A tile a compiled
 * bundle registered takes it from the documentation it ships and never reads
 * `baked`, whatever its tile id; a tile the environment's modules registered
 * takes the text `baked` holds for its tile id, and its own documentation when
 * that map holds none. `undefined` when neither carries one.
 */
function tileDocText(
  tile: IBrainTileDef,
  baked: ReadonlyMap<string, string>,
  extract: (markdown: string) => string | undefined
): string | undefined {
  const markdown = tile.metadata?.docsMarkdown;
  const documented = markdown === undefined ? undefined : extract(markdown);
  if (tile.provenance !== undefined) return documented;
  return baked.get(tile.tileId) ?? documented;
}

/**
 * Describe one tile for the model, reading it by its word in `localizer`'s
 * locale and its argument grammar through `slotType`. The fields the tile's
 * author writes are capped by {@link sanitizeCatalogTile}.
 */
function describeTile(
  tile: IBrainTileDef,
  text: TileTextSource,
  localizer: Localizer,
  slotType: (tileId: string) => string | undefined,
  values: ValueRendering
): CatalogTile {
  const description = tileDocText(tile, text.descriptions, descriptionFromMarkdown);
  const assistant = text.admitsLongForm(tile)
    ? tileDocText(tile, text.assistantSections, assistantSectionFromMarkdown)
    : undefined;
  const action = isActionTileDef(tile) ? tile.action : undefined;
  const args =
    action && action.callDef.argSlots.size() > 0
      ? renderCallSpec(action.callDef.callSpec, slotType, values)
      : undefined;
  const consumesWhenResult = tile.consumesWhenResult();
  return sanitizeCatalogTile({
    tileId: tile.tileId,
    label: tileSentenceWord(tile, localizer),
    kind: tile.kind,
    ...(description ? { description } : {}),
    ...(assistant ? { assistant } : {}),
    ...(action?.outputType ? { outputType: action.outputType } : {}),
    ...(args ? { args } : {}),
    placement: placementNames(tile),
    requires: capabilityNames(tile.requirements()),
    provides: capabilityNames(tile.capabilities()),
    outputs: outputKeys(tile),
    ...(consumesWhenResult ? { consumesWhenResult } : {}),
    ...(tile.hidden ? { hidden: true } : {}),
    ...(tile.deprecated ? { deprecated: true } : {}),
  });
}

/** True when any of the tile's searchable text contains `needle`. */
function matches(tile: CatalogTile, needle: string): boolean {
  return (
    tile.tileId.toLowerCase().includes(needle) ||
    tile.label.toLowerCase().includes(needle) ||
    tile.kind.toLowerCase().includes(needle) ||
    (tile.description?.toLowerCase().includes(needle) ?? false) ||
    (tile.assistant?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * List every tile a document may hold, grouped by the scope of the catalog it
 * came from, each with the author's description and the metadata the model
 * plans from. Argument tiles that no action names as a tile to place are left
 * out. `input.filter` narrows the tiles within every group and leaves `total`
 * counting all of them.
 */
export function readCatalog(workspace: AuthoringWorkspace, input: ToolInput<"read_catalog">): CatalogView {
  const localizer = workspace.environment.appServices.localizer;
  const scoped = tilesByScope(workspace.catalogs);
  const catalogTiles = scoped.flatMap((group) => group.tiles);
  const byId = new Map(catalogTiles.map((tile) => [tile.tileId, tile]));
  const namedAsTile = placeableArgTileIds(catalogTiles);
  const slotType = (tileId: string) => {
    const tile = byId.get(tileId);
    return tile && tile.kind === "parameter" ? (tile as BrainTileParameterDef).dataType : undefined;
  };
  const numberText = (value: number) => workspace.environment.appServices.numerics.formatNumber(value);
  const labelOf = createValueLabeler(() => tileCatalogsOf(workspace.catalogs).toArray(), numberText);
  const values: ValueRendering = {
    value: (value: Value) => renderValue(value, numberText, labelOf),
    number: numberText,
  };
  const listed = (tile: IBrainTileDef) =>
    (tile.kind !== "parameter" && tile.kind !== "modifier") || namedAsTile.has(tile.tileId);
  const needle = input.filter?.trim().toLowerCase();
  const roots = workspace.environment.appliedActionBundle()?.roots ?? [];
  const text: TileTextSource = {
    descriptions: workspace.descriptions,
    assistantSections: workspace.assistantSections,
    admitsLongForm: (tile) => admitsLongFormDocs(tile.provenance, roots, workspace.featuring),
  };

  const groups: CatalogGroup[] = [];
  let total = 0;
  for (const group of scoped) {
    const described = group.tiles.filter(listed).map((tile) => describeTile(tile, text, localizer, slotType, values));
    total += described.length;
    const tiles = needle ? described.filter((tile) => matches(tile, needle)) : described;
    if (tiles.length > 0) groups.push({ scope: group.scope, tiles });
  }
  return { groups, total };
}
