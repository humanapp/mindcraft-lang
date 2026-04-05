import { logger } from "@mindcraft-lang/core";
import type { BrainActionCallSpec } from "@mindcraft-lang/core/brain";
import {
  getBrainServices,
  mkActuatorTileId,
  mkCallDef,
  mkParameterTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/brain";
import { BrainTileActuatorDef, BrainTileParameterDef, BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import type { CompileResult, ExtractedParam, UserAuthoredProgram } from "@mindcraft-lang/ts-compiler";
import {
  deleteUserActionArtifacts,
  publishUserActionArtifacts,
  rebuildActiveBrainsUsingChangedActions,
} from "./brain-runtime";

const LS_METADATA_KEY = "sim:user-tile-metadata";
const METADATA_CACHE_VERSION = 1 as const;

interface RegisteredTileMetadata {
  key: string;
  kind: "sensor" | "actuator";
  name: string;
  callSpec: BrainActionCallSpec;
  params: ExtractedParam[];
  outputType?: string;
  isAsync: boolean;
  parameterTileIds: string[];
}

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
  tiles: UserTileMetadata[];
}

const registeredTiles = new Map<string, RegisteredTileMetadata>();
const fileToActionKey = new Map<string, string>();
const parameterTileRefCounts = new Map<string, number>();
const userOwnedParameterTileIds = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === "number";
}

function isDefaultValue(value: unknown): value is ExtractedParam["defaultValue"] {
  return (
    value === undefined ||
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

function isExtractedParam(value: unknown): value is ExtractedParam {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.required === "boolean" &&
    typeof value.anonymous === "boolean" &&
    isDefaultValue(value.defaultValue)
  );
}

function isCallSpec(value: unknown): value is BrainActionCallSpec {
  if (!isRecord(value) || typeof value.type !== "string" || !isOptionalString(value.name)) {
    return false;
  }

  switch (value.type) {
    case "arg":
      return (
        typeof value.tileId === "string" && isOptionalBoolean(value.required) && isOptionalBoolean(value.anonymous)
      );
    case "seq":
    case "bag":
      return Array.isArray(value.items) && value.items.every(isCallSpec);
    case "choice":
      return Array.isArray(value.options) && value.options.every(isCallSpec);
    case "optional":
      return isCallSpec(value.item);
    case "repeat":
      return isCallSpec(value.item) && isOptionalNumber(value.min) && isOptionalNumber(value.max);
    case "conditional":
      return (
        typeof value.condition === "string" &&
        isCallSpec(value.then) &&
        (value.else === undefined || isCallSpec(value.else))
      );
    default:
      return false;
  }
}

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

function persistMetadataCache(metadata: readonly UserTileMetadata[]): void {
  if (metadata.length === 0) {
    localStorage.removeItem(LS_METADATA_KEY);
    return;
  }

  const cache: UserTileMetadataCache = {
    version: METADATA_CACHE_VERSION,
    tiles: [...metadata],
  };
  localStorage.setItem(LS_METADATA_KEY, JSON.stringify(cache));
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

function parseMetadataCache(
  raw: unknown
): { metadata: UserTileMetadata[]; migrated: boolean; droppedEntries: number } | undefined {
  if (Array.isArray(raw)) {
    const { metadata, droppedEntries } = collectCachedEntries(raw);
    return {
      metadata,
      migrated: true,
      droppedEntries,
    };
  }

  if (!isRecord(raw) || raw.version !== METADATA_CACHE_VERSION || !Array.isArray(raw.tiles)) {
    return undefined;
  }

  const { metadata, droppedEntries } = collectCachedEntries(raw.tiles);
  return {
    metadata,
    migrated: droppedEntries > 0,
    droppedEntries,
  };
}

function getActionTileId(kind: "sensor" | "actuator", key: string): string {
  return kind === "sensor" ? mkSensorTileId(key) : mkActuatorTileId(key);
}

function getParameterId(tileName: string, param: ExtractedParam): string {
  return param.anonymous ? `anon.${param.type}` : `user.${tileName}.${param.name}`;
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

function retainParameterTiles(metadata: UserTileMetadata): string[] {
  const { tiles, types } = getBrainServices();
  const parameterTileIds: string[] = [];
  const seenTileIds = new Set<string>();

  for (const param of metadata.params) {
    const parameterId = getParameterId(metadata.name, param);
    const parameterTileId = mkParameterTileId(parameterId);
    if (seenTileIds.has(parameterTileId)) {
      continue;
    }

    seenTileIds.add(parameterTileId);
    parameterTileIds.push(parameterTileId);
    parameterTileRefCounts.set(parameterTileId, (parameterTileRefCounts.get(parameterTileId) ?? 0) + 1);

    if (tiles.has(parameterTileId)) {
      continue;
    }

    const typeId = types.resolveByName(param.type);
    if (!typeId) {
      logger.warn(`[user-tile-registration] unknown parameter type "${param.type}" for "${metadata.key}"`);
      continue;
    }

    tiles.registerTileDef(new BrainTileParameterDef(parameterId, typeId));
    userOwnedParameterTileIds.add(parameterTileId);
  }

  return parameterTileIds;
}

function releaseParameterTiles(parameterTileIds: readonly string[]): void {
  const { tiles } = getBrainServices();

  for (const parameterTileId of parameterTileIds) {
    const currentRefCount = parameterTileRefCounts.get(parameterTileId);
    if (currentRefCount === undefined) {
      continue;
    }

    if (currentRefCount <= 1) {
      parameterTileRefCounts.delete(parameterTileId);
      if (userOwnedParameterTileIds.has(parameterTileId)) {
        tiles.delete(parameterTileId);
        userOwnedParameterTileIds.delete(parameterTileId);
      }
      continue;
    }

    parameterTileRefCounts.set(parameterTileId, currentRefCount - 1);
  }
}

function deleteRegisteredTile(key: string): void {
  const registeredTile = registeredTiles.get(key);
  if (!registeredTile) {
    return;
  }

  const { tiles } = getBrainServices();
  tiles.delete(getActionTileId(registeredTile.kind, registeredTile.key));
  releaseParameterTiles(registeredTile.parameterTileIds);
  registeredTiles.delete(key);
}

function resolveMetadataOutputType(outputType: string | undefined): string | undefined {
  if (outputType === undefined) {
    return undefined;
  }

  const { types } = getBrainServices();
  if (types.get(outputType)) {
    return outputType;
  }

  return types.resolveByName(outputType);
}

function registerMetadata(metadata: UserTileMetadata): boolean {
  deleteRegisteredTile(metadata.key);

  const { tiles, types } = getBrainServices();
  const descriptor = {
    key: metadata.key,
    kind: metadata.kind,
    callDef: mkCallDef(metadata.callSpec),
    isAsync: metadata.isAsync,
    outputType: resolveMetadataOutputType(metadata.outputType),
  };

  if (metadata.kind === "sensor" && descriptor.outputType === undefined) {
    logger.warn(`[user-tile-registration] unknown output type "${metadata.outputType}" for "${metadata.key}"`);
    return false;
  }

  const parameterTileIds = retainParameterTiles(metadata);
  const actionTile =
    metadata.kind === "sensor"
      ? new BrainTileSensorDef(metadata.key, descriptor)
      : new BrainTileActuatorDef(metadata.key, descriptor);

  if (tiles.has(actionTile.tileId)) {
    tiles.delete(actionTile.tileId);
  }

  tiles.registerTileDef(actionTile);
  registeredTiles.set(metadata.key, {
    key: metadata.key,
    kind: metadata.kind,
    name: metadata.name,
    callSpec: metadata.callSpec,
    params: metadata.params,
    outputType: metadata.outputType,
    isAsync: metadata.isAsync,
    parameterTileIds,
  });
  return true;
}

function saveMetadataCache(): void {
  const metadata: UserTileMetadata[] = Array.from(registeredTiles.values()).map((entry) => ({
    key: entry.key,
    kind: entry.kind,
    name: entry.name,
    callSpec: entry.callSpec,
    params: entry.params,
    outputType: entry.outputType,
    isAsync: entry.isAsync,
  }));

  try {
    persistMetadataCache(metadata);
  } catch {
    logger.warn("[user-tile-registration] failed to save metadata cache");
  }
}

function loadMetadataCache(): UserTileMetadata[] | undefined {
  const json = localStorage.getItem(LS_METADATA_KEY);
  if (!json) return undefined;

  try {
    const parsed = parseMetadataCache(JSON.parse(json) as unknown);
    if (!parsed) {
      localStorage.removeItem(LS_METADATA_KEY);
      logger.warn("[user-tile-registration] cleared incompatible metadata cache");
      return undefined;
    }

    if (parsed.migrated) {
      persistMetadataCache(parsed.metadata);
      if (parsed.droppedEntries > 0) {
        logger.warn(
          `[user-tile-registration] dropped ${parsed.droppedEntries} incompatible metadata cache entr${parsed.droppedEntries === 1 ? "y" : "ies"}`
        );
      }
    }

    if (parsed.metadata.length === 0) {
      return undefined;
    }

    return parsed.metadata;
  } catch {
    localStorage.removeItem(LS_METADATA_KEY);
    logger.warn("[user-tile-registration] cleared unreadable metadata cache");
    return undefined;
  }
}

function registerFromCache(): void {
  const metadata = loadMetadataCache();
  if (!metadata || metadata.length === 0) {
    return;
  }

  for (const meta of metadata) {
    registerMetadata(meta);
  }

  logger.info(`[user-tile-registration] registered ${metadata.length} tile(s) from metadata cache`);
}

function removeMissingFiles(results: ReadonlyMap<string, CompileResult>): string[] {
  const currentPaths = new Set(results.keys());
  const removedKeys: string[] = [];

  for (const [path, key] of fileToActionKey) {
    if (currentPaths.has(path)) {
      continue;
    }

    fileToActionKey.delete(path);
    deleteRegisteredTile(key);
    removedKeys.push(key);
    logger.info(`[user-tile-registration] removed tile "${key}" (file deleted)`);
  }

  return removedKeys;
}

export function registerUserTilesAtStartup(): void {
  registerFromCache();
}

export function handleRecompilation(results: ReadonlyMap<string, CompileResult>, hasTypeErrors: boolean): void {
  if (hasTypeErrors) {
    return;
  }

  let added = 0;
  let updated = 0;
  let removed = 0;
  const programs: UserAuthoredProgram[] = [];
  const staleArtifactKeys = new Set<string>();
  const removedArtifactKeys: string[] = [];

  const previousFileCount = fileToActionKey.size;
  for (const key of removeMissingFiles(results)) {
    staleArtifactKeys.add(key);
  }
  removed += previousFileCount - fileToActionKey.size;

  for (const [path, result] of results) {
    if (!result.program) {
      continue;
    }

    const program = result.program;
    const previousKey = fileToActionKey.get(path);
    const hadRegistration = registeredTiles.has(program.key);

    if (previousKey && previousKey !== program.key) {
      deleteRegisteredTile(previousKey);
      staleArtifactKeys.add(previousKey);
      removed++;
    }

    if (!registerMetadata(metadataFromProgram(program))) {
      continue;
    }

    fileToActionKey.set(path, program.key);
    programs.push(program);

    if (!hadRegistration || previousKey !== program.key) {
      added++;
    } else {
      updated++;
    }
  }

  const liveKeys = new Set(fileToActionKey.values());
  for (const key of staleArtifactKeys) {
    if (!liveKeys.has(key)) {
      removedArtifactKeys.push(key);
    }
  }

  for (const key of Array.from(registeredTiles.keys())) {
    if (!liveKeys.has(key)) {
      deleteRegisteredTile(key);
      removedArtifactKeys.push(key);
      removed++;
    }
  }

  deleteUserActionArtifacts(removedArtifactKeys);
  const changedRevisions = publishUserActionArtifacts(programs);
  saveMetadataCache();
  rebuildActiveBrainsUsingChangedActions(changedRevisions);

  if (added > 0 || updated > 0 || removed > 0 || changedRevisions.size > 0) {
    logger.info(
      `[user-tile-registration] recompile: ${added} added, ${updated} updated, ${removed} removed, ${changedRevisions.size} rebuilt`
    );
  }
}
