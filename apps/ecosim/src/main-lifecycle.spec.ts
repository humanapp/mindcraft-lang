import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const mainSource = readFileSync(fileURLToPath(new URL("./main.tsx", import.meta.url)), "utf8");

describe("the app commits pending project writes before the page goes away", () => {
  test("page hide disposes the store, which flushes the pending project save", () => {
    assert.match(mainSource, /window\.addEventListener\("pagehide", disposeSimStore, \{ once: true \}\)/);
    assert.match(mainSource, /disposed = true;\s*ecosimStore\.dispose\(\);/);
  });

  test("a document that goes hidden flushes the pending project save without disposing", () => {
    const listener = mainSource.match(
      /document\.addEventListener\("visibilitychange", \(\) => \{([\s\S]*?)\n {2}\}\);/
    );
    assert.ok(listener, "the app listens for visibilitychange");
    assert.match(listener[1], /document\.visibilityState === "hidden"/);
    assert.match(listener[1], /ecosimStore\.projectManager\.flushAutoSave\(\)/);
    assert.doesNotMatch(listener[1], /dispose/);
  });
});
