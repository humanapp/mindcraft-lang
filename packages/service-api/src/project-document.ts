/** Shared Mindcraft project document format identifier. */
export const MINDCRAFT_PROJECT_FORMAT = "mindcraft.project";

/** Validation code constants used by shared project document diagnostics. */
export const MindcraftProjectDocumentValidationCode = {
  INVALID_JSON: "MINDCRAFT_PROJECT_INVALID_JSON",
  INVALID_ROOT: "MINDCRAFT_PROJECT_INVALID_ROOT",
  INVALID_FORMAT: "MINDCRAFT_PROJECT_INVALID_FORMAT",
  INVALID_NAME: "MINDCRAFT_PROJECT_INVALID_NAME",
  INVALID_DESCRIPTION: "MINDCRAFT_PROJECT_INVALID_DESCRIPTION",
  INVALID_THUMBNAIL_URL: "MINDCRAFT_PROJECT_INVALID_THUMBNAIL_URL",
  INVALID_FILES: "MINDCRAFT_PROJECT_INVALID_FILES",
  INVALID_FILE_ENTRY: "MINDCRAFT_PROJECT_INVALID_FILE_ENTRY",
  INVALID_FILE_PATH: "MINDCRAFT_PROJECT_INVALID_FILE_PATH",
  INVALID_FILE_CONTENT: "MINDCRAFT_PROJECT_INVALID_FILE_CONTENT",
  INVALID_BRAINS: "MINDCRAFT_PROJECT_INVALID_BRAINS",
  INVALID_TARGETS: "MINDCRAFT_PROJECT_INVALID_TARGETS",
  INVALID_EXTENSIONS: "MINDCRAFT_PROJECT_INVALID_EXTENSIONS",
  INVALID_EXTENSION_REFERENCE: "MINDCRAFT_PROJECT_INVALID_EXTENSION_REFERENCE",
} as const;

/** Union of all {@link MindcraftProjectDocumentValidationCode} values. */
export type MindcraftProjectDocumentValidationCode =
  (typeof MindcraftProjectDocumentValidationCode)[keyof typeof MindcraftProjectDocumentValidationCode];

/** Source file entry stored in a shared Mindcraft project document. */
export interface MindcraftProjectFile {
  /** Project-relative path using forward slashes. */
  readonly path: string;

  /** UTF-8 source text. */
  readonly content: string;
}

/** Target metadata keyed by package name. */
export type MindcraftProjectTargets = Readonly<Record<string, unknown>>;

/** Extension dependencies keyed by their `<owner>/<repo>` coordinate; each value is an extension reference string. */
export type MindcraftProjectExtensions = Readonly<Record<string, string>>;

/** Shared Mindcraft project document fields. */
export interface MindcraftProjectDocument {
  /** Document format identifier. */
  readonly format: typeof MINDCRAFT_PROJECT_FORMAT;

  /** Human-readable project name. */
  readonly name: string;

  /** Human-readable project description. */
  readonly description: string;

  /** Optional thumbnail URL or data URL. */
  readonly thumbnailUrl?: string;

  /** Workspace source files. */
  readonly files: readonly MindcraftProjectFile[];

  /** Serialized Mindcraft brain definitions keyed by brain id. */
  readonly brains: Readonly<Record<string, unknown>>;

  /** Target metadata keyed by package name. */
  readonly targets: MindcraftProjectTargets;

  /** Extension dependencies keyed by their `<owner>/<repo>` coordinate. Absent means the project has no extensions. */
  readonly extensions?: MindcraftProjectExtensions;
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
 * Validates a parsed shared Mindcraft project document.
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
  const format = readString(value, "format", "$.format", MindcraftProjectDocumentValidationCode.INVALID_FORMAT, errors);
  const name = readString(value, "name", "$.name", MindcraftProjectDocumentValidationCode.INVALID_NAME, errors);
  const description = readString(
    value,
    "description",
    "$.description",
    MindcraftProjectDocumentValidationCode.INVALID_DESCRIPTION,
    errors
  );
  const thumbnailUrl = readOptionalString(
    value,
    "thumbnailUrl",
    "$.thumbnailUrl",
    MindcraftProjectDocumentValidationCode.INVALID_THUMBNAIL_URL,
    errors
  );
  const files = readProjectFiles(value.files, errors);
  const brains = readRecord(value.brains, "$.brains", MindcraftProjectDocumentValidationCode.INVALID_BRAINS, errors);
  const targets = readRecord(
    value.targets,
    "$.targets",
    MindcraftProjectDocumentValidationCode.INVALID_TARGETS,
    errors
  );
  const extensions = readOptionalExtensions(value.extensions, errors);

  if (format !== undefined && format !== MINDCRAFT_PROJECT_FORMAT) {
    errors.push({
      code: MindcraftProjectDocumentValidationCode.INVALID_FORMAT,
      path: "$.format",
      message: `Project document format must be "${MINDCRAFT_PROJECT_FORMAT}".`,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    document: {
      format: MINDCRAFT_PROJECT_FORMAT,
      name: name as string,
      description: description as string,
      ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
      files: files as readonly MindcraftProjectFile[],
      brains: brains as Readonly<Record<string, unknown>>,
      targets: targets as MindcraftProjectTargets,
      ...(extensions !== undefined ? { extensions } : {}),
    },
    errors: [],
  };
}

function readOptionalExtensions(
  value: unknown,
  errors: MindcraftProjectDocumentValidationError[]
): MindcraftProjectExtensions | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push({
      code: MindcraftProjectDocumentValidationCode.INVALID_EXTENSIONS,
      path: "$.extensions",
      message: "$.extensions must be an object when present.",
    });
    return undefined;
  }

  for (const [coordinate, reference] of Object.entries(value)) {
    if (typeof reference !== "string") {
      errors.push({
        code: MindcraftProjectDocumentValidationCode.INVALID_EXTENSION_REFERENCE,
        path: `$.extensions[${JSON.stringify(coordinate)}]`,
        message: "Extension reference must be a string.",
      });
      return undefined;
    }
  }

  return value as MindcraftProjectExtensions;
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

function readProjectFiles(
  value: unknown,
  errors: MindcraftProjectDocumentValidationError[]
): MindcraftProjectFile[] | undefined {
  if (!Array.isArray(value)) {
    errors.push({
      code: MindcraftProjectDocumentValidationCode.INVALID_FILES,
      path: "$.files",
      message: "Project files must be an array.",
    });
    return undefined;
  }

  const files: MindcraftProjectFile[] = [];
  for (const [index, entry] of value.entries()) {
    const path = `$.files[${index}]`;
    if (!isRecord(entry)) {
      errors.push({
        code: MindcraftProjectDocumentValidationCode.INVALID_FILE_ENTRY,
        path,
        message: "Project file entry must be an object.",
      });
      continue;
    }

    const filePath = entry.path;
    const content = entry.content;
    if (!isMindcraftProjectFilePath(filePath)) {
      errors.push({
        code: MindcraftProjectDocumentValidationCode.INVALID_FILE_PATH,
        path: `${path}.path`,
        message: "Project file path must be a project-relative path.",
      });
      continue;
    }
    if (typeof content !== "string") {
      errors.push({
        code: MindcraftProjectDocumentValidationCode.INVALID_FILE_CONTENT,
        path: `${path}.content`,
        message: "Project file content must be a string.",
      });
      continue;
    }

    files.push({ path: filePath, content });
  }

  return files;
}

function readString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  code: MindcraftProjectDocumentValidationCode,
  errors: MindcraftProjectDocumentValidationError[]
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    errors.push({
      code,
      path,
      message: `${path} must be a string.`,
    });
    return undefined;
  }
  return value;
}

function readOptionalString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  code: MindcraftProjectDocumentValidationCode,
  errors: MindcraftProjectDocumentValidationError[]
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    errors.push({
      code,
      path,
      message: `${path} must be a string when present.`,
    });
    return undefined;
  }
  return value;
}

function readRecord(
  value: unknown,
  path: string,
  code: MindcraftProjectDocumentValidationCode,
  errors: MindcraftProjectDocumentValidationError[]
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) {
    errors.push({
      code,
      path,
      message: `${path} must be an object.`,
    });
    return undefined;
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
