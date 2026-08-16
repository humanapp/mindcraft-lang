import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  base64ToBytes,
  bytesToBase64,
  fileContentByteLength,
  fileContentEquals,
  fileContentFromBytes,
  fileContentFromWire,
  fileContentText,
  fileContentToBytes,
  fileContentToWire,
  isBinaryFileContent,
} from "./file-content.js";

/** The first bytes of a real PNG: signature plus the IHDR chunk header. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"><title>bézier</title></svg>';

describe("fileContentFromBytes", () => {
  it("decodes UTF-8 bytes to text", () => {
    const content = fileContentFromBytes(new TextEncoder().encode(SVG_TEXT));

    assert.equal(typeof content, "string");
    assert.equal(content, SVG_TEXT);
  });

  it("keeps bytes that are not UTF-8 text as bytes", () => {
    const content = fileContentFromBytes(PNG_BYTES);

    assert.ok(content instanceof Uint8Array);
    assert.deepEqual([...content], [...PNG_BYTES]);
  });

  it("keeps valid UTF-8 carrying a NUL byte as bytes", () => {
    const content = fileContentFromBytes(new Uint8Array([0x61, 0x00, 0x62]));

    assert.ok(content instanceof Uint8Array, "a NUL byte marks content the editor cannot treat as text");
  });
});

describe("fileContentToBytes", () => {
  it("returns binary content byte for byte", () => {
    const bytes = fileContentToBytes(fileContentFromBytes(PNG_BYTES));

    assert.deepEqual([...bytes], [...PNG_BYTES]);
  });

  it("UTF-8 encodes text content", () => {
    assert.deepEqual([...fileContentToBytes(SVG_TEXT)], [...new TextEncoder().encode(SVG_TEXT)]);
  });
});

describe("fileContentText", () => {
  it("returns the text of text content", () => {
    assert.equal(fileContentText(SVG_TEXT), SVG_TEXT);
  });

  it("returns undefined for binary content", () => {
    assert.equal(fileContentText(PNG_BYTES), undefined);
  });
});

describe("isBinaryFileContent", () => {
  it("distinguishes bytes from text", () => {
    assert.equal(isBinaryFileContent(PNG_BYTES), true);
    assert.equal(isBinaryFileContent(SVG_TEXT), false);
  });
});

describe("fileContentEquals", () => {
  it("compares bytes by value, not by reference", () => {
    assert.equal(fileContentEquals(PNG_BYTES, new Uint8Array(PNG_BYTES)), true);
    assert.equal(fileContentEquals(PNG_BYTES, PNG_BYTES.slice(0, 8)), false);
    assert.equal(fileContentEquals(PNG_BYTES, new Uint8Array([...PNG_BYTES.slice(0, 15), 0x00])), false);
  });

  it("compares text by value and never equates text with bytes", () => {
    assert.equal(fileContentEquals(SVG_TEXT, `${SVG_TEXT}`), true);
    assert.equal(fileContentEquals("A", new Uint8Array([0x41])), false);
  });
});

describe("fileContentByteLength", () => {
  it("measures encoded length for text and raw length for bytes", () => {
    assert.equal(fileContentByteLength(PNG_BYTES), PNG_BYTES.byteLength);
    assert.equal(fileContentByteLength(SVG_TEXT), new TextEncoder().encode(SVG_TEXT).byteLength);
  });
});

describe("the wire form", () => {
  it("carries text verbatim with no encoding tag", () => {
    const wire = fileContentToWire(SVG_TEXT);

    assert.equal(wire.content, SVG_TEXT);
    assert.equal(wire.encoding, undefined);
    assert.equal(fileContentFromWire(wire), SVG_TEXT);
  });

  it("round-trips binary content through base64 byte for byte", () => {
    const wire = fileContentToWire(PNG_BYTES);

    assert.equal(wire.encoding, "base64");
    const restored = fileContentFromWire(wire);
    assert.ok(restored instanceof Uint8Array);
    assert.deepEqual([...restored], [...PNG_BYTES]);
  });

  it("survives a JSON round-trip, which is how every transport carries it", () => {
    const wire = fileContentToWire(PNG_BYTES);

    const restored = fileContentFromWire(JSON.parse(JSON.stringify(wire)));

    assert.deepEqual([...fileContentToBytes(restored)], [...PNG_BYTES]);
  });
});

describe("the base64 codec", () => {
  it("round-trips bytes spanning the full byte range", () => {
    const all = new Uint8Array(256);
    for (let index = 0; index < 256; index++) {
      all[index] = index;
    }

    assert.deepEqual([...base64ToBytes(bytesToBase64(all))], [...all]);
  });
});
