import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addManifestFilesEntry,
  findMissingListedFiles,
  isFileInBuild,
  normalizeManifestFilePath,
  readManifestFilesList,
  removeManifestFilesEntry,
} from "./manifest-files.js";

describe("normalizeManifestFilePath", () => {
  test("strips leading ./ and / segments", () => {
    assert.equal(normalizeManifestFilePath("a.ts"), "a.ts");
    assert.equal(normalizeManifestFilePath("./a.ts"), "a.ts");
    assert.equal(normalizeManifestFilePath("/a.ts"), "a.ts");
    assert.equal(normalizeManifestFilePath(".//./sub/b.ts"), "sub/b.ts");
  });

  test("leaves interior segments and parent references untouched", () => {
    assert.equal(normalizeManifestFilePath("sub/./b.ts"), "sub/./b.ts");
    assert.equal(normalizeManifestFilePath("../gen/out.js"), "../gen/out.js");
  });
});

describe("isFileInBuild -- membership over the manifest files list", () => {
  const files = ["index.ts", "./icons/beam.svg", "docs/readme.md"];

  test("a listed path is in the build, however either side writes it", () => {
    assert.equal(isFileInBuild(files, "index.ts"), true);
    assert.equal(isFileInBuild(files, "./index.ts"), true);
    assert.equal(isFileInBuild(files, "/index.ts"), true);
    assert.equal(isFileInBuild(files, "icons/beam.svg"), true);
  });

  test("an unlisted path is not in the build", () => {
    assert.equal(isFileInBuild(files, "scratch.ts"), false);
    assert.equal(isFileInBuild(files, "icons/beam.md"), false);
  });
});

describe("findMissingListedFiles -- only the error direction is reported", () => {
  test("reports listed entries the presence test rejects, as written", () => {
    const present = new Set(["index.ts", "icons/beam.svg"]);
    const missing = findMissingListedFiles(["index.ts", "./icons/beam.svg", "./gone.ts"], (path) => present.has(path));
    assert.deepEqual(missing, ["./gone.ts"]);
  });

  test("invokes the presence test with normalized paths", () => {
    const seen: string[] = [];
    findMissingListedFiles(["./a.ts", "/b.ts"], (path) => {
      seen.push(path);
      return true;
    });
    assert.deepEqual(seen, ["a.ts", "b.ts"]);
  });

  test("a file absent from the list is never reported, even when nothing exists", () => {
    const missing = findMissingListedFiles(["a.ts"], () => false);
    assert.deepEqual(missing, ["a.ts"]);
  });

  test("empty when every listed file is present", () => {
    assert.deepEqual(
      findMissingListedFiles(["a.ts", "b.ts"], () => true),
      []
    );
  });
});

describe("readManifestFilesList -- lenient files-list read", () => {
  test("returns the string entries of a declared files array", () => {
    const text = JSON.stringify({ name: "P", files: ["a.ts", "b.svg"] });
    assert.deepEqual(readManifestFilesList(text), ["a.ts", "b.svg"]);
  });

  test("undefined for absent, empty, or non-array files, and for invalid JSON", () => {
    assert.equal(readManifestFilesList(JSON.stringify({ name: "P" })), undefined);
    assert.equal(readManifestFilesList(JSON.stringify({ files: [] })), undefined);
    assert.equal(readManifestFilesList(JSON.stringify({ files: "a.ts" })), undefined);
    assert.equal(readManifestFilesList("{ not json"), undefined);
    assert.equal(readManifestFilesList(JSON.stringify(["files"])), undefined);
  });
});

const MANIFEST = `{
  "name": "Drift Project",
  "version": "0.1.0",
  "description": "decoy \\"files\\": [\\"x.ts\\"] inside a string",
  "extensions": {},
  "files": [
    "index.ts",
    "./icons/beam.svg",
    "docs/readme.md"
  ],
  "appData": { "files": ["nested-decoy.ts"], "keep": "  odd   spacing\\t" }
}`;

describe("addManifestFilesEntry -- conservative text insert", () => {
  test("appends at the end of the array, matching its formatting, touching nothing else", () => {
    const edited = addManifestFilesEntry(MANIFEST, "sub/new.ts");
    assert.equal(edited, MANIFEST.replace('"docs/readme.md"\n  ]', '"docs/readme.md",\n    "sub/new.ts"\n  ]'));
  });

  test("writes the normalized path", () => {
    const edited = addManifestFilesEntry(MANIFEST, "./sub/new.ts");
    assert.ok(edited?.includes('"sub/new.ts"'));
    assert.ok(edited !== undefined && !edited.includes('"./sub/new.ts"'));
  });

  test("extends a single-line array inline", () => {
    const text = '{ "name": "P", "files": ["a.ts"] }';
    assert.equal(addManifestFilesEntry(text, "b.ts"), '{ "name": "P", "files": ["a.ts", "b.ts"] }');
  });

  test("fills an empty array", () => {
    const text = '{ "name": "P", "files": [] }';
    assert.equal(addManifestFilesEntry(text, "a.ts"), '{ "name": "P", "files": ["a.ts"] }');
  });

  test("undefined when the entry is already listed, in any written form", () => {
    assert.equal(addManifestFilesEntry(MANIFEST, "index.ts"), undefined);
    assert.equal(addManifestFilesEntry(MANIFEST, "./index.ts"), undefined);
    assert.equal(addManifestFilesEntry(MANIFEST, "icons/beam.svg"), undefined);
  });

  test("undefined when the document declares no usable files array", () => {
    assert.equal(addManifestFilesEntry('{ "name": "P" }', "a.ts"), undefined);
    assert.equal(addManifestFilesEntry('{ "files": "a.ts" }', "b.ts"), undefined);
    assert.equal(addManifestFilesEntry('{ "files": [1, 2] }', "b.ts"), undefined);
    assert.equal(addManifestFilesEntry("not json at all", "a.ts"), undefined);
  });

  test("ignores files keys nested deeper than the root and inside strings", () => {
    const text = '{ "appData": { "files": ["deep.ts"] }, "files": ["a.ts"] }';
    assert.equal(
      addManifestFilesEntry(text, "b.ts"),
      '{ "appData": { "files": ["deep.ts"] }, "files": ["a.ts", "b.ts"] }'
    );
  });
});

describe("removeManifestFilesEntry -- conservative text removal", () => {
  test("removes a middle entry and preserves the rest byte for byte", () => {
    const edited = removeManifestFilesEntry(MANIFEST, "icons/beam.svg");
    assert.equal(edited, MANIFEST.replace('"index.ts",\n    "./icons/beam.svg"', '"index.ts"'));
  });

  test("removes the first and the last entry", () => {
    assert.equal(removeManifestFilesEntry(MANIFEST, "index.ts"), MANIFEST.replace('"index.ts",\n    ', ""));
    assert.equal(removeManifestFilesEntry(MANIFEST, "docs/readme.md"), MANIFEST.replace(',\n    "docs/readme.md"', ""));
  });

  test("removing the sole entry leaves an empty array", () => {
    const text = '{ "name": "P", "files": [\n    "a.ts"\n  ] }';
    assert.equal(removeManifestFilesEntry(text, "a.ts"), '{ "name": "P", "files": [] }');
  });

  test("matches entries in any written form", () => {
    const edited = removeManifestFilesEntry(MANIFEST, "./docs/readme.md");
    assert.equal(edited, MANIFEST.replace(',\n    "docs/readme.md"', ""));
  });

  test("undefined when no entry matches or no usable files array exists", () => {
    assert.equal(removeManifestFilesEntry(MANIFEST, "scratch.ts"), undefined);
    assert.equal(removeManifestFilesEntry('{ "name": "P" }', "a.ts"), undefined);
  });

  test("add followed by remove restores the original text", () => {
    const added = addManifestFilesEntry(MANIFEST, "sub/new.ts");
    assert.ok(added !== undefined);
    assert.equal(removeManifestFilesEntry(added, "sub/new.ts"), MANIFEST);
  });
});
