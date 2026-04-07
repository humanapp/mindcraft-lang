import {
  type BrainActionCallSpec,
  BrainTileActuatorDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
  type HydratedTileMetadataSnapshot,
  type ITypeRegistry,
  logger,
  mkCallDef,
  type TileDefinitionInput,
} from "@mindcraft-lang/core/app";
import type { ExtractedParam, UserAuthoredProgram, WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";
import { isCallSpec, isExtractedParam, isOptionalString, isRecord } from "@mindcraft-lang/ts-compiler";
import { getMindcraftEnvironment } from "./mindcraft-environment";

const LS_METADATA_KEY = "sim:user-tile-metadata";
const METADATA_CACHE_VERSION = 2 as const;

interface UserTileMetadata {
  key: string;
  kind: "sensor" | "actuator";
  name: string;
  callSpec: BrainActionCallSpec;
  params: ExtractedParam[];
  outputType?: string;
  isAsync: boolean;
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
    Array.isArray(value.params) &&
    value.params.every(isExtractedParam) &&
    isOptionalString(value.outputType) &&
    typeof value.isAsync === "boolean"
  );
}

function metadataFromProgram(program: UserAuthoredProgram): UserTileMetadata {
  return {
    key: program.key,
    kind: program.kind,
    name: program.name,
    callSpec: program.callDef.callSpec as BrainActionCallSpec,
    params: program.params,
    outputType: program.outputType,
    isAsync: program.isAsync,
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

function persistMetadataCache(revision: string, metadata: readonly UserTileMetadata[]): void {
  if (metadata.length === 0) {
    localStorage.removeItem(LS_METADATA_KEY);
    return;
  }

  const cache: UserTileMetadataCache = {
    version: METADATA_CACHE_VERSION,
    revision,
    tiles: [...metadata],
  };
  localStorage.setItem(LS_METADATA_KEY, JSON.stringify(cache));
}

function loadMetadataCache(): LoadedHydratedMetadata | undefined {
  const json = localStorage.getItem(LS_METADATA_KEY);
  if (!json) {
    return undefined;
  }

  try {
    const parsed = parseMetadataCache(JSON.parse(json) as unknown);
    if (!parsed) {
      localStorage.removeItem(LS_METADATA_KEY);
      logger.warn("[user-tile-registration] cleared incompatible metadata cache");
      return undefined;
    }

    if (parsed.metadata.length === 0) {
      return undefined;
    }

    return parsed;
  } catch {
    localStorage.removeItem(LS_METADATA_KEY);
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

function buildHydratedSnapshot(revision: string, metadata: readonly UserTileMetadata[]): HydratedTileMetadataSnapshot {
  const environment = getMindcraftEnvironment();

  return environment.withServices((services) => {
    const { types } = services;
    const tiles = new Map<string, TileDefinitionInput>();

    for (const entry of metadata) {
      const parameterTiles: TileDefinitionInput[] = [];
      let canRegister = true;

      for (const param of entry.params) {
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

      const actionTile =
        entry.kind === "sensor"
          ? new BrainTileSensorDef(entry.key, descriptor)
          : new BrainTileActuatorDef(entry.key, descriptor);
      tiles.set(actionTile.tileId, actionTile);
    }

    return {
      revision,
      tiles: Array.from(tiles.values()).sort((left, right) => left.tileId.localeCompare(right.tileId)),
    };
  });
}

function collectMetadataFromCompile(result: WorkspaceCompileResult): UserTileMetadata[] {
  const metadata: UserTileMetadata[] = [];

  for (const compileResult of result.projectResult.results.values()) {
    if (compileResult.program) {
      metadata.push(metadataFromProgram(compileResult.program));
    }
  }

  metadata.sort((left, right) => left.key.localeCompare(right.key));
  return metadata;
}

export function hydrateUserTilesAtStartup(): void {
  const loaded = loadMetadataCache();
  if (!loaded) {
    return;
  }

  if (loaded.droppedEntries > 0) {
    logger.warn(
      `[user-tile-registration] dropped ${loaded.droppedEntries} incompatible metadata cache entr${loaded.droppedEntries === 1 ? "y" : "ies"}`
    );
  }

  const snapshot = buildHydratedSnapshot(loaded.revision, loaded.metadata);
  if (snapshot.tiles.length === 0) {
    return;
  }

  if (loaded.migrated) {
    persistMetadataCache(snapshot.revision, loaded.metadata);
  }

  getMindcraftEnvironment().hydrateTileMetadata(snapshot);
  logger.info(`[user-tile-registration] hydrated ${snapshot.tiles.length} tile(s) from metadata cache`);
}

export function applyCompiledUserTiles(result: WorkspaceCompileResult): void {
  const bundle = result.bundle;
  if (!bundle) {
    return;
  }

  const metadata = collectMetadataFromCompile(result);

  try {
    persistMetadataCache(bundle.revision, metadata);
  } catch {
    logger.warn("[user-tile-registration] failed to save metadata cache");
  }

  const update = getMindcraftEnvironment().replaceActionBundle(bundle);
  if (metadata.length > 0 || update.changedActionKeys.length > 0) {
    logger.info(
      `[user-tile-registration] applied bundle: ${metadata.length} tile(s), ${update.changedActionKeys.length} changed action(s), ${update.invalidatedBrains.length} invalidated brain(s)`
    );
  }
}
