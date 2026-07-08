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
  BrainTileOutputDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
  CoreCapabilityBits,
  List,
  logger,
  mkActuatorTileId,
  mkCallDef,
  mkOutputVarKey,
  mkSensorTileId,
  TilePlacement,
} from "@mindcraft-lang/core/app";
import type {
  ExtractedArgSpec,
  ExtractedOutput,
  ExtractedParam,
  UserAuthoredProgram,
  WorkspaceCompileResult,
} from "@mindcraft-lang/ts-compiler";
import {
  collectParams,
  isCallSpec,
  isOptionalBoolean,
  isOptionalString,
  isOptionalStringArray,
  isRecord,
  privateArgTileId,
  scopedOutputName,
} from "@mindcraft-lang/ts-compiler";

const METADATA_CACHE_VERSION = 9 as const;

/** Cached metadata describing a user-authored sensor or actuator tile. */
export interface UserTileMetadata {
  /** Stable key used to identify the tile across compiles. */
  key: string;
  /**
   * Namespace of the project that compiled this tile: a host project's store id
   * or an installed extension's `<owner>/<repo>` coordinate. Warm-start scopes
   * the tile's derived param and output ids under this namespace, matching the
   * ids the authoritative compile mints.
   */
  namespace: string;
  /** Opaque stable id from the source declaration. */
  id: string;
  /** Whether the tile is a sensor or an actuator. */
  kind: "sensor" | "actuator";
  /** Display name of the user's action. */
  name: string;
  /** Brain-action call signature derived from the source. */
  callSpec: BrainActionCallSpec;
  /** Argument descriptors derived from the source. */
  args: ExtractedArgSpec[];
  /** For sensors, the typeId of the value the tile produces. */
  outputType?: string;
  /** For sensors, the declared named outputs surfaced as inline output value-tiles. */
  outputs?: ExtractedOutput[];
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
  /** For sensors, when true the tile is placement-inline; the picker offers it in value-slot positions. */
  inline?: boolean;
  /** For sensors, when true the tile carries the PresenceGated capability; a bare WHEN gates on value presence. */
  presenceGated?: boolean;
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

function isOutput(value: unknown): value is ExtractedOutput {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    isOptionalString(value.label) &&
    isOptionalString(value.icon) &&
    isOptionalString(value.docs) &&
    isOptionalStringArray(value.tags)
  );
}

function isOptionalOutputArray(value: unknown): value is ExtractedOutput[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every(isOutput));
}

function isUserTileMetadata(value: unknown): value is UserTileMetadata {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.namespace === "string" &&
    typeof value.id === "string" &&
    (value.kind === "sensor" || value.kind === "actuator") &&
    typeof value.name === "string" &&
    isCallSpec(value.callSpec) &&
    Array.isArray(value.args) &&
    isOptionalString(value.outputType) &&
    isOptionalOutputArray(value.outputs) &&
    typeof value.isAsync === "boolean" &&
    isOptionalString(value.label) &&
    isOptionalString(value.iconUrl) &&
    isOptionalString(value.docsMarkdown) &&
    isOptionalStringArray(value.tags) &&
    isOptionalBoolean(value.inline) &&
    isOptionalBoolean(value.presenceGated)
  );
}

function metadataFromProgram(program: UserAuthoredProgram): UserTileMetadata {
  if (program.kind === "conversion") {
    throw new Error(`Conversion "${program.key}" has no tile metadata`);
  }
  return {
    key: program.key,
    namespace: program.projectNamespace,
    id: program.id,
    kind: program.kind,
    name: program.name,
    callSpec: program.callDef.callSpec as BrainActionCallSpec,
    args: program.args,
    outputType: program.outputType,
    outputs: program.outputs,
    isAsync: program.isAsync,
    label: program.label,
    iconUrl: program.iconUrl,
    docsMarkdown: program.docsMarkdown,
    tags: program.tags,
    inline: program.inline,
    presenceGated: program.presenceGated,
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

function getParameterId(projectNamespace: string, actionId: string, param: ExtractedParam): string {
  if (param.anonymous) return `anon.${param.type}`;
  if (param.name.startsWith("parameter.")) return param.name;
  return privateArgTileId(projectNamespace, actionId, param.name);
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

        const parameterId = getParameterId(entry.namespace, entry.id, param);
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

      const userTileCaps = new BitSet().set(CoreCapabilityBits.UserTile);
      if (entry.presenceGated) {
        userTileCaps.set(CoreCapabilityBits.PresenceGated);
      }
      const outputTiles: TileDefinitionInput[] = [];
      const providedOutputKeys = new List<string>();

      if (entry.kind === "sensor") {
        const outputType = entry.outputType ? resolveTypeId(types, entry.outputType) : undefined;
        if (!outputType) {
          logger.warn(`[user-tile-registration] unknown output type "${entry.outputType}" for "${entry.key}"`);
          continue;
        }
        descriptor.outputType = outputType;

        for (const output of entry.outputs ?? []) {
          const outputTypeId = resolveTypeId(types, output.type);
          if (!outputTypeId) {
            logger.warn(`[user-tile-registration] unknown output type "${output.type}" for "${entry.key}"`);
            canRegister = false;
            break;
          }
          const outputName = scopedOutputName(entry.namespace, output.name);
          providedOutputKeys.push(mkOutputVarKey(outputTypeId, outputName));
          outputTiles.push(
            new BrainTileOutputDef(outputTypeId, outputName, {
              metadata: {
                label: output.label ?? output.name,
                iconUrl: output.icon,
                docsMarkdown: output.docs,
                tags: output.tags,
              },
            })
          );
        }
        if (!canRegister) {
          continue;
        }
      }

      for (const tile of parameterTiles) {
        if (!tiles.has(tile.tileId)) {
          tiles.set(tile.tileId, tile);
        }
      }

      for (const tile of outputTiles) {
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

      const actionTile =
        entry.kind === "sensor"
          ? new BrainTileSensorDef(entry.key, descriptor, {
              metadata: tileMetadata,
              capabilities: userTileCaps,
              providedOutputs: providedOutputKeys,
              placement: entry.inline ? TilePlacement.EitherSide | TilePlacement.Inline : undefined,
            })
          : new BrainTileActuatorDef(entry.key, descriptor, { metadata: tileMetadata, capabilities: userTileCaps });
      tiles.set(actionTile.tileId, actionTile);
    }

    return {
      revision,
      tiles: Array.from(tiles.values()).sort((left, right) => left.tileId.localeCompare(right.tileId)),
    };
  });
}

/**
 * Extract user-tile metadata from a compile result, sorted by key. Includes a
 * metadata entry for every compilation root: the host project and each
 * installed extension, each keyed under its own namespace.
 */
export function collectMetadataFromCompile(result: WorkspaceCompileResult): UserTileMetadata[] {
  const metadata: UserTileMetadata[] = [];

  for (const rootResult of result.rootResults) {
    for (const compileResult of rootResult.results.values()) {
      // Conversions compile to a program but surface no tiles, so they contribute no tile metadata.
      if (compileResult.program && compileResult.program.kind !== "conversion") {
        metadata.push(metadataFromProgram(compileResult.program));
      }
    }
  }

  metadata.sort((left, right) => left.key.localeCompare(right.key));
  return metadata;
}

/**
 * Restore user tiles from the project's persisted metadata cache so the editor
 * can render them before the first compile finishes. Each tile's derived param
 * and output ids are scoped under the tile's own persisted namespace, matching
 * the ids the compiler mints. Returns the cached metadata, or `undefined` when
 * no usable cache exists.
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
