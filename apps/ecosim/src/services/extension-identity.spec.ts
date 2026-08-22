import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EmbeddedExtension } from "@wendoo-lang/bridge-app";
import { resolveProjectExtensions } from "@wendoo-lang/bridge-app";

/**
 * A mounted extension whose own manifest declares an identity that differs
 * from the coordinate the host's embed record assigns it.
 */
function mismatchedExtension(): EmbeddedExtension {
  return {
    canonicalOrigin: "acme/widget",
    files: [
      {
        path: "wendoo.json",
        content: JSON.stringify({
          name: "Widget",
          version: "1.0.0",
          identity: "someone-else/widget",
          files: ["index.ts"],
          ambient: ["widget.d.ts"],
        }),
      },
      { path: "index.ts", content: "export const widget = true;\n" },
      { path: "widget.d.ts", content: "declare const widgetGlobal: boolean;\n" },
    ],
  };
}

describe("mounted extension identity vs assigned origin", () => {
  it("resolves under the assigned origin; a mismatching declared identity is inert", () => {
    const resolved = resolveProjectExtensions(
      { "acme/widget": "embedded:acme/widget" },
      { embedded: [mismatchedExtension()] }
    );

    assert.deepEqual(resolved.dependencies, [{ coordinate: "acme/widget" }]);
    assert.equal(resolved.dependencyMounts.length, 1);
    const mount = resolved.dependencyMounts[0];
    assert.equal(mount.namespace, "acme/widget");
    // The manifest carrying the identity still parses: its ambient list arrives.
    assert.deepEqual(mount.ambient, ["widget.d.ts"]);
    assert.deepEqual(resolved.warnings, []);
  });
});
