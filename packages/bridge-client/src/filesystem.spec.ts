import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { ErrorCode } from "./error-codes.js";
import { type ExportedFileSystem, FileSystem, type FileSystemNotification, NotifyingFileSystem } from "./filesystem.js";

function make(entries?: ExportedFileSystem): FileSystem {
  const fs = new FileSystem();
  if (entries) fs.import(entries);
  return fs;
}

// ---------------------------------------------------------------------------
// Basic file operations
// ---------------------------------------------------------------------------

describe("FileSystem", () => {
  let pf: FileSystem;

  beforeEach(() => {
    pf = make();
  });

  // -- write / read ---------------------------------------------------------

  describe("write and read", () => {
    it("writes and reads a file at the root", () => {
      pf.mkdir("docs");
      pf.write("docs/hello.txt", "world");
      assert.equal(pf.read("docs/hello.txt"), "world");
    });

    it("overwrites an existing writable file", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "v1");
      pf.write("d/f.txt", "v2");
      assert.equal(pf.read("d/f.txt"), "v2");
    });

    it("throws when writing to a read-only file", () => {
      pf.mkdir("d");
      pf.write("d/locked.txt", "content", true);
      assert.throws(() => pf.write("d/locked.txt", "new"), { code: ErrorCode.FILE_READ_ONLY });
    });

    it("throws when reading a nonexistent file", () => {
      assert.throws(() => pf.read("nope.txt"), { code: ErrorCode.FILE_NOT_FOUND });
    });

    it("throws when writing into a nonexistent directory", () => {
      assert.throws(() => pf.write("missing/file.txt", "x"), { code: ErrorCode.DIRECTORY_NOT_FOUND });
    });

    it("throws when reading with an empty path", () => {
      assert.throws(() => pf.read(""), { code: ErrorCode.INVALID_PATH });
    });

    it("throws when writing with an empty path", () => {
      assert.throws(() => pf.write("", "x"), { code: ErrorCode.INVALID_PATH });
    });
  });

  // -- delete ---------------------------------------------------------------

  describe("delete", () => {
    it("deletes an existing writable file", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "content");
      pf.delete("d/f.txt");
      assert.throws(() => pf.read("d/f.txt"), { code: ErrorCode.FILE_NOT_FOUND });
    });

    it("throws when deleting a nonexistent file", () => {
      assert.throws(() => pf.delete("ghost.txt"), { code: ErrorCode.FILE_NOT_FOUND });
    });

    it("throws when deleting a read-only file", () => {
      pf.mkdir("d");
      pf.write("d/locked.txt", "content", true);
      assert.throws(() => pf.delete("d/locked.txt"), { code: ErrorCode.FILE_READ_ONLY });
    });

    it("throws when deleting with an empty path", () => {
      assert.throws(() => pf.delete(""), { code: ErrorCode.INVALID_PATH });
    });

    it("throws when parent directory does not exist", () => {
      assert.throws(() => pf.delete("no/file.txt"), { code: ErrorCode.DIRECTORY_NOT_FOUND });
    });
  });

  // -- stat -----------------------------------------------------------------

  describe("stat", () => {
    it("returns file stat for a file", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "data");
      const s = pf.stat("d/f.txt");
      assert.equal(s.kind, "file");
      assert.equal(s.name, "f.txt");
      assert.equal(s.path, "d/f.txt");
      if (s.kind === "file") {
        assert.equal(s.isReadonly, false);
        assert.ok(s.etag.length > 0);
      }
    });

    it("returns directory stat for a directory", () => {
      pf.mkdir("mydir");
      const s = pf.stat("mydir");
      assert.equal(s.kind, "directory");
      assert.equal(s.name, "mydir");
    });

    it("throws for a nonexistent path", () => {
      assert.throws(() => pf.stat("nothing"), { code: ErrorCode.PATH_NOT_FOUND });
    });

    it("throws for an empty path", () => {
      assert.throws(() => pf.stat(""), { code: ErrorCode.INVALID_PATH });
    });

    it("stat reflects read-only flag", () => {
      pf.mkdir("d");
      pf.write("d/ro.txt", "locked", true);
      const s = pf.stat("d/ro.txt");
      assert.equal(s.kind, "file");
      if (s.kind === "file") {
        assert.equal(s.isReadonly, true);
      }
    });

    it("throws when intermediate directory does not exist", () => {
      assert.throws(() => pf.stat("no/such/thing"), { code: ErrorCode.DIRECTORY_NOT_FOUND });
    });
  });

  // -- mkdir / rmdir --------------------------------------------------------

  describe("mkdir", () => {
    it("creates a directory", () => {
      pf.mkdir("alpha");
      const s = pf.stat("alpha");
      assert.equal(s.kind, "directory");
    });

    it("creates nested directories one level at a time", () => {
      pf.mkdir("a");
      pf.mkdir("a/b");
      pf.mkdir("a/b/c");
      const s = pf.stat("a/b/c");
      assert.equal(s.kind, "directory");
    });

    it("throws when creating a duplicate directory", () => {
      pf.mkdir("dup");
      assert.throws(() => pf.mkdir("dup"), { code: ErrorCode.DIRECTORY_ALREADY_EXISTS });
    });

    it("throws for empty path", () => {
      assert.throws(() => pf.mkdir(""), { code: ErrorCode.INVALID_PATH });
    });
  });

  describe("rmdir", () => {
    it("removes an empty directory", () => {
      pf.mkdir("temp");
      pf.rmdir("temp");
      assert.throws(() => pf.stat("temp"), { code: ErrorCode.PATH_NOT_FOUND });
    });

    it("removes a directory with writable files", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "data");
      pf.rmdir("d");
      assert.throws(() => pf.stat("d"), { code: ErrorCode.PATH_NOT_FOUND });
    });

    it("throws when removing a directory with read-only files", () => {
      pf.mkdir("d");
      pf.write("d/locked.txt", "x", true);
      assert.throws(() => pf.rmdir("d"), { code: ErrorCode.DIRECTORY_HAS_READONLY });
    });

    it("throws when removing a nonexistent directory", () => {
      assert.throws(() => pf.rmdir("nope"), { code: ErrorCode.DIRECTORY_NOT_FOUND });
    });

    it("throws for empty path", () => {
      assert.throws(() => pf.rmdir(""), { code: ErrorCode.INVALID_PATH });
    });

    it("throws when directory has nested read-only files", () => {
      pf.mkdir("a");
      pf.mkdir("a/b");
      pf.write("a/b/locked.txt", "x", true);
      assert.throws(() => pf.rmdir("a"), { code: ErrorCode.DIRECTORY_HAS_READONLY });
    });

    it("removes nested directory by path", () => {
      pf.mkdir("a");
      pf.mkdir("a/b");
      pf.rmdir("a/b");
      assert.throws(() => pf.stat("a/b"), { code: ErrorCode.PATH_NOT_FOUND });
      const s = pf.stat("a");
      assert.equal(s.kind, "directory");
    });

    it("throws when parent directory does not exist", () => {
      assert.throws(() => pf.rmdir("missing/child"), { code: ErrorCode.DIRECTORY_NOT_FOUND });
    });
  });

  // -- rename ---------------------------------------------------------------

  describe("rename", () => {
    it("renames a file within the same directory", () => {
      pf.mkdir("d");
      pf.write("d/old.txt", "content");
      pf.rename("d/old.txt", "d/new.txt");
      assert.equal(pf.read("d/new.txt"), "content");
      assert.throws(() => pf.read("d/old.txt"), { code: ErrorCode.FILE_NOT_FOUND });
    });

    it("moves a file to a different directory", () => {
      pf.mkdir("src");
      pf.mkdir("dst");
      pf.write("src/file.txt", "moved");
      pf.rename("src/file.txt", "dst/file.txt");
      assert.equal(pf.read("dst/file.txt"), "moved");
      assert.throws(() => pf.read("src/file.txt"), { code: ErrorCode.FILE_NOT_FOUND });
    });

    it("preserves etag across rename", () => {
      pf.mkdir("d");
      pf.write("d/a.txt", "data");
      const etagBefore = (pf.stat("d/a.txt") as { etag: string }).etag;
      pf.rename("d/a.txt", "d/b.txt");
      const etagAfter = (pf.stat("d/b.txt") as { etag: string }).etag;
      assert.equal(etagBefore, etagAfter);
    });

    it("throws when renaming a read-only file", () => {
      pf.mkdir("d");
      pf.write("d/ro.txt", "locked", true);
      assert.throws(() => pf.rename("d/ro.txt", "d/moved.txt"), { code: ErrorCode.FILE_READ_ONLY });
    });

    it("throws when old and new paths are the same", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "x");
      assert.throws(() => pf.rename("d/f.txt", "d/f.txt"), { code: ErrorCode.RENAME_SAME_PATH });
    });

    it("throws when source file does not exist", () => {
      assert.throws(() => pf.rename("ghost.txt", "other.txt"), { code: ErrorCode.FILE_NOT_FOUND });
    });

    it("throws when destination directory does not exist", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "x");
      assert.throws(() => pf.rename("d/f.txt", "missing/f.txt"), { code: ErrorCode.DIRECTORY_NOT_FOUND });
    });
  });

  // -- list -----------------------------------------------------------------

  describe("list", () => {
    it("lists root entries", () => {
      pf.mkdir("dir1");
      pf.mkdir("dir2");
      const entries = pf.list();
      const names = entries.map((e) => e.name);
      assert.ok(names.includes("dir1"));
      assert.ok(names.includes("dir2"));
    });

    it("lists entries in a subdirectory", () => {
      pf.mkdir("d");
      pf.write("d/a.txt", "a");
      pf.write("d/b.txt", "b");
      const entries = pf.list("d");
      assert.equal(entries.length, 2);
      assert.ok(entries.every((e) => e.kind === "file"));
    });

    it("list does not include file content", () => {
      pf.mkdir("d");
      pf.write("d/secret.txt", "password123");
      const entries = pf.list("d");
      const entry = entries[0];
      assert.equal((entry as Record<string, unknown>).content, undefined);
    });

    it("returns both files and directories", () => {
      pf.mkdir("parent");
      pf.mkdir("parent/child");
      pf.write("parent/f.txt", "data");
      const entries = pf.list("parent");
      const kinds = entries.map((e) => e.kind).sort();
      assert.deepEqual(kinds, ["directory", "file"]);
    });

    it("throws when listing a nonexistent directory", () => {
      assert.throws(() => pf.list("nope"), { code: ErrorCode.DIRECTORY_NOT_FOUND });
    });

    it("lists an empty root with no entries", () => {
      const entries = pf.list();
      assert.equal(entries.length, 0);
    });

    it("lists with undefined path returns root", () => {
      pf.mkdir("x");
      const entries = pf.list(undefined);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].name, "x");
    });
  });

  // -- export / import ------------------------------------------------------

  describe("export and import", () => {
    it("round-trips files through export/import", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "content");
      const exported = pf.export();
      const pf2 = make(exported);
      assert.equal(pf2.read("d/f.txt"), "content");
    });

    it("exports empty directories", () => {
      pf.mkdir("empty");
      const exported = pf.export();
      assert.ok(exported.has("empty"));
      const entry = exported.get("empty");
      assert.equal(entry?.kind, "directory");
    });

    it("preserves isReadonly through export/import", () => {
      pf.mkdir("d");
      pf.write("d/ro.txt", "locked", true);
      const exported = pf.export();
      const pf2 = make(exported);
      const s = pf2.stat("d/ro.txt");
      assert.equal(s.kind, "file");
      if (s.kind === "file") {
        assert.equal(s.isReadonly, true);
      }
    });

    it("preserves etag through export/import", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "data");
      const original = pf.stat("d/f.txt");
      const exported = pf.export();
      const pf2 = make(exported);
      const restored = pf2.stat("d/f.txt");
      if (original.kind === "file" && restored.kind === "file") {
        assert.equal(original.etag, restored.etag);
      }
    });

    it("imports files with nested directories created automatically", () => {
      const entries: ExportedFileSystem = new Map();
      entries.set("a/b/c/file.txt", { kind: "file", content: "deep", etag: "e1", isReadonly: false });
      const pf2 = make(entries);
      assert.equal(pf2.read("a/b/c/file.txt"), "deep");
    });

    it("imports a mix of files and directories", () => {
      const entries: ExportedFileSystem = new Map();
      entries.set("solo", { kind: "directory" });
      entries.set("d/file.txt", { kind: "file", content: "hi", etag: "e1", isReadonly: false });
      const pf2 = make(entries);
      const s = pf2.stat("solo");
      assert.equal(s.kind, "directory");
      assert.equal(pf2.read("d/file.txt"), "hi");
    });

    it("exports non-empty directories without explicit directory entries", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "x");
      const exported = pf.export();
      assert.ok(!exported.has("d"));
      assert.ok(exported.has("d/f.txt"));
    });

    it("export with multiple files across directories", () => {
      pf.mkdir("a");
      pf.mkdir("b");
      pf.write("a/x.txt", "1");
      pf.write("b/y.txt", "2");
      const exported = pf.export();
      assert.equal(exported.size, 2);
      const aEntry = exported.get("a/x.txt");
      const bEntry = exported.get("b/y.txt");
      assert.ok(aEntry && aEntry.kind === "file");
      assert.ok(bEntry && bEntry.kind === "file");
      if (aEntry.kind === "file") assert.equal(aEntry.content, "1");
      if (bEntry.kind === "file") assert.equal(bEntry.content, "2");
    });

    it("import replaces the existing snapshot", () => {
      pf.mkdir("old");
      pf.write("old/file.txt", "stale");

      const replacement: ExportedFileSystem = new Map();
      replacement.set("src/main.ts", {
        kind: "file",
        content: "fresh",
        etag: "etag-1",
        isReadonly: false,
      });

      pf.import(replacement);

      assert.throws(() => pf.read("old/file.txt"), { code: ErrorCode.DIRECTORY_NOT_FOUND });
      assert.equal(pf.read("src/main.ts"), "fresh");
    });
  });

  describe("applyNotification", () => {
    it("re-emits import notifications as a single snapshot change", () => {
      const base = new FileSystem();
      base.mkdir("old");
      base.write("old/file.txt", "stale");

      const notifications: FileSystemNotification[] = [];
      const fs = new NotifyingFileSystem(base, (notification) => {
        notifications.push(notification);
      });

      const change: FileSystemNotification = {
        action: "import",
        entries: [
          [
            "src/main.ts",
            {
              kind: "file",
              content: "fresh",
              etag: "etag-2",
              isReadonly: false,
            },
          ],
        ],
      };

      fs.applyNotification(change);

      assert.deepEqual(notifications, [change]);
      assert.throws(() => base.read("old/file.txt"), { code: ErrorCode.DIRECTORY_NOT_FOUND });
      assert.equal(base.read("src/main.ts"), "fresh");
    });
  });

  // -- path normalization ---------------------------------------------------

  describe("path normalization", () => {
    it("handles leading slashes", () => {
      pf.mkdir("d");
      pf.write("/d/f.txt", "ok");
      assert.equal(pf.read("/d/f.txt"), "ok");
      assert.equal(pf.read("d/f.txt"), "ok");
    });

    it("handles backslashes", () => {
      pf.mkdir("d");
      pf.write("d\\f.txt", "ok");
      assert.equal(pf.read("d/f.txt"), "ok");
    });

    it("handles redundant slashes", () => {
      pf.mkdir("d");
      pf.write("d///f.txt", "ok");
      assert.equal(pf.read("d/f.txt"), "ok");
    });

    it("normalizes the rename paths", () => {
      pf.mkdir("a");
      pf.mkdir("b");
      pf.write("/a/f.txt", "data");
      pf.rename("/a/f.txt", "/b/f.txt");
      assert.equal(pf.read("b/f.txt"), "data");
    });

    it("normalizes stat paths", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "x");
      const s = pf.stat("/d/f.txt");
      assert.equal(s.kind, "file");
    });

    it("normalizes delete paths", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "x");
      pf.delete("/d/f.txt");
      assert.throws(() => pf.read("d/f.txt"), { code: ErrorCode.FILE_NOT_FOUND });
    });

    it("normalizes mkdir / rmdir paths", () => {
      pf.mkdir("/mydir");
      const s = pf.stat("mydir");
      assert.equal(s.kind, "directory");
      pf.rmdir("/mydir");
      assert.throws(() => pf.stat("mydir"), { code: ErrorCode.PATH_NOT_FOUND });
    });
  });

  // -- constructor options --------------------------------------------------

  describe("constructor", () => {
    it("constructs empty", () => {
      const pf2 = new FileSystem();
      const entries = pf2.list();
      assert.equal(entries.length, 0);
    });

    it("imports initial filesystem entries", () => {
      const entries: ExportedFileSystem = new Map();
      entries.set("d", { kind: "directory" });
      entries.set("d/hello.txt", { kind: "file", content: "hi", etag: "e1", isReadonly: false });
      const pf2 = make(entries);
      assert.equal(pf2.read("d/hello.txt"), "hi");
    });
  });

  // -- edge cases -----------------------------------------------------------

  describe("edge cases", () => {
    it("write updates etag on overwrite", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "v1");
      const etag1 = (pf.stat("d/f.txt") as { etag: string }).etag;
      pf.write("d/f.txt", "v2");
      const etag2 = (pf.stat("d/f.txt") as { etag: string }).etag;
      assert.notEqual(etag1, etag2);
    });

    it("mkdir creates intermediate directories automatically", () => {
      pf.mkdir("a");
      pf.mkdir("a/b");
      assert.equal(pf.stat("a").kind, "directory");
      assert.equal(pf.stat("a/b").kind, "directory");
    });

    it("delete then re-create file works", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "first");
      pf.delete("d/f.txt");
      pf.write("d/f.txt", "second");
      assert.equal(pf.read("d/f.txt"), "second");
    });

    it("rmdir then re-create directory works", () => {
      pf.mkdir("d");
      pf.rmdir("d");
      pf.mkdir("d");
      assert.equal(pf.stat("d").kind, "directory");
    });

    it("many files in the same directory", () => {
      pf.mkdir("bulk");
      for (let i = 0; i < 50; i++) {
        pf.write(`bulk/file${i}.txt`, `content${i}`);
      }
      const entries = pf.list("bulk");
      assert.equal(entries.length, 50);
      assert.equal(pf.read("bulk/file25.txt"), "content25");
    });

    it("deeply nested directory structure", () => {
      let path = "";
      for (let i = 0; i < 10; i++) {
        path = path ? `${path}/d${i}` : `d${i}`;
        pf.mkdir(path);
      }
      pf.write(`${path}/leaf.txt`, "deep");
      assert.equal(pf.read(`${path}/leaf.txt`), "deep");
    });

    it("import with duplicate directory does not throw", () => {
      const entries: ExportedFileSystem = new Map();
      entries.set("d/a.txt", { kind: "file", content: "a", etag: "e1", isReadonly: false });
      entries.set("d/b.txt", { kind: "file", content: "b", etag: "e2", isReadonly: false });
      const pf2 = make(entries);
      assert.equal(pf2.read("d/a.txt"), "a");
      assert.equal(pf2.read("d/b.txt"), "b");
    });

    it("rename to existing writable file path overwrites it", () => {
      pf.mkdir("d");
      pf.write("d/a.txt", "keep");
      pf.write("d/b.txt", "overwrite");
      pf.rename("d/a.txt", "d/b.txt");
      assert.equal(pf.read("d/b.txt"), "keep");
      assert.throws(() => pf.read("d/a.txt"), { code: ErrorCode.FILE_NOT_FOUND });
    });

    it("rename fails when target is a read-only file", () => {
      pf.mkdir("d");
      pf.write("d/a.txt", "source");
      pf.write("d/b.txt", "readonly", true);
      assert.throws(() => pf.rename("d/a.txt", "d/b.txt"), { code: ErrorCode.FILE_READ_ONLY });
    });

    it("list on root path with mixed content", () => {
      pf.mkdir("dir1");
      pf.mkdir("dir2");
      pf.mkdir("dir2/sub");
      const entries = pf.list();
      assert.equal(entries.length, 2);
      assert.ok(entries.every((e) => e.kind === "directory"));
    });
  });

  // -- etag checking --------------------------------------------------------

  describe("etag checking", () => {
    it("write with matching etag succeeds", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "v1");
      const etag = (pf.stat("d/f.txt") as { etag: string }).etag;
      pf.write("d/f.txt", "v2", false, etag);
      assert.equal(pf.read("d/f.txt"), "v2");
    });

    it("write with mismatched etag throws", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "v1");
      assert.throws(() => pf.write("d/f.txt", "v2", false, "wrong-etag"), { code: ErrorCode.ETAG_MISMATCH });
      assert.equal(pf.read("d/f.txt"), "v1");
    });

    it("write without etag overwrites unconditionally", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "v1");
      pf.write("d/f.txt", "v2");
      assert.equal(pf.read("d/f.txt"), "v2");
    });

    it("write with etag to a new file succeeds", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "v1", false, "any-etag");
      assert.equal(pf.read("d/f.txt"), "v1");
    });

    it("write with etag generates a new etag", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "v1");
      const etag1 = (pf.stat("d/f.txt") as { etag: string }).etag;
      pf.write("d/f.txt", "v2", false, etag1);
      const etag2 = (pf.stat("d/f.txt") as { etag: string }).etag;
      assert.notEqual(etag1, etag2);
    });

    it("import restores etags from exported entries", () => {
      const entries: ExportedFileSystem = new Map();
      entries.set("d/f.txt", { kind: "file", content: "data", etag: "custom-etag-123", isReadonly: false });
      const pf2 = make(entries);
      const s = pf2.stat("d/f.txt");
      if (s.kind === "file") {
        assert.equal(s.etag, "custom-etag-123");
      }
    });

    it("stale etag after two writes is rejected", () => {
      pf.mkdir("d");
      pf.write("d/f.txt", "v1");
      const staleEtag = (pf.stat("d/f.txt") as { etag: string }).etag;
      pf.write("d/f.txt", "v2");
      assert.throws(() => pf.write("d/f.txt", "v3", false, staleEtag), { code: ErrorCode.ETAG_MISMATCH });
      assert.equal(pf.read("d/f.txt"), "v2");
    });
  });
});
