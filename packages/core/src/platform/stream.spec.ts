/**
 * Round-trip encode/decode tests for MemoryStream.
 *
 * Covers every DataType, tagged variants, chunk nesting,
 * buffer growth, and read position save/restore (pushReadPos/popReadPos).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stream } from "@mindcraft-lang/core";

const { MemoryStream, DataType, byteArrayFromUint8Array, byteArrayToUint8Array } = stream;

// ---- Primitive round-trips ----

describe("MemoryStream -- primitive round-trips", () => {
  test("U8 round-trip", () => {
    const s = new MemoryStream();
    s.writeU8(0);
    s.writeU8(127);
    s.writeU8(255);
    s.resetRead();

    assert.equal(s.readU8(), 0);
    assert.equal(s.readU8(), 127);
    assert.equal(s.readU8(), 255);
    assert.ok(s.eof());
  });

  test("U32 round-trip", () => {
    const s = new MemoryStream();
    s.writeU32(0);
    s.writeU32(1);
    s.writeU32(0xffff_ffff);
    s.writeU32(123456789);
    s.resetRead();

    assert.equal(s.readU32(), 0);
    assert.equal(s.readU32(), 1);
    assert.equal(s.readU32(), 0xffff_ffff);
    assert.equal(s.readU32(), 123456789);
    assert.ok(s.eof());
  });

  test("F64 round-trip", () => {
    const s = new MemoryStream();
    s.writeF64(0);
    s.writeF64(-1.5);
    s.writeF64(Math.PI);
    s.writeF64(Number.MAX_SAFE_INTEGER);
    s.writeF64(Number.MIN_SAFE_INTEGER);
    s.resetRead();

    assert.equal(s.readF64(), 0);
    assert.equal(s.readF64(), -1.5);
    assert.equal(s.readF64(), Math.PI);
    assert.equal(s.readF64(), Number.MAX_SAFE_INTEGER);
    assert.equal(s.readF64(), Number.MIN_SAFE_INTEGER);
    assert.ok(s.eof());
  });

  test("F64 rejects Infinity", () => {
    const s = new MemoryStream();
    assert.throws(() => s.writeF64(Number.POSITIVE_INFINITY));
    assert.throws(() => s.writeF64(Number.NEGATIVE_INFINITY));
  });

  test("Bool round-trip", () => {
    const s = new MemoryStream();
    s.writeBool(true);
    s.writeBool(false);
    s.resetRead();

    assert.equal(s.readBool(), true);
    assert.equal(s.readBool(), false);
    assert.ok(s.eof());
  });

  test("String round-trip", () => {
    const s = new MemoryStream();
    s.writeString("");
    s.writeString("hello");
    s.writeString("abc123");
    s.resetRead();

    assert.equal(s.readString(), "");
    assert.equal(s.readString(), "hello");
    assert.equal(s.readString(), "abc123");
    assert.ok(s.eof());
  });

  test("Bytes round-trip via byteArray helpers", () => {
    const src = new Uint8Array([10, 20, 30, 40, 50]);
    const ba = byteArrayFromUint8Array(src);

    const s = new MemoryStream();
    s.writeBytes(ba);
    s.resetRead();

    const out = s.readBytes();
    const dst = byteArrayToUint8Array(out) as Uint8Array;
    assert.deepEqual([...dst], [10, 20, 30, 40, 50]);
    assert.ok(s.eof());
  });

  test("Tag round-trip", () => {
    const s = new MemoryStream();
    // Tags are u32 four-cc values
    const tag = 0x42524e53; // "BRNS" in big-endian
    s.writeTag(tag);
    s.resetRead();

    assert.equal(s.peekTag(), tag);
    s.readTag(tag); // should not throw
    assert.ok(s.eof());
  });
});

// ---- Tagged variants ----

describe("MemoryStream -- tagged variants", () => {
  test("writeTaggedU8 / readTaggedU8", () => {
    const s = new MemoryStream();
    const tag = 0x41424344; // "ABCD"
    s.writeTaggedU8(tag, 99);
    s.resetRead();

    assert.equal(s.readTaggedU8(tag), 99);
    assert.ok(s.eof());
  });

  test("writeTaggedU32 / readTaggedU32", () => {
    const s = new MemoryStream();
    const tag = 0x56455253; // "VERS"
    s.writeTaggedU32(tag, 42);
    s.resetRead();

    assert.equal(s.readTaggedU32(tag), 42);
    assert.ok(s.eof());
  });

  test("writeTaggedF64 / readTaggedF64", () => {
    const s = new MemoryStream();
    const tag = 0x46363400; // "F64\0"
    s.writeTaggedF64(tag, 3.14);
    s.resetRead();

    const val = s.readTaggedF64(tag);
    assert.ok(Math.abs(val - 3.14) < 1e-10);
    assert.ok(s.eof());
  });

  test("writeTaggedBool / readTaggedBool", () => {
    const s = new MemoryStream();
    const tag = 0x424f4f4c; // "BOOL"
    s.writeTaggedBool(tag, true);
    s.writeTaggedBool(tag, false);
    s.resetRead();

    assert.equal(s.readTaggedBool(tag), true);
    assert.equal(s.readTaggedBool(tag), false);
    assert.ok(s.eof());
  });

  test("writeTaggedString / readTaggedString", () => {
    const s = new MemoryStream();
    const tag = 0x4e414d45; // "NAME"
    s.writeTaggedString(tag, "world");
    s.resetRead();

    assert.equal(s.readTaggedString(tag), "world");
    assert.ok(s.eof());
  });

  test("writeTaggedBytes / readTaggedBytes", () => {
    const src = byteArrayFromUint8Array(new Uint8Array([1, 2, 3]));
    const s = new MemoryStream();
    const tag = 0x44415441; // "DATA"
    s.writeTaggedBytes(tag, src);
    s.resetRead();

    const out = s.readTaggedBytes(tag);
    const dst = byteArrayToUint8Array(out) as Uint8Array;
    assert.deepEqual([...dst], [1, 2, 3]);
    assert.ok(s.eof());
  });
});

// ---- Chunk nesting ----

describe("MemoryStream -- chunk nesting", () => {
  test("single chunk write then read", () => {
    const s = new MemoryStream();
    const chunkTag = 0x43484e4b; // "CHNK"
    const version = 1;

    s.pushChunk(chunkTag, version);
    s.writeU8(10);
    s.writeU32(200);
    s.writeString("inside");
    s.popChunk();

    s.resetRead();

    const readVersion = s.enterChunk(chunkTag);
    assert.equal(readVersion, version);
    assert.equal(s.readU8(), 10);
    assert.equal(s.readU32(), 200);
    assert.equal(s.readString(), "inside");
    s.leaveChunk();

    assert.ok(s.eof());
  });

  test("nested chunks", () => {
    const s = new MemoryStream();
    const outerTag = 0x4f555452; // "OUTR"
    const innerTag = 0x494e4e52; // "INNR"

    s.pushChunk(outerTag, 2);
    s.writeU8(1);
    s.pushChunk(innerTag, 3);
    s.writeString("deep");
    s.popChunk();
    s.writeU8(2);
    s.popChunk();

    s.resetRead();

    const outerVer = s.enterChunk(outerTag);
    assert.equal(outerVer, 2);
    assert.equal(s.readU8(), 1);

    const innerVer = s.enterChunk(innerTag);
    assert.equal(innerVer, 3);
    assert.equal(s.readString(), "deep");
    s.leaveChunk();

    assert.equal(s.readU8(), 2);
    s.leaveChunk();

    assert.ok(s.eof());
  });

  test("skipChunk skips unknown chunk", () => {
    const s = new MemoryStream();
    const knownTag = 0x4b4e574e; // "KNWN"
    const unknownTag = 0x554e4b4e; // "UNKN"

    // Write known, unknown, known
    s.pushChunk(knownTag, 1);
    s.writeU8(42);
    s.popChunk();

    s.pushChunk(unknownTag, 1);
    s.writeString("skip me");
    s.writeU32(999);
    s.popChunk();

    s.pushChunk(knownTag, 1);
    s.writeU8(84);
    s.popChunk();

    s.resetRead();

    const v1 = s.enterChunk(knownTag);
    assert.equal(v1, 1);
    assert.equal(s.readU8(), 42);
    s.leaveChunk();

    s.skipChunk(unknownTag);

    const v2 = s.enterChunk(knownTag);
    assert.equal(v2, 1);
    assert.equal(s.readU8(), 84);
    s.leaveChunk();

    assert.ok(s.eof());
  });
});

// ---- Read position save/restore ----

describe("MemoryStream -- pushReadPos / popReadPos", () => {
  test("popReadPos restores to saved position", () => {
    const s = new MemoryStream();
    s.writeU8(1);
    s.writeU8(2);
    s.writeU8(3);
    s.resetRead();

    assert.equal(s.readU8(), 1);

    s.pushReadPos();
    assert.equal(s.readU8(), 2);
    assert.equal(s.readU8(), 3);
    s.popReadPos();

    // After pop, we should be back to before reading 2
    assert.equal(s.readU8(), 2);
    assert.equal(s.readU8(), 3);
    assert.ok(s.eof());
  });

  test("nested pushReadPos / popReadPos", () => {
    const s = new MemoryStream();
    s.writeU8(10);
    s.writeU8(20);
    s.writeU8(30);
    s.writeU8(40);
    s.resetRead();

    assert.equal(s.readU8(), 10);

    s.pushReadPos(); // save at position after 10
    assert.equal(s.readU8(), 20);

    s.pushReadPos(); // save at position after 20
    assert.equal(s.readU8(), 30);
    assert.equal(s.readU8(), 40);

    s.popReadPos(); // restore to after 20
    assert.equal(s.readU8(), 30);

    s.popReadPos(); // restore to after 10
    assert.equal(s.readU8(), 20);
  });
});

// ---- Buffer growth ----

describe("MemoryStream -- buffer growth", () => {
  test("writing beyond initial capacity grows the buffer", () => {
    // Start with tiny capacity
    const s = new MemoryStream(undefined, 4);

    // Write more than 4 bytes
    for (let i = 0; i < 100; i++) {
      s.writeU32(i);
    }
    s.resetRead();

    for (let i = 0; i < 100; i++) {
      assert.equal(s.readU32(), i, `U32 at index ${i}`);
    }
    assert.ok(s.eof());
  });

  test("tellWrite advances and tellRead tracks position", () => {
    const s = new MemoryStream();
    assert.equal(s.tellWrite(), 0);

    s.writeU8(1);
    const afterU8 = s.tellWrite();
    assert.ok(afterU8 > 0);

    s.writeU32(42);
    const afterU32 = s.tellWrite();
    assert.ok(afterU32 > afterU8);

    s.resetRead();
    assert.equal(s.tellRead(), 0);

    s.readU8();
    assert.ok(s.tellRead() > 0);
  });

  test("remaining decreases as data is read", () => {
    const s = new MemoryStream();
    s.writeU32(1);
    s.writeU32(2);
    s.writeU32(3);
    s.resetRead();

    const full = s.remaining();
    assert.ok(full > 0);
    s.readU32();
    const afterOne = s.remaining();
    assert.ok(afterOne < full);
    s.readU32();
    const afterTwo = s.remaining();
    assert.ok(afterTwo < afterOne);
    s.readU32();
    assert.equal(s.remaining(), 0);
  });
});

// ---- toBytes / construct from bytes ----

describe("MemoryStream -- toBytes and reconstruct", () => {
  test("round-trip through toBytes and constructor", () => {
    const s1 = new MemoryStream();
    s1.writeU32(7);
    s1.writeString("round-trip");
    s1.writeBool(true);
    s1.writeF64(Math.E);

    const bytes = s1.toBytes();

    const s2 = new MemoryStream(bytes);
    assert.equal(s2.readU32(), 7);
    assert.equal(s2.readString(), "round-trip");
    assert.equal(s2.readBool(), true);
    assert.ok(Math.abs(s2.readF64() - Math.E) < 1e-10);
    assert.ok(s2.eof());
  });
});

// ---- Error cases ----

describe("MemoryStream -- error cases", () => {
  test("readTag with wrong tag throws", () => {
    const s = new MemoryStream();
    s.writeTag(0x41414141); // "AAAA"
    s.resetRead();

    assert.throws(() => s.readTag(0x42424242)); // "BBBB"
  });

  test("reading past eof throws", () => {
    const s = new MemoryStream();
    s.writeU8(1);
    s.resetRead();

    s.readU8(); // consume the byte
    assert.throws(() => s.readU8());
  });
});

// ---- Mixed data types ----

describe("MemoryStream -- mixed data types", () => {
  test("interleaved types round-trip correctly", () => {
    const s = new MemoryStream();
    s.writeU8(42);
    s.writeString("hello");
    s.writeBool(false);
    s.writeU32(1000);
    s.writeF64(-99.5);
    s.writeString("");
    s.writeBool(true);
    s.writeU8(0);

    s.resetRead();

    assert.equal(s.readU8(), 42);
    assert.equal(s.readString(), "hello");
    assert.equal(s.readBool(), false);
    assert.equal(s.readU32(), 1000);
    assert.equal(s.readF64(), -99.5);
    assert.equal(s.readString(), "");
    assert.equal(s.readBool(), true);
    assert.equal(s.readU8(), 0);
    assert.ok(s.eof());
  });
});

// ---- skip ----

describe("MemoryStream -- skip", () => {
  test("skip advances read position by exact byte count", () => {
    const s = new MemoryStream();
    s.writeU8(1);
    s.resetRead();

    // Measure how many bytes a single U8 occupies
    const bytesPerU8 = s.remaining();

    // Write 3 U8s and skip the first two
    const s2 = new MemoryStream();
    s2.writeU8(10);
    s2.writeU8(20);
    s2.writeU8(30);
    s2.resetRead();

    s2.skip(bytesPerU8 * 2);
    assert.equal(s2.readU8(), 30);
  });
});
