export enum DataType {
  U8 = 1,
  Bytes = 2,
  U32 = 3,
  F64 = 4,
  Bool = 5,
  String = 6,
  Tag = 7,
  Chunk = 8,
}

export interface IByteArray {
  length(): number; // in bytes
  slice(start: number, end?: number): IByteArray;
  toStringLatin1(): string;
  compare(other: IByteArray): number;
  hashCode(): number;
}

export interface IReadStream {
  peekTag(): number; // peeks at next four-cc tag without advancing
  readTag(tag: number): void; // reads and verifies four-cc tag match
  readU8(): number;
  readBytes(): IByteArray;
  readU32(): number; // for lengths, ids
  readF64(): number; // number
  readBool(): boolean;
  readString(): string; // length-prefixed utf-8
  readTaggedU8(tag: number): number;
  readTaggedBytes(tag: number): IByteArray;
  readTaggedU32(tag: number): number;
  readTaggedF64(tag: number): number;
  readTaggedBool(tag: number): boolean;
  readTaggedString(tag: number): string;
  skip(bytes: number): void;
  eof(): boolean;
  enterChunk(tag: number): number; // enter a tagged chunk for reading, returns version
  leaveChunk(): void; // leave current chunk
  skipChunk(tag: number): void; // skip over a tagged chunk
  pushReadPos(): void; // push current read position onto stack
  popReadPos(): void; // pop read position from stack and restore it
}

export interface IWriteStream {
  writeTag(tag: number): void; // writes u32 (four-cc tag)
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
  pushChunk(tag: number, version: number): void; // start a new tagged chunk
  popChunk(): void; // finish current chunk and write it with length prefix
}
