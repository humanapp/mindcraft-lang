import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCatalogMove,
  ExtensionCatalogDocumentErrorCode,
  ExtensionCatalogDocumentWarningCode,
  MINDCRAFT_CATALOG_FORMAT,
  parseExtensionCatalogDocument,
  validateExtensionCatalogDocument,
} from "@mindcraft-lang/app-host";

const PIN_SHA = "b19b80b029a77303ee575d3ff9b29adbf7021b23";

const VALID_ENTRY = {
  coordinate: "mindcraft-lang/lib-codal-position",
  kind: "library",
  ref: `gh:mindcraft-lang/lib-codal-position@${PIN_SHA}`,
  name: "Position",
  version: "0.1.0",
  description: "Position sensing for CODAL targets.",
  targets: { "mindcraft-lang/microbit-v2": { packageVersion: "^0.2.0" } },
  thumbnail: "data:,x",
};

const TARGET_ENTRY = {
  coordinate: "mindcraft-lang/trg-widget",
  kind: "target",
  ref: `gh:mindcraft-lang/trg-widget@${PIN_SHA}`,
  name: "Widget",
  version: "0.1.0",
  description: "A hostable widget platform.",
};

const EMBEDDED_ENTRY = {
  coordinate: "mindcraft-lang/lib-microbit-cutebot",
  kind: "library",
  ref: "embedded:mindcraft-lang/lib-microbit-cutebot",
  name: "Cutebot",
  version: "0.1.2",
  description: "ELECFREAKS Cutebot chassis driver.",
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

  it("accepts a library entry without an alias", () => {
    const result = validateExtensionCatalogDocument({ format: MINDCRAFT_CATALOG_FORMAT, entries: [VALID_ENTRY] });

    assert.ok(result.ok);
    assert.equal(result.document.entries[0].kind, "library");
    assert.equal(result.document.entries[0].alias, undefined);
  });

  it("parses and field-picks a valid alias onto a target entry", () => {
    const withAlias = { ...TARGET_ENTRY, alias: "widget" };
    const result = validateExtensionCatalogDocument({ format: MINDCRAFT_CATALOG_FORMAT, entries: [withAlias] });

    assert.ok(result.ok);
    assert.equal(result.document.entries[0].kind, "target");
    assert.equal(result.document.entries[0].alias, "widget");
  });

  it("rejects an alias on a non-target entry with ALIAS_NOT_ALLOWED", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [{ ...VALID_ENTRY, alias: "widget" }],
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.ALIAS_NOT_ALLOWED));
  });

  it("rejects a target alias with an invalid charset", () => {
    for (const alias of ["Widget", "-leading", "has_underscore", 42]) {
      const result = validateExtensionCatalogDocument({
        format: MINDCRAFT_CATALOG_FORMAT,
        entries: [{ ...TARGET_ENTRY, alias }],
      });
      assert.ok(!result.ok, `Expected rejection for alias ${JSON.stringify(alias)}`);
      assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_ALIAS));
    }
  });

  it("rejects an all-digit target alias with NUMERIC_ALIAS", () => {
    for (const alias of ["2", "007", "12"]) {
      const result = validateExtensionCatalogDocument({
        format: MINDCRAFT_CATALOG_FORMAT,
        entries: [{ ...TARGET_ENTRY, alias }],
      });
      assert.ok(!result.ok, `Expected rejection for alias ${JSON.stringify(alias)}`);
      assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.NUMERIC_ALIAS));
    }
  });

  it("accepts a target alias that mixes digits with non-digits", () => {
    for (const alias of ["v2", "2-2", "microbit-v2"]) {
      const result = validateExtensionCatalogDocument({
        format: MINDCRAFT_CATALOG_FORMAT,
        entries: [{ ...TARGET_ENTRY, alias }],
      });
      assert.ok(result.ok, `Expected acceptance for alias ${JSON.stringify(alias)}`);
      assert.equal(result.document.entries[0].alias, alias);
    }
  });

  it("rejects two target entries carrying the same alias, compared case-insensitively", () => {
    const first = {
      ...TARGET_ENTRY,
      coordinate: "mindcraft-lang/trg-a",
      ref: `gh:mindcraft-lang/trg-a@${PIN_SHA}`,
      alias: "shared",
    };
    const second = {
      ...TARGET_ENTRY,
      coordinate: "mindcraft-lang/trg-b",
      ref: `gh:mindcraft-lang/trg-b@${PIN_SHA}`,
      alias: "shared",
    };
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [first, second],
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.DUPLICATE_ALIAS));
  });

  it("skips an unknown-kind entry with a warning, keeping the known entries", () => {
    for (const kind of ["template", "extension"]) {
      const result = validateExtensionCatalogDocument({
        format: MINDCRAFT_CATALOG_FORMAT,
        entries: [{ ...VALID_ENTRY, kind }, VALID_ENTRY],
      });

      assert.ok(result.ok);
      assert.equal(result.document.entries.length, 1);
      assert.equal(result.warnings.length, 1);
      assert.equal(result.warnings[0].code, ExtensionCatalogDocumentWarningCode.UNKNOWN_ENTRY_KIND);
      assert.equal(result.warnings[0].path, "$.entries[0].kind");
    }
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

  it("rejects gh: refs that are not full-SHA pins", () => {
    const badRefs = [
      "gh:mindcraft-lang/lib-codal-position@v0.1.0",
      `gh:mindcraft-lang/lib-codal-position@${PIN_SHA.slice(0, 7)}`,
      "gh:mindcraft-lang/lib-codal-position#main",
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

  it("accepts an embedded-transport ref with no SHA", () => {
    const result = validateExtensionCatalogDocument({ format: MINDCRAFT_CATALOG_FORMAT, entries: [EMBEDDED_ENTRY] });
    assert.ok(result.ok);
    assert.deepStrictEqual(result.warnings, []);
    assert.deepStrictEqual(result.document.entries, [EMBEDDED_ENTRY]);
  });

  it("rejects an embedded ref whose coordinate differs from the entry coordinate", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [{ ...EMBEDDED_ENTRY, ref: "embedded:other-org/lib-microbit-cutebot" }],
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_REF));
    assert.match(result.errors[0].message, /other-org\/lib-microbit-cutebot/);
  });

  it("rejects a ref whose transport is neither gh nor embedded", () => {
    for (const ref of ["npm:mindcraft-lang/lib-microbit-cutebot", "file:./cutebot", "cutebot"]) {
      const result = validateExtensionCatalogDocument({
        format: MINDCRAFT_CATALOG_FORMAT,
        entries: [{ ...EMBEDDED_ENTRY, ref }],
      });
      assert.ok(!result.ok, `Expected rejection for ref ${JSON.stringify(ref)}`);
      assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_REF));
    }
  });

  it("rejects a ref whose coordinate differs from the entry coordinate", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [{ ...VALID_ENTRY, ref: `gh:other-org/lib-codal-position@${PIN_SHA}` }],
    });
    assert.ok(!result.ok);
    assert.equal(result.errors[0].code, ExtensionCatalogDocumentErrorCode.INVALID_REF);
    assert.match(result.errors[0].message, /other-org\/lib-codal-position/);
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

describe("validateExtensionCatalogDocument -- moves", () => {
  const MOVE_COORDINATE = "mindcraft-lang/lib-codal-position";
  const MOVE_REF = `gh:${MOVE_COORDINATE}@${PIN_SHA}`;

  it("defaults an absent moves section to an empty map", () => {
    const result = validateExtensionCatalogDocument({ format: MINDCRAFT_CATALOG_FORMAT, entries: [VALID_ENTRY] });
    assert.ok(result.ok);
    assert.deepStrictEqual(result.document.moves, {});
  });

  it("accepts a well-formed same-coordinate flip with zero errors and warnings", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [VALID_ENTRY],
      moves: { [MOVE_COORDINATE]: { ref: MOVE_REF } },
    });
    assert.ok(result.ok);
    assert.deepStrictEqual(result.warnings, []);
    assert.deepStrictEqual(result.document.moves, { [MOVE_COORDINATE]: { ref: MOVE_REF } });
  });

  it("rejects a non-object moves section with INVALID_MOVES", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [VALID_ENTRY],
      moves: [],
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_MOVES));
  });

  it("rejects a move key that is not a coordinate with INVALID_MOVES", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [VALID_ENTRY],
      moves: { "no-slash": { ref: MOVE_REF } },
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_MOVES));
  });

  it("rejects move refs that are not full-SHA gh pins with INVALID_MOVE_REF", () => {
    const badRefs: unknown[] = [
      `embedded:${MOVE_COORDINATE}`,
      `gh:${MOVE_COORDINATE}@v0.1.0`,
      `gh:${MOVE_COORDINATE}@${PIN_SHA.slice(0, 7)}`,
      `gh:${MOVE_COORDINATE}#main`,
      42,
    ];
    for (const ref of badRefs) {
      const result = validateExtensionCatalogDocument({
        format: MINDCRAFT_CATALOG_FORMAT,
        entries: [VALID_ENTRY],
        moves: { [MOVE_COORDINATE]: { ref } },
      });
      assert.ok(!result.ok, `Expected rejection for move ref ${JSON.stringify(ref)}`);
      assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_MOVE_REF));
    }
  });

  it("rejects a move whose value is not an object with INVALID_MOVE_REF", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [VALID_ENTRY],
      moves: { [MOVE_COORDINATE]: MOVE_REF },
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_MOVE_REF));
  });

  it("rejects a move ref whose coordinate differs from the move key with INVALID_MOVE_REF", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [VALID_ENTRY],
      moves: { [MOVE_COORDINATE]: { ref: `gh:other-org/lib-codal-position@${PIN_SHA}` } },
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_MOVE_REF));
    assert.ok(result.errors.some((error) => /other-org\/lib-codal-position/.test(error.message)));
  });

  const RENAME_TO = "mindcraft-lang/lib-position";
  const RENAME_REF = `gh:${RENAME_TO}@${PIN_SHA}`;

  it("accepts a well-formed rename whose ref names the new coordinate", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [VALID_ENTRY],
      moves: { [MOVE_COORDINATE]: { coordinate: RENAME_TO, ref: RENAME_REF } },
    });
    assert.ok(result.ok);
    assert.deepStrictEqual(result.warnings, []);
    assert.deepStrictEqual(result.document.moves, { [MOVE_COORDINATE]: { coordinate: RENAME_TO, ref: RENAME_REF } });
  });

  it("rejects a rename whose new coordinate is malformed with INVALID_MOVE_COORDINATE", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [VALID_ENTRY],
      moves: { [MOVE_COORDINATE]: { coordinate: "no-slash", ref: RENAME_REF } },
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_MOVE_COORDINATE));
  });

  it("rejects a rename whose new coordinate equals the move key with INVALID_MOVE_COORDINATE", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [VALID_ENTRY],
      moves: { [MOVE_COORDINATE]: { coordinate: MOVE_COORDINATE, ref: MOVE_REF } },
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_MOVE_COORDINATE));
  });

  it("rejects a rename whose ref names the source, not the new coordinate, with INVALID_MOVE_REF", () => {
    const result = validateExtensionCatalogDocument({
      format: MINDCRAFT_CATALOG_FORMAT,
      entries: [VALID_ENTRY],
      moves: { [MOVE_COORDINATE]: { coordinate: RENAME_TO, ref: MOVE_REF } },
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_MOVE_REF));
  });
});

describe("applyCatalogMove", () => {
  const COORDINATE = "example-org/position-ext";
  const MOVED_REF = `example-org/position-ext@${PIN_SHA}`;
  const moves = { [COORDINATE]: { ref: `gh:${MOVED_REF}` } };

  it("redirects an embedded reference of a moved coordinate to the move target", () => {
    assert.equal(applyCatalogMove(`embedded:${COORDINATE}`, moves), `gh:${MOVED_REF}`);
  });

  it("redirects a differing gh pin of a moved coordinate to the move target", () => {
    assert.equal(applyCatalogMove(`gh:${COORDINATE}@v0.1.0`, moves), `gh:${MOVED_REF}`);
  });

  it("returns the reference unchanged when it already equals the move target", () => {
    assert.equal(applyCatalogMove(`gh:${MOVED_REF}`, moves), `gh:${MOVED_REF}`);
  });

  it("returns the reference unchanged when no move targets its coordinate", () => {
    assert.equal(applyCatalogMove("embedded:other-org/other-ext", moves), "embedded:other-org/other-ext");
  });

  it("returns an unparseable reference unchanged", () => {
    assert.equal(applyCatalogMove("not-a-reference", moves), "not-a-reference");
  });

  it("redirects a reference of a renamed source coordinate to the new coordinate's ref", () => {
    const RENAMED_REF = `gh:example-org/position-ext-2@${PIN_SHA}`;
    const renameMoves = { [COORDINATE]: { coordinate: "example-org/position-ext-2", ref: RENAMED_REF } };
    assert.equal(applyCatalogMove(`embedded:${COORDINATE}`, renameMoves), RENAMED_REF);
    assert.equal(applyCatalogMove(`gh:${COORDINATE}@v0.1.0`, renameMoves), RENAMED_REF);
    // A reference already at the new coordinate is not further redirected.
    assert.equal(applyCatalogMove(RENAMED_REF, renameMoves), RENAMED_REF);
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
