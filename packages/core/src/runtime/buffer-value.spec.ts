/**
 * Tests for the {@link BufferValue} value type and its program-constant codec:
 * construction, length, byte access, content-equality, hex conversion, and a
 * binary `.mcprogram` constant round-trip over the boundary byte values
 * (0/127/128/255), the empty buffer, and a longer buffer.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stream } from "@wendoo-lang/core";
import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import {
  type BufferValue,
  bufferByteAt,
  bufferLength,
  buffersEqual,
  bufferToHex,
  extractBufferValue,
  isBufferValue,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromBytes,
  linkedBrainProgramFromJson,
  linkedBrainProgramToBytes,
  mkBufferValue,
  mkBufferValueFromHex,
  mkNumberValue,
  NativeType,
  type NumberPrecision,
  type Value,
} from "@wendoo-lang/core/runtime";

const { byteArrayFromUint8Array } = stream;

const PRECISION: NumberPrecision = "f32";
const typeRegistry = __test__createBrainServices().runtime.types;

function buf(bytes: number[]): BufferValue {
  return mkBufferValue(byteArrayFromUint8Array(new Uint8Array(bytes)));
}

const LONG_BYTES: number[] = [];
for (let i = 0; i < 32; i++) {
  LONG_BYTES.push(i);
}

describe("BufferValue accessors", () => {
  test("length reflects the byte count", () => {
    assert.equal(bufferLength(buf([])), 0);
    assert.equal(bufferLength(buf([42])), 1);
    assert.equal(bufferLength(buf([0, 127, 128, 255])), 4);
    assert.equal(bufferLength(buf(LONG_BYTES)), 32);
  });

  test("byte-at returns each byte including the 0/127/128/255 boundaries", () => {
    const b = buf([0, 127, 128, 255]);
    assert.equal(bufferByteAt(b, 0), 0);
    assert.equal(bufferByteAt(b, 1), 127);
    assert.equal(bufferByteAt(b, 2), 128);
    assert.equal(bufferByteAt(b, 3), 255);
  });

  test("byte-at is undefined outside the buffer", () => {
    const b = buf([1, 2, 3]);
    assert.equal(bufferByteAt(b, -1), undefined);
    assert.equal(bufferByteAt(b, 3), undefined);
    assert.equal(bufferByteAt(buf([]), 0), undefined);
  });

  test("content-equality compares bytes, not identity", () => {
    assert.equal(buffersEqual(buf([1, 2, 3]), buf([1, 2, 3])), true);
    assert.equal(buffersEqual(buf([]), buf([])), true);
    assert.equal(buffersEqual(buf([1, 2, 3]), buf([1, 2, 4])), false);
    assert.equal(buffersEqual(buf([1, 2, 3]), buf([1, 2])), false);
  });

  test("guard and extractor", () => {
    const b = buf([9]);
    assert.equal(isBufferValue(b), true);
    assert.equal(isBufferValue(mkNumberValue(9)), false);
    assert.equal(extractBufferValue(b), b.v);
    assert.equal(extractBufferValue(mkNumberValue(9)), undefined);
  });
});

describe("BufferValue hex conversion", () => {
  test("to-hex is lowercase, two digits per byte, empty for an empty buffer", () => {
    assert.equal(bufferToHex(buf([])), "");
    assert.equal(bufferToHex(buf([42])), "2a");
    assert.equal(bufferToHex(buf([0, 127, 128, 255])), "007f80ff");
  });

  test("from-hex round-trips through to-hex", () => {
    for (const hex of ["", "2a", "007f80ff", bufferToHex(buf(LONG_BYTES))]) {
      assert.equal(bufferToHex(mkBufferValueFromHex(hex)), hex);
    }
  });

  test("from-hex accepts upper-case digits", () => {
    assert.equal(buffersEqual(mkBufferValueFromHex("00FF"), buf([0, 255])), true);
  });
});

describe("Buffer program-constant codec", () => {
  function decodeBufferPool(hexes: string[]): Value[] {
    const json: LinkedBrainProgramJson = {
      program: {
        version: 1,
        functions: [],
        constantPools: { numbers: [], strings: [], values: hexes.map((v) => ({ t: NativeType.Buffer, v })) },
        variableNames: [],
      },
      pages: [],
    };
    const program = linkedBrainProgramFromJson(json);
    const bytes = linkedBrainProgramToBytes(program, { profileId: 0, precision: PRECISION, typeRegistry });
    const decoded = linkedBrainProgramFromBytes(bytes, { precision: PRECISION, typeRegistry });
    return decoded.program.program.constantPools.values.toArray();
  }

  test("buffer constants round-trip byte-for-byte through the binary form", () => {
    const expected = [buf([]), buf([42]), buf([0, 127, 128, 255]), buf(LONG_BYTES)];
    const decoded = decodeBufferPool(expected.map(bufferToHex));
    assert.equal(decoded.length, expected.length);
    for (let i = 0; i < expected.length; i++) {
      const value = decoded[i];
      assert.ok(isBufferValue(value), `value ${i} decoded as a buffer`);
      assert.equal(buffersEqual(value, expected[i]), true, `value ${i} bytes match`);
    }
  });
});
