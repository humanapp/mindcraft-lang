import type { MindcraftProjectExtensions } from "@mindcraft-lang/service-api";

/**
 * A parsed extension reference naming where a dependency comes from.
 *
 * String forms:
 * - `gh:<owner>/<repo>@<tag>` -- a GitHub repository snapshot at an exact tag.
 * - `embedded:<owner>/<repo>` -- an extension bundled with the host application.
 * - `local:<project-id>` -- another project in the same project store.
 */
export type ExtensionReference =
  | {
      readonly transport: "gh";
      /** Repository owner (user or organization). */
      readonly owner: string;
      /** Repository name. */
      readonly repo: string;
      /** Tag naming the exact snapshot to fetch. */
      readonly tag: string;
    }
  | {
      readonly transport: "embedded";
      /** `<owner>/<repo>` coordinate identifying the bundled extension in the host application's embed records. */
      readonly coordinate: string;
    }
  | {
      readonly transport: "local";
      /** Project id of the source project. */
      readonly projectId: string;
    };

/**
 * Grammar for an extension coordinate `<owner>/<repo>`: an owner segment (ASCII
 * letters, digits, and `-`) and a repository segment, joined by a single slash.
 * This is the extension's identity and the key a dependency is stored under,
 * independent of the transport that delivers it.
 */
const COORDINATE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

const GH_REFERENCE_PATTERN = /^gh:([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)@([^\s/]+)$/;

const LOCAL_PROJECT_ID_PATTERN = /^[^\s/]+$/;

/** Semver 2.0.0 version grammar (semver.org). */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function isExtensionCoordinate(value: unknown): value is string {
  return typeof value === "string" && COORDINATE_PATTERN.test(value);
}

/**
 * Parse an extension reference string. Returns `undefined` when the string is
 * not in a recognized reference form.
 */
export function parseExtensionReference(reference: string): ExtensionReference | undefined {
  const ghMatch = GH_REFERENCE_PATTERN.exec(reference);
  if (ghMatch) {
    return { transport: "gh", owner: ghMatch[1], repo: ghMatch[2], tag: ghMatch[3] };
  }
  if (reference.startsWith("embedded:")) {
    const coordinate = reference.slice("embedded:".length);
    return isExtensionCoordinate(coordinate) ? { transport: "embedded", coordinate } : undefined;
  }
  if (reference.startsWith("local:")) {
    const projectId = reference.slice("local:".length);
    return LOCAL_PROJECT_ID_PATTERN.test(projectId) ? { transport: "local", projectId } : undefined;
  }
  return undefined;
}

/**
 * A project's content manifest: the portable identity data carried in
 * `mindcraft.json` alongside host-specific fields.
 */
export interface ProjectContentManifest {
  /** Project display name; also the source for the project's slug. */
  readonly name: string;
  /** Semver version of the project's content. */
  readonly version: string;
  /**
   * Extension dependencies keyed by their `<owner>/<repo>` coordinate; each
   * value is an extension reference string naming the transport. Coordinates
   * must be unique case-insensitively. Always present; an empty object means
   * the project has no extensions.
   */
  readonly extensions: MindcraftProjectExtensions;
}

/** Stable identifiers for content manifest validation errors. */
export const ProjectContentManifestErrorCode = {
  INVALID_JSON: "PROJECT_MANIFEST_INVALID_JSON",
  INVALID_ROOT: "PROJECT_MANIFEST_INVALID_ROOT",
  INVALID_NAME: "PROJECT_MANIFEST_INVALID_NAME",
  INVALID_VERSION: "PROJECT_MANIFEST_INVALID_VERSION",
  INVALID_EXTENSIONS: "PROJECT_MANIFEST_INVALID_EXTENSIONS",
  INVALID_EXTENSION_COORDINATE: "PROJECT_MANIFEST_INVALID_EXTENSION_COORDINATE",
  DUPLICATE_EXTENSION_COORDINATE: "PROJECT_MANIFEST_DUPLICATE_EXTENSION_COORDINATE",
  INVALID_EXTENSION_REFERENCE: "PROJECT_MANIFEST_INVALID_EXTENSION_REFERENCE",
} as const;

/** Union of all {@link ProjectContentManifestErrorCode} values. */
export type ProjectContentManifestErrorCode =
  (typeof ProjectContentManifestErrorCode)[keyof typeof ProjectContentManifestErrorCode];

/** Validation error for a rejected content manifest. */
export interface ProjectContentManifestError {
  /** Stable machine-readable error code. */
  readonly code: ProjectContentManifestErrorCode;
  /** JSON path of the rejected field. */
  readonly path: string;
  /** Human-readable error message. */
  readonly message: string;
}

/** Result of validating or parsing a content manifest. */
export type ProjectContentManifestParseResult =
  | {
      /** True when a valid content manifest was produced. */
      readonly ok: true;
      /** Parsed content manifest. */
      readonly manifest: ProjectContentManifest;
      /** Empty error list for a valid manifest. */
      readonly errors: readonly [];
    }
  | {
      /** False when validation rejected the manifest. */
      readonly ok: false;
      /** Validation errors. */
      readonly errors: readonly ProjectContentManifestError[];
    };

/**
 * Validate an extensions map: coordinate grammar (`<owner>/<repo>`),
 * case-insensitive coordinate uniqueness, and reference form. Returns one
 * error per rejected entry.
 */
export function validateProjectExtensions(
  extensions: Readonly<Record<string, unknown>>
): readonly ProjectContentManifestError[] {
  const errors: ProjectContentManifestError[] = [];
  const seenCoordinates = new Set<string>();

  for (const [coordinate, reference] of Object.entries(extensions)) {
    const path = `$.extensions[${JSON.stringify(coordinate)}]`;
    if (!isExtensionCoordinate(coordinate)) {
      errors.push({
        code: ProjectContentManifestErrorCode.INVALID_EXTENSION_COORDINATE,
        path,
        message: `Extension coordinate "${coordinate}" must be "<owner>/<repo>", each segment starting with a letter or digit.`,
      });
      continue;
    }

    const normalizedCoordinate = coordinate.toLowerCase();
    if (seenCoordinates.has(normalizedCoordinate)) {
      errors.push({
        code: ProjectContentManifestErrorCode.DUPLICATE_EXTENSION_COORDINATE,
        path,
        message: `Extension coordinate "${coordinate}" duplicates another coordinate when compared case-insensitively.`,
      });
      continue;
    }
    seenCoordinates.add(normalizedCoordinate);

    if (typeof reference !== "string" || parseExtensionReference(reference) === undefined) {
      errors.push({
        code: ProjectContentManifestErrorCode.INVALID_EXTENSION_REFERENCE,
        path,
        message:
          `Extension reference for "${coordinate}" must be a string in the form ` +
          '"gh:<owner>/<repo>@<tag>", "embedded:<owner>/<repo>", or "local:<project-id>".',
      });
    }
  }

  return errors;
}

/**
 * Parse and validate a project content manifest from JSON text. Fields other
 * than `name`, `version`, and `extensions` are ignored.
 *
 * @param content - JSON text of a `mindcraft.json` file.
 */
export function parseProjectContentManifest(content: string): ProjectContentManifestParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: ProjectContentManifestErrorCode.INVALID_JSON,
          path: "$",
          message: "Content manifest is not valid JSON.",
        },
      ],
    };
  }
  return validateProjectContentManifest(parsed);
}

/**
 * Validate a parsed project content manifest. Fields other than `name`,
 * `version`, and `extensions` are ignored; an absent `extensions` field
 * yields an empty extensions map.
 *
 * @param value - Parsed JSON value of a `mindcraft.json` file.
 */
export function validateProjectContentManifest(value: unknown): ProjectContentManifestParseResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [
        {
          code: ProjectContentManifestErrorCode.INVALID_ROOT,
          path: "$",
          message: "Content manifest root must be an object.",
        },
      ],
    };
  }

  const errors: ProjectContentManifestError[] = [];

  if (typeof value.name !== "string") {
    errors.push({
      code: ProjectContentManifestErrorCode.INVALID_NAME,
      path: "$.name",
      message: "$.name must be a string.",
    });
  }

  if (typeof value.version !== "string" || !SEMVER_PATTERN.test(value.version)) {
    errors.push({
      code: ProjectContentManifestErrorCode.INVALID_VERSION,
      path: "$.version",
      message: "$.version must be a semver string.",
    });
  }

  let extensions: MindcraftProjectExtensions = {};
  if (value.extensions !== undefined) {
    if (!isRecord(value.extensions)) {
      errors.push({
        code: ProjectContentManifestErrorCode.INVALID_EXTENSIONS,
        path: "$.extensions",
        message: "$.extensions must be an object when present.",
      });
    } else {
      const extensionErrors = validateProjectExtensions(value.extensions);
      if (extensionErrors.length > 0) {
        errors.push(...extensionErrors);
      } else {
        extensions = value.extensions as MindcraftProjectExtensions;
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    manifest: {
      name: value.name as string,
      version: value.version as string,
      extensions,
    },
    errors: [],
  };
}

/** Serialize a {@link ProjectContentManifest} to a pretty-printed JSON string. */
export function serializeProjectContentManifest(manifest: ProjectContentManifest): string {
  return JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      ...(Object.keys(manifest.extensions).length > 0 ? { extensions: manifest.extensions } : {}),
    },
    null,
    2
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
