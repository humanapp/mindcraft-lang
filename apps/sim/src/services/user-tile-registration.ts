import { Dict, List, logger } from "@mindcraft-lang/core";
import type { BrainActionCallSpec, BrainProgram, HostAsyncFn } from "@mindcraft-lang/core/brain";
import { mkCallDef } from "@mindcraft-lang/core/brain";
import type { CompileResult, ExtractedParam, UserAuthoredProgram, UserTileLinkInfo } from "@mindcraft-lang/typescript";
import { linkUserPrograms, registerUserTile } from "@mindcraft-lang/typescript";
import { getAllCompileResults } from "./user-tile-compiler";

const LS_METADATA_KEY = "sim:user-tile-metadata";

const noOpHostFn: HostAsyncFn = {
  exec() {},
};

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

export function registerUserTilesAtStartup(): void {
  const results = getAllCompileResults();
  const programs = collectPrograms(results);

  if (programs.length > 0) {
    registerPrograms(programs);
    saveMetadataCache(programs);
    logger.info(`[user-tile-registration] registered ${programs.length} tile(s) from compilation`);
  } else {
    registerFromCache();
  }
}
