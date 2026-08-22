import {
  WENDOO_BINARY_PROGRAM_IMAGE_MAGIC,
  WENDOO_PROGRAM_IMAGE_FORMAT,
  WENDOO_PROGRAM_IMAGE_VERSION,
  type WendooProgramImage,
  type WendooProgramImageBytes,
  WendooProgramImageEncoding,
} from "@wendoo-lang/core/runtime";

export {
  WENDOO_BINARY_PROGRAM_IMAGE_MAGIC,
  WENDOO_PROGRAM_IMAGE_FORMAT,
  WENDOO_PROGRAM_IMAGE_VERSION,
  type WendooProgramImage,
  type WendooProgramImageBytes,
  WendooProgramImageEncoding,
};

/** Validation code constants used by program image diagnostics. */
export const WendooProgramImageValidationCode = {
  INVALID_PROGRAM_IMAGE_ENCODING: "WENDOO_PROGRAM_IMAGE_INVALID_ENCODING",
  UNSUPPORTED_BINARY_PROGRAM_IMAGE: "WENDOO_PROGRAM_IMAGE_UNSUPPORTED_BINARY_ENCODING",
  INVALID_PROGRAM_IMAGE_JSON: "WENDOO_PROGRAM_IMAGE_INVALID_JSON",
  INVALID_PROGRAM_IMAGE_ROOT: "WENDOO_PROGRAM_IMAGE_INVALID_ROOT",
  INVALID_PROGRAM_IMAGE_FORMAT: "WENDOO_PROGRAM_IMAGE_INVALID_FORMAT",
  INVALID_PROGRAM_IMAGE_VERSION: "WENDOO_PROGRAM_IMAGE_INVALID_VERSION",
  INVALID_PROGRAM_IMAGE_PROFILE: "WENDOO_PROGRAM_IMAGE_INVALID_PROFILE",
  MISSING_PROGRAM_IMAGE_PROGRAM: "WENDOO_PROGRAM_IMAGE_MISSING_PROGRAM",
} as const;

/** Union of all {@link WendooProgramImageValidationCode} values. */
export type WendooProgramImageValidationCode =
  (typeof WendooProgramImageValidationCode)[keyof typeof WendooProgramImageValidationCode];

/** Validation diagnostic for a rejected program image. */
export interface WendooProgramImageValidationError<TCode extends string = WendooProgramImageValidationCode> {
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
export type WendooProgramImageParseResult<
  TProgram = unknown,
  TProfileId extends string = string,
  TError extends WendooProgramImageValidationError<string> = WendooProgramImageValidationError,
> =
  | {
      /** True when a valid program image was produced. */
      readonly ok: true;

      /** Encoding used by the parsed program image. */
      readonly encoding: typeof WendooProgramImageEncoding.JSON;

      /** Parsed program image envelope. */
      readonly image: WendooProgramImage<TProgram, TProfileId>;

      /** Empty diagnostics list for a valid image. */
      readonly errors: readonly [];
    }
  | {
      /** False when validation rejected the image. */
      readonly ok: false;

      /** Encoding detected before validation failed, when available. */
      readonly encoding?: WendooProgramImageEncoding;

      /** Validation diagnostics. */
      readonly errors: readonly TError[];
    };

/**
 * Parses a `.mcprogram` image from JSON text or bytes.
 *
 * @param input - Program image contents.
 */
export function parseWendooProgramImage(input: string | WendooProgramImageBytes): WendooProgramImageParseResult {
  if (typeof input === "string") {
    return parseWendooProgramImageJson(input);
  }

  const encoding = detectWendooProgramImageEncoding(input);
  if (encoding === undefined) {
    return {
      ok: false,
      errors: [
        {
          code: WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_ENCODING,
          path: "$",
          message: "Program image encoding is not recognized.",
        },
      ],
    };
  }

  if (encoding === WendooProgramImageEncoding.BINARY) {
    return {
      ok: false,
      encoding,
      errors: [
        {
          code: WendooProgramImageValidationCode.UNSUPPORTED_BINARY_PROGRAM_IMAGE,
          path: "$",
          message: "Binary program image encoding is not supported by this reader.",
        },
      ],
    };
  }

  return parseWendooProgramImageJson(new TextDecoder().decode(new Uint8Array(input)));
}

/**
 * Parses a JSON program image from text.
 *
 * @param content - Program image JSON text.
 */
export function parseWendooProgramImageJson(content: string): WendooProgramImageParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    return {
      ok: false,
      encoding: WendooProgramImageEncoding.JSON,
      errors: [
        {
          code: WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_JSON,
          path: "$",
          message: "Program image is not valid JSON.",
          cause,
        },
      ],
    };
  }

  return validateWendooProgramImage(parsed);
}

/**
 * Validates a parsed JSON program image envelope.
 *
 * @param value - Parsed JSON value from a program image.
 */
export function validateWendooProgramImage(value: unknown): WendooProgramImageParseResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      encoding: WendooProgramImageEncoding.JSON,
      errors: [
        {
          code: WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_ROOT,
          path: "$",
          message: "Program image root must be an object.",
        },
      ],
    };
  }

  const errors: WendooProgramImageValidationError[] = [];
  const format = readString(
    value,
    "format",
    "$.format",
    WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_FORMAT,
    errors
  );
  const version = readNumber(
    value,
    "version",
    "$.version",
    WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_VERSION,
    errors
  );
  const program = value.program;

  if (format !== undefined && format !== WENDOO_PROGRAM_IMAGE_FORMAT) {
    errors.push({
      code: WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_FORMAT,
      path: "$.format",
      message: `Program image format must be "${WENDOO_PROGRAM_IMAGE_FORMAT}".`,
    });
  }

  if (version !== undefined && version !== WENDOO_PROGRAM_IMAGE_VERSION) {
    errors.push({
      code: WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_VERSION,
      path: "$.version",
      message: `Program image version must be ${WENDOO_PROGRAM_IMAGE_VERSION}.`,
    });
  }

  const profileId = readString(
    value,
    "profileId",
    "$.profileId",
    WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_PROFILE,
    errors
  );

  if (program === undefined || program === null) {
    errors.push({
      code: WendooProgramImageValidationCode.MISSING_PROGRAM_IMAGE_PROGRAM,
      path: "$.program",
      message: "Program image program payload is required.",
    });
  }

  if (errors.length > 0) {
    return { ok: false, encoding: WendooProgramImageEncoding.JSON, errors };
  }

  return {
    ok: true,
    encoding: WendooProgramImageEncoding.JSON,
    image: {
      format: WENDOO_PROGRAM_IMAGE_FORMAT,
      version: WENDOO_PROGRAM_IMAGE_VERSION,
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
export function detectWendooProgramImageEncoding(
  bytes: WendooProgramImageBytes
): WendooProgramImageEncoding | undefined {
  const firstByte = firstContentByte(bytes);
  if (firstByte === undefined) {
    return undefined;
  }
  if (firstByte === 0x7b || firstByte === 0x5b) {
    return WendooProgramImageEncoding.JSON;
  }
  return hasBinaryMagic(bytes) ? WendooProgramImageEncoding.BINARY : undefined;
}

/**
 * Serializes a program image envelope as JSON text.
 *
 * @param image - Program image envelope to serialize.
 */
export function serializeWendooProgramImageJson<TProgram, TProfileId extends string>(
  image: WendooProgramImage<TProgram, TProfileId>
): string {
  return JSON.stringify(image);
}

function firstContentByte(bytes: WendooProgramImageBytes): number | undefined {
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x20) {
      return byte;
    }
  }
  return undefined;
}

function hasBinaryMagic(bytes: WendooProgramImageBytes): boolean {
  if (bytes.length < WENDOO_BINARY_PROGRAM_IMAGE_MAGIC.length) {
    return false;
  }
  for (let index = 0; index < WENDOO_BINARY_PROGRAM_IMAGE_MAGIC.length; index += 1) {
    if (bytes[index] !== WENDOO_BINARY_PROGRAM_IMAGE_MAGIC[index]) {
      return false;
    }
  }
  return true;
}

function readString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  code: WendooProgramImageValidationCode,
  errors: WendooProgramImageValidationError[]
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
  code: WendooProgramImageValidationCode,
  errors: WendooProgramImageValidationError[]
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
