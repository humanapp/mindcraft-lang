import type { ExtensionTarget } from "./project-content-manifest.js";
import { isExtensionCoordinate, parseExtensionReference, validateProjectTargets } from "./project-content-manifest.js";
import { isSupportedVersionRange, satisfiesRange } from "./semver-range.js";

/** Format marker of a Wendoo extension catalog document. */
export const WENDOO_CATALOG_FORMAT = "wendoo.catalog/1";

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

/** Transport a catalog move selector matches: the reference's delivery scheme. */
export type ExtensionCatalogMoveTransport = "gh" | "embedded";

/**
 * Object-form source selector of a catalog move entry. At least one field is
 * present. When `transport` is given, the entry captures only references on
 * that transport; when `packageVersion` is given, the entry captures only
 * references whose resolved content version satisfies the range (a branch
 * reference has no version and is never captured by a range).
 */
export interface ExtensionCatalogMoveObjectSelector {
  /** Transport the captured reference must use. */
  readonly transport?: ExtensionCatalogMoveTransport;
  /** Semver range the captured reference's resolved content version must satisfy. */
  readonly packageVersion?: string;
}

/**
 * Source selector of a catalog move entry: an exact full reference string
 * (captures only a reference structurally equal to it), or an object selector
 * over transport and version range.
 */
export type ExtensionCatalogMoveSelector = string | ExtensionCatalogMoveObjectSelector;

/**
 * One curated catalog move entry for a source coordinate. The catalog authority
 * (PR-reviewed, pinned) declares moves; they are never read from fetched
 * package content.
 *
 * `ref` is the destination reference: `embedded:<owner>/<repo>`,
 * `gh:<owner>/<repo>@<sha-or-tag>`, `gh:<owner>/<repo>#<branch>`, or the
 * floating form `gh:<owner>/<repo>` with no component, which resolves to the
 * highest stable published version at migration time (the resolved pin is what
 * gets persisted; stored manifests never hold a floating reference). A
 * destination whose coordinate differs from the move key is a rename.
 *
 * `from` selects which references of the key coordinate the entry captures.
 * When absent, the entry captures every reference of the coordinate that is
 * not already on the destination's (coordinate, transport) pair -- a reference
 * already on that pair keeps its own component.
 */
export interface ExtensionCatalogMoveEntry {
  /** Source selector; absent for the default selector. */
  readonly from?: ExtensionCatalogMoveSelector;
  /** Destination reference. */
  readonly ref: string;
}

/**
 * A catalog document's curated moves: for each source `<owner>/<repo>`
 * coordinate, the move entries that capture its references. Empty when the
 * document declares none. The document form accepts one entry or an array per
 * key; the parsed form always carries an array.
 */
export type ExtensionCatalogMoves = Readonly<Record<string, readonly ExtensionCatalogMoveEntry[]>>;

/** A parsed extension catalog document. */
export interface ExtensionCatalogDocument {
  /** The document's format marker ({@link WENDOO_CATALOG_FORMAT}). */
  readonly format: string;
  /** The catalog's entries, in document order, with unknown-kind entries skipped. */
  readonly entries: readonly ExtensionCatalogDocumentEntry[];
  /**
   * Curated moves keyed by source coordinate; always present, empty when the
   * document declares none.
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
  INVALID_MOVE_FROM: "CATALOG_DOCUMENT_INVALID_MOVE_FROM",
  UNSUPPORTED_MOVE_RANGE: "CATALOG_DOCUMENT_UNSUPPORTED_MOVE_RANGE",
  DUPLICATE_MOVE_SELECTOR: "CATALOG_DOCUMENT_DUPLICATE_MOVE_SELECTOR",
  FLOATING_MOVE_SELECTOR: "CATALOG_DOCUMENT_FLOATING_MOVE_SELECTOR",
  MOVE_CYCLE: "CATALOG_DOCUMENT_MOVE_CYCLE",
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

// ---------------------------------------------------------------------------
// Move reference shapes
// ---------------------------------------------------------------------------

const GH_FLOATING_REFERENCE_PATTERN = /^gh:([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;

/** Parsed parts of a catalog move reference. */
export interface CatalogMoveReferenceParts {
  /** The reference's transport. */
  readonly transport: ExtensionCatalogMoveTransport;
  /** The reference's `<owner>/<repo>` coordinate. */
  readonly coordinate: string;
  /** True for the floating `gh:<owner>/<repo>` form with no pin or branch component. */
  readonly floating: boolean;
}

/** The shape a move reference is compared and rewritten as: transport, coordinate, and component. */
interface MoveReferenceShape {
  readonly transport: ExtensionCatalogMoveTransport;
  readonly coordinate: string;
  /** Pin or branch component; absent for `embedded:` references and the floating `gh:` form. */
  readonly component?: { readonly kind: "pin" | "branch"; readonly value: string };
}

/** Parse a reference string into a move shape, accepting the floating `gh:<owner>/<repo>` form. */
function parseMoveReferenceShape(reference: string): MoveReferenceShape | undefined {
  const parsed = parseExtensionReference(reference);
  if (parsed !== undefined) {
    if (parsed.transport === "embedded") {
      return { transport: "embedded", coordinate: parsed.coordinate };
    }
    const value = parsed.routing.kind === "pin" ? parsed.routing.pin : parsed.routing.branch;
    return {
      transport: "gh",
      coordinate: `${parsed.owner}/${parsed.repo}`,
      component: { kind: parsed.routing.kind, value },
    };
  }
  const floating = GH_FLOATING_REFERENCE_PATTERN.exec(reference);
  if (floating) {
    return { transport: "gh", coordinate: `${floating[1]}/${floating[2]}` };
  }
  return undefined;
}

/** Serialize a move shape back to its reference string. */
function serializeMoveReferenceShape(shape: MoveReferenceShape): string {
  if (shape.transport === "embedded") {
    return `embedded:${shape.coordinate}`;
  }
  if (shape.component === undefined) {
    return `gh:${shape.coordinate}`;
  }
  const separator = shape.component.kind === "pin" ? "@" : "#";
  return `gh:${shape.coordinate}${separator}${shape.component.value}`;
}

/**
 * Canonical comparison key of a move shape. Coordinates compare
 * case-insensitively (GitHub owner and repository names are case-insensitive);
 * transports and components compare exactly.
 */
function canonicalMoveShapeKey(shape: MoveReferenceShape): string {
  const component =
    shape.component === undefined ? "" : `${shape.component.kind === "pin" ? "@" : "#"}${shape.component.value}`;
  return `${shape.transport}:${shape.coordinate.toLowerCase()}${component}`;
}

/** Report whether two coordinates name the same repository, compared case-insensitively. */
function sameCoordinate(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Parse a catalog move reference into its transport, coordinate, and floating
 * flag, accepting `embedded:<owner>/<repo>`, `gh:<owner>/<repo>@<pin>`,
 * `gh:<owner>/<repo>#<branch>`, and the floating `gh:<owner>/<repo>` form.
 * Returns `undefined` for an unrecognized form.
 *
 * @param reference - The reference string to parse.
 */
export function parseCatalogMoveReference(reference: string): CatalogMoveReferenceParts | undefined {
  const shape = parseMoveReferenceShape(reference);
  if (shape === undefined) {
    return undefined;
  }
  return {
    transport: shape.transport,
    coordinate: shape.coordinate,
    floating: shape.transport === "gh" && shape.component === undefined,
  };
}

// ---------------------------------------------------------------------------
// Move application
// ---------------------------------------------------------------------------

/**
 * Resolves the content version of a reference, for evaluating a move entry's
 * `packageVersion` selector. Returns `undefined` when the version is not
 * determinable from the content currently at hand.
 */
export type CatalogMoveVersionLookup = (reference: string) => string | undefined;

/** Stable identifiers for catalog move application failures. */
export const CatalogMoveApplyErrorCode = {
  /** More than one move entry captures the same reference. */
  AMBIGUOUS_CAPTURE: "CATALOG_MOVE_AMBIGUOUS_CAPTURE",
  /** Applying the moves revisited a reference shape already on the rewrite chain. */
  CYCLE: "CATALOG_MOVE_CYCLE",
} as const;

/** Union of all {@link CatalogMoveApplyErrorCode} values. */
export type CatalogMoveApplyErrorCode = (typeof CatalogMoveApplyErrorCode)[keyof typeof CatalogMoveApplyErrorCode];

/** Result of applying a catalog moves table to one reference. */
export type CatalogMoveApplication =
  | {
      /** True when application completed. */
      readonly ok: true;
      /**
       * The final reference after the rewrite chain; the input reference when
       * nothing captured it. May be a floating `gh:<owner>/<repo>` reference,
       * which the caller's fetch machinery resolves to a pin.
       */
      readonly reference: string;
      /** True when the reference was rewritten. */
      readonly moved: boolean;
      /**
       * True when a `packageVersion` selector on the final reference's
       * coordinate could not be evaluated because the reference's version is
       * not determinable yet. Re-apply once the version is known.
       */
      readonly pendingVersion: boolean;
    }
  | {
      /** False when application failed. */
      readonly ok: false;
      /** Stable failure code. */
      readonly code: CatalogMoveApplyErrorCode;
      /** The reference the failure occurred at. */
      readonly reference: string;
      /** Human-readable failure message naming the chain or competing entries. */
      readonly message: string;
    };

/** The move entries declared for a coordinate, matched case-insensitively. */
function moveEntriesForCoordinate(
  moves: ExtensionCatalogMoves,
  coordinate: string
): readonly ExtensionCatalogMoveEntry[] {
  const direct = moves[coordinate];
  if (direct !== undefined) {
    return direct;
  }
  const lower = coordinate.toLowerCase();
  for (const [key, entries] of Object.entries(moves)) {
    if (key.toLowerCase() === lower) {
      return entries;
    }
  }
  return [];
}

/** Parse a move entry's destination reference, throwing on a shape a validated document cannot carry. */
function requireMoveReferenceShape(reference: string): MoveReferenceShape {
  const shape = parseMoveReferenceShape(reference);
  if (shape === undefined) {
    throw new Error(`Catalog move reference "${reference}" is not a valid move reference.`);
  }
  return shape;
}

/** One entry's capture verdict for a shape: whether it captures now, and whether a version range is pending. */
function evaluateMoveEntry(
  shape: MoveReferenceShape,
  entry: ExtensionCatalogMoveEntry,
  versionLookup: CatalogMoveVersionLookup | undefined
): { captured: boolean; pending: boolean } {
  const destination = requireMoveReferenceShape(entry.ref);
  // Universal idempotence guard: a reference structurally equal to the entry's
  // destination is never captured.
  if (canonicalMoveShapeKey(shape) === canonicalMoveShapeKey(destination)) {
    return { captured: false, pending: false };
  }
  const from = entry.from;
  if (from === undefined) {
    const onDestinationPair =
      shape.transport === destination.transport && sameCoordinate(shape.coordinate, destination.coordinate);
    return { captured: !onDestinationPair, pending: false };
  }
  if (typeof from === "string") {
    const fromShape = requireMoveReferenceShape(from);
    return { captured: canonicalMoveShapeKey(shape) === canonicalMoveShapeKey(fromShape), pending: false };
  }
  if (from.transport !== undefined && from.transport !== shape.transport) {
    return { captured: false, pending: false };
  }
  if (from.packageVersion !== undefined) {
    if (shape.component?.kind === "branch") {
      // A branch reference has no version; a range never captures it.
      return { captured: false, pending: false };
    }
    if (shape.transport === "gh" && shape.component === undefined) {
      // A floating shape has no version until it resolves to a pin.
      return { captured: false, pending: true };
    }
    const version = versionLookup?.(serializeMoveReferenceShape(shape));
    if (version === undefined) {
      return { captured: false, pending: true };
    }
    return { captured: satisfiesRange(version, from.packageVersion), pending: false };
  }
  return { captured: true, pending: false };
}

/**
 * Apply a catalog moves table to one extension reference, following the
 * rewrite chain to its fixpoint. At each step, the entries declared for the
 * reference's coordinate are evaluated; the single capturing entry's
 * destination becomes the next reference. Application ends at the first
 * reference no entry captures.
 *
 * An unparseable reference is returned unchanged. More than one entry
 * capturing the same reference fails with
 * {@link CatalogMoveApplyErrorCode.AMBIGUOUS_CAPTURE}; revisiting a reference
 * shape already on the chain fails with
 * {@link CatalogMoveApplyErrorCode.CYCLE}.
 *
 * @param reference - The extension reference to redirect.
 * @param moves - The catalog moves table, keyed by source coordinate.
 * @param versionLookup - Resolves reference versions for `packageVersion`
 *   selectors; a selector whose version is unavailable does not capture and
 *   marks the result `pendingVersion`.
 */
export function applyCatalogMove(
  reference: string,
  moves: ExtensionCatalogMoves,
  versionLookup?: CatalogMoveVersionLookup
): CatalogMoveApplication {
  const start = parseMoveReferenceShape(reference);
  if (start === undefined) {
    return { ok: true, reference, moved: false, pendingVersion: false };
  }
  const visited = new Set([canonicalMoveShapeKey(start)]);
  const chain = [serializeMoveReferenceShape(start)];
  let shape = start;
  let pendingVersion = false;
  while (true) {
    const entries = moveEntriesForCoordinate(moves, shape.coordinate);
    const capturing: ExtensionCatalogMoveEntry[] = [];
    pendingVersion = false;
    for (const entry of entries) {
      const verdict = evaluateMoveEntry(shape, entry, versionLookup);
      if (verdict.captured) {
        capturing.push(entry);
      }
      if (verdict.pending) {
        pendingVersion = true;
      }
    }
    if (capturing.length > 1) {
      return {
        ok: false,
        code: CatalogMoveApplyErrorCode.AMBIGUOUS_CAPTURE,
        reference: serializeMoveReferenceShape(shape),
        message:
          `Catalog move entries ${capturing.map((entry) => JSON.stringify(entry.ref)).join(" and ")} ` +
          `both capture "${serializeMoveReferenceShape(shape)}".`,
      };
    }
    if (capturing.length === 0) {
      const moved = canonicalMoveShapeKey(shape) !== canonicalMoveShapeKey(start);
      return { ok: true, reference: moved ? serializeMoveReferenceShape(shape) : reference, moved, pendingVersion };
    }
    const next = requireMoveReferenceShape(capturing[0].ref);
    if (visited.has(canonicalMoveShapeKey(next))) {
      return {
        ok: false,
        code: CatalogMoveApplyErrorCode.CYCLE,
        reference,
        message: `Catalog moves cycle: ${[...chain, serializeMoveReferenceShape(next)].join(" -> ")}.`,
      };
    }
    visited.add(canonicalMoveShapeKey(next));
    chain.push(serializeMoveReferenceShape(next));
    shape = next;
  }
}

// ---------------------------------------------------------------------------
// Move validation
// ---------------------------------------------------------------------------

/** Report whether a selector can capture a reference on the given (coordinate, gh) pair. */
function selectorCanCaptureGhCoordinate(from: ExtensionCatalogMoveSelector | undefined, coordinate: string): boolean {
  if (from === undefined) {
    // The default selector excludes references already on the destination pair.
    return false;
  }
  if (typeof from === "string") {
    const shape = parseMoveReferenceShape(from);
    return shape !== undefined && shape.transport === "gh" && sameCoordinate(shape.coordinate, coordinate);
  }
  return from.transport === undefined || from.transport === "gh";
}

/** Validate one move entry for a key coordinate. Returns the entry or the errors that reject it. */
function validateMoveEntry(
  keyCoordinate: string,
  value: unknown,
  path: string
): { entry: ExtensionCatalogMoveEntry } | { errors: ExtensionCatalogDocumentError[] } {
  if (!isRecord(value) || typeof value.ref !== "string") {
    return {
      errors: [
        {
          code: ExtensionCatalogDocumentErrorCode.INVALID_MOVE_REF,
          path: `${path}.ref`,
          message: `Catalog move for "${keyCoordinate}" must be an object with a string "ref".`,
        },
      ],
    };
  }
  const errors: ExtensionCatalogDocumentError[] = [];
  const destination = parseMoveReferenceShape(value.ref);
  if (destination === undefined) {
    errors.push({
      code: ExtensionCatalogDocumentErrorCode.INVALID_MOVE_REF,
      path: `${path}.ref`,
      message:
        `Catalog move ref for "${keyCoordinate}" must be "embedded:<owner>/<repo>", "gh:<owner>/<repo>@<pin>", ` +
        '"gh:<owner>/<repo>#<branch>", or the floating "gh:<owner>/<repo>".',
    });
  }

  let from: ExtensionCatalogMoveSelector | undefined;
  if (value.from !== undefined) {
    if (typeof value.from === "string") {
      const fromParsed = parseExtensionReference(value.from);
      if (fromParsed === undefined) {
        errors.push({
          code: ExtensionCatalogDocumentErrorCode.INVALID_MOVE_FROM,
          path: `${path}.from`,
          message: `Catalog move "from" for "${keyCoordinate}" must be a full extension reference.`,
        });
      } else {
        const fromCoordinate =
          fromParsed.transport === "embedded" ? fromParsed.coordinate : `${fromParsed.owner}/${fromParsed.repo}`;
        if (!sameCoordinate(fromCoordinate, keyCoordinate)) {
          errors.push({
            code: ExtensionCatalogDocumentErrorCode.INVALID_MOVE_FROM,
            path: `${path}.from`,
            message: `Catalog move "from" names "${fromCoordinate}", not the move key "${keyCoordinate}".`,
          });
        } else if (
          destination !== undefined &&
          canonicalMoveShapeKey(requireMoveReferenceShape(value.from)) === canonicalMoveShapeKey(destination)
        ) {
          errors.push({
            code: ExtensionCatalogDocumentErrorCode.INVALID_MOVE_FROM,
            path: `${path}.from`,
            message: `Catalog move "from" for "${keyCoordinate}" equals the entry's "ref".`,
          });
        } else {
          from = value.from;
        }
      }
    } else if (isRecord(value.from)) {
      const selector = value.from;
      const selectorErrors: ExtensionCatalogDocumentError[] = [];
      if (selector.transport !== undefined && selector.transport !== "gh" && selector.transport !== "embedded") {
        selectorErrors.push({
          code: ExtensionCatalogDocumentErrorCode.INVALID_MOVE_FROM,
          path: `${path}.from.transport`,
          message: `Catalog move "from.transport" for "${keyCoordinate}" must be "gh" or "embedded".`,
        });
      }
      if (selector.packageVersion !== undefined) {
        if (typeof selector.packageVersion !== "string" || !isSupportedVersionRange(selector.packageVersion)) {
          selectorErrors.push({
            code: ExtensionCatalogDocumentErrorCode.UNSUPPORTED_MOVE_RANGE,
            path: `${path}.from.packageVersion`,
            message:
              `Catalog move "from.packageVersion" for "${keyCoordinate}" must be a semver range the range ` +
              "evaluator supports.",
          });
        }
      }
      if (selector.transport === undefined && selector.packageVersion === undefined) {
        selectorErrors.push({
          code: ExtensionCatalogDocumentErrorCode.INVALID_MOVE_FROM,
          path: `${path}.from`,
          message: `Catalog move "from" for "${keyCoordinate}" must carry "transport" and/or "packageVersion".`,
        });
      }
      if (selectorErrors.length > 0) {
        errors.push(...selectorErrors);
      } else {
        from = {
          ...(selector.transport !== undefined
            ? { transport: selector.transport as ExtensionCatalogMoveTransport }
            : {}),
          ...(selector.packageVersion !== undefined ? { packageVersion: selector.packageVersion as string } : {}),
        };
      }
    } else {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.INVALID_MOVE_FROM,
        path: `${path}.from`,
        message: `Catalog move "from" for "${keyCoordinate}" must be a reference string or a selector object.`,
      });
    }
  }

  // A floating destination is resolved once, at migration time. A selector
  // able to capture references already on the destination's (coordinate, gh)
  // pair would re-capture on every load.
  if (
    errors.length === 0 &&
    destination !== undefined &&
    destination.transport === "gh" &&
    destination.component === undefined &&
    sameCoordinate(destination.coordinate, keyCoordinate) &&
    selectorCanCaptureGhCoordinate(from, destination.coordinate)
  ) {
    errors.push({
      code: ExtensionCatalogDocumentErrorCode.FLOATING_MOVE_SELECTOR,
      path: `${path}.from`,
      message:
        `Catalog move for "${keyCoordinate}" pairs a floating destination with a selector that captures ` +
        "references already on the destination's coordinate and transport.",
    });
  }

  if (errors.length > 0) {
    return { errors };
  }
  return { entry: { ...(from !== undefined ? { from } : {}), ref: value.ref } };
}

/**
 * Validate a catalog document's `moves` section: an object keyed by source
 * `<owner>/<repo>` coordinate, each value one move entry or an array of them.
 * Structural disjointness is enforced per key (one default selector, exact
 * selectors pairwise distinct), the floating-destination selector rule is
 * enforced per entry, and the whole set is checked for statically visible
 * rewrite cycles by applying it to every entry's destination. Returns the
 * parsed moves (always array-valued) and one error per rejected finding.
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
  const moves: Record<string, ExtensionCatalogMoveEntry[]> = {};
  for (const [coordinate, raw] of Object.entries(value)) {
    const path = `$.moves[${JSON.stringify(coordinate)}]`;
    if (!isExtensionCoordinate(coordinate)) {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.INVALID_MOVES,
        path,
        message: `Catalog move key "${coordinate}" must be an "<owner>/<repo>" coordinate.`,
      });
      continue;
    }
    const isArray = Array.isArray(raw);
    const rawEntries: readonly unknown[] = isArray ? (raw as readonly unknown[]) : [raw];
    const entries: ExtensionCatalogMoveEntry[] = [];
    let rejected = false;
    for (const [index, rawEntry] of rawEntries.entries()) {
      const entryPath = isArray ? `${path}[${index}]` : path;
      const result = validateMoveEntry(coordinate, rawEntry, entryPath);
      if ("errors" in result) {
        errors.push(...result.errors);
        rejected = true;
      } else {
        entries.push(result.entry);
      }
    }
    if (rejected) {
      continue;
    }
    // Structural disjointness: at most one default selector per key, and exact
    // selectors pairwise structurally distinct. Overlap this cannot see (range
    // vs range, pin vs range) is caught by the apply-time ambiguity failure.
    const defaultCount = entries.filter((entry) => entry.from === undefined).length;
    if (defaultCount > 1) {
      errors.push({
        code: ExtensionCatalogDocumentErrorCode.DUPLICATE_MOVE_SELECTOR,
        path,
        message: `Catalog moves for "${coordinate}" declare ${defaultCount} entries without a "from" selector.`,
      });
      continue;
    }
    const exactKeys = new Set<string>();
    let duplicateExact = false;
    for (const entry of entries) {
      if (typeof entry.from !== "string") {
        continue;
      }
      const key = canonicalMoveShapeKey(requireMoveReferenceShape(entry.from));
      if (exactKeys.has(key)) {
        errors.push({
          code: ExtensionCatalogDocumentErrorCode.DUPLICATE_MOVE_SELECTOR,
          path,
          message: `Catalog moves for "${coordinate}" declare two entries with the exact "from" ${JSON.stringify(entry.from)}.`,
        });
        duplicateExact = true;
        break;
      }
      exactKeys.add(key);
    }
    if (duplicateExact) {
      continue;
    }
    moves[coordinate] = entries;
  }

  if (errors.length === 0) {
    // Cycle check on the destination-application graph: apply the full move
    // set to every entry's concrete destination; a revisited shape is a
    // statically visible loop. Version ranges do not capture here (versions
    // are unknown at parse), so resolution-dependent loops remain a runtime
    // concern of the apply-time visited-set guard.
    for (const [coordinate, entries] of Object.entries(moves)) {
      for (const [index, entry] of entries.entries()) {
        const result = applyCatalogMove(entry.ref, moves, () => undefined);
        if (result.ok) {
          continue;
        }
        const path = `$.moves[${JSON.stringify(coordinate)}][${index}].ref`;
        errors.push({
          code:
            result.code === CatalogMoveApplyErrorCode.CYCLE
              ? ExtensionCatalogDocumentErrorCode.MOVE_CYCLE
              : ExtensionCatalogDocumentErrorCode.DUPLICATE_MOVE_SELECTOR,
          path,
          message: result.message,
        });
      }
    }
  }
  return { moves, errors };
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
  if (value.format !== WENDOO_CATALOG_FORMAT) {
    return {
      ok: false,
      errors: [
        {
          code: ExtensionCatalogDocumentErrorCode.INVALID_FORMAT,
          path: "$.format",
          message: `Catalog document format must be "${WENDOO_CATALOG_FORMAT}".`,
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
  return { ok: true, document: { format: WENDOO_CATALOG_FORMAT, entries, moves }, warnings, errors: [] };
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
