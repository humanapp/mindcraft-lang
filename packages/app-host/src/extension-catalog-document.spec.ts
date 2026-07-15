import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ExtensionCatalogDocumentErrorCode,
  ExtensionCatalogDocumentWarningCode,
  MINDCRAFT_CATALOG_FORMAT,
  parseExtensionCatalogDocument,
  validateExtensionCatalogDocument,
} from "@mindcraft-lang/app-host";

const PIN_SHA = "b19b80b029a77303ee575d3ff9b29adbf7021b23";

const VALID_ENTRY = {
  coordinate: "mindcraft-lang/codal-position-ext",
  kind: "extension",
  ref: `gh:mindcraft-lang/codal-position-ext@${PIN_SHA}`,
  name: "Position",
  version: "0.1.0",
  description: "Position sensing for CODAL targets.",
  targets: { "mindcraft-lang/microbit-v2": { packageVersion: "^0.2.0" } },
  thumbnail: "data:,x",
};

describe("validateExtensionCatalogDocument", () => {
  it("accepts a document with a fully specified entry", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [VALID_ENTRY],
    });

    assert.ok(result.ok);
    assert.deepStrictEqual(result.warnings, []);
    assert.deepStrictEqual(result.document.entries, [VALID_ENTRY]);
  });

  it("accepts an entry without the optional targets and thumbnail", () => {
    const { targets, thumbnail, ...minimal } = VALID_ENTRY;
    const result = validateExtensionCatalogDocument({ format: MINDCRAFT_CATALOG_FORMAT, entries: [minimal] });

    assert.ok(result.ok);
    assert.deepStrictEqual(result.document.entries, [minimal]);
  });

  it("skips an unknown-kind entry with a warning, keeping the known entries", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [{ ...VALID_ENTRY, kind: "template" }, VALID_ENTRY],
    });

    assert.ok(result.ok);
    assert.equal(result.document.entries.length, 1);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, ExtensionCatalogDocumentWarningCode.UNKNOWN_ENTRY_KIND);
    assert.equal(result.warnings[0].path, "$.entries[0].kind");
  });

  it("rejects a wrong or missing format marker", () => {
    for (const format of [undefined, "mindcraft.catalog/2", "catalog"]) {
      const result = validateExtensionCatalogDocument({ format, entries: [] });
      assert.ok(!result.ok);
      assert.equal(result.errors[0].code, ExtensionCatalogDocumentErrorCode.INVALID_FORMAT);
    }
  });

  it("rejects a non-array entries field and a non-object root", () => {
    const entries = validateExtensionCatalogDocument({ format: MINDCRAFT_CATALOG_FORMAT, entries: {} });
    assert.ok(!entries.ok);
    assert.equal(entries.errors[0].code, ExtensionCatalogDocumentErrorCode.INVALID_ENTRIES);

    const root = validateExtensionCatalogDocument([]);
    assert.ok(!root.ok);
    assert.equal(root.errors[0].code, ExtensionCatalogDocumentErrorCode.INVALID_ROOT);
  });

  it("rejects a malformed coordinate", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [{ ...VALID_ENTRY, coordinate: "no-slash" }],
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_COORDINATE));
  });

  it("rejects refs that are not full-SHA pins", () => {
    const badRefs = [
      "gh:mindcraft-lang/codal-position-ext@v0.1.0",
      `gh:mindcraft-lang/codal-position-ext@${PIN_SHA.slice(0, 7)}`,
      "gh:mindcraft-lang/codal-position-ext#main",
      `embedded:mindcraft-lang/codal-position-ext`,
      42,
    ];
    for (const ref of badRefs) {
      const result = validateExtensionCatalogDocument({
        format: MINDCRAFT_CATALOG_FORMAT,
        entries: [{ ...VALID_ENTRY, ref }],
      });
      assert.ok(!result.ok, `Expected rejection for ref ${JSON.stringify(ref)}`);
      assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_REF));
    }
  });

  it("rejects a ref whose coordinate differs from the entry coordinate", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [{ ...VALID_ENTRY, ref: `gh:other-org/codal-position-ext@${PIN_SHA}` }],
    });
    assert.ok(!result.ok);
    assert.equal(result.errors[0].code, ExtensionCatalogDocumentErrorCode.INVALID_REF);
    assert.match(result.errors[0].message, /other-org\/codal-position-ext/);
  });

  it("rejects missing display metadata with entry paths", () => {
    const { description, ...withoutDescription } = VALID_ENTRY;
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [withoutDescription],
    });
    assert.ok(!result.ok);
    assert.equal(result.errors[0].code, ExtensionCatalogDocumentErrorCode.INVALID_ENTRY);
    assert.equal(result.errors[0].path, "$.entries[0].description");
  });
});

describe("parseExtensionCatalogDocument", () => {
  it("parses a document from JSON text", () => {
    const result = parseExtensionCatalogDocument(
      JSON.stringify({ format: MINDCRAFT_CATALOG_FORMAT, entries: [VALID_ENTRY] })
    );
    assert.ok(result.ok);
    assert.equal(result.document.entries.length, 1);
  });

  it("rejects invalid JSON with INVALID_JSON", () => {
    const result = parseExtensionCatalogDocument("{not json");
    assert.ok(!result.ok);
    assert.equal(result.errors[0].code, ExtensionCatalogDocumentErrorCode.INVALID_JSON);
  });
});
