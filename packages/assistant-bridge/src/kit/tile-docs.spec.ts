import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { kTileIdPlaceholder, pairTileDocs } from "./tile-docs.js";

const kButtonTileId = "tile.sensor->microbit-v2.button-a";

describe("pairTileDocs", () => {
  test("pairs content with the entries that name it, keyed by tile id", () => {
    const docs = pairTileDocs({ "button-a": "# Button A\n" }, [
      { tileId: kButtonTileId, contentKey: "button-a" },
      { tileId: "tile.sensor->microbit-v2.button-b", contentKey: "button-b" },
    ]);
    assert.equal(docs.get(kButtonTileId), "# Button A\n");
    assert.equal(docs.has("tile.sensor->microbit-v2.button-b"), false);
  });

  test("replaces every tile-id placeholder in the content with the entry's tile id", () => {
    const docs = pairTileDocs(
      {
        "button-a": `\`\`\`brain noframe when\n{ "tile": "${kTileIdPlaceholder}" }\n\`\`\`\n\n["${kTileIdPlaceholder}"]`,
      },
      [{ tileId: kButtonTileId, contentKey: "button-a" }]
    );
    const markdown = docs.get(kButtonTileId) ?? "";
    assert.equal(markdown.includes(kTileIdPlaceholder), false);
    assert.equal(markdown.split(kButtonTileId).length - 1, 2);
  });

  test("leaves content without the placeholder unchanged", () => {
    const literal = '{ "tile": "tile.modifier->microbit-v2.click" }';
    const docs = pairTileDocs({ "button-a": literal }, [{ tileId: kButtonTileId, contentKey: "button-a" }]);
    assert.equal(docs.get(kButtonTileId), literal);
  });
});
