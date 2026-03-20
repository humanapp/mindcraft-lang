import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compileUserTile } from "./compile.js";

describe("compileUserTile", () => {
  test("returns a result with a diagnostics array for empty input", () => {
    const result = compileUserTile("");
    assert.ok(Array.isArray(result.diagnostics));
    assert.equal(result.diagnostics.length, 0);
  });
});
