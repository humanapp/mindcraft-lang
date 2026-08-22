import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectWendooProgramImageEncoding,
  parseWendooProgramImage,
  parseWendooProgramImageJson,
  serializeWendooProgramImageJson,
  validateWendooProgramImage,
  WENDOO_BINARY_PROGRAM_IMAGE_MAGIC,
  WENDOO_PROGRAM_IMAGE_FORMAT,
  WENDOO_PROGRAM_IMAGE_VERSION,
  type WendooProgramImage,
  WendooProgramImageEncoding,
  WendooProgramImageValidationCode,
} from "./program-image";

type ProgramImageValidationCode =
  (typeof WendooProgramImageValidationCode)[keyof typeof WendooProgramImageValidationCode];

const VALID_IMAGE: WendooProgramImage<{
  readonly entry: string;
  readonly bytecode: readonly number[];
}> = {
  format: WENDOO_PROGRAM_IMAGE_FORMAT,
  version: WENDOO_PROGRAM_IMAGE_VERSION,
  profileId: "test-profile",
  program: {
    entry: "main",
    bytecode: [1, 2, 3],
  },
};

function errorCodes(value: unknown): readonly ProgramImageValidationCode[] {
  const result = validateWendooProgramImage(value);
  assert.equal(result.ok, false);
  return result.errors.map((error) => error.code);
}

describe("parseWendooProgramImageJson", () => {
  it("parses JSON program image text", () => {
    const result = parseWendooProgramImageJson(JSON.stringify(VALID_IMAGE));

    assert.equal(result.ok, true);
    assert.equal(result.encoding, WendooProgramImageEncoding.JSON);
    assert.deepEqual(result.image, VALID_IMAGE);
  });

  it("returns a stable code for malformed JSON", () => {
    const result = parseWendooProgramImageJson("{not json");

    assert.equal(result.ok, false);
    assert.equal(result.encoding, WendooProgramImageEncoding.JSON);
    assert.deepEqual(
      result.errors.map((error) => error.code),
      [WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_JSON]
    );
    assert.ok(result.errors[0]?.cause);
  });
});

describe("parseWendooProgramImage", () => {
  it("parses JSON program image text", () => {
    const result = parseWendooProgramImage(JSON.stringify(VALID_IMAGE));

    assert.equal(result.ok, true);
    assert.equal(result.encoding, WendooProgramImageEncoding.JSON);
    assert.deepEqual(result.image, VALID_IMAGE);
  });

  it("detects JSON program image bytes", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(VALID_IMAGE));

    const result = parseWendooProgramImage(bytes);

    assert.equal(result.ok, true);
    assert.equal(result.encoding, WendooProgramImageEncoding.JSON);
    assert.deepEqual(result.image, VALID_IMAGE);
  });

  it("returns a stable code for recognized binary program images", () => {
    const result = parseWendooProgramImage(new Uint8Array([...WENDOO_BINARY_PROGRAM_IMAGE_MAGIC, 1, 2, 3]));

    assert.equal(result.ok, false);
    assert.equal(result.encoding, WendooProgramImageEncoding.BINARY);
    assert.deepEqual(
      result.errors.map((error) => error.code),
      [WendooProgramImageValidationCode.UNSUPPORTED_BINARY_PROGRAM_IMAGE]
    );
  });

  it("returns a stable code for unknown byte encodings", () => {
    const result = parseWendooProgramImage(new Uint8Array([0x01, 0x02, 0x03]));

    assert.equal(result.ok, false);
    assert.equal(result.encoding, undefined);
    assert.deepEqual(
      result.errors.map((error) => error.code),
      [WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_ENCODING]
    );
  });
});

describe("validateWendooProgramImage", () => {
  it("validates a parsed program image object", () => {
    const result = validateWendooProgramImage(VALID_IMAGE);

    assert.equal(result.ok, true);
    assert.deepEqual(result.image, VALID_IMAGE);
  });

  it("rejects invalid common envelope fields with stable codes", () => {
    assert.deepEqual(
      errorCodes({
        ...VALID_IMAGE,
        format: "wendoo.project",
        version: 2,
        profileId: 3,
        program: null,
      }),
      [
        WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_FORMAT,
        WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_VERSION,
        WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_PROFILE,
        WendooProgramImageValidationCode.MISSING_PROGRAM_IMAGE_PROGRAM,
      ]
    );
  });

  it("rejects non-object JSON roots", () => {
    assert.deepEqual(errorCodes([]), [WendooProgramImageValidationCode.INVALID_PROGRAM_IMAGE_ROOT]);
  });
});

describe("detectWendooProgramImageEncoding", () => {
  it("detects JSON program image bytes", () => {
    const jsonPrefix = new Uint8Array([0x0a, 0x7b]);

    assert.equal(detectWendooProgramImageEncoding(jsonPrefix), WendooProgramImageEncoding.JSON);
  });

  it("detects binary program image bytes", () => {
    const bytes = new Uint8Array([...WENDOO_BINARY_PROGRAM_IMAGE_MAGIC, 1, 2, 3]);

    assert.equal(detectWendooProgramImageEncoding(bytes), WendooProgramImageEncoding.BINARY);
  });

  it("rejects unknown byte encodings", () => {
    assert.equal(detectWendooProgramImageEncoding(new Uint8Array([0x01, 0x02, 0x03])), undefined);
  });
});

describe("serializeWendooProgramImageJson", () => {
  it("preserves the embedded profile id across JSON serialization", () => {
    const serialized = serializeWendooProgramImageJson(VALID_IMAGE);
    const result = parseWendooProgramImageJson(serialized);

    assert.equal(result.ok, true);
    assert.equal(result.image.profileId, "test-profile");
    assert.deepEqual(result.image, VALID_IMAGE);
  });
});
