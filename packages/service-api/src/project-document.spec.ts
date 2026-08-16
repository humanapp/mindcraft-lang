import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WireFileContent } from "./file-content";
import { bytesToBase64, fileContentFromWire, fileContentToBytes } from "./file-content";
import {
  MINDCRAFT_PROJECT_FORMAT,
  MindcraftProjectDocumentValidationCode,
  parseMindcraftProjectDocument,
  validateMindcraftProjectDocument,
} from "./project-document";

/** The first bytes of a real PNG: signature plus the IHDR chunk header. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

/** Minimal well-formed document fields. */
function baseDocumentFields(): Record<string, unknown> {
  return {
    format: MINDCRAFT_PROJECT_FORMAT,
    manifest: { name: "Project", version: "0.1.0", extensions: {} },
    contents: { "src/main.ts": "hello" },
  };
}

function errorCodes(value: unknown): string[] {
  const result = validateMindcraftProjectDocument(value);
  return result.ok ? [] : result.errors.map((error) => error.code);
}

describe("MindcraftProjectDocument validation", () => {
  it("accepts a well-formed document and carries the manifest object verbatim", () => {
    const manifest = {
      name: "Project",
      version: "1.2.3",
      extensions: { "org/dep": "embedded:org/dep" },
      brains: { main: { pages: [] } },
      app: { "test-app": { settings: true } },
    };
    const result = validateMindcraftProjectDocument({ ...baseDocumentFields(), manifest });
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.equal(result.document.manifest, manifest);
    assert.deepEqual(result.document.contents, { "src/main.ts": "hello" });
  });

  it("rejects a non-object root", () => {
    assert.deepEqual(errorCodes([]), [MindcraftProjectDocumentValidationCode.INVALID_ROOT]);
  });

  it("rejects a missing or foreign format marker", () => {
    for (const format of [undefined, "mindcraft.project", 2]) {
      const codes = errorCodes({ ...baseDocumentFields(), format });
      assert.ok(codes.includes(MindcraftProjectDocumentValidationCode.INVALID_FORMAT), `format ${String(format)}`);
    }
  });

  it("rejects a missing or non-object manifest", () => {
    for (const manifest of [undefined, "manifest", ["name"]]) {
      const codes = errorCodes({ ...baseDocumentFields(), manifest });
      assert.ok(codes.includes(MindcraftProjectDocumentValidationCode.INVALID_MANIFEST));
    }
  });

  it("rejects a missing or non-object contents map", () => {
    for (const contents of [undefined, "contents", [{ path: "a", content: "b" }]]) {
      const codes = errorCodes({ ...baseDocumentFields(), contents });
      assert.ok(codes.includes(MindcraftProjectDocumentValidationCode.INVALID_CONTENTS));
    }
  });

  it("rejects escaping, absolute, and backslash content paths", () => {
    for (const path of ["../escape.ts", "/absolute.ts", "src\\file.ts", "src/./main.ts", ""]) {
      const codes = errorCodes({ ...baseDocumentFields(), contents: { [path]: "x" } });
      assert.ok(codes.includes(MindcraftProjectDocumentValidationCode.INVALID_FILE_PATH), `path "${path}"`);
    }
  });

  it("rejects content values that are neither text nor a base64 entry", () => {
    for (const content of [42, {}, { content: 42, encoding: "base64" }, { content: "AA==", encoding: "hex" }]) {
      const codes = errorCodes({ ...baseDocumentFields(), contents: { "src/main.ts": content } });
      assert.deepEqual(codes, [MindcraftProjectDocumentValidationCode.INVALID_FILE_CONTENT], JSON.stringify(content));
    }
  });

  it("accepts a base64 entry and carries it through as binary content", () => {
    const entry = { content: bytesToBase64(PNG_BYTES), encoding: "base64" };

    const result = validateMindcraftProjectDocument({
      ...baseDocumentFields(),
      contents: { "tiles/icon.png": entry, "src/main.ts": "hello" },
    });

    assert.ok(result.ok);
    const carried = result.document.contents["tiles/icon.png"];
    assert.notEqual(typeof carried, "string", "a base64 entry stays an entry, not text");
    assert.deepEqual([...fileContentToBytes(fileContentFromWire(carried as WireFileContent))], [...PNG_BYTES]);
    assert.equal(result.document.contents["src/main.ts"], "hello", "text files stay bare strings");
  });

  it("parses a document from JSON text and rejects invalid JSON", () => {
    const parsed = parseMindcraftProjectDocument(JSON.stringify(baseDocumentFields()));
    assert.equal(parsed.ok, true);

    const invalid = parseMindcraftProjectDocument("{not json");
    assert.equal(invalid.ok, false);
    assert.ok(!invalid.ok);
    assert.equal(invalid.errors[0].code, MindcraftProjectDocumentValidationCode.INVALID_JSON);
  });
});
