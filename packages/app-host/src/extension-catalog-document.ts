import type { ExtensionTarget } from "./project-content-manifest.js";
import { isExtensionCoordinate, parseExtensionReference, validateProjectTargets } from "./project-content-manifest.js";

/** Format marker of a Mindcraft extension catalog document. */
export const MINDCRAFT_CATALOG_FORMAT = "mindcraft.catalog/1";

/** Entry kind for a library the catalog approves for installation. */
export const CATALOG_ENTRY_KIND_EXTENSION = "library";

/** Entry kind for a hostable platform target a CLI resolves by alias or coordinate. */
export const CATALOG_ENTRY_KIND_TARGET = "target";

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

const CATALOG_ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * One entry of an extension catalog document: an approved extension pinned to
 * exact content, with the display metadata a browser renders without fetching
 * the content.
 */
export interface ExtensionCatalogDocumentEntry {
  /** The extension's `<owner>/<repo>` coordinate. */
  readonly coordinate: string;
  /** Entry kind; one of `"library"` or `"target"`. */
  readonly kind: string;
  /**
   * The reference an install of this entry writes: either
   * `gh:<coordinate>@<full 40-character commit SHA>` naming exact remote
   * content, or `embedded:<coordinate>` naming a host-bundled library.
   */
  readonly ref: string;
  /** Display name shown for the entry. */
  readonly name: string;
  /** Version shown for the entry as a display string. */
  readonly version: string;
  /** Description shown for the entry. */
  readonly description: string;
  /**
   * Curated shell-friendly handle for a `"target"` entry: lowercase
   * alphanumerics and hyphens with no leading hyphen (`^[a-z0-9][a-z0-9-]*$`)
   * and not all digits, unique within the document compared case-insensitively.
   * Allowed only on `"target"` entries; present only when the entry declares one.
   */
  readonly alias?: string;
  /**
   * Platform-compatibility targets keyed by target package `<owner>/<repo>`
   * coordinate; present only when the entry declares them.
   */
  readonly targets?: Readonly<Record<string, ExtensionTarget>>;
  /** Thumbnail URL or data URI; present only when the entry declares one. */
  readonly thumbnail?: string;
}

/**
 * One curated transport-flip move: a coordinate's content is now served from a
 * new reference for the same coordinate. The catalog authority (PR-reviewed,
 * pinned) declares moves; they are never read from fetched package content.
 */
export interface ExtensionCatalogMove {
  /**
   * The reference the coordinate now resolves through:
   * `gh:<owner>/<repo>@<full 40-character commit SHA>`, whose `<owner>/<repo>`
   * equals the move's coordinate key (a same-coordinate flip).
   */
  readonly ref: string;
}

/**
 * A catalog document's curated moves, keyed by the `<owner>/<repo>` coordinate
 * being redirected. Empty when the document declares none.
 */
export type ExtensionCatalogMoves = Readonly<Record<string, ExtensionCatalogMove>>;

/** A parsed extension catalog document. */
export interface ExtensionCatalogDocument {
  /** The document's format marker ({@link MINDCRAFT_CATALOG_FORMAT}). */
  readonly format: string;
  /** The catalog's entries, in document order, with unknown-kind entries skipped. */
  readonly entries: readonly ExtensionCatalogDocumentEntry[];
  /**
   * Curated transport-flip moves keyed by coordinate; always present, empty
   * when the document declares none.
   */
  readonly moves: ExtensionCatalogMoves;
}

/** Stable identifiers for catalog document validation errors. */
export const ExtensionCatalogDocumentErrorCode = {
  INVALID_JSON: "CATALOG_DOCUMENT_INVALID_JSON",
  INVALID_ROOT: "CATALOG_DOCUMENT_INVALID_ROOT",
  INVALID_FORMAT: "CATALOG_DOCUMENT_INVALID_FORMAT",
  INVALID_ENTRIES: "CATALOG_DOCUMENT_INVALID_ENTRIES",
  INVALID_ENTRY: "CATALOG_DOCUMENT_INVALID_ENTRY",
  INVALID_COORDINATE: "CATALOG_DOCUMENT_INVALID_COORDINATE",
  INVALID_REF: "CATALOG_DOCUMENT_INVALID_REF",
  INVALID_ALIAS: "CATALOG_DOCUMENT_INVALID_ALIAS",
  DUPLICATE_ALIAS: "CATALOG_DOCUMENT_DUPLICATE_ALIAS",
  ALIAS_NOT_ALLOWED: "CATALOG_DOCUMENT_ALIAS_NOT_ALLOWED",
  INVALID_MOVES: "CATALOG_DOCUMENT_INVALID_MOVES",
  INVALID_MOVE_REF: "CATALOG_DOCUMENT_INVALID_MOVE_REF",
  NUMERIC_ALIAS: "CATALOG_DOCUMENT_NUMERIC_ALIAS",
} as const;

/** Union of all {@link ExtensionCatalogDocumentErrorCode} values. */
export type ExtensionCatalogDocumentErrorCode =
  (typeof ExtensionCatalogDocumentErrorCode)[keyof typeof ExtensionCatalogDocumentErrorCode];

/** Stable identifiers for non-fatal catalog document validation warnings. */
export const ExtensionCatalogDocumentWarningCode = {
  /** The entry's kind is not one this format defines; the entry is skipped. */
  UNKNOWN_ENTRY_KIND: "CATALOG_DOCUMENT_UNKNOWN_ENTRY_KIND",
} as const;

/** Union of all {@link ExtensionCatalogDocumentWarningCode} values. */
export type ExtensionCatalogDocumentWarningCode =
  (typeof ExtensionCatalogDocumentWarningCode)[keyof typeof ExtensionCatalogDocumentWarningCode];

/** Validation error for a rejected catalog document. */
export interface ExtensionCatalogDocumentError {
  /** Stable machine-readable error code. */
  readonly code: ExtensionCatalogDocumentErrorCode;
  /** JSON path of the rejected field. */
  readonly path: string;
  /** Human-readable error message. */
  readonly message: string;
}

/** Non-fatal validation warning for an accepted catalog document. */
export interface ExtensionCatalogDocumentWarning {
  /** Stable machine-readable warning code. */
  readonly code: ExtensionCatalogDocumentWarningCode;
  /** JSON path of the entry the warning is about. */
  readonly path: string;
  /** Human-readable warning message. */
  readonly message: string;
}

/** Result of validating or parsing an extension catalog document. */
export type ExtensionCatalogDocumentParseResult =
  | {
      /** True when a valid catalog document was produced. */
      readonly ok: true;
      /** Parsed catalog document. */
      readonly document: ExtensionCatalogDocument;
      /** Non-fatal warnings, one per skipped unknown-kind entry. */
      readonly warnings: readonly ExtensionCatalogDocumentWarning[];
      /** Empty error list for a valid document. */
      readonly errors: readonly [];
    }
  | {
      /** False when validation rejected the document. */
      readonly ok: false;
      /** Validation errors. */
      readonly errors: readonly ExtensionCatalogDocumentError[];
    };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate one catalog entry. Returns the entry, a warning for an
 * unknown-kind entry to skip, or the errors that reject it.
 */
function validateEntry(
  value: unknown,
  path: string
):
  | { entry: ExtensionCatalogDocumentEntry }
  | { skip: ExtensionCatalogDocumentWarning }
  | { errors: ExtensionCatalogDocumentError[] } {
  if (!isRecord(value)) {
    return {
      errors: [
        {
          code: ExtensionCatalogDocumentErrorCode.INVALID_ENTRY,
          path,
          message: "Catalog entry must be an object.",
        },
      ],
    };
  }

  if (typeof value.kind !== "string") {
    return {
      errors: [
        {
          code: ExtensionCatalogDocumentErrorCode.INVALID_ENTRY,
          path: `${path}.kind`,
          message: "Catalog entry kind must be a string.",
        },
      ],
    };
  }
  if (value.kind !== CATALOG_ENTRY_KIND_EXTENSION && value.kind !== CATALOG_ENTRY_KIND_TARGET) {
    return {
      skip: {
        code: ExtensionCatalogDocumentWarningCode.UNKNOWN_ENTRY_KIND,
        path: `${path}.kind`,
        message: `Catalog entry kind "${value.kind}" is not known to this format; the entry is skipped.`,
      },
    };
  }
  const kind = value.kind;

  const errors: ExtensionCatalogDocumentError[] = [];

  if (!isExtensionCoordinate(value.coordinate)) {
    errors.push({
      code: ExtensionCatalogDocumentErrorCode.INVALID_COORDINATE,
      path: `${path}.coordinate`,
      message: 'Catalog entry coordinate must be an "<owner>/<repo>" coordinate.',
    });
  }

  const parsedRef = typeof value.ref === "string" ? parseExtensionReference(value.ref) : undefined;
  if (parsedRef === undefined) {
    errors.push({
      code: ExtensionCatalogDocumentErrorCode.INVALID_REF,
      path: `${path}.ref`,
      message:
        'Catalog entry ref must be "gh:<owner>/<repo>@<full 40-character commit SHA>" or "embedded:<owner>/<repo>".',
    });
  } else if (parsedRef.transport === "gh") {
    if (parsedRef.routing.kind !== "pin" || !FULL_COMMIT_SHA_PATTERN.test(parsedRef.routing.pin)) {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.INVALID_REF,
        path: `${path}.ref`,
        message: 'Catalog entry "gh:" ref must be pinned to a full 40-character commit SHA.',
      });
    } else if (isExtensionCoordinate(value.coordinate) && `${parsedRef.owner}/${parsedRef.repo}` !== value.coordinate) {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.INVALID_REF,
        path: `${path}.ref`,
        message: `Catalog entry ref names "${parsedRef.owner}/${parsedRef.repo}", not the entry coordinate "${value.coordinate}".`,
      });
    }
  } else if (parsedRef.transport === "embedded") {
    if (isExtensionCoordinate(value.coordinate) && parsedRef.coordinate !== value.coordinate) {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.INVALID_REF,
        path: `${path}.ref`,
        message: `Catalog entry ref names "${parsedRef.coordinate}", not the entry coordinate "${value.coordinate}".`,
      });
    }
  } else {
    errors.push({
      code: ExtensionCatalogDocumentErrorCode.INVALID_REF,
      path: `${path}.ref`,
      message: 'Catalog entry ref transport must be "gh" or "embedded".',
    });
  }

  for (const field of ["name", "version", "description"] as const) {
    if (typeof value[field] !== "string") {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.INVALID_ENTRY,
        path: `${path}.${field}`,
        message: `Catalog entry ${field} must be a string.`,
      });
    }
  }

  let targets: Readonly<Record<string, ExtensionTarget>> | undefined;
  if (value.targets !== undefined) {
    const targetErrors = validateProjectTargets(value.targets);
    if (targetErrors.length > 0) {
      errors.push(
        ...targetErrors.map((error) => ({
          code: ExtensionCatalogDocumentErrorCode.INVALID_ENTRY,
          path: `${path}.targets`,
          message: error.message,
        }))
      );
    } else if (Object.keys(value.targets as Record<string, unknown>).length > 0) {
      targets = value.targets as Readonly<Record<string, ExtensionTarget>>;
    }
  }

  if (value.alias !== undefined) {
    if (kind !== CATALOG_ENTRY_KIND_TARGET) {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.ALIAS_NOT_ALLOWED,
        path: `${path}.alias`,
        message: `Catalog entry alias is allowed only on "${CATALOG_ENTRY_KIND_TARGET}" entries, not "${kind}" entries.`,
      });
    } else if (typeof value.alias !== "string" || !CATALOG_ALIAS_PATTERN.test(value.alias)) {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.INVALID_ALIAS,
        path: `${path}.alias`,
        message:
          "Catalog entry alias must be lowercase alphanumerics and hyphens with no leading hyphen (^[a-z0-9][a-z0-9-]*$).",
      });
    } else if (/^[0-9]+$/.test(value.alias)) {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.NUMERIC_ALIAS,
        path: `${path}.alias`,
        message: "Catalog entry alias must not be all digits, so it cannot be confused with a list index.",
      });
    }
  }

  if (value.thumbnail !== undefined && typeof value.thumbnail !== "string") {
    errors.push({
      code: ExtensionCatalogDocumentErrorCode.INVALID_ENTRY,
      path: `${path}.thumbnail`,
      message: "Catalog entry thumbnail must be a string when present.",
    });
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    entry: {
      coordinate: value.coordinate as string,
      kind,
      ref: value.ref as string,
      name: value.name as string,
      version: value.version as string,
      description: value.description as string,
      ...(typeof value.alias === "string" ? { alias: value.alias } : {}),
      ...(targets !== undefined ? { targets } : {}),
      ...(typeof value.thumbnail === "string" ? { thumbnail: value.thumbnail } : {}),
    },
  };
}

/**
 * Validate a catalog document's `moves` section: an object keyed by
 * `<owner>/<repo>` coordinate, each value an object whose `ref` is a `gh:`
 * reference pinned to a full 40-character commit SHA naming the key coordinate.
 * Returns the well-formed moves and one error per rejected entry.
 */
function validateExtensionCatalogMoves(value: unknown): {
  moves: ExtensionCatalogMoves;
  errors: ExtensionCatalogDocumentError[];
} {
  if (!isRecord(value)) {
    return {
      moves: {},
      errors: [
        {
          code: ExtensionCatalogDocumentErrorCode.INVALID_MOVES,
          path: "$.moves",
          message: "$.moves must be an object when present.",
        },
      ],
    };
  }
  const errors: ExtensionCatalogDocumentError[] = [];
  const moves: Record<string, ExtensionCatalogMove> = {};
  for (const [coordinate, entry] of Object.entries(value)) {
    const path = `$.moves[${JSON.stringify(coordinate)}]`;
    if (!isExtensionCoordinate(coordinate)) {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.INVALID_MOVES,
        path,
        message: `Catalog move key "${coordinate}" must be an "<owner>/<repo>" coordinate.`,
      });
      continue;
    }
    if (!isRecord(entry) || typeof entry.ref !== "string") {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.INVALID_MOVE_REF,
        path: `${path}.ref`,
        message: `Catalog move "${coordinate}" must be an object with a string "ref".`,
      });
      continue;
    }
    const parsedRef = parseExtensionReference(entry.ref);
    if (
      parsedRef === undefined ||
      parsedRef.transport !== "gh" ||
      parsedRef.routing.kind !== "pin" ||
      !FULL_COMMIT_SHA_PATTERN.test(parsedRef.routing.pin)
    ) {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.INVALID_MOVE_REF,
        path: `${path}.ref`,
        message: `Catalog move "${coordinate}" ref must be "gh:<owner>/<repo>@<full 40-character commit SHA>".`,
      });
      continue;
    }
    if (`${parsedRef.owner}/${parsedRef.repo}` !== coordinate) {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.INVALID_MOVE_REF,
        path: `${path}.ref`,
        message: `Catalog move ref names "${parsedRef.owner}/${parsedRef.repo}", not the move coordinate "${coordinate}".`,
      });
      continue;
    }
    moves[coordinate] = { ref: entry.ref };
  }
  return { moves, errors };
}

/**
 * Redirect an extension reference through a catalog moves table: when a move
 * targets the reference's coordinate and its target differs from the reference,
 * return the move's target reference; otherwise return the reference unchanged.
 * The coordinate is read from the reference's transport (`embedded:<coordinate>`
 * or `gh:<owner>/<repo>`), and an unparseable reference is returned unchanged.
 *
 * @param reference - The extension reference to redirect.
 * @param moves - The catalog moves table, keyed by coordinate.
 */
export function applyCatalogMove(reference: string, moves: ExtensionCatalogMoves): string {
  const parsed = parseExtensionReference(reference);
  if (parsed === undefined) {
    return reference;
  }
  const coordinate = parsed.transport === "embedded" ? parsed.coordinate : `${parsed.owner}/${parsed.repo}`;
  const move = moves[coordinate];
  if (move === undefined || move.ref === reference) {
    return reference;
  }
  return move.ref;
}

/**
 * Validate a parsed extension catalog document. An entry whose kind is not one
 * this format defines is skipped with a warning; any other invalid field
 * rejects the document.
 *
 * @param value - Parsed JSON value of a catalog document.
 */
export function validateExtensionCatalogDocument(value: unknown): ExtensionCatalogDocumentParseResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [
        {
          code: ExtensionCatalogDocumentErrorCode.INVALID_ROOT,
          path: "$",
          message: "Catalog document root must be an object.",
        },
      ],
    };
  }
  if (value.format !== MINDCRAFT_CATALOG_FORMAT) {
    return {
      ok: false,
      errors: [
        {
          code: ExtensionCatalogDocumentErrorCode.INVALID_FORMAT,
          path: "$.format",
          message: `Catalog document format must be "${MINDCRAFT_CATALOG_FORMAT}".`,
        },
      ],
    };
  }
  if (!Array.isArray(value.entries)) {
    return {
      ok: false,
      errors: [
        {
          code: ExtensionCatalogDocumentErrorCode.INVALID_ENTRIES,
          path: "$.entries",
          message: "$.entries must be an array.",
        },
      ],
    };
  }

  const entries: ExtensionCatalogDocumentEntry[] = [];
  const warnings: ExtensionCatalogDocumentWarning[] = [];
  const errors: ExtensionCatalogDocumentError[] = [];
  const aliasFirstIndex = new Map<string, number>();
  for (const [index, entryValue] of (value.entries as readonly unknown[]).entries()) {
    const result = validateEntry(entryValue, `$.entries[${index}]`);
    if ("entry" in result) {
      entries.push(result.entry);
      if (result.entry.alias !== undefined) {
        const aliasKey = result.entry.alias.toLowerCase();
        const priorIndex = aliasFirstIndex.get(aliasKey);
        if (priorIndex === undefined) {
          aliasFirstIndex.set(aliasKey, index);
        } else {
          errors.push({
            code: ExtensionCatalogDocumentErrorCode.DUPLICATE_ALIAS,
            path: `$.entries[${index}].alias`,
            message: `Catalog entry alias "${result.entry.alias}" duplicates the alias at $.entries[${priorIndex}] (compared case-insensitively).`,
          });
        }
      }
    } else if ("skip" in result) {
      warnings.push(result.skip);
    } else {
      errors.push(...result.errors);
    }
  }

  let moves: ExtensionCatalogMoves = {};
  if (value.moves !== undefined) {
    const movesResult = validateExtensionCatalogMoves(value.moves);
    moves = movesResult.moves;
    errors.push(...movesResult.errors);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, document: { format: MINDCRAFT_CATALOG_FORMAT, entries, moves }, warnings, errors: [] };
}

/**
 * Parse and validate an extension catalog document from JSON text.
 *
 * @param content - JSON text of a catalog document.
 */
export function parseExtensionCatalogDocument(content: string): ExtensionCatalogDocumentParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: ExtensionCatalogDocumentErrorCode.INVALID_JSON,
          path: "$",
          message: "Catalog document is not valid JSON.",
        },
      ],
    };
  }
  return validateExtensionCatalogDocument(parsed);
}
