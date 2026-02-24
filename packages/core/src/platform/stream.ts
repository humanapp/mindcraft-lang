import type { IByteArray, IReadStream, IWriteStream } from "./stream-types";

export { DataType, type IByteArray, type IReadStream, type IWriteStream } from "./stream-types";

export declare class MemoryStream implements IReadStream, IWriteStream {
  constructor(initial?: IByteArray, initialCapacity?: number);

  // IReadStream
  peekTag(): number;
  readTag(tag: number): void;
  readU8(): number;
  readBytes(): IByteArray;
  readU32(): number;
  readF64(): number;
  readBool(): boolean;
  readString(): string;
  readTaggedU8(tag: number): number;
  readTaggedBytes(tag: number): IByteArray;
  readTaggedU32(tag: number): number;
  readTaggedF64(tag: number): number;
  readTaggedBool(tag: number): boolean;
  readTaggedString(tag: number): string;
  skip(bytes: number): void;
  eof(): boolean;
  pushReadPos(): void;
  popReadPos(): void;

  // IWriteStream
  writeTag(tag: number): void;
  writeU8(v: number): void;
  writeBytes(bytes: IByteArray): void;
  writeU32(v: number): void;
  writeF64(v: number): void;
  writeBool(v: boolean): void;
  writeString(v: string): void;
  writeTaggedU8(tag: number, v: number): void;
  writeTaggedBytes(tag: number, bytes: IByteArray): void;
  writeTaggedU32(tag: number, v: number): void;
  writeTaggedF64(tag: number, v: number): void;
  writeTaggedBool(tag: number, v: boolean): void;
  writeTaggedString(tag: number, v: string): void;
  toBytes(): IByteArray;

  // Additional methods
  resetRead(): void;
  tellRead(): number;
  tellWrite(): number;
  remaining(): number;

  // Chunk methods
  pushChunk(tag: number, version: number): void;
  popChunk(): void;
  enterChunk(tag: number): number;
  leaveChunk(): void;
  skipChunk(tag: number): void;
}

// Utility functions for IByteArray conversion
// These are implemented in platform-specific files (stream.node.ts, stream.rbx.ts)
// and will be available at runtime after the build process.

/**
 * Creates an IByteArray from platform-native binary data (makes a copy).
 * Implementation provided by platform-specific module.
 */
export declare function byteArrayFromUint8Array(src: unknown): IByteArray;

/**
 * Extracts platform-native binary data from an IByteArray.
 * Implementation provided by platform-specific module.
 */
export declare function byteArrayToUint8Array(bytes: IByteArray): unknown;
