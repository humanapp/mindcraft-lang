import type { ActionKind, BrainActionCallSpec, MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { logger, mkActionTileId } from "@mindcraft-lang/core/app";
import type { ActionKey } from "@mindcraft-lang/core/runtime";
import type {
  CompileDiagnostic,
  ExtractedArgSpec,
  ExtractedOutput,
  UserAuthoredProgram,
  UserTileDefinition,
  WorkspaceCompileResult,
} from "@mindcraft-lang/ts-compiler";

/** Metadata describing a user-authored sensor or actuator tile. */
export interface UserTileMetadata {
  /** Stable key used to identify the tile across compiles. */
  key: string;
  /**
   * Namespace of the project that compiled this tile: a host project's store id
   * or an installed extension's `<owner>/<repo>` coordinate.
   */
  namespace: string;
  /** Opaque stable id from the source declaration. */
  id: string;
  /** The tile-bearing action kind; conversions surface no tile and are excluded. */
  kind: Exclude<ActionKind, "conversion">;
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

/** Result returned by {@link applyCompiledUserTiles}. */
export interface UserTileApplyResult {
  metadata: readonly UserTileMetadata[];
  /** Action keys whose call definition changed since the previous bundle. */
  changedActionKeys: readonly string[];
  /** Number of brains invalidated by the change. */
  invalidatedBrainCount: number;
}

function metadataFromProgram(program: UserAuthoredProgram | UserTileDefinition): UserTileMetadata {
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

/**
 * Extract user-tile metadata from a compile result, sorted by key. Includes a
 * metadata entry for every contributing file of every compilation root -- the
 * host project and each installed extension, each keyed under its own
 * namespace -- matching the files whose tiles enter the compiled bundle.
 */
export function collectMetadataFromCompile(result: WorkspaceCompileResult): UserTileMetadata[] {
  const metadata: UserTileMetadata[] = [];

  for (const rootResult of result.rootResults) {
    for (const compileResult of rootResult.results.values()) {
      const surface = compileResult.program ?? compileResult.definition;
      // Conversions compile to a program but surface no tiles, so they contribute no tile metadata.
      if (surface && surface.kind !== "conversion") {
        metadata.push(metadataFromProgram(surface));
      }
    }
  }

  metadata.sort((left, right) => left.key.localeCompare(right.key));
  return metadata;
}

/**
 * A user tile's error compile diagnostics together with the source file path
 * that produced them. `path` is the compilation-root path keyed by the tile's
 * {@link ActionKey}; a consumer composes a source location from `path` and each
 * diagnostic's `line`/`column`.
 */
export interface TileCompileDiagnostics {
  /** Compilation-root path of the source file that contributed the tile. */
  readonly path: string;
  /** The file's error compile diagnostics, verbatim and in emit order. */
  readonly diagnostics: readonly CompileDiagnostic[];
}

/**
 * Map each user tile's {@link ActionKey} to the error compile diagnostics of the
 * source file that contributed it and that source's path, built from a single
 * workspace compile. Iterates every compilation root's per-file results, keying
 * by `(program ?? definition).key` and collecting that file's compile errors:
 * the TypeScript pre-emit diagnostics (`tsErrors` for the file's path) together
 * with the result's own descriptor, lowering, and emit diagnostics, filtered to
 * `severity === "error"`. Conversions surface no tile and are excluded. A file
 * that compiled cleanly, or produced only warnings and infos, is absent from the
 * map.
 *
 * The stored diagnostics are the compiler's verbatim {@link CompileDiagnostic}
 * objects, so a consumer reads `message`, `severity`, and `line`/`column` directly.
 */
export function collectTileSourceCompileErrors(result: WorkspaceCompileResult): Map<ActionKey, TileCompileDiagnostics> {
  const byKey = new Map<ActionKey, TileCompileDiagnostics>();

  for (const rootResult of result.rootResults) {
    for (const [path, compileResult] of rootResult.results) {
      const surface = compileResult.program ?? compileResult.definition;
      // Conversions compile to a program but surface no tile, so they contribute no tile diagnostics.
      if (!surface || surface.kind === "conversion") {
        continue;
      }
      const tsErrors = rootResult.tsErrors.get(path) ?? [];
      const diagnostics = [...tsErrors, ...compileResult.diagnostics].filter(
        (diagnostic) => diagnostic.severity === "error"
      );
      if (diagnostics.length > 0) {
        byKey.set(surface.key, { path, diagnostics });
      }
    }
  }

  return byKey;
}

/**
 * Apply the user-tile bundle from a project compile result to the environment.
 * Returns `undefined` when the compile produced no bundle.
 */
export function applyCompiledUserTiles(
  env: MindcraftEnvironment,
  result: WorkspaceCompileResult
): UserTileApplyResult | undefined {
  const bundle = result.bundle;
  if (!bundle) {
    return undefined;
  }

  const metadata = collectMetadataFromCompile(result);

  const update = env.replaceActionBundle(bundle);
  if (metadata.length > 0 || update.changedActionKeys.length > 0) {
    logger.debug(
      `[user-tile-registration] applied bundle: ${metadata.length} tile(s), ${update.changedActionKeys.length} changed action(s), ${update.invalidatedBrains.length} invalidated brain(s)`
    );
    for (const entry of metadata) {
      const tileId = mkActionTileId(entry.kind, entry.key);
      logger.debug(`[user-tile-registration]   ${tileId}`);
    }
  }

  return {
    metadata,
    changedActionKeys: update.changedActionKeys,
    invalidatedBrainCount: update.invalidatedBrains.length,
  };
}
