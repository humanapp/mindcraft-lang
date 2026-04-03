import { Dict, List, logger } from "@mindcraft-lang/core";
import type { BrainActionCallSpec, BrainProgram, HostAsyncFn } from "@mindcraft-lang/core/brain";
import { getBrainServices, mkActuatorTileId, mkCallDef, mkSensorTileId } from "@mindcraft-lang/core/brain";
import type { CompileResult, ExtractedParam, UserAuthoredProgram, UserTileLinkInfo } from "@mindcraft-lang/typescript";
import { linkUserPrograms, registerUserTile } from "@mindcraft-lang/typescript";
import { getAllCompileResults } from "./user-tile-compiler";

const LS_METADATA_KEY = "sim:user-tile-metadata";

const noOpHostFn: HostAsyncFn = {
  exec() {},
};

interface RegisteredTileInfo {
  tileId: string;
  kind: "sensor" | "actuator";
  name: string;
}

const registeredTiles = new Map<string, RegisteredTileInfo>();
const tileChangedListeners = new Set<() => void>();

function makeTileId(kind: "sensor" | "actuator", name: string): string {
  return `user.${kind}.${name}`;
}

function makeCatalogTileId(kind: "sensor" | "actuator", tileId: string): string {
  return kind === "sensor" ? mkSensorTileId(tileId) : mkActuatorTileId(tileId);
}

export function onUserTilesChanged(fn: () => void): () => void {
  tileChangedListeners.add(fn);
  return () => {
    tileChangedListeners.delete(fn);
  };
}

function notifyUserTilesChanged(): void {
  for (const fn of tileChangedListeners) {
    fn();
  }
}

interface UserTileMetadata {
  kind: "sensor" | "actuator";
  name: string;
  callSpec: BrainActionCallSpec;
  params: ExtractedParam[];
  outputType?: string;
}

function createEmptyBrainProgram(): BrainProgram {
  return {
    version: 0,
    functions: List.empty(),
    constants: List.empty(),
    variableNames: List.empty(),
    entryPoint: 0,
    ruleIndex: Dict.empty(),
    pages: List.empty(),
  };
}

function collectPrograms(results: ReadonlyMap<string, CompileResult>): UserAuthoredProgram[] {
  const programs: UserAuthoredProgram[] = [];
  for (const [, result] of results) {
    if (result.program) programs.push(result.program);
  }
  return programs;
}

function registerPrograms(programs: UserAuthoredProgram[]): void {
  const emptyProgram = createEmptyBrainProgram();
  const { userLinks } = linkUserPrograms(emptyProgram, programs);
  for (const linkInfo of userLinks) {
    registerUserTile(linkInfo, noOpHostFn);
  }
}

export function saveMetadataCache(programs: UserAuthoredProgram[]): void {
  const metadata: UserTileMetadata[] = programs.map((p) => ({
    kind: p.kind,
    name: p.name,
    callSpec: p.callDef.callSpec as BrainActionCallSpec,
    params: p.params,
    outputType: p.outputType,
  }));
  try {
    localStorage.setItem(LS_METADATA_KEY, JSON.stringify(metadata));
  } catch {
    logger.warn("[user-tile-registration] failed to save metadata cache");
  }
}

function loadMetadataCache(): UserTileMetadata[] | undefined {
  const json = localStorage.getItem(LS_METADATA_KEY);
  if (!json) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function metadataToProgram(meta: UserTileMetadata): UserAuthoredProgram {
  return {
    kind: meta.kind,
    name: meta.name,
    callDef: mkCallDef(meta.callSpec),
    outputType: meta.outputType,
    params: meta.params,
    version: 0,
    functions: List.empty(),
    constants: List.empty(),
    variableNames: List.empty(),
    numCallsiteVars: 0,
    entryFuncId: 0,
    execIsAsync: false,
    lifecycleFuncIds: {},
    programRevisionId: "",
  };
}

function registerFromCache(): boolean {
  const metadata = loadMetadataCache();
  if (!metadata || metadata.length === 0) return false;

  for (const meta of metadata) {
    const program = metadataToProgram(meta);
    const linkInfo: UserTileLinkInfo = {
      program,
      linkedEntryFuncId: 0,
    };
    registerUserTile(linkInfo, noOpHostFn);
  }
  logger.info(`[user-tile-registration] registered ${metadata.length} tile(s) from metadata cache`);
  return true;
}

function populateTrackingMap(results: ReadonlyMap<string, CompileResult>): void {
  for (const [path, result] of results) {
    if (result.program) {
      const tileId = makeTileId(result.program.kind, result.program.name);
      registeredTiles.set(path, { tileId, kind: result.program.kind, name: result.program.name });
    }
  }
}

export function registerUserTilesAtStartup(): void {
  const results = getAllCompileResults();
  const programs = collectPrograms(results);

  if (programs.length > 0) {
    registerPrograms(programs);
    saveMetadataCache(programs);
    populateTrackingMap(results);
    logger.info(`[user-tile-registration] registered ${programs.length} tile(s) from compilation`);
  } else {
    registerFromCache();
  }
}

export function handleRecompilation(results: ReadonlyMap<string, CompileResult>, hasTypeErrors: boolean): void {
  if (results.size === 0 && hasTypeErrors) return;

  const { tiles } = getBrainServices();
  let added = 0;
  let updated = 0;
  let removed = 0;

  const newFileToProgram = new Map<string, UserAuthoredProgram>();
  for (const [path, result] of results) {
    if (result.program) newFileToProgram.set(path, result.program);
  }

  const newTileIdsByFile = new Map<string, string>();
  for (const [path, program] of newFileToProgram) {
    newTileIdsByFile.set(path, makeTileId(program.kind, program.name));
  }

  for (const [path, reg] of registeredTiles) {
    const newTileId = newTileIdsByFile.get(path);
    if (!newTileId || newTileId !== reg.tileId) {
      const catalogId = makeCatalogTileId(reg.kind, reg.tileId);
      tiles.delete(catalogId);
      registeredTiles.delete(path);
      if (!newTileId) {
        removed++;
        logger.info(`[user-tile-registration] removed tile "${reg.tileId}" (file deleted)`);
      }
    }
  }

  const programs = [...newFileToProgram.values()];
  if (programs.length > 0) {
    registerPrograms(programs);
  }

  for (const [path, program] of newFileToProgram) {
    const tileId = makeTileId(program.kind, program.name);
    const existing = registeredTiles.get(path);
    if (!existing) {
      added++;
    } else if (existing.tileId !== tileId) {
      added++;
    } else {
      updated++;
    }
    registeredTiles.set(path, { tileId, kind: program.kind, name: program.name });
  }

  for (const [path] of registeredTiles) {
    if (!newFileToProgram.has(path)) {
      registeredTiles.delete(path);
    }
  }

  if (programs.length > 0) {
    saveMetadataCache(programs);
  } else if (!hasTypeErrors) {
    saveMetadataCache([]);
  }

  if (added > 0 || removed > 0 || updated > 0) {
    logger.info(`[user-tile-registration] recompile: ${added} added, ${updated} updated, ${removed} removed`);
    notifyUserTilesChanged();
  }
}
