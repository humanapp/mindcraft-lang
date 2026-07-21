import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CatalogMoveVersionLookup, ExtensionCatalogMoves } from "@mindcraft-lang/app-host";
import {
  applyCatalogMove,
  CatalogMoveApplyErrorCode,
  ExtensionCatalogDocumentErrorCode,
  ExtensionCatalogDocumentWarningCode,
  MINDCRAFT_CATALOG_FORMAT,
  parseCatalogMoveReference,
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

// ---------------------------------------------------------------------------
// Moves -- validation
// ---------------------------------------------------------------------------

/** Validate a document that carries only the given moves section. */
function validateMoves(moves: unknown): ReturnType<typeof validateExtensionCatalogDocument> {
  return validateExtensionCatalogDocument({ format: MINDCRAFT_CATALOG_FORMAT, entries: [], moves });
}

/** Assert the given moves section is rejected and one of its errors carries the code. */
function assertMovesFatal(moves: unknown, code: ExtensionCatalogDocumentErrorCode): void {
  const result = validateMoves(moves);
  assert.ok(!result.ok, `Expected rejection for moves ${JSON.stringify(moves)}`);
  assert.ok(
    result.errors.some((error) => error.code === code),
    `Expected ${code}; got ${result.errors.map((error) => error.code).join(", ")}`
  );
}

describe("validateExtensionCatalogDocument -- moves", () => {
  const MOVE_COORDINATE = "mindcraft-lang/lib-codal-position";
  const MOVE_REF = `gh:${MOVE_COORDINATE}@${PIN_SHA}`;

  it("defaults an absent moves section to an empty map", () => {
    const result = validateExtensionCatalogDocument({ format: MINDCRAFT_CATALOG_FORMAT, entries: [VALID_ENTRY] });
    assert.ok(result.ok);
    assert.deepStrictEqual(result.document.moves, {});
  });

  it("normalizes a single-entry object form to a one-entry array", () => {
    const result = validateMoves({ [MOVE_COORDINATE]: { ref: MOVE_REF } });
    assert.ok(result.ok);
    assert.deepStrictEqual(result.warnings, []);
    assert.deepStrictEqual(result.document.moves, { [MOVE_COORDINATE]: [{ ref: MOVE_REF }] });
  });

  it("accepts an entry array with selector-scoped entries", () => {
    const result = validateMoves({
      [MOVE_COORDINATE]: [
        { from: { transport: "embedded" }, ref: MOVE_REF },
        { from: { transport: "gh", packageVersion: "^0.1.0" }, ref: `gh:${MOVE_COORDINATE}@v0.2.0` },
      ],
    });
    assert.ok(result.ok);
    assert.equal(result.document.moves[MOVE_COORDINATE].length, 2);
  });

  it("accepts all destination forms: embedded, gh pin, gh tag, gh branch, and floating gh", () => {
    for (const ref of [
      `embedded:${MOVE_COORDINATE}`,
      MOVE_REF,
      `gh:${MOVE_COORDINATE}@v0.2.0`,
      `gh:${MOVE_COORDINATE}#main`,
      `gh:${MOVE_COORDINATE}`,
    ]) {
      const result = validateMoves({ "other-org/source": { ref } });
      assert.ok(result.ok, `Expected acceptance for destination ${JSON.stringify(ref)}`);
    }
  });

  it("rejects a non-object moves section with INVALID_MOVES", () => {
    assertMovesFatal([], ExtensionCatalogDocumentErrorCode.INVALID_MOVES);
  });

  it("rejects a move key that is not a coordinate with INVALID_MOVES", () => {
    assertMovesFatal({ "no-slash": { ref: MOVE_REF } }, ExtensionCatalogDocumentErrorCode.INVALID_MOVES);
  });

  it("rejects destination refs outside the grammar with INVALID_MOVE_REF", () => {
    for (const ref of ["npm:a/b", "gh:owner-only", `embedded:${MOVE_COORDINATE}@v1`, 42, undefined]) {
      assertMovesFatal({ [MOVE_COORDINATE]: { ref } }, ExtensionCatalogDocumentErrorCode.INVALID_MOVE_REF);
    }
  });

  it("rejects a move whose value is not an object with INVALID_MOVE_REF", () => {
    assertMovesFatal({ [MOVE_COORDINATE]: MOVE_REF }, ExtensionCatalogDocumentErrorCode.INVALID_MOVE_REF);
  });

  it("rejects a from string that is not a full reference with INVALID_MOVE_FROM", () => {
    for (const from of [`gh:${MOVE_COORDINATE}`, "not-a-reference", 42]) {
      assertMovesFatal(
        { [MOVE_COORDINATE]: { from, ref: MOVE_REF } },
        ExtensionCatalogDocumentErrorCode.INVALID_MOVE_FROM
      );
    }
  });

  it("rejects a from string whose coordinate differs from the move key with INVALID_MOVE_FROM", () => {
    assertMovesFatal(
      { [MOVE_COORDINATE]: { from: "embedded:other-org/elsewhere", ref: MOVE_REF } },
      ExtensionCatalogDocumentErrorCode.INVALID_MOVE_FROM
    );
  });

  it("rejects a from string structurally equal to the entry ref with INVALID_MOVE_FROM", () => {
    assertMovesFatal(
      { [MOVE_COORDINATE]: { from: MOVE_REF, ref: MOVE_REF } },
      ExtensionCatalogDocumentErrorCode.INVALID_MOVE_FROM
    );
  });

  it("rejects an empty object selector with INVALID_MOVE_FROM", () => {
    assertMovesFatal(
      { [MOVE_COORDINATE]: { from: {}, ref: MOVE_REF } },
      ExtensionCatalogDocumentErrorCode.INVALID_MOVE_FROM
    );
  });

  it("rejects a selector transport outside gh/embedded with INVALID_MOVE_FROM", () => {
    assertMovesFatal(
      { [MOVE_COORDINATE]: { from: { transport: "npm" }, ref: MOVE_REF } },
      ExtensionCatalogDocumentErrorCode.INVALID_MOVE_FROM
    );
  });

  it("rejects range forms the evaluator does not support with UNSUPPORTED_MOVE_RANGE", () => {
    for (const packageVersion of ["", "  ", ">=1.0", "1.x.0", "1.0.0 || 2.0.0", 42]) {
      assertMovesFatal(
        { [MOVE_COORDINATE]: { from: { packageVersion }, ref: MOVE_REF } },
        ExtensionCatalogDocumentErrorCode.UNSUPPORTED_MOVE_RANGE
      );
    }
  });

  it("accepts the conjunction range form the evaluator supports", () => {
    const result = validateMoves({
      [MOVE_COORDINATE]: { from: { packageVersion: ">=0.2.0 <=0.4.0" }, ref: MOVE_REF },
    });
    assert.ok(result.ok);
  });

  it("rejects two default-selector entries for one key with DUPLICATE_MOVE_SELECTOR", () => {
    assertMovesFatal(
      { [MOVE_COORDINATE]: [{ ref: MOVE_REF }, { ref: `gh:${MOVE_COORDINATE}@v0.2.0` }] },
      ExtensionCatalogDocumentErrorCode.DUPLICATE_MOVE_SELECTOR
    );
  });

  it("rejects two structurally equal exact froms, including a case-variant coordinate, with DUPLICATE_MOVE_SELECTOR", () => {
    const from = `gh:${MOVE_COORDINATE}@v0.1.0`;
    assertMovesFatal(
      {
        [MOVE_COORDINATE]: [
          { from, ref: MOVE_REF },
          { from, ref: `gh:${MOVE_COORDINATE}@v0.2.0` },
        ],
      },
      ExtensionCatalogDocumentErrorCode.DUPLICATE_MOVE_SELECTOR
    );
    // Coordinates compare case-insensitively: a case-variant exact from is the same selector.
    assertMovesFatal(
      {
        [MOVE_COORDINATE]: [
          { from, ref: MOVE_REF },
          { from: "gh:Mindcraft-Lang/LIB-codal-position@v0.1.0", ref: `gh:${MOVE_COORDINATE}@v0.2.0` },
        ],
      },
      ExtensionCatalogDocumentErrorCode.DUPLICATE_MOVE_SELECTOR
    );
  });

  it("rejects a floating destination whose selector captures the destination transport with FLOATING_MOVE_SELECTOR", () => {
    const floating = `gh:${MOVE_COORDINATE}`;
    for (const from of [
      { transport: "gh" },
      { packageVersion: "^0.1.0" },
      `gh:${MOVE_COORDINATE}@v0.1.0`,
      `gh:${MOVE_COORDINATE}#main`,
    ]) {
      assertMovesFatal(
        { [MOVE_COORDINATE]: { from, ref: floating } },
        ExtensionCatalogDocumentErrorCode.FLOATING_MOVE_SELECTOR
      );
    }
  });

  it("accepts a floating destination with a selector that cannot capture the destination pair", () => {
    const floating = `gh:${MOVE_COORDINATE}`;
    for (const from of [undefined, { transport: "embedded" }, `embedded:${MOVE_COORDINATE}`] as const) {
      const result = validateMoves({
        [MOVE_COORDINATE]: { ...(from !== undefined ? { from } : {}), ref: floating },
      });
      assert.ok(result.ok, `Expected acceptance for from ${JSON.stringify(from)}`);
    }
    // A floating rename destination never shares the key coordinate, so any selector is legal.
    const rename = validateMoves({
      [MOVE_COORDINATE]: { from: { transport: "gh" }, ref: "gh:mindcraft-lang/lib-position" },
    });
    assert.ok(rename.ok);
  });

  it("rejects a ping-pong recall pair with MOVE_CYCLE", () => {
    const shaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const shaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    assertMovesFatal(
      {
        [MOVE_COORDINATE]: [
          { from: `gh:${MOVE_COORDINATE}@${shaA}`, ref: `gh:${MOVE_COORDINATE}@${shaB}` },
          { from: `gh:${MOVE_COORDINATE}@${shaB}`, ref: `gh:${MOVE_COORDINATE}@${shaA}` },
        ],
      },
      ExtensionCatalogDocumentErrorCode.MOVE_CYCLE
    );
  });

  it("rejects a cross-key chain loop with MOVE_CYCLE", () => {
    assertMovesFatal(
      {
        "example-org/a": { ref: "gh:example-org/b@v1.0.0" },
        "example-org/b": { ref: "gh:example-org/a@v1.0.0" },
      },
      ExtensionCatalogDocumentErrorCode.MOVE_CYCLE
    );
  });
});

describe("parseCatalogMoveReference", () => {
  it("parses the four concrete forms and the floating form", () => {
    assert.deepStrictEqual(parseCatalogMoveReference("embedded:example-org/a"), {
      transport: "embedded",
      coordinate: "example-org/a",
      floating: false,
    });
    assert.deepStrictEqual(parseCatalogMoveReference(`gh:example-org/a@${PIN_SHA}`), {
      transport: "gh",
      coordinate: "example-org/a",
      floating: false,
    });
    assert.deepStrictEqual(parseCatalogMoveReference("gh:example-org/a#main"), {
      transport: "gh",
      coordinate: "example-org/a",
      floating: false,
    });
    assert.deepStrictEqual(parseCatalogMoveReference("gh:example-org/a"), {
      transport: "gh",
      coordinate: "example-org/a",
      floating: true,
    });
    assert.equal(parseCatalogMoveReference("not-a-reference"), undefined);
  });
});

// ---------------------------------------------------------------------------
// Moves -- application
// ---------------------------------------------------------------------------

/** Apply and assert success, returning the application. */
function applyOk(
  reference: string,
  moves: ExtensionCatalogMoves,
  versionLookup?: CatalogMoveVersionLookup
): { reference: string; moved: boolean; pendingVersion: boolean } {
  const result = applyCatalogMove(reference, moves, versionLookup);
  assert.ok(result.ok, `Expected ok application for ${reference}; got ${!result.ok ? result.code : ""}`);
  return result;
}

describe("applyCatalogMove -- default selector (the clobber fix)", () => {
  const COORDINATE = "example-org/position-ext";
  const OLD_SHA = "1111111111111111111111111111111111111111";
  const NEW_SHA = "2222222222222222222222222222222222222222";
  const moves: ExtensionCatalogMoves = { [COORDINATE]: [{ ref: `gh:${COORDINATE}@${OLD_SHA}` }] };

  it("a gh reference of a flipped coordinate keeps its own component", () => {
    const result = applyOk(`gh:${COORDINATE}@${NEW_SHA}`, moves);
    assert.equal(result.reference, `gh:${COORDINATE}@${NEW_SHA}`);
    assert.equal(result.moved, false);
  });

  it("an embedded reference of a flipped coordinate still migrates to the pin", () => {
    const result = applyOk(`embedded:${COORDINATE}`, moves);
    assert.equal(result.reference, `gh:${COORDINATE}@${OLD_SHA}`);
    assert.equal(result.moved, true);
  });

  it("a reference structurally equal to the destination is never captured", () => {
    const result = applyOk(`gh:${COORDINATE}@${OLD_SHA}`, moves);
    assert.equal(result.moved, false);
  });

  it("a reference of an untargeted coordinate and an unparseable reference pass through", () => {
    assert.equal(applyOk("embedded:other-org/other-ext", moves).reference, "embedded:other-org/other-ext");
    assert.equal(applyOk("not-a-reference", moves).reference, "not-a-reference");
  });
});

describe("applyCatalogMove -- structural equality and case", () => {
  const COORDINATE = "example-org/src";
  const SHA = "1111111111111111111111111111111111111111";

  it("an exact from captures a case-variant coordinate spelling of the same reference", () => {
    const moves: ExtensionCatalogMoves = {
      [COORDINATE]: [{ from: `gh:Example-Org/SRC@${SHA}`, ref: `embedded:${COORDINATE}` }],
    };
    const result = applyOk(`gh:${COORDINATE}@${SHA}`, moves);
    assert.equal(result.reference, `embedded:${COORDINATE}`);
  });

  it("an exact from does not capture a component near-miss", () => {
    const moves: ExtensionCatalogMoves = {
      [COORDINATE]: [{ from: `gh:${COORDINATE}@v1.0.0`, ref: `embedded:${COORDINATE}` }],
    };
    assert.equal(applyOk(`gh:${COORDINATE}@v1.0.1`, moves).moved, false);
  });

  it("the idempotence guard fires for a case-variant spelling of the destination", () => {
    const moves: ExtensionCatalogMoves = { [COORDINATE]: [{ ref: `gh:${COORDINATE}@${SHA}` }] };
    const caseVariant = `gh:Example-Org/SRC@${SHA}`;
    const result = applyOk(caseVariant, moves);
    assert.equal(result.reference, caseVariant);
    assert.equal(result.moved, false);
  });
});

describe("applyCatalogMove -- version ranges", () => {
  const COORDINATE = "example-org/src";
  const SHA = "1111111111111111111111111111111111111111";
  const DEST = `gh:${COORDINATE}@v9.9.9`;
  const source = `gh:${COORDINATE}@${SHA}`;

  function rangeMoves(packageVersion: string): ExtensionCatalogMoves {
    return { [COORDINATE]: [{ from: { packageVersion }, ref: DEST }] };
  }

  it("captures on both inclusive boundaries and passes through just outside them", () => {
    const moves = rangeMoves(">=0.2.0 <=0.4.0");
    for (const [version, captured] of [
      ["0.2.0", true],
      ["0.4.0", true],
      ["0.1.9", false],
      ["0.4.1", false],
    ] as const) {
      const result = applyOk(source, moves, () => version);
      assert.equal(result.moved, captured, `version ${version}`);
      assert.equal(result.reference, captured ? DEST : source);
      assert.equal(result.pendingVersion, false);
    }
  });

  it("never captures a branch reference and does not mark it pending", () => {
    const result = applyOk(`gh:${COORDINATE}#main`, rangeMoves("*"), () => "1.0.0");
    assert.equal(result.moved, false);
    assert.equal(result.pendingVersion, false);
  });

  it("marks an undeterminable version pending without capturing", () => {
    const result = applyOk(source, rangeMoves("^1.0.0"), () => undefined);
    assert.equal(result.moved, false);
    assert.equal(result.pendingVersion, true);
  });

  it("captures once the version becomes determinable", () => {
    const result = applyOk(source, rangeMoves("^1.0.0"), (reference) => (reference === source ? "1.2.3" : undefined));
    assert.equal(result.reference, DEST);
    assert.equal(result.pendingVersion, false);
  });
});

describe("applyCatalogMove -- chains", () => {
  const SHA = "3333333333333333333333333333333333333333";

  it("follows a same-key flip-then-rename chain through a floating hop in one application", () => {
    const moves: ExtensionCatalogMoves = {
      "example-org/a": [
        { from: { transport: "embedded" }, ref: "gh:example-org/a" },
        { from: { transport: "gh" }, ref: `gh:example-org/c@${SHA}` },
      ],
    };
    // The intermediate floating hop is captured by the gh-transport entry and
    // is never resolved to a pin.
    assert.equal(applyOk("embedded:example-org/a", moves).reference, `gh:example-org/c@${SHA}`);
    assert.equal(applyOk("gh:example-org/a@v0.1.0", moves).reference, `gh:example-org/c@${SHA}`);
    assert.equal(applyOk(`gh:example-org/c@${SHA}`, moves).moved, false);
  });

  it("follows a cross-key rename chain to the final coordinate", () => {
    const moves: ExtensionCatalogMoves = {
      "example-org/a": [{ ref: `gh:example-org/b@${SHA}` }],
      "example-org/b": [{ ref: `gh:example-org/c@${SHA}` }],
    };
    assert.equal(applyOk("embedded:example-org/a", moves).reference, `gh:example-org/c@${SHA}`);
    assert.equal(applyOk("embedded:example-org/b", moves).reference, `gh:example-org/c@${SHA}`);
  });

  it("a range entry downstream of a floating hop is pending until the hop resolves", () => {
    const floatingMoves: ExtensionCatalogMoves = {
      "example-org/a": [
        { from: { transport: "embedded" }, ref: "gh:example-org/a" },
        { from: { transport: "gh", packageVersion: "^1.0.0" }, ref: `gh:example-org/b@${SHA}` },
      ],
    };
    // The floating hop has no version: the range entry cannot evaluate, the
    // application ends at the floating reference, and pendingVersion is set.
    const beforeResolution = applyOk("embedded:example-org/a", floatingMoves, () => undefined);
    assert.equal(beforeResolution.reference, "gh:example-org/a");
    assert.equal(beforeResolution.pendingVersion, true);
    // Once the hop resolved to a pin (final-so-far), re-applying from the pin
    // evaluates the range and completes the chain.
    const pinned = applyOk("gh:example-org/a@v1.2.0", floatingMoves, () => "1.2.0");
    assert.equal(pinned.reference, `gh:example-org/b@${SHA}`);
  });
});

describe("applyCatalogMove -- ambiguity and cycles", () => {
  const COORDINATE = "example-org/src";
  const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  it("fails with a stable code naming the reference when two entries capture it", () => {
    const moves: ExtensionCatalogMoves = {
      [COORDINATE]: [
        { from: { transport: "gh" }, ref: `embedded:${COORDINATE}` },
        { from: `gh:${COORDINATE}@${SHA_A}`, ref: `embedded:${COORDINATE}` },
      ],
    };
    const result = applyCatalogMove(`gh:${COORDINATE}@${SHA_A}`, moves);
    assert.ok(!result.ok);
    assert.equal(result.code, CatalogMoveApplyErrorCode.AMBIGUOUS_CAPTURE);
    assert.equal(result.reference, `gh:${COORDINATE}@${SHA_A}`);
  });

  it("fails with the cycle code, not a hang, on a resolution-dependent loop", () => {
    const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    // Ranges do not capture at parse time, so this loop is invisible to the
    // parse-time destination-application check; the runtime visited set is
    // what stops it.
    const moves: ExtensionCatalogMoves = {
      "example-org/b": [{ from: { packageVersion: "^1.0.0" }, ref: `gh:example-org/c@${SHA_B}` }],
      "example-org/c": [{ from: { packageVersion: "^2.0.0" }, ref: `gh:example-org/b@${SHA_A}` }],
    };
    const versions = new Map([
      [`gh:example-org/b@${SHA_A}`, "1.0.0"],
      [`gh:example-org/c@${SHA_B}`, "2.0.0"],
    ]);
    const result = applyCatalogMove(`gh:example-org/b@${SHA_A}`, moves, (reference) => versions.get(reference));
    assert.ok(!result.ok);
    assert.equal(result.code, CatalogMoveApplyErrorCode.CYCLE);
  });
});

// ---------------------------------------------------------------------------
// Moves -- the capture matrix
// ---------------------------------------------------------------------------

describe("applyCatalogMove -- capture matrix", () => {
  const S = "example-org/src";
  const D = "example-org/dst";
  const SRC_SHA = "1111111111111111111111111111111111111111";
  const DST_SHA = "2222222222222222222222222222222222222222";

  interface SourceCell {
    readonly name: string;
    readonly ref: string;
    readonly transport: "gh" | "embedded";
    readonly branch: boolean;
    readonly version?: string;
  }

  const sources: readonly SourceCell[] = [
    { name: "embedded", ref: `embedded:${S}`, transport: "embedded", branch: false, version: "1.0.0" },
    { name: "gh-sha", ref: `gh:${S}@${SRC_SHA}`, transport: "gh", branch: false, version: "1.5.0" },
    { name: "gh-vtag", ref: `gh:${S}@v2.0.0`, transport: "gh", branch: false, version: "2.0.0" },
    { name: "gh-branch", ref: `gh:${S}#main`, transport: "gh", branch: true },
  ];

  interface DestCell {
    readonly name: string;
    readonly ref: string;
    readonly transport: "gh" | "embedded";
    readonly floating: boolean;
  }

  function destinations(coordinate: string): readonly DestCell[] {
    return [
      { name: "embedded", ref: `embedded:${coordinate}`, transport: "embedded", floating: false },
      { name: "gh-sha", ref: `gh:${coordinate}@${DST_SHA}`, transport: "gh", floating: false },
      { name: "gh-vtag", ref: `gh:${coordinate}@v9.9.9`, transport: "gh", floating: false },
      { name: "gh-branch", ref: `gh:${coordinate}#release`, transport: "gh", floating: false },
      { name: "gh-floating", ref: `gh:${coordinate}`, transport: "gh", floating: true },
    ];
  }

  type SelectorKind =
    | "absent"
    | "exact-match"
    | "exact-near-miss"
    | "transport-match"
    | "transport-miss"
    | "range-in"
    | "range-out";

  function selectorFrom(kind: SelectorKind, source: SourceCell): unknown {
    switch (kind) {
      case "absent":
        return undefined;
      case "exact-match":
        return source.ref;
      case "exact-near-miss":
        return `gh:${S}@v7.7.7`;
      case "transport-match":
        return { transport: source.transport };
      case "transport-miss":
        return { transport: source.transport === "gh" ? "embedded" : "gh" };
      case "range-in":
        return { packageVersion: ">=1.0.0" };
      case "range-out":
        return { packageVersion: "<0.5.0" };
    }
  }

  /** Whether the selector can capture a gh-transport reference of the source coordinate. */
  function selectorReachesGh(kind: SelectorKind, source: SourceCell): boolean {
    switch (kind) {
      case "absent":
        return false;
      case "exact-match":
        return source.transport === "gh";
      case "exact-near-miss":
        return true;
      case "transport-match":
        return source.transport === "gh";
      case "transport-miss":
        return source.transport === "embedded";
      case "range-in":
      case "range-out":
        return true;
    }
  }

  /** Whether the entry captures the source, given the cell validated. */
  function expectedCapture(kind: SelectorKind, source: SourceCell, dest: DestCell, rename: boolean): boolean {
    switch (kind) {
      case "absent": {
        if (rename) {
          return true;
        }
        const onDestinationPair = source.transport === dest.transport;
        return !onDestinationPair;
      }
      case "exact-match":
        return true;
      case "exact-near-miss":
        return false;
      case "transport-match":
        return true;
      case "transport-miss":
        return false;
      case "range-in":
        return !source.branch;
      case "range-out":
        return false;
    }
  }

  const versionLookup: CatalogMoveVersionLookup = (reference) => {
    const cell = sources.find((source) => source.ref === reference);
    return cell?.version;
  };

  const selectorKinds: readonly SelectorKind[] = [
    "absent",
    "exact-match",
    "exact-near-miss",
    "transport-match",
    "transport-miss",
    "range-in",
    "range-out",
  ];

  let assertedCells = 0;

  for (const rename of [false, true]) {
    const coordinate = rename ? D : S;
    for (const source of sources) {
      for (const dest of destinations(coordinate)) {
        for (const kind of selectorKinds) {
          const from = selectorFrom(kind, source);
          const entry = { ...(from !== undefined ? { from } : {}), ref: dest.ref };
          const cellName = `${rename ? "rename" : "flip"} ${source.name} -> ${dest.name} [${kind}]`;

          // Parse legality of the cell.
          const fromEqualsRef = kind === "exact-match" && source.ref === dest.ref;
          const floatingIllegal = !rename && dest.floating && selectorReachesGh(kind, source);

          it(cellName, () => {
            const validated = validateMoves({ [S]: entry });
            if (fromEqualsRef) {
              assert.ok(!validated.ok);
              assert.ok(
                validated.errors.some((error) => error.code === ExtensionCatalogDocumentErrorCode.INVALID_MOVE_FROM)
              );
              assertedCells++;
              return;
            }
            if (floatingIllegal) {
              assert.ok(!validated.ok);
              assert.ok(
                validated.errors.some(
                  (error) => error.code === ExtensionCatalogDocumentErrorCode.FLOATING_MOVE_SELECTOR
                )
              );
              assertedCells++;
              return;
            }
            assert.ok(
              validated.ok,
              `Expected a valid cell; got ${!validated.ok ? JSON.stringify(validated.errors) : ""}`
            );
            const moves = validated.document.moves;

            const captured = expectedCapture(kind, source, dest, rename);
            const guardBlocks = source.ref === dest.ref;
            const expectedRef = captured && !guardBlocks ? dest.ref : source.ref;

            const result = applyOk(source.ref, moves, versionLookup);
            assert.equal(result.reference, expectedRef, "output reference");
            assert.equal(result.moved, expectedRef !== source.ref, "moved flag");
            assert.equal(result.pendingVersion, false, "pendingVersion");

            // Idempotence: applying the output again is a no-op.
            const again = applyOk(result.reference, moves, versionLookup);
            assert.equal(again.reference, result.reference, "idempotence");
            assert.equal(again.moved, false, "idempotence moved flag");
            assertedCells++;
          });
        }
      }
    }
  }

  it("asserted every cell of the matrix", () => {
    assert.equal(assertedCells, 2 * sources.length * 5 * selectorKinds.length);
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
