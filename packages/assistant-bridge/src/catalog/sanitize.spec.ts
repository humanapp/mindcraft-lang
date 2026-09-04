import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CatalogTile } from "../tools/read-catalog.js";
import {
  ARGS_TRUNCATION_MARKER,
  CATALOG_TEXT_LIMITS,
  sanitizeArgsText,
  sanitizeCatalogText,
  sanitizeCatalogTile,
  TRUNCATION_MARKER,
} from "./sanitize.js";

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
  test("leaves text under its limit exactly as written", () => {
    assert.equal(
      sanitizeCatalogText("rate clamps to 0..5 shots per second", 1024),
      "rate clamps to 0..5 shots per second"
    );
  });

  test("keeps newlines, pipes, and padding, which carry no structural role", () => {
    assert.equal(sanitizeCatalogText("first\nsecond|third", 1024), "first\nsecond|third");
    assert.equal(sanitizeCatalogText("a \r\n | \t b", 1024), "a \r\n | \t b");
    assert.equal(sanitizeCatalogText("  padded  ", 1024), "  padded  ");
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
    const long = `${"y".repeat(400)}\nmore | text`;
    const once = sanitizeCatalogText(long, 128);

    assert.equal(once, sanitizeCatalogText(long, 128));
    assert.equal(sanitizeCatalogText(once, 128), once);
  });

  test("leaves every field of a tile under its limit exactly as it arrived", () => {
    const original = tile({
      tileId: "actuator.shoot",
      label: "shoot\n| fake",
      description: "fires|a shot",
      args: "one-of(x | y)",
      outputType: "boolean",
    });

    assert.deepEqual(sanitizeCatalogTile(original), original);
  });

  test("leaves a tile carrying no description carrying none", () => {
    const sanitized = sanitizeCatalogTile(tile({ tileId: "a" }));

    assert.ok(!("description" in sanitized), "no description is added");
  });

  test("caps each field of author text under its own limit", () => {
    const sanitized = sanitizeCatalogTile(
      tile({
        tileId: "a",
        label: "L".repeat(500),
        description: "D".repeat(5000),
      })
    );

    assert.equal(sanitized.label.length, CATALOG_TEXT_LIMITS.label);
    assert.equal(sanitized.description?.length, CATALOG_TEXT_LIMITS.description);
  });
});

describe("the author text a rendered args string carries", () => {
  test("cuts text to its limit with a marker carrying no bracket", () => {
    const cut = sanitizeArgsText("x".repeat(200), CATALOG_TEXT_LIMITS.argDefault);

    assert.equal(cut.length, CATALOG_TEXT_LIMITS.argDefault);
    assert.ok(cut.endsWith(ARGS_TRUNCATION_MARKER), cut);
    assert.ok(!cut.includes("[") && !cut.includes("]"), cut);
  });

  test("leaves args text inside its limit exactly as it arrived", () => {
    assert.equal(sanitizeArgsText("(Hz)=880", CATALOG_TEXT_LIMITS.argDefault), "(Hz)=880");
  });

  test("is unchanged by a second application", () => {
    const once = sanitizeArgsText("y".repeat(200), CATALOG_TEXT_LIMITS.argUnit);

    assert.equal(sanitizeArgsText(once, CATALOG_TEXT_LIMITS.argUnit), once);
  });

  test("caps a tile's whole args string, whatever produced it", () => {
    const capped = sanitizeCatalogTile(tile({ tileId: "a", args: "z".repeat(4000) }));

    assert.equal(capped.args?.length, CATALOG_TEXT_LIMITS.args);
    assert.ok(capped.args?.endsWith(ARGS_TRUNCATION_MARKER), capped.args);
  });

  test("leaves a tile carrying no args carrying none", () => {
    assert.equal(sanitizeCatalogTile(tile({ tileId: "a" })).args, undefined);
  });
});
