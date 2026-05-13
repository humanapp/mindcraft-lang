/** Program image format identifier used by JSON-encoded `.mcprogram` files. */
export const MINDCRAFT_PROGRAM_IMAGE_FORMAT = "mindcraft.program";

/** Program image envelope version. */
export const MINDCRAFT_PROGRAM_IMAGE_VERSION = 1;

/** Binary `.mcprogram` magic bytes ('MCPROG'). */
export const MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC = [0x4d, 0x43, 0x50, 0x52, 0x4f, 0x47] as const;

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
