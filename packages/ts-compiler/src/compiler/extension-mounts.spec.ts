/**
 * The `@ext/<owner>/<repo>` specifier split: an extension coordinate is exactly
 * two segments. Fewer segments name no extension (the import falls through to an
 * ordinary module-not-found), and a third segment or beyond is a deep import
 * into the extension's internals. This grammar is the single source the module
 * resolver and the deep-import scan both read.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { splitExtensionSpecifier } from "./extension-mounts.js";

describe("splitExtensionSpecifier", () => {
  test("a bare owner segment names no coordinate", () => {
    assert.deepEqual(splitExtensionSpecifier("wodal-lib"), {});
  });

  test("the empty remainder names no coordinate", () => {
    assert.deepEqual(splitExtensionSpecifier(""), {});
  });

  test("exactly two segments is the coordinate, with no deep path", () => {
    assert.deepEqual(splitExtensionSpecifier("mindcraft-lang/wodal-lib"), {
      coordinate: "mindcraft-lang/wodal-lib",
    });
  });

  test("a third segment is a deep path past the two-segment coordinate", () => {
    assert.deepEqual(splitExtensionSpecifier("mindcraft-lang/wodal-lib/image"), {
      coordinate: "mindcraft-lang/wodal-lib",
      deepPath: "/image",
    });
  });

  test("further segments all fold into the deep path", () => {
    assert.deepEqual(splitExtensionSpecifier("owner/repo/nested/module"), {
      coordinate: "owner/repo",
      deepPath: "/nested/module",
    });
  });
});
