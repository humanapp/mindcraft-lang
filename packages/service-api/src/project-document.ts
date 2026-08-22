import type { WireFileContent } from "./file-content.js";

/** Shared Wendoo project document format identifier. */
export const WENDOO_PROJECT_FORMAT = "wendoo.project/2";

/**
 * Content version a project document, content manifest, or extension reads and
 * compares as when it lacks a valid semver `version`: the lowest semantic
 * version, `"0.0.0"`.
 */
export const LOWEST_CONTENT_VERSION = "0.0.0";

/** Validation code constants used by shared project document diagnostics. */
export const WendooProjectDocumentValidationCode = {
  INVALID_JSON: "WENDOO_PROJECT_INVALID_JSON",
  INVALID_ROOT: "WENDOO_PROJECT_INVALID_ROOT",
  INVALID_FORMAT: "WENDOO_PROJECT_INVALID_FORMAT",
  INVALID_MANIFEST: "WENDOO_PROJECT_INVALID_MANIFEST",
  INVALID_CONTENTS: "WENDOO_PROJECT_INVALID_CONTENTS",
  INVALID_FILE_PATH: "WENDOO_PROJECT_INVALID_FILE_PATH",
  INVALID_FILE_CONTENT: "WENDOO_PROJECT_INVALID_FILE_CONTENT",
} as const;

/** Union of all {@link WendooProjectDocumentValidationCode} values. */
export type WendooProjectDocumentValidationCode =
  (typeof WendooProjectDocumentValidationCode)[keyof typeof WendooProjectDocumentValidationCode];

/** Extension dependencies keyed by their `<owner>/<repo>` coordinate; each value is an extension reference string. */
export type WendooProjectExtensions = Readonly<Record<string, string>>;

/**
 * One file's contents inside a project document: its text as a bare string, or
 * a base64 entry for a file whose bytes are not UTF-8 text.
 */
export type WendooProjectFileContent = string | WireFileContent;

/**
 * Shared Wendoo project document: a single-file container for one project.
 * The project's content manifest (its `wendoo.json` object) is embedded
 * verbatim; the document adds only the format marker and the project's file
 * contents.
 */
export interface WendooProjectDocument {
  /** Document format identifier. */
  readonly format: typeof WENDOO_PROJECT_FORMAT;

  /** The project's content manifest object, embedded verbatim. */
  readonly manifest: Readonly<Record<string, unknown>>;

  /** File contents keyed by project-relative path. */
  readonly contents: Readonly<Record<string, WendooProjectFileContent>>;
}

/** Validation diagnostic for a rejected shared project document. */
export interface WendooProjectDocumentValidationError {
  /** Stable machine-readable validation code. */
  readonly code: WendooProjectDocumentValidationCode;

  /** JSON path of the rejected field. */
  readonly path: string;

  /** Human-readable diagnostic message. */
  readonly message: string;
}

/** Result of validating or parsing a shared project document. */
export type WendooProjectDocumentParseResult =
  | {
      /** True when a valid project document was produced. */
      readonly ok: true;

      /** Parsed shared project document. */
      readonly document: WendooProjectDocument;

      /** Empty diagnostics list for a valid document. */
      readonly errors: readonly [];
    }
  | {
      /** False when validation rejected the document. */
      readonly ok: false;

      /** Validation diagnostics. */
      readonly errors: readonly WendooProjectDocumentValidationError[];
    };

/**
 * Parses and validates a shared Wendoo project document from JSON text.
 *
 * @param content - JSON text from a `.wendoo` file.
 */
export function parseWendooProjectDocument(content: string): WendooProjectDocumentParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: WendooProjectDocumentValidationCode.INVALID_JSON,
          path: "$",
          message: "Project document is not valid JSON.",
        },
      ],
    };
  }

  return validateWendooProjectDocument(parsed);
}

/**
 * Validates a parsed shared Wendoo project document: the format marker, the
 * embedded manifest object, and the file contents map. The manifest object is
 * carried verbatim; its fields are validated by the content manifest schema,
 * not here.
 *
 * @param value - Parsed JSON value from a `.wendoo` file.
 */
export function validateWendooProjectDocument(value: unknown): WendooProjectDocumentParseResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [
        {
          code: WendooProjectDocumentValidationCode.INVALID_ROOT,
          path: "$",
          message: "Project document root must be an object.",
        },
      ],
    };
  }

  const errors: WendooProjectDocumentValidationError[] = [];

  if (value.format !== WENDOO_PROJECT_FORMAT) {
    errors.push({
      code: WendooProjectDocumentValidationCode.INVALID_FORMAT,
      path: "$.format",
      message: `Project document format must be "${WENDOO_PROJECT_FORMAT}".`,
    });
  }

  if (!isRecord(value.manifest)) {
    errors.push({
      code: WendooProjectDocumentValidationCode.INVALID_MANIFEST,
      path: "$.manifest",
      message: "$.manifest must be an object.",
    });
  }

  if (!isRecord(value.contents)) {
    errors.push({
      code: WendooProjectDocumentValidationCode.INVALID_CONTENTS,
      path: "$.contents",
      message: "$.contents must be an object keyed by project-relative path.",
    });
  } else {
    for (const [filePath, content] of Object.entries(value.contents)) {
      const path = `$.contents[${JSON.stringify(filePath)}]`;
      if (!isWendooProjectFilePath(filePath)) {
        errors.push({
          code: WendooProjectDocumentValidationCode.INVALID_FILE_PATH,
          path,
          message: "Project file path must be a project-relative path.",
        });
        continue;
      }
      if (!isWendooProjectFileContent(content)) {
        errors.push({
          code: WendooProjectDocumentValidationCode.INVALID_FILE_CONTENT,
          path,
          message: 'Project file content must be text or a { content, encoding: "base64" } entry.',
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
      format: WENDOO_PROJECT_FORMAT,
      manifest: value.manifest as Readonly<Record<string, unknown>>,
      contents: value.contents as Readonly<Record<string, WendooProjectFileContent>>,
    },
    errors: [],
  };
}

/** Tests whether a value is a valid entry of a project document's `contents` map. */
export function isWendooProjectFileContent(value: unknown): value is WendooProjectFileContent {
  if (typeof value === "string") {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.content === "string" && value.encoding === "base64";
}

/** Tests whether a value is a valid shared-project file path. */
export function isWendooProjectFilePath(value: unknown): value is string {
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
