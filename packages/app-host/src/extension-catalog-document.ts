import type { ExtensionTarget } from "./project-content-manifest.js";
import { isExtensionCoordinate, parseExtensionReference, validateProjectTargets } from "./project-content-manifest.js";

/** Format marker of a Mindcraft extension catalog document. */
export const MINDCRAFT_CATALOG_FORMAT = "mindcraft.catalog/1";

/** The one entry kind this format defines. */
export const CATALOG_ENTRY_KIND_EXTENSION = "library";

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

/**
 * One entry of an extension catalog document: an approved extension pinned to
 * exact content, with the display metadata a browser renders without fetching
 * the content.
 */
export interface ExtensionCatalogDocumentEntry {
  /** The extension's `<owner>/<repo>` coordinate. */
  readonly coordinate: string;
  /** Trust semantics of the entry's pin; `"library"` is the only kind this format defines. */
  readonly kind: string;
  /**
   * The pinned reference an install of this entry writes:
   * `gh:<coordinate>@<full 40-character commit SHA>`, naming exactly the
   * approved content.
   */
  readonly ref: string;
  /** Display name shown for the entry. */
  readonly name: string;
  /** Published version the pin corresponds to. */
  readonly version: string;
  /** Description shown for the entry. */
  readonly description: string;
  /**
   * Platform-compatibility targets keyed by target package `<owner>/<repo>`
   * coordinate; present only when the entry declares them.
   */
  readonly targets?: Readonly<Record<string, ExtensionTarget>>;
  /** Thumbnail URL or data URI; present only when the entry declares one. */
  readonly thumbnail?: string;
}

/** A parsed extension catalog document. */
export interface ExtensionCatalogDocument {
  /** The document's format marker ({@link MINDCRAFT_CATALOG_FORMAT}). */
  readonly format: string;
  /** The catalog's entries, in document order, with unknown-kind entries skipped. */
  readonly entries: readonly ExtensionCatalogDocumentEntry[];
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
  if (value.kind !== CATALOG_ENTRY_KIND_EXTENSION) {
    return {
      skip: {
        code: ExtensionCatalogDocumentWarningCode.UNKNOWN_ENTRY_KIND,
        path: `${path}.kind`,
        message: `Catalog entry kind "${value.kind}" is not known to this format; the entry is skipped.`,
      },
    };
  }

  const errors: ExtensionCatalogDocumentError[] = [];

  if (!isExtensionCoordinate(value.coordinate)) {
    errors.push({
      code: ExtensionCatalogDocumentErrorCode.INVALID_COORDINATE,
      path: `${path}.coordinate`,
      message: 'Catalog entry coordinate must be an "<owner>/<repo>" coordinate.',
    });
  }

  const parsedRef = typeof value.ref === "string" ? parseExtensionReference(value.ref) : undefined;
  if (
    parsedRef === undefined ||
    parsedRef.transport !== "gh" ||
    parsedRef.routing.kind !== "pin" ||
    !FULL_COMMIT_SHA_PATTERN.test(parsedRef.routing.pin)
  ) {
    errors.push({
      code: ExtensionCatalogDocumentErrorCode.INVALID_REF,
      path: `${path}.ref`,
      message: 'Catalog entry ref must be "gh:<owner>/<repo>@<full 40-character commit SHA>".',
    });
  } else if (isExtensionCoordinate(value.coordinate) && `${parsedRef.owner}/${parsedRef.repo}` !== value.coordinate) {
    errors.push({
      code: ExtensionCatalogDocumentErrorCode.INVALID_REF,
      path: `${path}.ref`,
      message: `Catalog entry ref names "${parsedRef.owner}/${parsedRef.repo}", not the entry coordinate "${value.coordinate}".`,
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
      kind: CATALOG_ENTRY_KIND_EXTENSION,
      ref: value.ref as string,
      name: value.name as string,
      version: value.version as string,
      description: value.description as string,
      ...(targets !== undefined ? { targets } : {}),
      ...(typeof value.thumbnail === "string" ? { thumbnail: value.thumbnail } : {}),
    },
  };
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
  for (const [index, entryValue] of (value.entries as readonly unknown[]).entries()) {
    const result = validateEntry(entryValue, `$.entries[${index}]`);
    if ("entry" in result) {
      entries.push(result.entry);
    } else if ("skip" in result) {
      warnings.push(result.skip);
    } else {
      errors.push(...result.errors);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, document: { format: MINDCRAFT_CATALOG_FORMAT, entries }, warnings, errors: [] };
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
