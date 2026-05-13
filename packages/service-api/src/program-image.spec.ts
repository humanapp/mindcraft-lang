import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectMindcraftProgramImageEncoding,
  MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC,
  MINDCRAFT_PROGRAM_IMAGE_FORMAT,
  MINDCRAFT_PROGRAM_IMAGE_VERSION,
  type MindcraftProgramImage,
  MindcraftProgramImageEncoding,
  MindcraftProgramImageValidationCode,
  parseMindcraftProgramImageJson,
  serializeMindcraftProgramImageJson,
  validateMindcraftProgramImage,
} from "./program-image";

type ProgramImageValidationCode =
  (typeof MindcraftProgramImageValidationCode)[keyof typeof MindcraftProgramImageValidationCode];

const VALID_IMAGE: MindcraftProgramImage<{
  readonly entry: string;
  readonly bytecode: readonly number[];
}> = {
  format: MINDCRAFT_PROGRAM_IMAGE_FORMAT,
  version: MINDCRAFT_PROGRAM_IMAGE_VERSION,
  profileId: "test-profile",
  program: {
    entry: "main",
    bytecode: [1, 2, 3],
  },
};

function errorCodes(value: unknown): readonly ProgramImageValidationCode[] {
  const result = validateMindcraftProgramImage(value);
  assert.equal(result.ok, false);
  return result.errors.map((error) => error.code);
}

describe("parseMindcraftProgramImageJson", () => {
  it("parses JSON program image text", () => {
    const result = parseMindcraftProgramImageJson(JSON.stringify(VALID_IMAGE));

    assert.equal(result.ok, true);
    assert.equal(result.encoding, MindcraftProgramImageEncoding.JSON);
    assert.deepEqual(result.image, VALID_IMAGE);
  });

  it("returns a stable code for malformed JSON", () => {
    const result = parseMindcraftProgramImageJson("{not json");

    assert.equal(result.ok, false);
    assert.equal(result.encoding, MindcraftProgramImageEncoding.JSON);
    assert.deepEqual(
      result.errors.map((error) => error.code),
      [MindcraftProgramImageValidationCode.INVALID_PROGRAM_IMAGE_JSON]
    );
  });
});

describe("validateMindcraftProgramImage", () => {
  it("validates a parsed program image object", () => {
    const result = validateMindcraftProgramImage(VALID_IMAGE);

    assert.equal(result.ok, true);
    assert.deepEqual(result.image, VALID_IMAGE);
  });

  it("rejects invalid common envelope fields with stable codes", () => {
    assert.deepEqual(
      errorCodes({
        ...VALID_IMAGE,
        format: "mindcraft.project",
        version: 2,
        profileId: 3,
        program: null,
      }),
      [
        MindcraftProgramImageValidationCode.INVALID_PROGRAM_IMAGE_FORMAT,
        MindcraftProgramImageValidationCode.INVALID_PROGRAM_IMAGE_VERSION,
        MindcraftProgramImageValidationCode.INVALID_PROGRAM_IMAGE_PROFILE,
        MindcraftProgramImageValidationCode.MISSING_PROGRAM_IMAGE_PROGRAM,
      ]
    );
  });

  it("rejects non-object JSON roots", () => {
    assert.deepEqual(errorCodes([]), [MindcraftProgramImageValidationCode.INVALID_PROGRAM_IMAGE_ROOT]);
  });
});

describe("detectMindcraftProgramImageEncoding", () => {
  it("detects JSON program image bytes", () => {
    const jsonPrefix = new Uint8Array([0x0a, 0x7b]);

    assert.equal(detectMindcraftProgramImageEncoding(jsonPrefix), MindcraftProgramImageEncoding.JSON);
  });

  it("detects binary program image bytes", () => {
    const bytes = new Uint8Array([...MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC, 1, 2, 3]);

    assert.equal(detectMindcraftProgramImageEncoding(bytes), MindcraftProgramImageEncoding.BINARY);
  });

  it("rejects unknown byte encodings", () => {
    assert.equal(detectMindcraftProgramImageEncoding(new Uint8Array([0x01, 0x02, 0x03])), undefined);
  });
});

describe("serializeMindcraftProgramImageJson", () => {
  it("preserves the embedded profile id across JSON serialization", () => {
    const serialized = serializeMindcraftProgramImageJson(VALID_IMAGE);
    const result = parseMindcraftProgramImageJson(serialized);

    assert.equal(result.ok, true);
    assert.equal(result.image.profileId, "test-profile");
    assert.deepEqual(result.image, VALID_IMAGE);
  });
});
