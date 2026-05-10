import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryProjectFileSystem } from "./in-memory-project-file-system.js";

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
