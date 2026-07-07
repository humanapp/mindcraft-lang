import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DependencyMount } from "@mindcraft-lang/ts-compiler";
import type { EmbeddedExtension } from "./embedded-extensions.js";
import { ExtensionResolutionCycleError, resolveEmbeddedExtensions } from "./embedded-extensions.js";

const OWNER = "mindcraft-lang";

/** The canonical `<owner>/<repo>` coordinate an embedded extension with the given repo segment carries. */
function coordinateFor(repo: string): string {
  return `${OWNER}/${repo}`;
}

/** An embedded extension whose content includes a `mindcraft.json` declaring its version and its own extensions. */
function ext(
  repo: string,
  options: { version?: string; extensions?: Record<string, string>; extra?: Record<string, string> } = {}
): EmbeddedExtension {
  const files: { path: string; content: string }[] = [
    { path: "index.ts", content: `export const ${repo.replace(/[^A-Za-z0-9]/g, "_")} = 1;` },
  ];
  if (options.version !== undefined || options.extensions !== undefined) {
    files.push({
      path: "mindcraft.json",
      content: JSON.stringify({
        name: repo,
        version: options.version ?? "1.0.0",
        ...(options.extensions ? { extensions: options.extensions } : {}),
      }),
    });
  }
  for (const [path, content] of Object.entries(options.extra ?? {})) {
    files.push({ path, content });
  }
  return { canonicalOrigin: coordinateFor(repo), files };
}

function mountFor(mounts: readonly DependencyMount[], origin: string): DependencyMount {
  const mount = mounts.find((m) => m.namespace === origin);
  assert.ok(mount, `expected a mount for ${origin}`);
  return mount;
}

/** The Wodal standard library shape: an embedded extension with no `mindcraft.json`, hence no dependencies. */
const STDLIB: EmbeddedExtension = {
  canonicalOrigin: coordinateFor("wodal-lib"),
  files: [
    { path: "index.ts", content: "export {} from './image';" },
    { path: "image.ts", content: "export const image = 1;" },
  ],
};

describe("resolveEmbeddedExtensions -- flat cases", () => {
  test("resolves an embedded reference by repo segment to a coordinate dependency and a namespaced mount", () => {
    const resolved = resolveEmbeddedExtensions({ "mindcraft-lang/wodal-lib": "embedded:wodal-lib" }, [STDLIB]);
    assert.deepEqual(resolved.dependencies, [{ coordinate: "mindcraft-lang/wodal-lib" }]);
    assert.equal(resolved.dependencyMounts.length, 1);
    const mount = resolved.dependencyMounts[0];
    assert.equal(mount.namespace, "mindcraft-lang/wodal-lib");
    assert.equal(mount.files.get("/index.ts"), "export {} from './image';");
    assert.equal(mount.files.get("/image.ts"), "export const image = 1;");
    assert.deepEqual(mount.dependencies, []);
    assert.deepEqual(resolved.warnings, []);
  });

  test("the coordinate derives from identity, not from the manifest key", () => {
    // A manifest key that disagrees with the resolved coordinate does not change
    // the imported coordinate: it is always the extension's own <owner>/<repo>.
    const resolved = resolveEmbeddedExtensions({ "any/key": "embedded:wodal-lib" }, [STDLIB]);
    assert.deepEqual(resolved.dependencies, [{ coordinate: "mindcraft-lang/wodal-lib" }]);
  });

  test("skips references of other transports", () => {
    const resolved = resolveEmbeddedExtensions({ "owner/pos": "gh:owner/repo@v1.0.0", "author/scratch": "local:abc" }, [
      STDLIB,
    ]);
    assert.deepEqual(resolved.dependencies, []);
    assert.deepEqual(resolved.dependencyMounts, []);
    assert.deepEqual(resolved.warnings, []);
  });

  test("skips an embedded reference with no matching bundled extension", () => {
    const resolved = resolveEmbeddedExtensions({ "mindcraft-lang/other": "embedded:not-bundled" }, [STDLIB]);
    assert.deepEqual(resolved.dependencies, []);
  });

  test("returns empty results for an absent extensions list", () => {
    const resolved = resolveEmbeddedExtensions(undefined, [STDLIB]);
    assert.deepEqual(resolved.dependencies, []);
    assert.deepEqual(resolved.dependencyMounts, []);
    assert.deepEqual(resolved.warnings, []);
  });

  test("the stdlib default extension (no manifest) resolves identically regardless of embed-record noise", () => {
    const resolved = resolveEmbeddedExtensions({ "mindcraft-lang/wodal-lib": "embedded:wodal-lib" }, [
      STDLIB,
      ext("unused-a", { version: "2.0.0" }),
    ]);
    assert.deepEqual(resolved.dependencies, [{ coordinate: "mindcraft-lang/wodal-lib" }]);
    assert.equal(resolved.dependencyMounts.length, 1);
    assert.equal(resolved.dependencyMounts[0].namespace, "mindcraft-lang/wodal-lib");
    assert.deepEqual(resolved.dependencyMounts[0].dependencies, []);
    assert.deepEqual(resolved.warnings, []);
  });
});

describe("resolveEmbeddedExtensions -- transitive resolution", () => {
  test("an extension's own extensions resolve recursively, dependency mounts carry their own deps", () => {
    // A -> B -> C
    const embed = [
      ext("a", { version: "1.0.0", extensions: { "mindcraft-lang/b": "embedded:b" } }),
      ext("b", { version: "1.0.0", extensions: { "mindcraft-lang/c": "embedded:c" } }),
      ext("c", { version: "1.0.0" }),
    ];
    const resolved = resolveEmbeddedExtensions({ "mindcraft-lang/a": "embedded:a" }, embed);

    assert.deepEqual(resolved.dependencies, [{ coordinate: "mindcraft-lang/a" }]);
    const origins = resolved.dependencyMounts.map((m) => m.namespace).sort();
    assert.deepEqual(origins, [coordinateFor("a"), coordinateFor("b"), coordinateFor("c")]);

    assert.deepEqual(mountFor(resolved.dependencyMounts, coordinateFor("a")).dependencies, [
      { coordinate: "mindcraft-lang/b" },
    ]);
    assert.deepEqual(mountFor(resolved.dependencyMounts, coordinateFor("b")).dependencies, [
      { coordinate: "mindcraft-lang/c" },
    ]);
    assert.deepEqual(mountFor(resolved.dependencyMounts, coordinateFor("c")).dependencies, []);
    assert.deepEqual(resolved.warnings, []);
  });

  test("a diamond resolves one instance of the shared origin; both dependents reference the same origin", () => {
    // A -> C, B -> C; host -> A, B
    const embed = [
      ext("a", { version: "1.0.0", extensions: { "mindcraft-lang/c": "embedded:c" } }),
      ext("b", { version: "1.0.0", extensions: { "mindcraft-lang/c": "embedded:c" } }),
      ext("c", { version: "1.0.0" }),
    ];
    const resolved = resolveEmbeddedExtensions(
      { "mindcraft-lang/a": "embedded:a", "mindcraft-lang/b": "embedded:b" },
      embed
    );

    const cMounts = resolved.dependencyMounts.filter((m) => m.namespace === coordinateFor("c"));
    assert.equal(cMounts.length, 1, "the shared origin appears exactly once in the closure");
    assert.deepEqual(mountFor(resolved.dependencyMounts, coordinateFor("a")).dependencies, [
      { coordinate: "mindcraft-lang/c" },
    ]);
    assert.deepEqual(mountFor(resolved.dependencyMounts, coordinateFor("b")).dependencies, [
      { coordinate: "mindcraft-lang/c" },
    ]);
    assert.deepEqual(resolved.warnings, []);
  });
});

describe("resolveEmbeddedExtensions -- shared origin", () => {
  test("the same embedded origin reached directly and transitively unifies to one mount, no warning", () => {
    // host -> c (depth 0); host -> a -> c (depth 1). Because an embedded
    // reference is identity-derived (`embedded:<repo>` matches the embed entry
    // whose origin repo segment is `<repo>`), both paths reach the same origin
    // through the same reference and the same content: they unify silently.
    const embed = [
      ext("a", { version: "1.0.0", extensions: { "mindcraft-lang/c": "embedded:c" } }),
      ext("c", { version: "1.0.0" }),
    ];
    const resolved = resolveEmbeddedExtensions(
      { "mindcraft-lang/c": "embedded:c", "mindcraft-lang/a": "embedded:a" },
      embed
    );

    const cMounts = resolved.dependencyMounts.filter((m) => m.namespace === coordinateFor("c"));
    assert.equal(cMounts.length, 1, "one instance of the shared origin");
    assert.deepEqual(resolved.warnings, [], "an identity-derived reference cannot conflict with itself");
    assert.deepEqual(mountFor(resolved.dependencyMounts, coordinateFor("a")).dependencies, [
      { coordinate: "mindcraft-lang/c" },
    ]);
  });
});

describe("resolveEmbeddedExtensions -- cycle rejection", () => {
  test("a dependency cycle throws a precise cycle error naming the origins", () => {
    // A -> B -> A
    const embed = [
      ext("a", { version: "1.0.0", extensions: { "mindcraft-lang/b": "embedded:b" } }),
      ext("b", { version: "1.0.0", extensions: { "mindcraft-lang/a": "embedded:a" } }),
    ];
    assert.throws(
      () => resolveEmbeddedExtensions({ "mindcraft-lang/a": "embedded:a" }, embed),
      (err: unknown) => {
        assert.ok(err instanceof ExtensionResolutionCycleError);
        assert.deepEqual(err.cycle, [coordinateFor("a"), coordinateFor("b"), coordinateFor("a")]);
        return true;
      }
    );
  });

  test("a self-cycle throws", () => {
    const embed = [ext("a", { version: "1.0.0", extensions: { "mindcraft-lang/a": "embedded:a" } })];
    assert.throws(
      () => resolveEmbeddedExtensions({ "mindcraft-lang/a": "embedded:a" }, embed),
      ExtensionResolutionCycleError
    );
  });
});
