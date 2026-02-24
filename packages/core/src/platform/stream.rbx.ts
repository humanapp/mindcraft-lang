import { fromFourCC } from "../primitives";
import { Error } from "./error";
import { DataType, type IByteArray, type IReadStream, type IWriteStream } from "./stream-types";
import { StringUtils as SU } from "./string";

export { DataType, type IByteArray, type IReadStream, type IWriteStream };

// Maximum allowed lengths for various data types
// WARNING: Lowering these values _will_ break backward compatibility of serialized data! They may be safely increased.
// KEEP IN SYNC with stream.node.ts
export const kMaxStringLength = 512; // 512 bytes
export const kMaxLongStringLength = 64 * 1024; // 64 KB
export const kMaxByteArrayLength = 1 * 1024 * 1024; // 1 MB

type RobloxBuffer = buffer;

class RobloxByteArray implements IByteArray {
  private readonly b: RobloxBuffer;
  private readonly start: number;
  private readonly size: number;

  constructor(b: RobloxBuffer, start = 0, size?: number) {
    const total = buffer.len(b);
    const s = start | 0;
    const n = (size ?? total - s) | 0;
    if (s < 0 || n < 0 || s + n > total) {
      throw new Error(`RobloxByteArray out of range: start=${s} size=${n} total=${total}`);
    }
    this.b = b;
    this.start = s;
    this.size = n;
  }

  static alloc(size: number): RobloxByteArray {
    if (size < 0) throw new Error(`alloc size < 0: ${size}`);
    return new RobloxByteArray(buffer.create(size), 0, size);
  }

  static fromStringLatin1(str: string): RobloxByteArray {
    // buffer.fromstring uses raw bytes (1 char => 1 byte) semantics.
    const b = buffer.fromstring(str);
    return new RobloxByteArray(b, 0, buffer.len(b));
  }

  // Internal escape hatch for stream impls.
  _raw(): { b: RobloxBuffer; start: number; size: number } {
    return { b: this.b, start: this.start, size: this.size };
  }

  length(): number {
    return this.size;
  }

  slice(istart: number, iend?: number): IByteArray {
    const s = istart | 0;
    const e = iend === undefined ? this.size : iend | 0;
    if (s < 0 || e < s || e > this.size) {
      throw new Error(`slice out of range: start=${s} end=${e} len=${this.size}`);
    }

    const n = e - s;
    const out = buffer.create(n);
    buffer.copy(out, 0, this.b, this.start + s, n);
    return new RobloxByteArray(out, 0, n);
  }

  // Optional helpers that are nice to have in Roblox land:
  readU8(offset: number): number {
    const o = offset | 0;
    if (o < 0 || o >= this.size) throw new Error(`readU8 out of range: ${o}`);
    return buffer.readu8(this.b, this.start + o);
  }

  toStringLatin1(): string {
    // Return only this slice as a string (raw bytes).
    // buffer.tostring converts the whole buffer; we need subrange.
    // We can readstring just our range.
    return buffer.readstring(this.b, this.start, this.size);
  }

  compare(other: IByteArray): number {
    if (!(other instanceof RobloxByteArray))
      throw new Error("RobloxByteArray.compare expects RobloxByteArray argument");
    const a = this._raw();
    const b = other._raw();
    const minLength = math.min(a.size, b.size);
    for (let i = 0; i < minLength; i++) {
      const byteA = buffer.readu8(a.b, a.start + i);
      const byteB = buffer.readu8(b.b, b.start + i);
      if (byteA !== byteB) {
        return byteA - byteB;
      }
    }
    return a.size - b.size;
  }

  hashCode(): number {
    // Simple hash code implementation (djb2)
    let hash = 5381;
    const r = this._raw();
    for (let i = 0; i < r.size; i++) {
      hash = (hash << 5) + hash + buffer.readu8(r.b, r.start + i);
    }
    return hash;
  }

  static concat(chunks: readonly IByteArray[]): RobloxByteArray {
    let total = 0;
    const raws: { b: RobloxBuffer; start: number; size: number }[] = [];

    for (const c of chunks) {
      if (!(c instanceof RobloxByteArray)) throw new Error("RobloxByteArray.concat expects RobloxByteArray chunks");
      const r = c._raw();
      raws.push(r);
      total += r.size;
    }

    const out = buffer.create(total);
    let o = 0;
    for (const r of raws) {
      buffer.copy(out, o, r.b, r.start, r.size);
      o += r.size;
    }

    return new RobloxByteArray(out, 0, total);
  }
}

export class MemoryStream implements IReadStream, IWriteStream {
  private buf: RobloxBuffer;
  private rpos = 0;
  private wpos = 0;

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
      if (!(initial instanceof RobloxByteArray)) {
        // In Roblox builds you can tighten this to only accept RobloxByteArray.
        // If you want cross-impl support, you could fall back to toStringLatin1().
        throw new Error("RobloxMemoryStream expects RobloxByteArray input on Roblox target");
      }
      const src = initial._raw();
      this.buf = buffer.create(src.size);
      buffer.copy(this.buf, 0, src.b, src.start, src.size);
      this.wpos = src.size;
    } else {
      const cap = math.max(1, initialCapacity | 0);
      this.buf = buffer.create(cap);
      this.wpos = 0;
    }
  }

  // ---- IReadStream ----

  readRawByte(): number {
    this.ensureReadable(1);
    const v = buffer.readu8(this.buf, this.rpos);
    this.rpos += 1;
    return v;
  }

  readRawU32(): number {
    this.ensureReadable(4);
    const v = buffer.readu32(this.buf, this.rpos);
    this.rpos += 4;
    return v;
  }

  readRawF64(): number {
    this.ensureReadable(8);
    const v = buffer.readf64(this.buf, this.rpos);
    this.rpos += 8;
    return v;
  }

  readRawBytes(len: number): RobloxBuffer {
    const n = len | 0;
    if (n < 0) throw new Error(`readRawBytes len < 0: ${n}`);
    if (n > kMaxByteArrayLength) throw new Error(`readRawBytes len too large: ${n} bytes`);
    this.ensureReadable(n);

    const out = buffer.create(n);
    buffer.copy(out, 0, this.buf, this.rpos, n);
    this.rpos += n;

    return out;
  }

  readDataType(t: DataType): void {
    const actual = this.readRawByte();
    this.ensureDataType(actual, t);
  }

  peekDataType(): DataType {
    this.ensureReadable(1);
    const actual = buffer.readu8(this.buf, this.rpos);
    return actual as DataType;
  }

  readU8(): number {
    this.readDataType(DataType.U8);
    return this.readRawByte();
  }

  readBytes(): IByteArray {
    this.readDataType(DataType.Bytes);
    const len = this.readRawU32();
    const buffer = this.readRawBytes(len);
    return new RobloxByteArray(buffer, 0, len);
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
    if (byteLen > kMaxStringLength) throw new Error(`String too large: ${byteLen} bytes`);
    const bytes = new RobloxByteArray(this.readRawBytes(byteLen), 0, byteLen);
    return utf8DecodeFromByteArray(bytes as RobloxByteArray);
  }

  peekTag(): number {
    const dt = this.peekDataType();
    if (dt !== DataType.Tag) {
      return 0;
    }
    this.ensureReadable(5); // 1 byte data type + 4 byte tag
    return buffer.readu32(this.buf, this.rpos + 1);
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
    if (this.chunkStack.size() > 0) {
      this.chunkStack[this.chunkStack.size() - 1].stream.writeRawByte(v);
      return;
    }
    this.ensureWritable(1);
    buffer.writeu8(this.buf, this.wpos, v & 0xff);
    this.wpos += 1;
  }

  writeRawU32(v: number): void {
    if (this.chunkStack.size() > 0) {
      this.chunkStack[this.chunkStack.size() - 1].stream.writeRawU32(v);
      return;
    }
    this.ensureWritable(4);
    buffer.writeu32(this.buf, this.wpos, v >>> 0);
    this.wpos += 4;
  }

  writeRawF64(v: number): void {
    if (this.chunkStack.size() > 0) {
      this.chunkStack[this.chunkStack.size() - 1].stream.writeRawF64(v);
      return;
    }
    this.ensureWritable(8);
    buffer.writef64(this.buf, this.wpos, v);
    this.wpos += 8;
  }

  writeDataType(t: DataType): void {
    if (this.chunkStack.size() > 0) {
      this.chunkStack[this.chunkStack.size() - 1].stream.writeDataType(t);
      return;
    }
    this.ensureWritable(1);
    buffer.writeu8(this.buf, this.wpos, t as number);
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
    if (!(bytes instanceof RobloxByteArray)) {
      throw new Error("RobloxMemoryStream.writeBytes expects RobloxByteArray on Roblox target");
    }

    const r = bytes._raw();
    if (r.size > kMaxByteArrayLength) throw new Error(`writeBytes too large: ${r.size} bytes`);
    this.writeRawU32(r.size);

    if (this.chunkStack.size() > 0) {
      // Delegate the buffer copy to the chunk stream
      const chunkStream = this.chunkStack[this.chunkStack.size() - 1].stream;
      chunkStream.ensureWritable(r.size);
      buffer.copy(chunkStream.buf, chunkStream.wpos, r.b, r.start, r.size);
      chunkStream.wpos += r.size;
    } else {
      this.ensureWritable(r.size);
      buffer.copy(this.buf, this.wpos, r.b, r.start, r.size);
      this.wpos += r.size;
    }
  }

  writeU32(v: number): void {
    if (v < 0 || v > 0xffffffff) {
      throw new Error(`writeU32 out of range: ${v}`);
    }
    this.writeDataType(DataType.U32);
    this.writeRawU32(v);
  }

  writeF64(v: number): void {
    // Luau: NaN is v ~= v; infinities are +/-math.huge
    if (v !== v || v === math.huge || v === -math.huge) throw new Error(`writeF64 requires finite number: ${v}`);
    this.writeDataType(DataType.F64);
    this.writeRawF64(v);
  }

  writeBool(v: boolean): void {
    this.writeDataType(DataType.Bool);
    this.writeRawByte(v ? 1 : 0);
  }

  writeString(v: string): void {
    this.writeDataType(DataType.String);
    const encoded = utf8EncodeToByteArray(v);
    const r = encoded._raw();
    if (r.size > kMaxStringLength) throw new Error(`String too large: ${r.size} bytes`);
    this.writeRawU32(r.size);

    if (this.chunkStack.size() > 0) {
      // Delegate the buffer copy to the chunk stream
      const chunkStream = this.chunkStack[this.chunkStack.size() - 1].stream;
      chunkStream.ensureWritable(r.size);
      buffer.copy(chunkStream.buf, chunkStream.wpos, r.b, r.start, r.size);
      chunkStream.wpos += r.size;
    } else {
      this.ensureWritable(r.size);
      buffer.copy(this.buf, this.wpos, r.b, r.start, r.size);
      this.wpos += r.size;
    }
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
    const out = buffer.create(this.wpos);
    buffer.copy(out, 0, this.buf, 0, this.wpos);
    return new RobloxByteArray(out, 0, this.wpos);
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
    // Note: Luau arrays don't have .slice(), so we manually copy
    const chunkCopy: Array<{ tag: number; version: number; endPos: number }> = [];
    for (const chunk of this.readChunkStack) {
      chunkCopy.push({ tag: chunk.tag, version: chunk.version, endPos: chunk.endPos });
    }
    this.readPosStack.push({
      rpos: this.rpos,
      chunkStack: chunkCopy,
    });
  }

  popReadPos(): void {
    if (this.readPosStack.size() === 0) {
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
    if (this.chunkStack.size() === 0) {
      throw new Error("popChunk called without matching pushChunk");
    }

    const { tag, version, stream: chunkStream } = this.chunkStack.pop()!;
    const chunkBytes = chunkStream.toBytes();

    if (!(chunkBytes instanceof RobloxByteArray)) {
      throw new Error("Expected RobloxByteArray from chunk stream");
    }

    const r = chunkBytes._raw();

    // If there's still a chunk on the stack, write to that chunk's stream
    // Otherwise write directly to the main stream
    if (this.chunkStack.size() > 0) {
      const parentStream = this.chunkStack[this.chunkStack.size() - 1].stream;
      parentStream.writeDataTypeDirect(DataType.Chunk);
      parentStream.writeRawU32Direct(tag);
      parentStream.writeRawU32Direct(version);
      parentStream.writeRawU32Direct(r.size);
      parentStream.ensureWritable(r.size);
      buffer.copy(parentStream.buf, parentStream.wpos, r.b, r.start, r.size);
      parentStream.wpos += r.size;
    } else {
      // Write chunk directly to main stream: DataType.Chunk + tag + version + length + data
      this.writeDataTypeDirect(DataType.Chunk);
      this.writeRawU32Direct(tag);
      this.writeRawU32Direct(version);
      this.writeRawU32Direct(r.size);
      this.ensureWritable(r.size);
      buffer.copy(this.buf, this.wpos, r.b, r.start, r.size);
      this.wpos += r.size;
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
    if (this.readChunkStack.size() === 0) {
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

  private writeDataTypeDirect(t: DataType): void {
    this.ensureWritable(1);
    buffer.writeu8(this.buf, this.wpos, t as number);
    this.wpos += 1;
  }

  private writeRawU32Direct(v: number): void {
    this.ensureWritable(4);
    buffer.writeu32(this.buf, this.wpos, v >>> 0);
    this.wpos += 4;
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
    const cap = buffer.len(this.buf);
    if (need <= cap) return;

    let newCap = cap;
    if (newCap < 64) newCap = 64;
    while (newCap < need) newCap *= 2;

    const bnext = buffer.create(newCap);
    buffer.copy(bnext, 0, this.buf, 0, this.wpos);
    this.buf = bnext;
  }
}

function utf8NextByteIndex(s: string, byteIndex1Based: number): number {
  // utf8.offset(s, 2, i) returns the byte index (1-based) of the NEXT codepoint
  // when starting at byte index i. If i is the last codepoint, it returns undefined.
  const inext = (utf8.offset as unknown as (s: string, n: number, i: number) => number | undefined)(
    s,
    2,
    byteIndex1Based
  );
  if (inext !== undefined) return inext;

  // Past end: return one past last byte index.
  return SU.length(s) + 1;
}

function utf8ForEachCodepoint(s: string, fn: (cp: number) => void): void {
  // Luau byte indices are 1-based for utf8.* functions.
  let i = 1;
  const iend = SU.length(s);

  while (i <= iend) {
    const cp = (utf8.codepoint as unknown as (s: string, i: number) => number)(s, i);
    fn(cp);
    i = utf8NextByteIndex(s, i);
  }
}

// --- UTF-8 encode/decode ---

export function utf8EncodeToByteArray(s: string): RobloxByteArray {
  // First pass: compute byte length
  let byteLen = 0;
  utf8ForEachCodepoint(s, (cp) => {
    if (cp <= 0x7f) byteLen += 1;
    else if (cp <= 0x7ff) byteLen += 2;
    else if (cp <= 0xffff) byteLen += 3;
    else byteLen += 4;
  });

  const b = buffer.create(byteLen);
  let o = 0;

  // Second pass: encode
  utf8ForEachCodepoint(s, (cp) => {
    if (cp <= 0x7f) {
      buffer.writeu8(b, o++, cp);
    } else if (cp <= 0x7ff) {
      buffer.writeu8(b, o++, 0xc0 | (cp >> 6));
      buffer.writeu8(b, o++, 0x80 | (cp & 0x3f));
    } else if (cp <= 0xffff) {
      buffer.writeu8(b, o++, 0xe0 | (cp >> 12));
      buffer.writeu8(b, o++, 0x80 | ((cp >> 6) & 0x3f));
      buffer.writeu8(b, o++, 0x80 | (cp & 0x3f));
    } else {
      buffer.writeu8(b, o++, 0xf0 | (cp >> 18));
      buffer.writeu8(b, o++, 0x80 | ((cp >> 12) & 0x3f));
      buffer.writeu8(b, o++, 0x80 | ((cp >> 6) & 0x3f));
      buffer.writeu8(b, o++, 0x80 | (cp & 0x3f));
    }
  });

  return new RobloxByteArray(b as unknown as RobloxBuffer, 0, byteLen);
}

export function utf8DecodeFromByteArray(bytes: RobloxByteArray): string {
  const r = bytes._raw();
  const out: string[] = [];

  let i = 0;
  while (i < r.size) {
    const b0 = buffer.readu8(r.b as unknown as RobloxBuffer, r.start + i);
    i += 1;

    if (b0 < 0x80) {
      out.push(utf8.char(b0));
    } else if (b0 < 0xe0) {
      const b1 = buffer.readu8(r.b as unknown as RobloxBuffer, r.start + i);
      i += 1;
      const cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
      out.push(utf8.char(cp));
    } else if (b0 < 0xf0) {
      const b1 = buffer.readu8(r.b as unknown as RobloxBuffer, r.start + i);
      i += 1;
      const b2 = buffer.readu8(r.b as unknown as RobloxBuffer, r.start + i);
      i += 1;
      const cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
      out.push(utf8.char(cp));
    } else {
      const b1 = buffer.readu8(r.b as unknown as RobloxBuffer, r.start + i);
      i += 1;
      const b2 = buffer.readu8(r.b as unknown as RobloxBuffer, r.start + i);
      i += 1;
      const b3 = buffer.readu8(r.b as unknown as RobloxBuffer, r.start + i);
      i += 1;
      const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      out.push(utf8.char(cp));
    }
  }

  return out.join("");
}

// Utility functions for working with IByteArray and buffer
// Note: In Roblox, we don't have Uint8Array, so these work with buffer directly

/**
 * Creates an IByteArray from a Roblox buffer (makes a copy).
 */
export function byteArrayFromBuffer(src: RobloxBuffer): IByteArray {
  const size = buffer.len(src);
  const copy = buffer.create(size);
  buffer.copy(copy, 0, src, 0, size);
  return new RobloxByteArray(copy, 0, size);
}

/**
 * Extracts a Roblox buffer from an IByteArray.
 * For RobloxByteArray, returns the underlying buffer (may be a slice).
 * For other implementations, converts via latin1 string.
 */
export function byteArrayToBuffer(bytes: IByteArray): RobloxBuffer {
  if (bytes instanceof RobloxByteArray) {
    const raw = bytes._raw();
    // If it's the full buffer, return as-is
    if (raw.start === 0 && raw.size === buffer.len(raw.b)) {
      return raw.b;
    }
    // Otherwise, need to copy the slice to a new buffer
    const out = buffer.create(raw.size);
    buffer.copy(out, 0, raw.b, raw.start, raw.size);
    return out;
  }

  // Fallback: use latin1 conversion
  const str = bytes.toStringLatin1();
  return buffer.fromstring(str);
}

// For compatibility with Node version's Uint8Array functions,
// provide aliases (in Roblox they work with buffer)
export const byteArrayFromUint8Array = byteArrayFromBuffer;
export const byteArrayToUint8Array = byteArrayToBuffer;
