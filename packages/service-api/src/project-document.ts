/** Shared Mindcraft project document format identifier. */
export const MINDCRAFT_PROJECT_FORMAT = "mindcraft.project/2";

/**
 * Content version a project document, content manifest, or extension reads and
 * compares as when it lacks a valid semver `version`: the lowest semantic
 * version, `"0.0.0"`.
 */
export const LOWEST_CONTENT_VERSION = "0.0.0";

/** Validation code constants used by shared project document diagnostics. */
export const MindcraftProjectDocumentValidationCode = {
  INVALID_JSON: "MINDCRAFT_PROJECT_INVALID_JSON",
  INVALID_ROOT: "MINDCRAFT_PROJECT_INVALID_ROOT",
  INVALID_FORMAT: "MINDCRAFT_PROJECT_INVALID_FORMAT",
  INVALID_MANIFEST: "MINDCRAFT_PROJECT_INVALID_MANIFEST",
  INVALID_CONTENTS: "MINDCRAFT_PROJECT_INVALID_CONTENTS",
  INVALID_FILE_PATH: "MINDCRAFT_PROJECT_INVALID_FILE_PATH",
  INVALID_FILE_CONTENT: "MINDCRAFT_PROJECT_INVALID_FILE_CONTENT",
} as const;

/** Union of all {@link MindcraftProjectDocumentValidationCode} values. */
export type MindcraftProjectDocumentValidationCode =
  (typeof MindcraftProjectDocumentValidationCode)[keyof typeof MindcraftProjectDocumentValidationCode];

/** Extension dependencies keyed by their `<owner>/<repo>` coordinate; each value is an extension reference string. */
export type MindcraftProjectExtensions = Readonly<Record<string, string>>;

/**
 * Shared Mindcraft project document: a single-file container for one project.
 * The project's content manifest (its `mindcraft.json` object) is embedded
 * verbatim; the document adds only the format marker and the project's file
 * contents.
 */
export interface MindcraftProjectDocument {
  /** Document format identifier. */
  readonly format: typeof MINDCRAFT_PROJECT_FORMAT;

  /** The project's content manifest object, embedded verbatim. */
  readonly manifest: Readonly<Record<string, unknown>>;

  /** UTF-8 file contents keyed by project-relative path. */
  readonly contents: Readonly<Record<string, string>>;
}

/** Validation diagnostic for a rejected shared project document. */
export interface MindcraftProjectDocumentValidationError {
  /** Stable machine-readable validation code. */
  readonly code: MindcraftProjectDocumentValidationCode;

  /** JSON path of the rejected field. */
  readonly path: string;

  /** Human-readable diagnostic message. */
  readonly message: string;
}

/** Result of validating or parsing a shared project document. */
export type MindcraftProjectDocumentParseResult =
  | {
      /** True when a valid project document was produced. */
      readonly ok: true;

      /** Parsed shared project document. */
      readonly document: MindcraftProjectDocument;

      /** Empty diagnostics list for a valid document. */
      readonly errors: readonly [];
    }
  | {
      /** False when validation rejected the document. */
      readonly ok: false;

      /** Validation diagnostics. */
      readonly errors: readonly MindcraftProjectDocumentValidationError[];
    };

/**
 * Parses and validates a shared Mindcraft project document from JSON text.
 *
 * @param content - JSON text from a `.mindcraft` file.
 */
export function parseMindcraftProjectDocument(content: string): MindcraftProjectDocumentParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: MindcraftProjectDocumentValidationCode.INVALID_JSON,
          path: "$",
          message: "Project document is not valid JSON.",
        },
      ],
    };
  }

  return validateMindcraftProjectDocument(parsed);
}

/**
 * Validates a parsed shared Mindcraft project document: the format marker, the
 * embedded manifest object, and the file contents map. The manifest object is
 * carried verbatim; its fields are validated by the content manifest schema,
 * not here.
 *
 * @param value - Parsed JSON value from a `.mindcraft` file.
 */
export function validateMindcraftProjectDocument(value: unknown): MindcraftProjectDocumentParseResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [
        {
          code: MindcraftProjectDocumentValidationCode.INVALID_ROOT,
          path: "$",
          message: "Project document root must be an object.",
        },
      ],
    };
  }

  const errors: MindcraftProjectDocumentValidationError[] = [];

  if (value.format !== MINDCRAFT_PROJECT_FORMAT) {
    errors.push({
      code: MindcraftProjectDocumentValidationCode.INVALID_FORMAT,
      path: "$.format",
      message: `Project document format must be "${MINDCRAFT_PROJECT_FORMAT}".`,
    });
  }

  if (!isRecord(value.manifest)) {
    errors.push({
      code: MindcraftProjectDocumentValidationCode.INVALID_MANIFEST,
      path: "$.manifest",
      message: "$.manifest must be an object.",
    });
  }

  if (!isRecord(value.contents)) {
    errors.push({
      code: MindcraftProjectDocumentValidationCode.INVALID_CONTENTS,
      path: "$.contents",
      message: "$.contents must be an object keyed by project-relative path.",
    });
  } else {
    for (const [filePath, content] of Object.entries(value.contents)) {
      const path = `$.contents[${JSON.stringify(filePath)}]`;
      if (!isMindcraftProjectFilePath(filePath)) {
        errors.push({
          code: MindcraftProjectDocumentValidationCode.INVALID_FILE_PATH,
          path,
          message: "Project file path must be a project-relative path.",
        });
        continue;
      }
      if (typeof content !== "string") {
        errors.push({
          code: MindcraftProjectDocumentValidationCode.INVALID_FILE_CONTENT,
          path,
          message: "Project file content must be a string.",
        });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    document: {
      format: MINDCRAFT_PROJECT_FORMAT,
      manifest: value.manifest as Readonly<Record<string, unknown>>,
      contents: value.contents as Readonly<Record<string, string>>,
    },
    errors: [],
  };
}

/** Tests whether a value is a valid shared-project file path. */
export function isMindcraftProjectFilePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
