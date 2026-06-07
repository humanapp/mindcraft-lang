import type {
  BrainActionCallSpec,
  HydratedTileMetadataSnapshot,
  ITileMetadata,
  ITypeRegistry,
  MindcraftEnvironment,
  TileDefinitionInput,
} from "@mindcraft-lang/core/app";
import {
  BitSet,
  BrainTileActuatorDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
  CoreCapabilityBits,
  logger,
  mkActuatorTileId,
  mkCallDef,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import type {
  ExtractedArgSpec,
  ExtractedParam,
  UserAuthoredProgram,
  WorkspaceCompileResult,
} from "@mindcraft-lang/ts-compiler";
import {
  collectParams,
  isCallSpec,
  isOptionalString,
  isOptionalStringArray,
  isRecord,
} from "@mindcraft-lang/ts-compiler";

const METADATA_CACHE_VERSION = 3 as const;

/** Cached metadata describing a user-authored sensor or actuator tile. */
export interface UserTileMetadata {
  /** Stable key used to identify the tile across compiles. */
  key: string;
  /** Whether the tile is a sensor or an actuator. */
  kind: "sensor" | "actuator";
  /** Source-level identifier of the user's function. */
  name: string;
  /** Brain-action call signature derived from the source. */
  callSpec: BrainActionCallSpec;
  /** Argument descriptors derived from the source. */
  args: ExtractedArgSpec[];
  /** For sensors, the typeId of the value the tile produces. */
  outputType?: string;
  /** Whether the tile's call returns a `Promise`. */
  isAsync: boolean;
  /** Optional human-readable label for the tile. */
  label?: string;
  /** Optional icon URL for the tile. */
  iconUrl?: string;
  /** Optional Markdown documentation shown in the editor. */
  docsMarkdown?: string;
  /** Optional categorization tags. */
  tags?: string[];
}

/**
 * Storage hooks for the user-tile metadata warm-start cache. The cache is
 * project-scoped: the host wires these to the active project's durable app-data.
 */
export interface UserTileRegistrationOptions {
  /** Loads the raw persisted metadata-cache JSON for the active project, or undefined when absent. */
  loadMetadata: () => Promise<string | undefined>;
  /** Persists the raw metadata-cache JSON for the active project; `undefined` clears the cache. */
  saveMetadata: (json: string | undefined) => void;
}

/** Result returned by {@link applyCompiledUserTiles}. */
export interface UserTileApplyResult {
  metadata: readonly UserTileMetadata[];
  /** Action keys whose call definition changed since the previous bundle. */
  changedActionKeys: readonly string[];
  /** Number of brains invalidated by the change. */
  invalidatedBrainCount: number;
}

interface UserTileMetadataCache {
  version: typeof METADATA_CACHE_VERSION;
  revision: string;
  tiles: UserTileMetadata[];
}

type LoadedHydratedMetadata = {
  metadata: UserTileMetadata[];
  revision: string;
  migrated: boolean;
  droppedEntries: number;
};

function isUserTileMetadata(value: unknown): value is UserTileMetadata {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    (value.kind === "sensor" || value.kind === "actuator") &&
    typeof value.name === "string" &&
    isCallSpec(value.callSpec) &&
    Array.isArray(value.args) &&
    isOptionalString(value.outputType) &&
    typeof value.isAsync === "boolean" &&
    isOptionalString(value.label) &&
    isOptionalString(value.iconUrl) &&
    isOptionalString(value.docsMarkdown) &&
    isOptionalStringArray(value.tags)
  );
}

function metadataFromProgram(program: UserAuthoredProgram): UserTileMetadata {
  return {
    key: program.key,
    kind: program.kind,
    name: program.name,
    callSpec: program.callDef.callSpec as BrainActionCallSpec,
    args: program.args,
    outputType: program.outputType,
    isAsync: program.isAsync,
    label: program.label,
    iconUrl: program.iconUrl,
    docsMarkdown: program.docsMarkdown,
    tags: program.tags,
  };
}

function collectCachedEntries(entries: readonly unknown[]): { metadata: UserTileMetadata[]; droppedEntries: number } {
  const metadata: UserTileMetadata[] = [];
  let droppedEntries = 0;

  for (const entry of entries) {
    if (isUserTileMetadata(entry)) {
      metadata.push(entry);
      continue;
    }

    droppedEntries++;
  }

  return { metadata, droppedEntries };
}

function parseMetadataCache(raw: unknown): LoadedHydratedMetadata | undefined {
  if (Array.isArray(raw)) {
    const { metadata, droppedEntries } = collectCachedEntries(raw);
    return {
      metadata,
      revision: "hydrated-legacy",
      migrated: true,
      droppedEntries,
    };
  }

  if (!isRecord(raw)) {
    return undefined;
  }

  if (raw.version === 1 && Array.isArray(raw.tiles)) {
    const { metadata, droppedEntries } = collectCachedEntries(raw.tiles);
    return {
      metadata,
      revision: "hydrated-legacy",
      migrated: true,
      droppedEntries,
    };
  }

  if (raw.version !== METADATA_CACHE_VERSION || !Array.isArray(raw.tiles) || typeof raw.revision !== "string") {
    return undefined;
  }

  const { metadata, droppedEntries } = collectCachedEntries(raw.tiles);
  return {
    metadata,
    revision: raw.revision,
    migrated: droppedEntries > 0,
    droppedEntries,
  };
}

function persistMetadataCache(
  save: (json: string | undefined) => void,
  revision: string,
  metadata: readonly UserTileMetadata[]
): void {
  if (metadata.length === 0) {
    save(undefined);
    return;
  }

  const cache: UserTileMetadataCache = {
    version: METADATA_CACHE_VERSION,
    revision,
    tiles: [...metadata],
  };
  save(JSON.stringify(cache));
}

function loadMetadataCache(json: string | undefined, clear: () => void): LoadedHydratedMetadata | undefined {
  if (!json) {
    return undefined;
  }

  try {
    const parsed = parseMetadataCache(JSON.parse(json) as unknown);
    if (!parsed) {
      clear();
      logger.warn("[user-tile-registration] cleared incompatible metadata cache");
      return undefined;
    }

    if (parsed.metadata.length === 0) {
      return undefined;
    }

    return parsed;
  } catch {
    clear();
    logger.warn("[user-tile-registration] cleared unreadable metadata cache");
    return undefined;
  }
}

function resolveTypeId(types: ITypeRegistry, typeName: string): string | undefined {
  if (types.get(typeName)) {
    return typeName;
  }

  return types.resolveByName(typeName);
}

function getParameterId(tileName: string, param: ExtractedParam): string {
  return param.anonymous ? `anon.${param.type}` : `user.${tileName}.${param.name}`;
}

function buildHydratedSnapshot(
  env: MindcraftEnvironment,
  revision: string,
  metadata: readonly UserTileMetadata[]
): HydratedTileMetadataSnapshot {
  return env.withServices((services) => {
    const { types } = services.runtime;
    const tiles = new Map<string, TileDefinitionInput>();

    for (const entry of metadata) {
      const parameterTiles: TileDefinitionInput[] = [];
      let canRegister = true;

      for (const param of collectParams(entry.args)) {
        const typeId = resolveTypeId(types, param.type);
        if (!typeId) {
          logger.warn(`[user-tile-registration] unknown parameter type "${param.type}" for "${entry.key}"`);
          canRegister = false;
          break;
        }

        const parameterId = getParameterId(entry.name, param);
        parameterTiles.push(
          new BrainTileParameterDef(parameterId, typeId, {
            hidden: param.anonymous,
          })
        );
      }

      if (!canRegister) {
        continue;
      }

      const descriptor = {
        key: entry.key,
        kind: entry.kind,
        callDef: mkCallDef(entry.callSpec),
        isAsync: entry.isAsync,
        outputType: undefined as string | undefined,
      };

      if (entry.kind === "sensor") {
        const outputType = entry.outputType ? resolveTypeId(types, entry.outputType) : undefined;
        if (!outputType) {
          logger.warn(`[user-tile-registration] unknown output type "${entry.outputType}" for "${entry.key}"`);
          continue;
        }
        descriptor.outputType = outputType;
      }

      for (const tile of parameterTiles) {
        if (!tiles.has(tile.tileId)) {
          tiles.set(tile.tileId, tile);
        }
      }

      const tileMetadata: ITileMetadata = {
        label: entry.label ?? entry.name,
        iconUrl: entry.iconUrl,
        docsMarkdown: entry.docsMarkdown,
        tags: entry.tags,
      };

      const userTileCaps = new BitSet().set(CoreCapabilityBits.UserTile);

      const actionTile =
        entry.kind === "sensor"
          ? new BrainTileSensorDef(entry.key, descriptor, { metadata: tileMetadata, capabilities: userTileCaps })
          : new BrainTileActuatorDef(entry.key, descriptor, { metadata: tileMetadata, capabilities: userTileCaps });
      tiles.set(actionTile.tileId, actionTile);
    }

    return {
      revision,
      tiles: Array.from(tiles.values()).sort((left, right) => left.tileId.localeCompare(right.tileId)),
    };
  });
}

/** Extract user-tile metadata from a project compile result, sorted by key. */
export function collectMetadataFromCompile(result: WorkspaceCompileResult): UserTileMetadata[] {
  const metadata: UserTileMetadata[] = [];

  for (const compileResult of result.projectResult.results.values()) {
    if (compileResult.program) {
      metadata.push(metadataFromProgram(compileResult.program));
    }
  }

  metadata.sort((left, right) => left.key.localeCompare(right.key));
  return metadata;
}

/**
 * Restore user tiles from the project's persisted metadata cache so the editor
 * can render them before the first compile finishes. Returns the cached
 * metadata, or `undefined` when no usable cache exists.
 */
export async function hydrateUserTilesFromCache(
  env: MindcraftEnvironment,
  options: UserTileRegistrationOptions
): Promise<readonly UserTileMetadata[] | undefined> {
  const json = await options.loadMetadata();
  const loaded = loadMetadataCache(json, () => options.saveMetadata(undefined));
  if (!loaded) {
    return undefined;
  }

  if (loaded.droppedEntries > 0) {
    logger.warn(
      `[user-tile-registration] dropped ${loaded.droppedEntries} incompatible metadata cache entr${loaded.droppedEntries === 1 ? "y" : "ies"}`
    );
  }

  const snapshot = buildHydratedSnapshot(env, loaded.revision, loaded.metadata);
  if (snapshot.tiles.length === 0) {
    return undefined;
  }

  if (loaded.migrated) {
    persistMetadataCache(options.saveMetadata, snapshot.revision, loaded.metadata);
  }

  env.hydrateTileMetadata(snapshot);
  logger.debug(`[user-tile-registration] hydrated ${snapshot.tiles.length} tile(s) from metadata cache`);
  return loaded.metadata;
}

/**
 * Apply the user-tile bundle from a project compile result to the
 * environment, refreshing the metadata cache. Returns `undefined` when the
 * compile produced no bundle.
 */
export function applyCompiledUserTiles(
  env: MindcraftEnvironment,
  result: WorkspaceCompileResult,
  options: UserTileRegistrationOptions
): UserTileApplyResult | undefined {
  const bundle = result.bundle;
  if (!bundle) {
    return undefined;
  }

  const metadata = collectMetadataFromCompile(result);

  try {
    persistMetadataCache(options.saveMetadata, bundle.revision, metadata);
  } catch {
    logger.warn("[user-tile-registration] failed to save metadata cache");
  }

  const update = env.replaceActionBundle(bundle);
  if (metadata.length > 0 || update.changedActionKeys.length > 0) {
    logger.debug(
      `[user-tile-registration] applied bundle: ${metadata.length} tile(s), ${update.changedActionKeys.length} changed action(s), ${update.invalidatedBrains.length} invalidated brain(s)`
    );
    for (const entry of metadata) {
      const tileId = entry.kind === "sensor" ? mkSensorTileId(entry.key) : mkActuatorTileId(entry.key);
      logger.debug(`[user-tile-registration]   ${tileId}`);
    }
  }

  return {
    metadata,
    changedActionKeys: update.changedActionKeys,
    invalidatedBrainCount: update.invalidatedBrains.length,
  };
}
