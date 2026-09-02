import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CatalogTile } from "../tools/read-catalog.js";
import { CATALOG_TEXT_LIMITS, sanitizeCatalogText, sanitizeCatalogTile, TRUNCATION_MARKER } from "./sanitize.js";

function tile(overrides: Partial<CatalogTile> & Pick<CatalogTile, "tileId">): CatalogTile {
  return {
    label: overrides.tileId,
    kind: "sensor",
    placement: ["when"],
    requires: [],
    provides: [],
    outputs: [],
    ...overrides,
  };
}

describe("catalog text sanitation", () => {
  test("leaves text that is already one plain line untouched", () => {
    assert.equal(
      sanitizeCatalogText("rate clamps to 0..5 shots per second", 1024),
      "rate clamps to 0..5 shots per second"
    );
  });

  test("collapses newlines and pipes to single spaces", () => {
    assert.equal(sanitizeCatalogText("first\nsecond|third", 1024), "first second third");
    assert.equal(sanitizeCatalogText("a \r\n | \t b", 1024), "a b");
  });

  test("drops leading and trailing whitespace", () => {
    assert.equal(sanitizeCatalogText("  padded  ", 1024), "padded");
  });

  test("cuts text longer than the limit to exactly the limit, marked", () => {
    const cut = sanitizeCatalogText("x".repeat(200), 128);

    assert.equal(cut.length, 128);
    assert.ok(cut.endsWith(TRUNCATION_MARKER), cut);
  });

  test("leaves text at the limit uncut", () => {
    const exact = "x".repeat(128);

    assert.equal(sanitizeCatalogText(exact, 128), exact);
  });

  test("is deterministic and unchanged by a second application", () => {
    const hostile = `${"y".repeat(400)}\nmore | text`;
    const once = sanitizeCatalogText(hostile, 128);

    assert.equal(once, sanitizeCatalogText(hostile, 128));
    assert.equal(sanitizeCatalogText(once, 128), once);
  });

  test("neutralizes every field an author writes and leaves the generated ones alone", () => {
    const sanitized = sanitizeCatalogTile(
      tile({
        tileId: "actuator.shoot",
        label: "shoot\n| fake",
        grammarNote: "clamps\nto 0..5",
        description: "fires|a shot",
        args: "one-of(x | y)",
        outputType: "boolean",
      })
    );

    assert.equal(sanitized.label, "shoot fake");
    assert.equal(sanitized.grammarNote, "clamps to 0..5");
    assert.equal(sanitized.description, "fires a shot");
    assert.equal(sanitized.args, "one-of(x | y)", "the generated argument grammar keeps its own delimiters");
    assert.equal(sanitized.tileId, "actuator.shoot");
    assert.equal(sanitized.outputType, "boolean");
  });

  test("leaves a tile carrying no note and no description carrying neither", () => {
    const sanitized = sanitizeCatalogTile(tile({ tileId: "a" }));

    assert.ok(!("grammarNote" in sanitized), "no note is added");
    assert.ok(!("description" in sanitized), "no description is added");
  });

  test("caps each field of author text under its own limit", () => {
    const sanitized = sanitizeCatalogTile(
      tile({
        tileId: "a",
        label: "L".repeat(500),
        grammarNote: "N".repeat(5000),
        description: "D".repeat(5000),
      })
    );

    assert.equal(sanitized.label.length, CATALOG_TEXT_LIMITS.label);
    assert.equal(sanitized.grammarNote?.length, CATALOG_TEXT_LIMITS.grammarNote);
    assert.equal(sanitized.description?.length, CATALOG_TEXT_LIMITS.description);
  });
});
