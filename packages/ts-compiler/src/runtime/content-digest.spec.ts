/**
 * The bundle's content-identity primitives: a self-contained SHA-256 pinned to
 * the FIPS 180-4 published vectors, and a canonical JSON encoder whose output
 * is independent of object key order.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { canonicalJson, sha256Hex } from "./content-digest.js";

describe("sha256Hex", () => {
  test("matches the published one-block and two-block vectors", () => {
    assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
  });

  test("hashes the UTF-8 encoding of non-ASCII text", () => {
    const text = "é中文\u{1f600}";
    const expected = createHash("sha256").update(text, "utf8").digest("hex");
    assert.equal(sha256Hex(text), expected);
  });

  test("matches node's digest across every padding boundary length", () => {
    for (const length of [1, 54, 55, 56, 63, 64, 65, 119, 120, 128, 1000]) {
      const text = "a".repeat(length);
      assert.equal(sha256Hex(text), createHash("sha256").update(text, "utf8").digest("hex"), `length ${length}`);
    }
  });
});

describe("canonicalJson", () => {
  test("is independent of object key order, at every nesting depth", () => {
    const left = { b: 1, a: { d: [3, { f: 1, e: 2 }], c: "x" } };
    const right = { a: { c: "x", d: [3, { e: 2, f: 1 }] }, b: 1 };
    assert.equal(canonicalJson(left), canonicalJson(right));
    assert.equal(canonicalJson(left), '{"a":{"c":"x","d":[3,{"e":2,"f":1}]},"b":1}');
  });

  test("drops undefined members and keeps array order", () => {
    assert.equal(canonicalJson({ b: undefined, a: 1 }), '{"a":1}');
    assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
  });

  test("distinguishes values that differ only in a nested member", () => {
    assert.notEqual(canonicalJson({ a: { b: 1 } }), canonicalJson({ a: { b: 2 } }));
  });
});
