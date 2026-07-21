import type { IBrainActionTileDef, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { mkVariableFactoryTileId } from "@mindcraft-lang/core/brain";
import type { BrainTileParameterDef } from "@mindcraft-lang/core/brain/tiles";

/** A documented parameter or modifier tile placed by an action's call spec. */
export interface ActionArgTileEntry {
  readonly kind: "tile";
  readonly tileDef: IBrainTileDef;
  /**
   * True when the tile's slot fills anonymously: the user puts a value
   * directly in the slot, without placing the parameter tile itself.
   */
  readonly anonymous: boolean;
}

/** An anonymous value slot of an action, documented by its accepted value type. */
export interface ActionArgTypeEntry {
  readonly kind: "type";
  readonly typeId: string;
  /** Always true: an anonymous value slot has no placeable tile of its own. */
  readonly anonymous: true;
}

/** One entry of an action's documented parameter-and-modifier surface. */
export type ActionArgEntry = ActionArgTileEntry | ActionArgTypeEntry;

/**
 * True for a parameter tile that carries no name surface of its own: a hidden
 * platform parameter or an anonymous type-keyed parameter tile.
 */
function isGenericParameterTile(tileDef: IBrainTileDef): boolean {
  if (tileDef.kind !== "parameter") {
    return false;
  }
  return tileDef.hidden === true || (tileDef as BrainTileParameterDef).anonType !== undefined;
}

/**
 * Resolves the documented parameter-and-modifier entries of a sensor or
 * actuator tile's call spec, in call-spec declaration order. `getTileDef`
 * resolves an arg slot's tile id to its definition.
 *
 * A named, visible parameter or modifier tile yields a tile entry whose
 * `anonymous` flag carries the slot's anonymity. An anonymous slot whose tile
 * is a hidden or anonymous type-keyed parameter yields a type entry carrying
 * the parameter's value type; a choice of such slots yields one type entry
 * per accepted type, in option order. Slots that resolve no definition, a
 * deprecated one, or a hidden one outside an anonymous slot are omitted. A
 * tile id or value type referenced by more than one slot appears once, at its
 * first slot position. Returns an empty array for an undefined tile def and
 * for tile kinds without an action call spec.
 */
export function getActionArgEntries(
  tileDef: IBrainTileDef | undefined,
  getTileDef: (tileId: string) => IBrainTileDef | undefined
): readonly ActionArgEntry[] {
  if (!tileDef || (tileDef.kind !== "sensor" && tileDef.kind !== "actuator")) {
    return [];
  }
  const argSlots = (tileDef as IBrainActionTileDef).action.callDef.argSlots;
  const seen = new Set<string>();
  const entries: ActionArgEntry[] = [];
  for (let i = 0; i < argSlots.size(); i++) {
    const slot = argSlots.get(i);
    const argTileDef = getTileDef(slot.argSpec.tileId);
    if (!argTileDef || argTileDef.deprecated) {
      continue;
    }
    if (slot.argSpec.anonymous && isGenericParameterTile(argTileDef)) {
      const typeId = (argTileDef as BrainTileParameterDef).dataType;
      if (!seen.has(`type:${typeId}`)) {
        seen.add(`type:${typeId}`);
        entries.push({ kind: "type", typeId, anonymous: true });
      }
      continue;
    }
    if (argTileDef.hidden) {
      continue;
    }
    if (!seen.has(`tile:${argTileDef.tileId}`)) {
      seen.add(`tile:${argTileDef.tileId}`);
      entries.push({ kind: "tile", tileDef: argTileDef, anonymous: slot.argSpec.anonymous === true });
    }
  }
  return entries;
}

/** Lookup sources for {@link resolveTypeDisplayName}. Every source is optional. */
export interface TypeDisplaySources {
  /** App-supplied friendly type names keyed by type id. */
  dataTypeNames?: ReadonlyMap<string, string>;
  /** Resolves a tile id to its catalog definition. */
  getTileDef?: (tileId: string) => IBrainTileDef | undefined;
  /** Resolves a type id to its registered type name. */
  getTypeName?: (typeId: string) => string | undefined;
}

/**
 * Resolves the display name of a value type for user-facing surfaces. Tries,
 * in order: the app's friendly name map, the label of the type's variable
 * factory tile (a user struct's declared name), and the registered type name
 * with any module-qualifying prefix removed. Falls back to the type id when
 * no source resolves.
 */
export function resolveTypeDisplayName(typeId: string, sources: TypeDisplaySources): string {
  const mapped = sources.dataTypeNames?.get(typeId);
  if (mapped) {
    return mapped;
  }
  const factoryLabel = sources.getTileDef?.(mkVariableFactoryTileId(typeId))?.metadata?.label;
  if (factoryLabel) {
    return factoryLabel;
  }
  const typeName = sources.getTypeName?.(typeId);
  if (typeName) {
    const sep = typeName.lastIndexOf("::");
    return sep >= 0 ? typeName.slice(sep + 2) : typeName;
  }
  return typeId;
}
