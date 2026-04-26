import { type CompiledActionBundle, Dict } from "@mindcraft-lang/core";
import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { ProjectCompileResult } from "../compiler/compile.js";
import type { UserAuthoredProgram } from "../compiler/types.js";
import { buildUserTileMetadata, type UserTileTypeResolver } from "./user-tile-metadata.js";

/** Options for {@link buildCompiledActionBundle}. */
export interface BuildCompiledActionBundleOptions {
  /** Resolve a parameter type name to its `TypeId`. Defaults to `services.types.resolveByName`. */
  resolveTypeId?: UserTileTypeResolver;
  /** Override the bundle revision. Defaults to a content hash of the included programs. */
  revision?: string;
  services: BrainServices;
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function hasBlockingDiagnostics(result: ProjectCompileResult): boolean {
  if (result.tsErrors.size > 0) {
    return true;
  }

  for (const compileResult of result.results.values()) {
    if (compileResult.diagnostics.length > 0) {
      return true;
    }
  }

  return false;
}

function collectPrograms(result: ProjectCompileResult): readonly UserAuthoredProgram[] {
  const programs: UserAuthoredProgram[] = [];

  for (const compileResult of result.results.values()) {
    if (compileResult.program) {
      programs.push(compileResult.program);
    }
  }

  programs.sort((left, right) => left.key.localeCompare(right.key));
  return programs;
}

function buildRevision(programs: readonly UserAuthoredProgram[]): string {
  if (programs.length === 0) {
    return "bundle-empty";
  }

  const signature = programs.map((program) => `${program.key}:${program.revisionId}`).join("|");
  return `bundle-${hashText(signature)}`;
}

function addTiles(target: Map<string, IBrainTileDef>, tiles: readonly IBrainTileDef[]): void {
  for (const tile of tiles) {
    if (!target.has(tile.tileId)) {
      target.set(tile.tileId, tile);
    }
  }
}

/** Build a {@link CompiledActionBundle} from a {@link ProjectCompileResult}. Returns undefined when the project has blocking diagnostics. */
export function buildCompiledActionBundle(
  result: ProjectCompileResult,
  options: BuildCompiledActionBundleOptions
): CompiledActionBundle | undefined {
  if (hasBlockingDiagnostics(result)) {
    return undefined;
  }

  const resolveTypeId = options.resolveTypeId ?? ((typeName: string) => options.services.types.resolveByName(typeName));
  const programs = collectPrograms(result);
  const actions = new Dict<string, UserAuthoredProgram>();
  const tileMap = new Map<string, IBrainTileDef>();

  for (const program of programs) {
    const metadata = buildUserTileMetadata(program, resolveTypeId);
    if (!metadata) {
      return undefined;
    }

    actions.set(program.key, program);
    addTiles(tileMap, metadata.parameterTiles);
    addTiles(tileMap, [metadata.actionTile]);
  }

  const tiles = Array.from(tileMap.values()).sort((left, right) => left.tileId.localeCompare(right.tileId));

  return {
    revision: options.revision ?? buildRevision(programs),
    actions,
    tiles,
  };
}
