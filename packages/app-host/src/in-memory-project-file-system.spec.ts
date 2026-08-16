import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryProjectFileSystem } from "./in-memory-project-file-system.js";

/** The first bytes of a real PNG: signature plus the IHDR chunk header. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

test("createInMemoryProjectFileSystem filters excluded entries from import changes", () => {
  const filesystem = createInMemoryProjectFileSystem({
    shouldExclude: (path) => path.startsWith("__generated__/"),
  });

  filesystem.applyRemoteChange({
    action: "import",
    entries: [
      ["src/main.ts", { kind: "file", content: "user", etag: "user", isReadonly: false }],
      ["__generated__/ambient.d.ts", { kind: "file", content: "ambient", etag: "generated", isReadonly: true }],
    ],
  });

  const snapshot = filesystem.exportSnapshot();
  assert.equal(snapshot.has("src/main.ts"), true);
  assert.equal(snapshot.has("__generated__/ambient.d.ts"), false);
});

test("createInMemoryProjectFileSystem applies filtered imports as full replacements", () => {
  const filesystem = createInMemoryProjectFileSystem({
    shouldExclude: (path) => path.startsWith("__generated__/"),
  });

  filesystem.applyRemoteChange({
    action: "write",
    path: "src/stale.ts",
    content: "stale",
    newEtag: "stale",
  });

  filesystem.applyRemoteChange({
    action: "import",
    entries: [
      ["__generated__/ambient.d.ts", { kind: "file", content: "ambient", etag: "generated", isReadonly: true }],
    ],
  });

  assert.equal(filesystem.exportSnapshot().size, 0);
});

test("createInMemoryProjectFileSystem carries binary file content through write and rename byte for byte", () => {
  const filesystem = createInMemoryProjectFileSystem();

  filesystem.applyLocalChange({ action: "write", path: "tiles/icon.png", content: PNG_BYTES, newEtag: "e0" });
  filesystem.applyLocalChange({ action: "rename", oldPath: "tiles/icon.png", newPath: "tiles/moved.png" });

  const entry = filesystem.exportSnapshot().get("tiles/moved.png");
  assert.ok(entry && entry.kind === "file");
  assert.ok(entry.content instanceof Uint8Array, "binary content stays bytes");
  assert.deepEqual([...entry.content], [...PNG_BYTES]);
});

test("createInMemoryProjectFileSystem carries binary content through an import snapshot", () => {
  const filesystem = createInMemoryProjectFileSystem();

  filesystem.applyRemoteChange({
    action: "import",
    entries: [["tiles/icon.png", { kind: "file", content: PNG_BYTES, etag: "e0", isReadonly: false }]],
  });

  const entry = filesystem.exportSnapshot().get("tiles/icon.png");
  assert.ok(entry && entry.kind === "file");
  assert.deepEqual([...(entry.content as Uint8Array)], [...PNG_BYTES]);
});
