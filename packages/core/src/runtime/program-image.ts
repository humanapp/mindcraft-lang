/** Program image format identifier used by JSON-encoded `.mcprogram` files. */
export const MINDCRAFT_PROGRAM_IMAGE_FORMAT = "mindcraft.program";

/** Program image envelope version. */
export const MINDCRAFT_PROGRAM_IMAGE_VERSION = 1;

/**
 * Binary `.mcprogram` magic bytes (`0x89` + `"MBP"`, "mindcraft binary program").
 * The high-bit lead byte distinguishes the binary form from JSON text and catches
 * 7-bit/text-mode corruption (the same role `0x89` plays in the PNG signature);
 * the `MBP` identifier makes the format recognizable in a hex dump.
 */
export const MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC = [0x89, 0x4d, 0x42, 0x50] as const;

/** Program image encodings recognized by program image readers. */
export const MindcraftProgramImageEncoding = {
  JSON: "json",
  BINARY: "binary",
} as const;

/** Union of all {@link MindcraftProgramImageEncoding} values. */
export type MindcraftProgramImageEncoding =
  (typeof MindcraftProgramImageEncoding)[keyof typeof MindcraftProgramImageEncoding];

/** Serialized Mindcraft program image envelope. */
export interface MindcraftProgramImage<TProgram = unknown, TProfileId extends string = string> {
  /** Program image format identifier. */
  readonly format: typeof MINDCRAFT_PROGRAM_IMAGE_FORMAT;

  /** Program image envelope version. */
  readonly version: typeof MINDCRAFT_PROGRAM_IMAGE_VERSION;

  /** Device profile required by the program image. */
  readonly profileId: TProfileId;

  /** Linked Mindcraft program payload. */
  readonly program: TProgram;
}

/** Byte-like collection accepted by program image encoding detection. */
export interface MindcraftProgramImageBytes {
  /** Number of bytes in the collection. */
  readonly length: number;

  /** Byte value at the given zero-based index. */
  readonly [index: number]: number;
}
