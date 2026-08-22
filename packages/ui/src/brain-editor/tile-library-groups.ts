import { assertUnreachable } from "@wendoo/core";
import type { IBrainTileDef } from "@wendoo/core/brain";
import type {
  BrainTileActuatorDef,
  BrainTileModifierDef,
  BrainTileOutputDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
} from "@wendoo/core/brain/tiles";

/** An installed library whose tiles the editor subgroups: its coordinate identity and manifest display name. */
export interface TileSourceLibrary {
  /** The library's `<owner>/<repo>` coordinate, matched against a tile's identity namespace. */
  readonly coordinate: string;
  /** Display name from the library's `wendoo.json`, shown as the subgroup heading. */
  readonly name: string;
}

/** One subcluster produced by {@link groupTilesByLibrary}: a library and the items attributed to it. */
export interface LibraryTileCluster<T> {
  readonly library: TileSourceLibrary;
  readonly items: readonly T[];
}

/** Result of {@link groupTilesByLibrary}: unattributed items in input order, then one cluster per library. */
export interface LibraryTileGroups<T> {
  readonly unattributed: readonly T[];
  readonly clusters: readonly LibraryTileCluster<T>[];
}

/**
 * The project namespace of the compiled user action, argument, or output
 * backing a tile: a host project's store id or an installed library's
 * `<owner>/<repo>` coordinate. Undefined for platform tiles and for tile kinds
 * that carry no identity namespace.
 */
export function tileSourceNamespace(tileDef: IBrainTileDef): string | undefined {
  switch (tileDef.kind) {
    case "actuator":
    case "sensor":
      return (tileDef as BrainTileActuatorDef | BrainTileSensorDef).userIdentity?.namespace;
    case "output":
      return (tileDef as BrainTileOutputDef).namespace;
    case "parameter":
      return (tileDef as BrainTileParameterDef).userArg?.namespace;
    case "modifier":
      return (tileDef as BrainTileModifierDef).userArg?.namespace;
    case "undefined":
    case "operator":
    case "variable":
    case "literal":
    case "factory":
    case "controlFlow":
    case "accessor":
    case "page":
    case "missing":
      return undefined;
    default:
      return assertUnreachable(tileDef.kind);
  }
}

/**
 * True when the tile is a sensor or actuator compiled from the active
 * project's own TypeScript: its identity namespace equals `projectNamespace`.
 * False for library tiles, platform tiles, other tile kinds, and when
 * `projectNamespace` is undefined.
 */
export function isProjectAuthoredActionTile(tileDef: IBrainTileDef, projectNamespace: string | undefined): boolean {
  if (projectNamespace === undefined || (tileDef.kind !== "sensor" && tileDef.kind !== "actuator")) {
    return false;
  }
  return tileSourceNamespace(tileDef) === projectNamespace;
}

/**
 * Partition items by the installed library their tile's identity namespace
 * names: unattributed items first, in input order, then one cluster per
 * library ordered by display name. An item whose namespace matches no entry
 * in `libraries` (a platform tile or a tile from the project's own code) is
 * unattributed, as is an item `getTileDef` resolves no tile def for. Only
 * libraries with at least one item produce a cluster.
 */
export function groupTilesByLibrary<T>(
  items: readonly T[],
  getTileDef: (item: T) => IBrainTileDef | undefined,
  libraries: readonly TileSourceLibrary[] | undefined
): LibraryTileGroups<T> {
  if (!libraries || libraries.length === 0) {
    return { unattributed: items, clusters: [] };
  }
  const byCoordinate = new Map(libraries.map((library) => [library.coordinate, library]));
  const unattributed: T[] = [];
  const clustered = new Map<string, { library: TileSourceLibrary; items: T[] }>();
  for (const item of items) {
    const tileDef = getTileDef(item);
    const namespace = tileDef !== undefined ? tileSourceNamespace(tileDef) : undefined;
    const library = namespace !== undefined ? byCoordinate.get(namespace) : undefined;
    if (!library) {
      unattributed.push(item);
      continue;
    }
    let cluster = clustered.get(library.coordinate);
    if (!cluster) {
      cluster = { library, items: [] };
      clustered.set(library.coordinate, cluster);
    }
    cluster.items.push(item);
  }
  const clusters = [...clustered.values()].sort((a, b) => a.library.name.localeCompare(b.library.name));
  return { unattributed, clusters };
}
