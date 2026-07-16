import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { containedRelativePath, isSafeRelativePath } from "./path-confinement";

describe("isSafeRelativePath", () => {
  it("accepts normal relative paths", () => {
    for (const path of ["index.html", "app/index.html", "a/b/c.js", "app.main/index.html"]) {
      assert.strictEqual(isSafeRelativePath(path), true, path);
    }
  });

  it("rejects parent-directory traversal", () => {
    for (const path of ["..", "../escape", "app/../../escape", "a/../../b"]) {
      assert.strictEqual(isSafeRelativePath(path), false, path);
    }
  });

  it("rejects absolute paths", () => {
    for (const path of ["/etc/passwd", "/app/index.html"]) {
      assert.strictEqual(isSafeRelativePath(path), false, path);
    }
  });

  it("rejects backslashes", () => {
    for (const path of ["app\\index.html", "..\\escape", "a\\b"]) {
      assert.strictEqual(isSafeRelativePath(path), false, path);
    }
  });

  it("rejects empty paths and empty or dot segments", () => {
    for (const path of ["", "a//b", "./a", "a/./b"]) {
      assert.strictEqual(isSafeRelativePath(path), false, path);
    }
  });
});

describe("containedRelativePath", () => {
  it("returns the portion under the root", () => {
    assert.strictEqual(containedRelativePath("/home/user/project", "/home/user/project/src/main.ts"), "src/main.ts");
  });

  it("tolerates a trailing slash on the root", () => {
    assert.strictEqual(containedRelativePath("/home/user/project/", "/home/user/project/a.ts"), "a.ts");
  });

  it("returns undefined for a path outside the root", () => {
    assert.strictEqual(containedRelativePath("/home/user/project", "/home/user/other/a.ts"), undefined);
  });

  it("returns undefined for a sibling sharing the root prefix", () => {
    assert.strictEqual(containedRelativePath("/home/user/project", "/home/user/project-two/a.ts"), undefined);
  });
});
