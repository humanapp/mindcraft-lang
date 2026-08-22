/**
 * The `@lib/<owner>/<repo>` specifier split: an extension coordinate is exactly
 * two segments. Fewer segments name no extension (the import falls through to an
 * ordinary module-not-found), and a third segment or beyond is a deep import
 * into the extension's internals. This grammar is the single source the module
 * resolver and the deep-import scan both read.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isCompilerControlledPath } from "./compile.js";
import {
  extensionFilePath,
  extensionWorkspacePath,
  isExtensionWorkspacePath,
  parseExtensionCompilerPath,
  qualifiedDeclarationName,
  splitExtensionSpecifier,
} from "./extension-mounts.js";
import { qualifiedClassName } from "./symbol-keys.js";

describe("splitExtensionSpecifier", () => {
  test("a bare owner segment names no coordinate", () => {
    assert.deepEqual(splitExtensionSpecifier("wodal"), {});
  });

  test("the empty remainder names no coordinate", () => {
    assert.deepEqual(splitExtensionSpecifier(""), {});
  });

  test("exactly two segments is the coordinate, with no deep path", () => {
    assert.deepEqual(splitExtensionSpecifier("wendoo-lang/codal"), {
      coordinate: "wendoo-lang/codal",
    });
  });

  test("a third segment is a deep path past the two-segment coordinate", () => {
    assert.deepEqual(splitExtensionSpecifier("wendoo-lang/codal/image"), {
      coordinate: "wendoo-lang/codal",
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

describe("installed-extension paths", () => {
  test("a coordinate's file materializes at its `.libraries/<owner>/<repo>/` subtree", () => {
    assert.equal(extensionFilePath("acme/point", "index.ts"), "/.libraries/acme/point/index.ts");
    assert.equal(extensionFilePath("acme/point", "/nested/util.ts"), "/.libraries/acme/point/nested/util.ts");
    assert.equal(extensionWorkspacePath("acme/point", "/index.ts"), ".libraries/acme/point/index.ts");
  });

  test("an extension compiler path parses back to its coordinate and coordinate-relative path", () => {
    assert.deepEqual(parseExtensionCompilerPath("/.libraries/acme/point/index.ts"), {
      namespace: "acme/point",
      fileName: "/index.ts",
    });
    assert.deepEqual(parseExtensionCompilerPath("/.libraries/acme/point/nested/util.ts"), {
      namespace: "acme/point",
      fileName: "/nested/util.ts",
    });
  });

  test("a project-local path is not an extension path", () => {
    assert.equal(parseExtensionCompilerPath("/main.ts"), undefined);
    assert.equal(parseExtensionCompilerPath("/.libraries/acme"), undefined);
    assert.equal(isExtensionWorkspacePath("main.ts"), false);
  });

  test("the extensions tree is recognized workspace-relative and compiler-path", () => {
    assert.equal(isExtensionWorkspacePath(".libraries"), true);
    assert.equal(isExtensionWorkspacePath(".libraries/acme/point/index.ts"), true);
    assert.equal(isExtensionWorkspacePath("/.libraries/acme/point/index.ts"), true);
    assert.equal(isExtensionWorkspacePath(".librariesfoo/x.ts"), false);
  });

  test("a declaration inside the extensions tree keys under its coordinate, not the host namespace", () => {
    assert.equal(
      qualifiedDeclarationName("host-guid", "/.libraries/acme/point/point.ts", "Point"),
      qualifiedClassName("acme/point", "/point.ts", "Point")
    );
  });

  test("a project-local declaration keys under the host namespace", () => {
    assert.equal(
      qualifiedDeclarationName("host-guid", "/main.ts", "Foo"),
      qualifiedClassName("host-guid", "/main.ts", "Foo")
    );
  });

  test("the extensions tree is compiler-controlled, so the project store excludes it from saved bytes", () => {
    assert.equal(isCompilerControlledPath(".libraries/acme/point/index.ts", []), true);
    assert.equal(isCompilerControlledPath("main.ts", []), false);
  });
});
