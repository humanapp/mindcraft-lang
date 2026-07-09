import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { buildEmbeddedExtensionFromDir, findMissingExtensionFiles } from "./embedded-extension-loader.js";

const COORDINATE = "test-owner/loader-ext";

function contentByPath(files: readonly { path: string; content: string }[]): Map<string, string> {
  return new Map(files.map((f) => [f.path, f.content]));
}

describe("buildEmbeddedExtensionFromDir -- manifest files list is the authoritative content set", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "mindcraft-ext-"));
    writeFileSync(join(dir, "index.ts"), "export {};\n");
    writeFileSync(join(dir, "detect.svg"), "<svg/>\n");
    writeFileSync(join(dir, "scratch.ts"), "// kept in storage, excluded from the build\n");
    writeFileSync(
      join(dir, "mindcraft.json"),
      JSON.stringify({ name: "Loader Ext", version: "0.1.0", files: ["index.ts", "detect.svg"] }, null, 2)
    );
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("assembles exactly the listed files plus the manifest, keyed by coordinate", () => {
    const extension = buildEmbeddedExtensionFromDir(dir, COORDINATE);
    assert.equal(extension.canonicalOrigin, COORDINATE);
    const byPath = contentByPath(extension.files);
    assert.deepEqual([...byPath.keys()].sort(), ["detect.svg", "index.ts", "mindcraft.json"]);
    assert.equal(byPath.get("index.ts"), "export {};\n");
    assert.equal(byPath.get("detect.svg"), "<svg/>\n");
  });

  test("a file present on disk but absent from the list is excluded, and is never an error", () => {
    const extension = buildEmbeddedExtensionFromDir(dir, COORDINATE);
    assert.equal(
      contentByPath(extension.files).has("scratch.ts"),
      false,
      "an unlisted on-disk file is not part of the build"
    );
    assert.deepEqual(findMissingExtensionFiles(dir), [], "an unlisted on-disk file is not a drift error");
  });

  test("adding a file to the dir and the manifest list adds it to the bundle with no other change", () => {
    writeFileSync(join(dir, "detect.md"), "# Detect\n");
    writeFileSync(
      join(dir, "mindcraft.json"),
      JSON.stringify({ name: "Loader Ext", version: "0.1.0", files: ["index.ts", "detect.svg", "detect.md"] }, null, 2)
    );
    const extension = buildEmbeddedExtensionFromDir(dir, COORDINATE);
    assert.equal(contentByPath(extension.files).get("detect.md"), "# Detect\n");
  });
});

describe("buildEmbeddedExtensionFromDir -- the error direction is a listed file missing from disk", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "mindcraft-ext-"));
    writeFileSync(join(dir, "index.ts"), "export {};\n");
    writeFileSync(
      join(dir, "mindcraft.json"),
      JSON.stringify({ name: "Broken Ext", version: "0.1.0", files: ["index.ts", "gone.ts"] }, null, 2)
    );
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("findMissingExtensionFiles reports the listed-but-absent file and only it", () => {
    assert.deepEqual(findMissingExtensionFiles(dir), ["gone.ts"]);
  });

  test("assembly fails with a precise error naming the missing file", () => {
    assert.throws(
      () => buildEmbeddedExtensionFromDir(dir, COORDINATE),
      /gone\.ts/,
      "the build names content it cannot assemble"
    );
  });
});

describe("buildEmbeddedExtensionFromDir -- an embedded extension must declare its files", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "mindcraft-ext-"));
    writeFileSync(join(dir, "mindcraft.json"), JSON.stringify({ name: "No Files", version: "0.1.0" }, null, 2));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("a manifest with no files list is rejected", () => {
    assert.throws(() => buildEmbeddedExtensionFromDir(dir, COORDINATE), /files/);
  });
});
