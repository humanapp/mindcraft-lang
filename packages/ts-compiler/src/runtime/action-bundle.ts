import { assertUnreachable, type CompiledActionBundle, Dict } from "@mindcraft-lang/core";
import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { CompileResult, ProjectCompileResult } from "../compiler/compile.js";
import type { UserAuthoredProgram, UserTileDefinition } from "../compiler/types.js";
import { buildStructTypeTiles, buildUserTileMetadata, type UserTileTypeResolver } from "./user-tile-metadata.js";

/** Options for {@link buildCompiledActionBundle}. */
export interface BuildCompiledActionBundleOptions {
  /** Resolve a parameter type name to its `TypeId`. Defaults to `services.runtime.types.resolveByName`. */
  resolveTypeId?: UserTileTypeResolver;
  /** Override the bundle revision. Defaults to a content hash of the included programs and definitions. */
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

/**
 * True when a single file's compile result contributes to a bundle: the file
 * carries a program (fresh or last-good) or a tile surface definition.
 */
export function compileResultContributes(result: CompileResult): boolean {
  return result.program !== undefined || result.definition !== undefined;
}

/**
 * True when one compilation root still holds a tile-bearing source file that
 * contributed nothing this compile: a per-file compile result carrying an
 * error-severity diagnostic with neither a program nor a surface definition.
 * A file that merely fails to typecheck without bearing a tile does not count,
 * and a file deleted since the previous compile leaves no result at all.
 */
function rootHasBlockedTileFile(result: ProjectCompileResult): boolean {
  for (const compileResult of result.results.values()) {
    if (compileResultContributes(compileResult)) {
      continue;
    }
    if (compileResult.diagnostics.some((diag) => diag.severity === "error")) {
      return true;
    }
  }

  return false;
}

/** The per-root contributions, each sorted by action key. */
interface BundleContributions {
  programs: readonly UserAuthoredProgram[];
  definitions: readonly UserTileDefinition[];
}

function collectContributions(results: readonly ProjectCompileResult[]): BundleContributions {
  const programs: UserAuthoredProgram[] = [];
  const definitions: UserTileDefinition[] = [];

  for (const result of results) {
    for (const compileResult of result.results.values()) {
      if (compileResult.program) {
        programs.push(compileResult.program);
      } else if (compileResult.definition) {
        definitions.push(compileResult.definition);
      }
    }
  }

  programs.sort((left, right) => left.key.localeCompare(right.key));
  definitions.sort((left, right) => left.key.localeCompare(right.key));
  return { programs, definitions };
}

function buildRevision(contributions: BundleContributions): string {
  const surfaces = [...contributions.programs, ...contributions.definitions];
  if (surfaces.length === 0) {
    return "bundle-empty";
  }

  const signature = surfaces.map((surface) => `${surface.key}:${surface.revisionId}`).join("|");
  return `bundle-${hashText(signature)}`;
}

function addTiles(target: Map<string, IBrainTileDef>, tiles: readonly IBrainTileDef[]): void {
  for (const tile of tiles) {
    if (!target.has(tile.tileId)) {
      target.set(tile.tileId, tile);
    }
  }
}

/** Build a {@link CompiledActionBundle} from a {@link ProjectCompileResult}. Returns undefined when nothing contributes and a file failed. */
export function buildCompiledActionBundle(
  result: ProjectCompileResult,
  options: BuildCompiledActionBundleOptions
): CompiledActionBundle | undefined {
  return buildMultiRootActionBundle([result], options);
}

/**
 * Build one {@link CompiledActionBundle} from the per-root compile results of
 * a multi-root session, registering each tile if-absent across roots in
 * action-key order.
 *
 * Contribution is definition presence, per file: a file carrying a program
 * (fresh or last-good) contributes its executable action and its tiles; a
 * file carrying only a tile surface definition contributes its tiles without
 * an action, so the tile is placeable and typechecks while a brain using it
 * reports a link failure. A tile whose surface types cannot be resolved is
 * withheld. Returns undefined only when no file anywhere contributes and every
 * root still holds a tile-bearing file blocked from contributing; a project
 * whose sole tile file is mid-edit then keeps its last good bundle. A project
 * whose tile files are all gone returns an empty bundle, so the host clears the
 * tiles they registered.
 */
export function buildMultiRootActionBundle(
  results: Iterable<ProjectCompileResult>,
  options: BuildCompiledActionBundleOptions
): CompiledActionBundle | undefined {
  const resultList = [...results];

  const resolveTypeId =
    options.resolveTypeId ?? ((typeName: string) => options.services.runtime.types.resolveByName(typeName));
  const contributions = collectContributions(resultList);
  const contributionCount = contributions.programs.length + contributions.definitions.length;
  if (contributionCount === 0 && resultList.length > 0 && resultList.every(rootHasBlockedTileFile)) {
    return undefined;
  }
  const actions = new Dict<string, UserAuthoredProgram>();
  const tileMap = new Map<string, IBrainTileDef>();

  for (const program of contributions.programs) {
    addTiles(tileMap, buildStructTypeTiles(program, options.services));

    switch (program.kind) {
      case "conversion":
        // A conversion has no tile surface of its own; its artifact rides the
        // bundle's action table and registers via its conversion metadata.
        actions.set(program.key, program);
        continue;
      case "sensor":
      case "actuator":
        break;
      default:
        assertUnreachable(program.kind);
    }

    const metadata = buildUserTileMetadata(program, resolveTypeId);
    if (!metadata) {
      continue;
    }

    actions.set(program.key, program);
    addTiles(tileMap, metadata.parameterTiles);
    addTiles(tileMap, metadata.modifierTiles);
    addTiles(tileMap, metadata.outputTiles);
    addTiles(tileMap, [metadata.actionTile]);
  }

  for (const definition of contributions.definitions) {
    const metadata = buildUserTileMetadata(definition, resolveTypeId);
    if (!metadata) {
      continue;
    }
    addTiles(tileMap, metadata.parameterTiles);
    addTiles(tileMap, metadata.modifierTiles);
    addTiles(tileMap, metadata.outputTiles);
    addTiles(tileMap, [metadata.actionTile]);
  }

  const tiles = Array.from(tileMap.values()).sort((left, right) => left.tileId.localeCompare(right.tileId));

  return {
    revision: options.revision ?? buildRevision(contributions),
    actions,
    tiles,
  };
}
