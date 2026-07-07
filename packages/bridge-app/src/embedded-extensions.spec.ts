import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EmbeddedExtension } from "./embedded-extensions.js";
import { embeddedOrigin, resolveEmbeddedExtensions } from "./embedded-extensions.js";

const STDLIB: EmbeddedExtension = {
  slug: "wodal-stdlib",
  canonicalOrigin: embeddedOrigin("wodal-stdlib"),
  files: [
    { path: "index.ts", content: "export {} from './image';" },
    { path: "image.ts", content: "export const image = 1;" },
  ],
};

describe("embeddedOrigin", () => {
  test("prefixes the slug with the embedded transport", () => {
    assert.equal(embeddedOrigin("wodal-stdlib"), "embedded:wodal-stdlib");
  });
});

describe("resolveEmbeddedExtensions", () => {
  test("resolves an embedded reference to a dependency and a namespaced mount", () => {
    const resolved = resolveEmbeddedExtensions({ "wodal-stdlib": "embedded:wodal-stdlib" }, [STDLIB]);
    assert.deepEqual(resolved.dependencies, [{ slug: "wodal-stdlib", namespace: "embedded:wodal-stdlib" }]);
    assert.equal(resolved.dependencyMounts.length, 1);
    const mount = resolved.dependencyMounts[0];
    assert.equal(mount.namespace, "embedded:wodal-stdlib");
    assert.equal(mount.files.get("/index.ts"), "export {} from './image';");
    assert.equal(mount.files.get("/image.ts"), "export const image = 1;");
  });

  test("keeps the manifest slug as the dependency alias when it differs from the extension slug", () => {
    const resolved = resolveEmbeddedExtensions({ stdlib: "embedded:wodal-stdlib" }, [STDLIB]);
    assert.deepEqual(resolved.dependencies, [{ slug: "stdlib", namespace: "embedded:wodal-stdlib" }]);
  });

  test("skips references of other transports", () => {
    const resolved = resolveEmbeddedExtensions({ pos: "gh:owner/repo@v1.0.0", scratch: "local:abc" }, [STDLIB]);
    assert.deepEqual(resolved.dependencies, []);
    assert.deepEqual(resolved.dependencyMounts, []);
  });

  test("skips an embedded reference with no matching bundled extension", () => {
    const resolved = resolveEmbeddedExtensions({ other: "embedded:not-bundled" }, [STDLIB]);
    assert.deepEqual(resolved.dependencies, []);
  });

  test("returns empty results for an absent extensions list", () => {
    const resolved = resolveEmbeddedExtensions(undefined, [STDLIB]);
    assert.deepEqual(resolved.dependencies, []);
    assert.deepEqual(resolved.dependencyMounts, []);
  });
});
