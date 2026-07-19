import { type CompiledActionBundle, Dict } from "@mindcraft-lang/core";
import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { ProjectCompileResult } from "../compiler/compile.js";
import type { UserAuthoredProgram } from "../compiler/types.js";
import { buildStructTypeTiles, buildUserTileMetadata, type UserTileTypeResolver } from "./user-tile-metadata.js";

/** Options for {@link buildCompiledActionBundle}. */
export interface BuildCompiledActionBundleOptions {
  /** Resolve a parameter type name to its `TypeId`. Defaults to `services.runtime.types.resolveByName`. */
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

/** True when one compilation root carries a TypeScript error or a lowering diagnostic. */
function rootHasBlockingDiagnostics(result: ProjectCompileResult): boolean {
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

function collectPrograms(results: readonly ProjectCompileResult[]): readonly UserAuthoredProgram[] {
  const programs: UserAuthoredProgram[] = [];

  for (const result of results) {
    for (const compileResult of result.results.values()) {
      if (compileResult.program) {
        programs.push(compileResult.program);
      }
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
  return buildMultiRootActionBundle([result], options);
}

/**
 * Build one {@link CompiledActionBundle} from the per-root compile results of
 * a multi-root session, registering each tile if-absent across roots in
 * program `key` order.
 *
 * A root carrying a blocking diagnostic contributes no tiles; every healthy
 * root still contributes its own. A host project whose user code has a compile
 * error therefore does not withhold the tiles of the healthy roots (the
 * installed libraries). Returns undefined only when every root is blocked; a
 * project whose sole root fails then keeps its last good bundle.
 */
export function buildMultiRootActionBundle(
  results: Iterable<ProjectCompileResult>,
  options: BuildCompiledActionBundleOptions
): CompiledActionBundle | undefined {
  const resultList = [...results];
  const healthyResults = resultList.filter((result) => !rootHasBlockingDiagnostics(result));
  if (healthyResults.length === 0 && resultList.length > 0) {
    return undefined;
  }

  const resolveTypeId =
    options.resolveTypeId ?? ((typeName: string) => options.services.runtime.types.resolveByName(typeName));
  const programs = collectPrograms(healthyResults);
  const actions = new Dict<string, UserAuthoredProgram>();
  const tileMap = new Map<string, IBrainTileDef>();

  for (const program of programs) {
    addTiles(tileMap, buildStructTypeTiles(program, options.services));

    // A conversion has no tile surface of its own; its artifact rides the
    // bundle's action table and registers via its conversion metadata.
    if (program.kind === "conversion") {
      actions.set(program.key, program);
      continue;
    }

    const metadata = buildUserTileMetadata(program, resolveTypeId);
    if (!metadata) {
      return undefined;
    }

    actions.set(program.key, program);
    addTiles(tileMap, metadata.parameterTiles);
    addTiles(tileMap, metadata.modifierTiles);
    addTiles(tileMap, metadata.outputTiles);
    addTiles(tileMap, [metadata.actionTile]);
  }

  const tiles = Array.from(tileMap.values()).sort((left, right) => left.tileId.localeCompare(right.tileId));

  return {
    revision: options.revision ?? buildRevision(programs),
    actions,
    tiles,
  };
}
