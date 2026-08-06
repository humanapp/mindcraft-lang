import type { ReadonlyBitSet } from "@mindcraft-lang/core";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { isActionTileDef, TilePlacement } from "@mindcraft-lang/core/brain";
import type { BrainActionCallSpec } from "@mindcraft-lang/core/runtime";
import { tileLabel } from "./tile-label.js";
import type { ToolInput } from "./tool-schemas.js";
import { type AuthoringWorkspace, allTiles } from "./workspace.js";

/** One tile as `read_catalog` describes it. */
export interface CatalogTile {
  readonly tileId: string;
  /** Display label, the value text or variable name a manufactured tile carries, or the tile id when it has none. */
  readonly label: string;
  /** Tile kind, for example "sensor", "actuator", "modifier". */
  readonly kind: string;
  /** The author's description of what the tile senses or does; absent when undocumented. */
  readonly description?: string;
  /** Value type the tile produces; absent for tiles that produce none. */
  readonly outputType?: string;
  /** Compact rendering of the tile's argument grammar; absent for tiles that take no arguments. */
  readonly args?: string;
  /** Rule sides and nestings the tile may be placed in. */
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

/** The placement flags set on `tile`, as names. */
function placementNames(tile: IBrainTileDef): string[] {
  const placement = tile.placement ?? 0;
  const names: string[] = [];
  if ((placement & TilePlacement.WhenSide) !== 0) names.push("when");
  if ((placement & TilePlacement.DoSide) !== 0) names.push("do");
  if ((placement & TilePlacement.ChildRule) !== 0) names.push("childRule");
  if ((placement & TilePlacement.InsideLoop) !== 0) names.push("insideLoop");
  if ((placement & TilePlacement.Inline) !== 0) names.push("inline");
  return names;
}

/** Render one call-spec node as a compact grammar string. */
function renderCallSpec(spec: BrainActionCallSpec): string {
  switch (spec.type) {
    case "arg":
      return spec.required ? `${spec.tileId}!` : spec.tileId;
    case "seq":
      return `seq(${spec.items.map(renderCallSpec).join(", ")})`;
    case "bag":
      return `any-order(${spec.items.map(renderCallSpec).join(", ")})`;
    case "choice":
      return `one-of(${spec.options.map(renderCallSpec).join(" | ")})`;
    case "optional":
      return `optional(${renderCallSpec(spec.item)})`;
    case "repeat":
      return `repeat(${renderCallSpec(spec.item)}, ${spec.min ?? 0}..${spec.max ?? "many"})`;
    case "conditional":
      return `if-matched(${spec.condition}, ${renderCallSpec(spec.then)}${spec.else ? `, ${renderCallSpec(spec.else)}` : ""})`;
  }
}

/** Output identity keys `tile` provides. */
function outputKeys(tile: IBrainTileDef): string[] {
  const provided = tile.providedOutputs();
  const keys: string[] = [];
  for (let i = 0; i < provided.size(); i++) keys.push(provided.get(i)!);
  return keys;
}

/** Describe one tile for the model. */
function describeTile(tile: IBrainTileDef, descriptions: ReadonlyMap<string, string>): CatalogTile {
  const description = descriptions.get(tile.tileId);
  const action = isActionTileDef(tile) ? tile.action : undefined;
  const args = action && action.callDef.argSlots.size() > 0 ? renderCallSpec(action.callDef.callSpec) : undefined;
  const consumesWhenResult = tile.consumesWhenResult();
  return {
    tileId: tile.tileId,
    label: tileLabel(tile),
    kind: tile.kind,
    ...(description ? { description } : {}),
    ...(action?.outputType ? { outputType: action.outputType } : {}),
    ...(args ? { args } : {}),
    placement: placementNames(tile),
    requires: capabilityNames(tile.requirements()),
    provides: capabilityNames(tile.capabilities()),
    outputs: outputKeys(tile),
    ...(consumesWhenResult ? { consumesWhenResult } : {}),
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
 * List every tile available in the environment, each with the author's
 * description and the metadata the model plans from.
 */
export function readCatalog(workspace: AuthoringWorkspace, input: ToolInput<"read_catalog">): CatalogView {
  const described = allTiles(workspace.catalogs).map((tile) => describeTile(tile, workspace.descriptions));
  const needle = input.filter?.trim().toLowerCase();
  const tiles = needle ? described.filter((tile) => matches(tile, needle)) : described;
  return { tiles, total: described.length };
}
