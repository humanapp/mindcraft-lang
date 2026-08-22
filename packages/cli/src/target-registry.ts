import { readFileSync } from "node:fs";
import type { ExtensionCatalogDocumentError, ExtensionCatalogDocumentWarning } from "@wendoo/app-host";
import { parseExtensionCatalogDocument } from "@wendoo/app-host";

/** Stable identifiers for target registry failures. */
export const TargetRegistryErrorCode = {
  /** The bundled registry file could not be read from disk. */
  REGISTRY_UNREADABLE: "TARGET_REGISTRY_UNREADABLE",
  /** The registry content did not validate as a clean catalog document. */
  REGISTRY_PARSE_FAILED: "TARGET_REGISTRY_PARSE_FAILED",
  /** A requested coordinate is not present in the registry. */
  UNKNOWN_TARGET_COORDINATE: "TARGET_REGISTRY_UNKNOWN_COORDINATE",
} as const;

/** Union of all {@link TargetRegistryErrorCode} values. */
export type TargetRegistryErrorCode = (typeof TargetRegistryErrorCode)[keyof typeof TargetRegistryErrorCode];

/**
 * Failure raised by {@link loadTargetRegistry}, {@link parseTargetRegistry},
 * and {@link TargetRegistry.resolve}. Match on {@link code}; the message is
 * secondary human context.
 */
export class TargetRegistryError extends Error {
  /** Stable machine-readable failure code. */
  readonly code: TargetRegistryErrorCode;
  /** Parser errors that rejected the document, when {@link code} is `REGISTRY_PARSE_FAILED`. */
  readonly parseErrors: readonly ExtensionCatalogDocumentError[];
  /** Parser warnings treated as failures, when {@link code} is `REGISTRY_PARSE_FAILED`. */
  readonly parseWarnings: readonly ExtensionCatalogDocumentWarning[];

  /**
   * @param code - Stable failure code.
   * @param message - Human-readable failure context.
   * @param details - Parser diagnostics carried for a parse failure.
   */
  constructor(
    code: TargetRegistryErrorCode,
    message: string,
    details?: {
      readonly parseErrors?: readonly ExtensionCatalogDocumentError[];
      readonly parseWarnings?: readonly ExtensionCatalogDocumentWarning[];
    }
  ) {
    super(message);
    this.name = "TargetRegistryError";
    this.code = code;
    this.parseErrors = details?.parseErrors ?? [];
    this.parseWarnings = details?.parseWarnings ?? [];
  }
}

/** One published target the CLI can resolve to its pinned content. */
export interface TargetRegistryEntry {
  /** The target's `<owner>/<repo>` coordinate. */
  readonly coordinate: string;
  /** Entry kind; one of `"library"` or `"target"`. */
  readonly kind: string;
  /** Display name shown for the target. */
  readonly name: string;
  /** Published version the pin corresponds to. */
  readonly version: string;
  /** Description shown for the target. */
  readonly description: string;
  /** Pinned reference `gh:<coordinate>@<full 40-character commit SHA>`. */
  readonly ref: string;
}

/**
 * The set of targets the CLI ships, each pinned to exact content. Construct one
 * with {@link loadTargetRegistry} or {@link parseTargetRegistry}.
 */
export class TargetRegistry {
  /** The registry's entries, in document order. */
  readonly entries: readonly TargetRegistryEntry[];

  /** @param entries - Validated registry entries in document order. */
  constructor(entries: readonly TargetRegistryEntry[]) {
    this.entries = entries;
  }

  /**
   * Resolve a target coordinate to its pinned reference string.
   *
   * @param coordinate - An `<owner>/<repo>` target coordinate.
   * @returns The entry's `gh:<coordinate>@<sha>` pin.
   * @throws {TargetRegistryError} With code `UNKNOWN_TARGET_COORDINATE` when the
   * coordinate is not in the registry.
   */
  resolve(coordinate: string): string {
    const entry = this.entries.find((candidate) => candidate.coordinate === coordinate);
    if (entry === undefined) {
      throw new TargetRegistryError(
        TargetRegistryErrorCode.UNKNOWN_TARGET_COORDINATE,
        `No target "${coordinate}" is in the registry.`
      );
    }
    return entry.ref;
  }
}

/**
 * Build a {@link TargetRegistry} from catalog document text. Any parser error
 * or warning is a failure: an unknown-kind entry the catalog parser skips with
 * a warning would silently vanish, so a warning rejects the whole document.
 *
 * @param content - JSON text of a `wendoo.catalog/1` document.
 * @throws {TargetRegistryError} With code `REGISTRY_PARSE_FAILED` when the
 * content does not validate cleanly.
 */
export function parseTargetRegistry(content: string): TargetRegistry {
  const result = parseExtensionCatalogDocument(content);
  if (!result.ok) {
    throw new TargetRegistryError(
      TargetRegistryErrorCode.REGISTRY_PARSE_FAILED,
      "Target registry document did not validate.",
      { parseErrors: result.errors }
    );
  }
  if (result.warnings.length > 0) {
    throw new TargetRegistryError(
      TargetRegistryErrorCode.REGISTRY_PARSE_FAILED,
      "Target registry document produced warnings, which are not accepted.",
      { parseWarnings: result.warnings }
    );
  }
  const entries = result.document.entries.map((entry) => ({
    coordinate: entry.coordinate,
    kind: entry.kind,
    name: entry.name,
    version: entry.version,
    description: entry.description,
    ref: entry.ref,
  }));
  return new TargetRegistry(entries);
}

/** Location of the bundled registry file, resolved relative to this module. */
const REGISTRY_FILE_URL = new URL("../targets.json", import.meta.url);

/**
 * Load the registry bundled with the CLI. The file is read relative to this
 * module, so resolution is identical whether the CLI runs from npm, from the
 * built `dist/`, or from `src/` in development, and does not depend on the
 * caller's working directory.
 *
 * @throws {TargetRegistryError} With code `REGISTRY_UNREADABLE` when the file
 * cannot be read, or `REGISTRY_PARSE_FAILED` when it does not validate cleanly.
 */
export function loadTargetRegistry(): TargetRegistry {
  let content: string;
  try {
    content = readFileSync(REGISTRY_FILE_URL, "utf8");
  } catch {
    throw new TargetRegistryError(
      TargetRegistryErrorCode.REGISTRY_UNREADABLE,
      `Could not read the target registry at ${REGISTRY_FILE_URL.pathname}.`
    );
  }
  return parseTargetRegistry(content);
}
