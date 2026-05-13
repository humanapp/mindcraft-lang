import {
  MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC,
  MINDCRAFT_PROGRAM_IMAGE_FORMAT,
  MINDCRAFT_PROGRAM_IMAGE_VERSION,
  type MindcraftProgramImage,
  type MindcraftProgramImageBytes,
  MindcraftProgramImageEncoding,
} from "@mindcraft-lang/core/runtime";

export {
  MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC,
  MINDCRAFT_PROGRAM_IMAGE_FORMAT,
  MINDCRAFT_PROGRAM_IMAGE_VERSION,
  type MindcraftProgramImage,
  type MindcraftProgramImageBytes,
  MindcraftProgramImageEncoding,
};

/** Validation code constants used by program image diagnostics. */
export const MindcraftProgramImageValidationCode = {
  INVALID_PROGRAM_IMAGE_ENCODING: "MINDCRAFT_PROGRAM_IMAGE_INVALID_ENCODING",
  UNSUPPORTED_BINARY_PROGRAM_IMAGE: "MINDCRAFT_PROGRAM_IMAGE_UNSUPPORTED_BINARY_ENCODING",
  INVALID_PROGRAM_IMAGE_JSON: "MINDCRAFT_PROGRAM_IMAGE_INVALID_JSON",
  INVALID_PROGRAM_IMAGE_ROOT: "MINDCRAFT_PROGRAM_IMAGE_INVALID_ROOT",
  INVALID_PROGRAM_IMAGE_FORMAT: "MINDCRAFT_PROGRAM_IMAGE_INVALID_FORMAT",
  INVALID_PROGRAM_IMAGE_VERSION: "MINDCRAFT_PROGRAM_IMAGE_INVALID_VERSION",
  INVALID_PROGRAM_IMAGE_PROFILE: "MINDCRAFT_PROGRAM_IMAGE_INVALID_PROFILE",
  MISSING_PROGRAM_IMAGE_PROGRAM: "MINDCRAFT_PROGRAM_IMAGE_MISSING_PROGRAM",
} as const;

/** Union of all {@link MindcraftProgramImageValidationCode} values. */
export type MindcraftProgramImageValidationCode =
  (typeof MindcraftProgramImageValidationCode)[keyof typeof MindcraftProgramImageValidationCode];

/** Validation diagnostic for a rejected program image. */
export interface MindcraftProgramImageValidationError<TCode extends string = MindcraftProgramImageValidationCode> {
  /** Stable machine-readable validation code. */
  readonly code: TCode;

  /** JSON path of the rejected field, or `$` for non-JSON input. */
  readonly path: string;

  /** Human-readable diagnostic message. */
  readonly message: string;

  /** Original thrown value when one is available. */
  readonly cause?: unknown;
}

/** Result of validating or parsing a program image. */
export type MindcraftProgramImageParseResult<
  TProgram = unknown,
  TProfileId extends string = string,
  TError extends MindcraftProgramImageValidationError<string> = MindcraftProgramImageValidationError,
> =
  | {
      /** True when a valid program image was produced. */
      readonly ok: true;

      /** Encoding used by the parsed program image. */
      readonly encoding: typeof MindcraftProgramImageEncoding.JSON;

      /** Parsed program image envelope. */
      readonly image: MindcraftProgramImage<TProgram, TProfileId>;

      /** Empty diagnostics list for a valid image. */
      readonly errors: readonly [];
    }
  | {
      /** False when validation rejected the image. */
      readonly ok: false;

      /** Encoding detected before validation failed, when available. */
      readonly encoding?: MindcraftProgramImageEncoding;

      /** Validation diagnostics. */
      readonly errors: readonly TError[];
    };

/**
 * Parses a `.mcprogram` image from JSON text or bytes.
 *
 * @param input - Program image contents.
 */
export function parseMindcraftProgramImage(
  input: string | MindcraftProgramImageBytes
): MindcraftProgramImageParseResult {
  if (typeof input === "string") {
    return parseMindcraftProgramImageJson(input);
  }

  const encoding = detectMindcraftProgramImageEncoding(input);
  if (encoding === undefined) {
    return {
      ok: false,
      errors: [
        {
          code: MindcraftProgramImageValidationCode.INVALID_PROGRAM_IMAGE_ENCODING,
          path: "$",
          message: "Program image encoding is not recognized.",
        },
      ],
    };
  }

  if (encoding === MindcraftProgramImageEncoding.BINARY) {
    return {
      ok: false,
      encoding,
      errors: [
        {
          code: MindcraftProgramImageValidationCode.UNSUPPORTED_BINARY_PROGRAM_IMAGE,
          path: "$",
          message: "Binary program image encoding is not supported by this reader.",
        },
      ],
    };
  }

  return parseMindcraftProgramImageJson(new TextDecoder().decode(new Uint8Array(input)));
}

/**
 * Parses a JSON program image from text.
 *
 * @param content - Program image JSON text.
 */
export function parseMindcraftProgramImageJson(content: string): MindcraftProgramImageParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    return {
      ok: false,
      encoding: MindcraftProgramImageEncoding.JSON,
      errors: [
        {
          code: MindcraftProgramImageValidationCode.INVALID_PROGRAM_IMAGE_JSON,
          path: "$",
          message: "Program image is not valid JSON.",
          cause,
        },
      ],
    };
  }

  return validateMindcraftProgramImage(parsed);
}

/**
 * Validates a parsed JSON program image envelope.
 *
 * @param value - Parsed JSON value from a program image.
 */
export function validateMindcraftProgramImage(value: unknown): MindcraftProgramImageParseResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      encoding: MindcraftProgramImageEncoding.JSON,
      errors: [
        {
          code: MindcraftProgramImageValidationCode.INVALID_PROGRAM_IMAGE_ROOT,
          path: "$",
          message: "Program image root must be an object.",
        },
      ],
    };
  }

  const errors: MindcraftProgramImageValidationError[] = [];
  const format = readString(
    value,
    "format",
    "$.format",
    MindcraftProgramImageValidationCode.INVALID_PROGRAM_IMAGE_FORMAT,
    errors
  );
  const version = readNumber(
    value,
    "version",
    "$.version",
    MindcraftProgramImageValidationCode.INVALID_PROGRAM_IMAGE_VERSION,
    errors
  );
  const program = value.program;

  if (format !== undefined && format !== MINDCRAFT_PROGRAM_IMAGE_FORMAT) {
    errors.push({
      code: MindcraftProgramImageValidationCode.INVALID_PROGRAM_IMAGE_FORMAT,
      path: "$.format",
      message: `Program image format must be "${MINDCRAFT_PROGRAM_IMAGE_FORMAT}".`,
    });
  }

  if (version !== undefined && version !== MINDCRAFT_PROGRAM_IMAGE_VERSION) {
    errors.push({
      code: MindcraftProgramImageValidationCode.INVALID_PROGRAM_IMAGE_VERSION,
      path: "$.version",
      message: `Program image version must be ${MINDCRAFT_PROGRAM_IMAGE_VERSION}.`,
    });
  }

  const profileId = readString(
    value,
    "profileId",
    "$.profileId",
    MindcraftProgramImageValidationCode.INVALID_PROGRAM_IMAGE_PROFILE,
    errors
  );

  if (program === undefined || program === null) {
    errors.push({
      code: MindcraftProgramImageValidationCode.MISSING_PROGRAM_IMAGE_PROGRAM,
      path: "$.program",
      message: "Program image program payload is required.",
    });
  }

  if (errors.length > 0) {
    return { ok: false, encoding: MindcraftProgramImageEncoding.JSON, errors };
  }

  return {
    ok: true,
    encoding: MindcraftProgramImageEncoding.JSON,
    image: {
      format: MINDCRAFT_PROGRAM_IMAGE_FORMAT,
      version: MINDCRAFT_PROGRAM_IMAGE_VERSION,
      profileId: profileId as string,
      program,
    },
    errors: [],
  };
}

/**
 * Detects the encoding of raw `.mcprogram` bytes.
 *
 * @param bytes - Program image bytes.
 */
export function detectMindcraftProgramImageEncoding(
  bytes: MindcraftProgramImageBytes
): MindcraftProgramImageEncoding | undefined {
  const firstByte = firstContentByte(bytes);
  if (firstByte === undefined) {
    return undefined;
  }
  if (firstByte === 0x7b || firstByte === 0x5b) {
    return MindcraftProgramImageEncoding.JSON;
  }
  return hasBinaryMagic(bytes) ? MindcraftProgramImageEncoding.BINARY : undefined;
}

/**
 * Serializes a program image envelope as JSON text.
 *
 * @param image - Program image envelope to serialize.
 */
export function serializeMindcraftProgramImageJson<TProgram, TProfileId extends string>(
  image: MindcraftProgramImage<TProgram, TProfileId>
): string {
  return JSON.stringify(image);
}

function firstContentByte(bytes: MindcraftProgramImageBytes): number | undefined {
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x20) {
      return byte;
    }
  }
  return undefined;
}

function hasBinaryMagic(bytes: MindcraftProgramImageBytes): boolean {
  if (bytes.length < MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC.length) {
    return false;
  }
  for (let index = 0; index < MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC.length; index += 1) {
    if (bytes[index] !== MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC[index]) {
      return false;
    }
  }
  return true;
}

function readString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  code: MindcraftProgramImageValidationCode,
  errors: MindcraftProgramImageValidationError[]
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

function readNumber(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  code: MindcraftProgramImageValidationCode,
  errors: MindcraftProgramImageValidationError[]
): number | undefined {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    errors.push({
      code,
      path,
      message: `${path} must be an integer.`,
    });
    return undefined;
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
