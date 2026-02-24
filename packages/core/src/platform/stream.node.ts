import { fromFourCC } from "../primitives";
import { Error } from "./error";
import { DataType, type IByteArray, type IReadStream, type IWriteStream } from "./stream-types";

export { DataType, type IByteArray, type IReadStream, type IWriteStream };

// Maximum allowed lengths for various data types
// WARNING: Lowering these values _will_ break backward compatibility of serialized data! They may be safely increased.
// KEEP IN SYNC with stream.rbx.ts
export const kMaxStringLength = 512; // 512 bytes
export const kMaxLongStringLength = 64 * 1024; // 64 KB
export const kMaxByteArrayLength = 1 * 1024 * 1024; // 1 MB

class NodeByteArray implements IByteArray {
  private readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  static alloc(size: number): NodeByteArray {
    if (size < 0) throw new Error(`alloc size < 0: ${size}`);
    return new NodeByteArray(new Uint8Array(size));
  }

  static fromUint8ArrayCopy(src: Uint8Array): NodeByteArray {
    const c = new Uint8Array(src.length);
    c.set(src);
    return new NodeByteArray(c);
  }

  static fromStringLatin1(str: string): NodeByteArray {
    // 1 char => 1 byte (0..255)
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return new NodeByteArray(out);
  }

  // Internal escape hatch for stream impls.
  // Callers should not mutate.
  asUint8Array(): Uint8Array {
    return this.data;
  }

  length(): number {
    return this.data.length;
  }

  slice(start: number, end?: number): IByteArray {
    const s = start | 0;
    const e = end === undefined ? this.data.length : end | 0;
    if (s < 0 || e < s || e > this.data.length) {
      throw new Error(`slice out of range: start=${s}, end=${e}, len=${this.data.length}`);
    }
    return new NodeByteArray(this.data.slice(s, e)); // copy
  }

  toStringLatin1(): string {
    // Avoid TextDecoder to keep this target-simple.
    let out = "";
    // Chunk to avoid call stack / perf issues for large arrays.
    const CHUNK = 0x8000;
    for (let i = 0; i < this.data.length; i += CHUNK) {
      const sub = this.data.subarray(i, Math.min(i + CHUNK, this.data.length));
      out += String.fromCharCode(...sub);
    }
    return out;
  }

  compare(other: IByteArray): number {
    const aLen = this.length();
    const bLen = other.length();
    const minLength = Math.min(aLen, bLen);
    for (let i = 0; i < minLength; i++) {
      const byteA = this.data[i];
      const byteB = (other as NodeByteArray).data[i];
      if (byteA !== byteB) {
        return byteA - byteB;
      }
    }
    return aLen - bLen;
  }

  hashCode(): number {
    // Simple hash code implementation (djb2)
    let hash = 5381;
    for (let i = 0; i < this.data.length; i++) {
      hash = (hash * 33) ^ this.data[i];
    }
    return hash >>> 0; // Ensure unsigned
  }

  static concat(chunks: readonly IByteArray[]): NodeByteArray {
    let total = 0;
    const u8s: Uint8Array[] = [];
    for (const c of chunks) {
      if (!(c instanceof NodeByteArray)) throw new Error("NodeByteArray.concat expects NodeByteArray chunks");
      const u8 = c.asUint8Array();
      u8s.push(u8);
      total += u8.length;
    }

    const out = new Uint8Array(total);
    let o = 0;
    for (const u8 of u8s) {
      out.set(u8, o);
      o += u8.length;
    }
    return new NodeByteArray(out);
  }
}

export class MemoryStream implements IReadStream, IWriteStream {
  private buf: Uint8Array;
  private view: DataView;
  private rpos = 0;
  private wpos = 0;

  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });

  // Chunk support: stack of buffers for writing nested chunks
  private chunkStack: Array<{ tag: number; version: number; stream: MemoryStream }> = [];
  // Read chunk stack: tracks chunk boundaries
  private readChunkStack: Array<{ tag: number; version: number; endPos: number }> = [];
  // Read position stack - stores both rpos and chunk stack state
  private readPosStack: Array<{
    rpos: number;
    chunkStack: Array<{ tag: number; version: number; endPos: number }>;
  }> = [];

  constructor(initial?: IByteArray, initialCapacity = 64) {
    if (initial) {
      const src = MemoryStream.toU8(initial);
      this.buf = new Uint8Array(src.length);
      this.buf.set(src);
      this.wpos = src.length;
    } else {
      const cap = Math.max(1, initialCapacity | 0);
      this.buf = new Uint8Array(cap);
      this.wpos = 0;
    }
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
  }

  // ---- IReadStream ----

  readRawByte(): number {
    this.ensureReadable(1);
    const v = this.buf[this.rpos];
    this.rpos += 1;
    return v;
  }

  readRawU32(): number {
    this.ensureReadable(4);
    const v = this.view.getUint32(this.rpos, true);
    this.rpos += 4;
    return v;
  }

  readRawF64(): number {
    this.ensureReadable(8);
    const v = this.view.getFloat64(this.rpos, true);
    this.rpos += 8;
    return v;
  }

  readRawBytes(len: number): Uint8Array {
    const n = len | 0;
    if (n < 0) throw new Error(`readRawBytes len < 0: ${n}`);
    if (n > kMaxByteArrayLength) throw new Error(`readRawBytes len too large: ${n} bytes`);
    this.ensureReadable(n);

    const start = this.rpos;
    const end = start + n;
    this.rpos = end;

    return this.buf.subarray(start, end);
  }

  readDataType(t: DataType): void {
    const actual = this.readRawByte();
    this.ensureDataType(actual, t);
  }

  peekDataType(): DataType {
    this.ensureReadable(1);
    return this.buf[this.rpos] as DataType;
  }

  readU8(): number {
    this.readDataType(DataType.U8);
    return this.readRawByte();
  }

  readBytes(): IByteArray {
    this.readDataType(DataType.Bytes);
    const len = this.readRawU32();
    const bytes = this.readRawBytes(len);
    return NodeByteArray.fromUint8ArrayCopy(bytes);
  }

  readU32(): number {
    this.readDataType(DataType.U32);
    return this.readRawU32();
  }

  readF64(): number {
    this.readDataType(DataType.F64);
    return this.readRawF64();
  }

  readBool(): boolean {
    this.readDataType(DataType.Bool);
    const b = this.readRawByte();
    if (b !== 0 && b !== 1) throw new Error(`Invalid bool value: ${b}`);
    return b === 1;
  }

  readString(): string {
    this.readDataType(DataType.String);
    const byteLen = this.readRawU32();
    // Optional guard. Tune as desired.
    if (byteLen > kMaxStringLength) throw new Error(`String too large: ${byteLen} bytes`);

    this.ensureReadable(byteLen);
    const start = this.rpos;
    const end = start + byteLen;
    this.rpos = end;

    return this.decoder.decode(this.buf.subarray(start, end));
  }

  peekTag(): number {
    const dt = this.peekDataType(); // ensure next is a tag
    if (dt !== DataType.Tag) {
      return 0;
    }
    this.ensureReadable(5); // 1 byte data type + 4 byte tag
    return this.view.getUint32(this.rpos + 1, true);
  }

  readTag(tag: number): void {
    this.readDataType(DataType.Tag);
    const t = this.readRawU32();
    if (t !== tag) {
      throw new Error(`Tag mismatch: expected ${fromFourCC(tag)}, got ${fromFourCC(t)}`);
    }
  }

  readTaggedU8(tag: number): number {
    this.readTag(tag);
    return this.readU8();
  }

  readTaggedBytes(tag: number): IByteArray {
    this.readTag(tag);
    return this.readBytes();
  }

  readTaggedU32(tag: number): number {
    this.readTag(tag);
    return this.readU32();
  }

  readTaggedF64(tag: number): number {
    this.readTag(tag);
    return this.readF64();
  }

  readTaggedBool(tag: number): boolean {
    this.readTag(tag);
    return this.readBool();
  }

  readTaggedString(tag: number): string {
    this.readTag(tag);
    return this.readString();
  }

  skip(bytes: number): void {
    const n = bytes | 0;
    if (n < 0) throw new Error(`skip bytes < 0: ${n}`);
    this.ensureReadable(n);
    this.rpos += n;
  }

  eof(): boolean {
    return this.rpos >= this.wpos;
  }

  // ---- IWriteStream ----

  writeRawByte(v: number): void {
    if (this.chunkStack.length > 0) {
      this.chunkStack[this.chunkStack.length - 1].stream.writeRawByte(v);
      return;
    }
    this.ensureWritable(1);
    this.buf[this.wpos] = v & 0xff;
    this.wpos += 1;
  }

  writeRawU32(v: number): void {
    if (this.chunkStack.length > 0) {
      this.chunkStack[this.chunkStack.length - 1].stream.writeRawU32(v);
      return;
    }
    this.ensureWritable(4);
    this.view.setUint32(this.wpos, v >>> 0, true);
    this.wpos += 4;
  }

  writeRawF64(v: number): void {
    if (this.chunkStack.length > 0) {
      this.chunkStack[this.chunkStack.length - 1].stream.writeRawF64(v);
      return;
    }
    this.ensureWritable(8);
    this.view.setFloat64(this.wpos, v, true);
    this.wpos += 8;
  }

  writeRawBytes(bytes: Uint8Array, len: number): void {
    if (this.chunkStack.length > 0) {
      this.chunkStack[this.chunkStack.length - 1].stream.writeRawBytes(bytes, len);
      return;
    }
    len = len | 0;
    if (len < 0 || len > bytes.length) {
      throw new Error(`writeRawBytes len out of range: ${len}`);
    }
    if (len > kMaxByteArrayLength) throw new Error(`writeRawBytes len too large: ${len} bytes`);
    this.ensureWritable(len);
    this.buf.set(bytes.subarray(0, len), this.wpos);
    this.wpos += len;
  }

  writeDataType(t: DataType): void {
    if (this.chunkStack.length > 0) {
      this.chunkStack[this.chunkStack.length - 1].stream.writeDataType(t);
      return;
    }
    this.ensureWritable(1);
    this.buf[this.wpos] = t as number;
    this.wpos += 1;
  }

  writeU8(v: number): void {
    this.writeDataType(DataType.U8);
    const x = v | 0;
    if (x < 0 || x > 0xff) throw new Error(`writeU8 out of range: ${v}`);
    this.writeRawByte(x);
  }

  writeBytes(bytes: IByteArray): void {
    this.writeDataType(DataType.Bytes);
    const src = MemoryStream.toU8(bytes);
    this.writeRawU32(src.length);
    this.writeRawBytes(src, src.length);
  }

  writeU32(v: number): void {
    if (!Number.isFinite(v) || v < 0 || v > 0xffffffff) {
      throw new Error(`writeU32 out of range: ${v}`);
    }
    this.writeDataType(DataType.U32);
    this.writeRawU32(v);
  }

  writeF64(v: number): void {
    // If you want to allow NaN/Infinity, relax this.
    if (!Number.isFinite(v)) throw new Error(`writeF64 requires finite number: ${v}`);
    this.writeDataType(DataType.F64);
    this.writeRawF64(v);
  }

  writeBool(v: boolean): void {
    this.writeDataType(DataType.Bool);
    this.writeRawByte(v ? 1 : 0);
  }

  writeString(v: string): void {
    this.writeDataType(DataType.String);
    const bytes = this.encoder.encode(v);
    if (bytes.length > kMaxStringLength) throw new Error(`String too large: ${bytes.length} bytes`);
    this.writeRawU32(bytes.length);
    this.writeRawBytes(bytes, bytes.length);
  }

  writeTag(tag: number): void {
    this.writeDataType(DataType.Tag);
    this.writeRawU32(tag);
  }

  writeTaggedU8(tag: number, v: number): void {
    this.writeTag(tag);
    this.writeU8(v);
  }

  writeTaggedBytes(tag: number, bytes: IByteArray): void {
    this.writeTag(tag);
    this.writeBytes(bytes);
  }

  writeTaggedU32(tag: number, v: number): void {
    this.writeTag(tag);
    this.writeU32(v);
  }

  writeTaggedF64(tag: number, v: number): void {
    this.writeTag(tag);
    this.writeF64(v);
  }

  writeTaggedBool(tag: number, v: boolean): void {
    this.writeTag(tag);
    this.writeBool(v);
  }

  writeTaggedString(tag: number, v: string): void {
    this.writeTag(tag);
    this.writeString(v);
  }

  toBytes(): IByteArray {
    // copy out so caller won't observe mutations on future writes
    return new NodeByteArray(this.buf.slice(0, this.wpos));
  }

  // ---- Optional helpers ----

  resetRead(): void {
    this.rpos = 0;
    this.readChunkStack = [];
  }

  tellRead(): number {
    return this.rpos;
  }

  tellWrite(): number {
    return this.wpos;
  }

  remaining(): number {
    return this.wpos - this.rpos;
  }

  pushReadPos(): void {
    // Save both read position and chunk stack state
    this.readPosStack.push({
      rpos: this.rpos,
      chunkStack: this.readChunkStack.slice(), // shallow copy
    });
  }

  popReadPos(): void {
    if (this.readPosStack.length === 0) {
      throw new Error("popReadPos: stack is empty");
    }
    const state = this.readPosStack.pop()!;
    this.rpos = state.rpos;
    this.readChunkStack = state.chunkStack;
  }

  // ---- Chunk support ----

  pushChunk(tag: number, version: number): void {
    // Save current stream state and start a new nested stream
    const chunkStream = new MemoryStream();
    this.chunkStack.push({ tag, version, stream: chunkStream });
  }

  popChunk(): void {
    if (this.chunkStack.length === 0) {
      throw new Error("popChunk called without matching pushChunk");
    }

    const { tag, version, stream: chunkStream } = this.chunkStack.pop()!;
    const chunkBytes = chunkStream.toBytes();
    const src = MemoryStream.toU8(chunkBytes);

    // If there's still a chunk on the stack, write to that chunk's stream
    // Otherwise write directly to the main stream
    if (this.chunkStack.length > 0) {
      const parentStream = this.chunkStack[this.chunkStack.length - 1].stream;
      parentStream.writeDataTypeDirect(DataType.Chunk);
      parentStream.writeRawU32Direct(tag);
      parentStream.writeRawU32Direct(version);
      parentStream.writeRawU32Direct(src.length);
      parentStream.writeRawBytesDirect(src, src.length);
    } else {
      // Write chunk directly to main stream: DataType.Chunk + tag + version + length + data
      this.writeDataTypeDirect(DataType.Chunk);
      this.writeRawU32Direct(tag);
      this.writeRawU32Direct(version);
      this.writeRawU32Direct(src.length);
      this.writeRawBytesDirect(src, src.length);
    }
  }

  enterChunk(tag: number): number {
    // Read chunk header
    this.readDataType(DataType.Chunk);
    const t = this.readRawU32();
    if (t !== tag) {
      throw new Error(`Chunk tag mismatch: expected ${fromFourCC(tag)}, got ${fromFourCC(t)}`);
    }
    const version = this.readRawU32();
    const len = this.readRawU32();
    const endPos = this.rpos + len;

    if (endPos > this.wpos) {
      throw new Error(`Chunk extends beyond buffer: endPos=${endPos}, wpos=${this.wpos}`);
    }

    this.readChunkStack.push({ tag, version, endPos });
    return version;
  }

  leaveChunk(): void {
    if (this.readChunkStack.length === 0) {
      throw new Error("leaveChunk called without matching enterChunk");
    }

    const { endPos } = this.readChunkStack.pop()!;
    // Move read position to end of chunk
    this.rpos = endPos;
  }

  skipChunk(tag: number): void {
    // Read chunk header
    this.readDataType(DataType.Chunk);
    const t = this.readRawU32();
    if (t !== tag) {
      throw new Error(`Chunk tag mismatch: expected ${fromFourCC(tag)}, got ${fromFourCC(t)}`);
    }
    const version = this.readRawU32();
    const len = this.readRawU32();
    // Skip the chunk data
    this.skip(len);
  }

  // ---- internals ----

  // ---- internals ----

  private writeDataTypeDirect(t: DataType): void {
    this.ensureWritable(1);
    this.buf[this.wpos] = t as number;
    this.wpos += 1;
  }

  private writeRawU32Direct(v: number): void {
    this.ensureWritable(4);
    this.view.setUint32(this.wpos, v >>> 0, true);
    this.wpos += 4;
  }

  private writeRawBytesDirect(bytes: Uint8Array, len: number): void {
    len = len | 0;
    if (len < 0 || len > bytes.length) {
      throw new Error(`writeRawBytes len out of range: ${len}`);
    }
    if (len > kMaxByteArrayLength) throw new Error(`writeRawBytes len too large: ${len} bytes`);
    this.ensureWritable(len);
    this.buf.set(bytes.subarray(0, len), this.wpos);
    this.wpos += len;
  }

  private ensureDataType(actual: number, expected: DataType): void {
    if (actual !== expected) {
      throw new Error(`Data type mismatch: expected ${expected}, got ${actual}`);
    }
  }

  private ensureReadable(n: number): void {
    if (this.rpos + n > this.wpos) {
      throw new Error(`Unexpected EOF: need ${n} bytes, have ${this.wpos - this.rpos}`);
    }
  }

  private ensureWritable(n: number): void {
    const need = this.wpos + n;
    if (need <= this.buf.length) return;

    let newCap = this.buf.length;
    if (newCap < 64) newCap = 64;
    while (newCap < need) newCap *= 2;

    const next = new Uint8Array(newCap);
    next.set(this.buf.subarray(0, this.wpos), 0);
    this.buf = next;
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
  }

  private static toU8(bytes: IByteArray): Uint8Array {
    // Fast path for our NodeByteArray.
    if (bytes instanceof NodeByteArray) return bytes.asUint8Array();

    // Fallback: use the latin1 string representation (1 byte/char).
    // This keeps the interface minimal and still lets NodeMemoryStream
    // consume any IByteArray implementation.
    const s = bytes.toStringLatin1();
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
}

// Utility functions for working with IByteArray and Uint8Array

/**
 * Creates an IByteArray from a Uint8Array (makes a copy).
 */
export function byteArrayFromUint8Array(src: Uint8Array): IByteArray {
  return NodeByteArray.fromUint8ArrayCopy(src);
}

/**
 * Extracts a Uint8Array from an IByteArray.
 * For NodeByteArray, returns the underlying array directly (no copy).
 * For other implementations, converts via latin1 string.
 */
export function byteArrayToUint8Array(bytes: IByteArray): Uint8Array {
  if (bytes instanceof NodeByteArray) {
    return bytes.asUint8Array();
  }

  // Fallback: use latin1 conversion
  const s = bytes.toStringLatin1();
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i) & 0xff;
  }
  return out;
}
