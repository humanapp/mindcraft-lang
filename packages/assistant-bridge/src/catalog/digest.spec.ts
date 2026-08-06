import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CatalogTile } from "../tools/read-catalog.js";
import { catalogDigest } from "./digest.js";

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

describe("catalog digest", () => {
  test("produces one line per listed tile", () => {
    const digest = catalogDigest([tile({ tileId: "b" }), tile({ tileId: "a" })]);

    assert.equal(digest.tileCount, 2);
    assert.equal(digest.text.split("\n").length, 2);
  });

  test("orders tiles by id, whatever order they arrive in", () => {
    const forwards = catalogDigest([tile({ tileId: "a" }), tile({ tileId: "b" }), tile({ tileId: "c" })]);
    const backwards = catalogDigest([tile({ tileId: "c" }), tile({ tileId: "b" }), tile({ tileId: "a" })]);

    assert.equal(forwards.text, backwards.text);
  });

  test("serializes to the same text for the same catalog and to different text otherwise", () => {
    const first = catalogDigest([tile({ tileId: "a" })]);
    const same = catalogDigest([tile({ tileId: "a" })]);
    const other = catalogDigest([tile({ tileId: "a", description: "senses light" })]);

    assert.equal(first.text, same.text);
    assert.notEqual(first.text, other.text);
  });

  test("omits tiles the editor hides from its pickers", () => {
    const digest = catalogDigest([tile({ tileId: "a" }), tile({ tileId: "b", hidden: true })]);

    assert.equal(digest.tileCount, 1);
    assert.ok(!digest.text.includes("\n"), "only the listed tile has a line");
  });

  test("carries the author description on the tile's line", () => {
    const digest = catalogDigest([tile({ tileId: "a", description: "Detects other actors\nin range." })]);

    assert.ok(digest.text.includes("Detects other actors in range."));
    assert.equal(digest.text.split("\n").length, 1, "a multi-line description stays on one line");
  });

  test("carries the metadata the model plans from", () => {
    const digest = catalogDigest([
      tile({
        tileId: "a",
        outputType: "boolean",
        args: "one-of(x | y)",
        requires: ["cap:32"],
        provides: ["cap:33"],
        outputs: ["out:1"],
        consumesWhenResult: "number",
      }),
    ]);

    for (const field of ["out=boolean", "args=one-of(x | y)", "needs=cap:32", "gives=cap:33", "outputs=out:1"]) {
      assert.ok(digest.text.includes(field), field);
    }
  });
});
