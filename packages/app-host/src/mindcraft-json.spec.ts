import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MindcraftJson } from "@mindcraft-lang/app-host";
import { parseMindcraftJson, serializeMindcraftJson } from "@mindcraft-lang/app-host";

const VALID: MindcraftJson = {
  name: "test-project",
  host: { name: "test-host", version: "1.0.0" },
  version: "0.1.0",
  description: "A test project",
};

describe("parseMindcraftJson", () => {
  it("parses valid JSON", () => {
    const result = parseMindcraftJson(JSON.stringify(VALID));
    assert.deepStrictEqual(result, VALID);
  });

  it("returns undefined for malformed JSON", () => {
    assert.strictEqual(parseMindcraftJson("{not json"), undefined);
  });

  it("returns undefined when name is missing", () => {
    const { name: _, ...rest } = VALID;
    assert.strictEqual(parseMindcraftJson(JSON.stringify(rest)), undefined);
  });

  it("returns undefined when version is missing", () => {
    const { version: _, ...rest } = VALID;
    assert.strictEqual(parseMindcraftJson(JSON.stringify(rest)), undefined);
  });

  it("returns undefined when description is missing", () => {
    const { description: _, ...rest } = VALID;
    assert.strictEqual(parseMindcraftJson(JSON.stringify(rest)), undefined);
  });

  it("returns undefined when host is missing", () => {
    const { host: _, ...rest } = VALID;
    assert.strictEqual(parseMindcraftJson(JSON.stringify(rest)), undefined);
  });

  it("returns undefined when host is null", () => {
    assert.strictEqual(parseMindcraftJson(JSON.stringify({ ...VALID, host: null })), undefined);
  });

  it("returns undefined when host.name is missing", () => {
    assert.strictEqual(parseMindcraftJson(JSON.stringify({ ...VALID, host: { version: "1.0.0" } })), undefined);
  });

  it("returns undefined when host.version is missing", () => {
    assert.strictEqual(parseMindcraftJson(JSON.stringify({ ...VALID, host: { name: "host" } })), undefined);
  });

  it("returns undefined when name is a number", () => {
    assert.strictEqual(parseMindcraftJson(JSON.stringify({ ...VALID, name: 42 })), undefined);
  });
});

describe("serializeMindcraftJson", () => {
  it("round-trips through parse", () => {
    const serialized = serializeMindcraftJson(VALID);
    const parsed = parseMindcraftJson(serialized);
    assert.deepStrictEqual(parsed, VALID);
  });

  it("produces indented JSON", () => {
    const serialized = serializeMindcraftJson(VALID);
    assert.ok(serialized.includes("\n"));
    assert.ok(serialized.includes("  "));
  });
});
