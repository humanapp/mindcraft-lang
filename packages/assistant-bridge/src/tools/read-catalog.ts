import type { ReadonlyBitSet } from "@mindcraft-lang/core";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { isActionTileDef, TilePlacement } from "@mindcraft-lang/core/brain";
import { tileSentenceWord } from "@mindcraft-lang/core/brain/language-service";
import type { BrainTileParameterDef } from "@mindcraft-lang/core/brain/tiles";
import type { Localizer } from "@mindcraft-lang/core/localization";
import type { BrainActionCallArgSpec, BrainActionCallSpec } from "@mindcraft-lang/core/runtime";
import type { ToolInput } from "./tool-schemas.js";
import { type AuthoringWorkspace, allTiles } from "./workspace.js";

/** One tile as `read_catalog` describes it. */
export interface CatalogTile {
  readonly tileId: string;
  /** The word the tile reads by in the environment's locale. */
  readonly label: string;
  /** Tile kind, for example "sensor", "actuator", "modifier". */
  readonly kind: string;
  /** The author's description of what the tile senses or does; absent when undocumented. */
  readonly description?: string;
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
  /**
   * A rule this tile's use obeys that its argument grammar does not state, in
   * one plain sentence, as the tile's registration states it; absent when the
   * tile adds no such rule.
   */
  readonly grammarNote?: string;
  /** `true` for a tile the editor hides from its pickers. */
  readonly hidden?: boolean;
  /** `true` for a tile kept only for documents that already use it. */
  readonly deprecated?: boolean;
}

/** The catalog as `read_catalog` returns it. */
export interface CatalogView {
  /** Tiles matching the request, sorted by tile id. */
  readonly tiles: readonly CatalogTile[];
  /** Tiles in the environment before filtering. */
  readonly total: number;
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
 * Render one call-spec node as a compact grammar string. A named argument reads
 * as the tile id to place, suffixed with `!` when required; an anonymous
 * argument takes no tile of its own and reads as `value:<typeId>`, the type of
 * the value expression that fills it.
 *
 * @param slotType The value type an anonymous slot keyed by a parameter tile id takes.
 */
function renderCallSpec(spec: BrainActionCallSpec, slotType: (tileId: string) => string | undefined): string {
  const render = (item: BrainActionCallSpec) => renderCallSpec(item, slotType);
  switch (spec.type) {
    case "arg": {
      const named = spec.anonymous ? `value:${slotType(spec.tileId) ?? "unknown"}` : spec.tileId;
      return spec.required ? `${named}!` : named;
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
 * Describe one tile for the model, reading it by its word in `localizer`'s
 * locale and its argument grammar through `slotType`.
 */
function describeTile(
  tile: IBrainTileDef,
  descriptions: ReadonlyMap<string, string>,
  localizer: Localizer,
  slotType: (tileId: string) => string | undefined
): CatalogTile {
  const description = descriptions.get(tile.tileId);
  const action = isActionTileDef(tile) ? tile.action : undefined;
  const args =
    action && action.callDef.argSlots.size() > 0 ? renderCallSpec(action.callDef.callSpec, slotType) : undefined;
  const consumesWhenResult = tile.consumesWhenResult();
  return {
    tileId: tile.tileId,
    label: tileSentenceWord(tile, localizer),
    kind: tile.kind,
    ...(description ? { description } : {}),
    ...(action?.outputType ? { outputType: action.outputType } : {}),
    ...(args ? { args } : {}),
    placement: placementNames(tile),
    requires: capabilityNames(tile.requirements()),
    provides: capabilityNames(tile.capabilities()),
    outputs: outputKeys(tile),
    ...(consumesWhenResult ? { consumesWhenResult } : {}),
    ...(tile.metadata?.grammarNote ? { grammarNote: tile.metadata.grammarNote } : {}),
    ...(tile.hidden ? { hidden: true } : {}),
    ...(tile.deprecated ? { deprecated: true } : {}),
  };
}

/** True when any of the tile's searchable text contains `needle`. */
function matches(tile: CatalogTile, needle: string): boolean {
  return (
    tile.tileId.toLowerCase().includes(needle) ||
    tile.label.toLowerCase().includes(needle) ||
    tile.kind.toLowerCase().includes(needle) ||
    (tile.description?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * List every tile a document may hold, each with the author's description and
 * the metadata the model plans from. Argument tiles no action names as a tile
 * to place are left out: an anonymous slot's parameter tile carries only that
 * slot's value type, which the argument grammar reads out as `value:<typeId>`.
 */
export function readCatalog(workspace: AuthoringWorkspace, input: ToolInput<"read_catalog">): CatalogView {
  const localizer = workspace.environment.appServices.localizer;
  const environmentTiles = allTiles(workspace.catalogs);
  const byId = new Map(environmentTiles.map((tile) => [tile.tileId, tile]));
  const namedAsTile = placeableArgTileIds(environmentTiles);
  const slotType = (tileId: string) => {
    const tile = byId.get(tileId);
    return tile && tile.kind === "parameter" ? (tile as BrainTileParameterDef).dataType : undefined;
  };
  const placeable = environmentTiles.filter(
    (tile) => (tile.kind !== "parameter" && tile.kind !== "modifier") || namedAsTile.has(tile.tileId)
  );
  const described = placeable.map((tile) => describeTile(tile, workspace.descriptions, localizer, slotType));
  const needle = input.filter?.trim().toLowerCase();
  const tiles = needle ? described.filter((tile) => matches(tile, needle)) : described;
  return { tiles, total: described.length };
}
