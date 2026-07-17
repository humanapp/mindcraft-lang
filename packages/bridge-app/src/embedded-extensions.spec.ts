import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DependencyMount } from "@mindcraft-lang/ts-compiler";
import type { EmbeddedExtension, OriginCandidate } from "./embedded-extensions.js";
import {
  ExtensionResolutionCycleError,
  resolveProjectExtensions,
  unifyOriginCandidate,
} from "./embedded-extensions.js";

const OWNER = "mindcraft-lang";

/** The canonical `<owner>/<repo>` coordinate an embedded extension with the given repo segment carries. */
function coordinateFor(repo: string): string {
  return `${OWNER}/${repo}`;
}

/** An embedded extension whose content includes a `mindcraft.json` declaring its version and its own extensions. */
function ext(
  repo: string,
  options: {
    version?: string;
    extensions?: Record<string, string>;
    ambient?: string[];
    extra?: Record<string, string>;
  } = {}
): EmbeddedExtension {
  const files: { path: string; content: string }[] = [
    { path: "index.ts", content: `export const ${repo.replace(/[^A-Za-z0-9]/g, "_")} = 1;` },
  ];
  if (options.version !== undefined || options.extensions !== undefined || options.ambient !== undefined) {
    files.push({
      path: "mindcraft.json",
      content: JSON.stringify({
        name: repo,
        version: options.version ?? "1.0.0",
        ...(options.extensions ? { extensions: options.extensions } : {}),
        ...(options.ambient ? { ambient: options.ambient } : {}),
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

/** The codal standard library shape: an embedded extension with no `mindcraft.json`, hence no dependencies. */
const STDLIB: EmbeddedExtension = {
  canonicalOrigin: coordinateFor("codal"),
  files: [
    { path: "index.ts", content: "export {} from './image';" },
    { path: "image.ts", content: "export const image = 1;" },
  ],
};

describe("resolveProjectExtensions -- flat cases", () => {
  test("resolves an embedded reference by coordinate to a coordinate dependency and a namespaced mount", () => {
    const resolved = resolveProjectExtensions(
      { "mindcraft-lang/codal": "embedded:mindcraft-lang/codal" },
      { embedded: [STDLIB] }
    );
    assert.deepEqual(resolved.dependencies, [{ coordinate: "mindcraft-lang/codal" }]);
    assert.equal(resolved.dependencyMounts.length, 1);
    const mount = resolved.dependencyMounts[0];
    assert.equal(mount.namespace, "mindcraft-lang/codal");
    assert.equal(mount.files.get("/index.ts"), "export {} from './image';");
    assert.equal(mount.files.get("/image.ts"), "export const image = 1;");
    assert.deepEqual(mount.dependencies, []);
    assert.deepEqual(resolved.warnings, []);
  });

  test("the coordinate derives from identity, not from the manifest key", () => {
    // A manifest key that disagrees with the resolved coordinate does not change
    // the imported coordinate: it is always the extension's own <owner>/<repo>.
    const resolved = resolveProjectExtensions({ "any/key": "embedded:mindcraft-lang/codal" }, { embedded: [STDLIB] });
    assert.deepEqual(resolved.dependencies, [{ coordinate: "mindcraft-lang/codal" }]);
  });

  test("skips references of other transports", () => {
    const resolved = resolveProjectExtensions(
      { "owner/pos": "gh:owner/repo@v1.0.0", "author/scratch": "ffff:abc" },
      { embedded: [STDLIB] }
    );
    assert.deepEqual(resolved.dependencies, []);
    assert.deepEqual(resolved.dependencyMounts, []);
    assert.deepEqual(resolved.warnings, []);
  });

  test("skips an embedded reference with no matching bundled extension", () => {
    const resolved = resolveProjectExtensions(
      { "mindcraft-lang/other": "embedded:mindcraft-lang/not-bundled" },
      { embedded: [STDLIB] }
    );
    assert.deepEqual(resolved.dependencies, []);
  });

  test("carries an extension's declared ambient list onto its mount and omits it when undeclared", () => {
    const withAmbient = resolveProjectExtensions(
      { "mindcraft-lang/a": "embedded:mindcraft-lang/a" },
      {
        embedded: [
          ext("a", { version: "1.0.0", ambient: ["mindcraft.a.d.ts"], extra: { "mindcraft.a.d.ts": "export {};" } }),
        ],
      }
    );
    assert.deepEqual(mountFor(withAmbient.dependencyMounts, coordinateFor("a")).ambient, ["mindcraft.a.d.ts"]);

    const withoutAmbient = resolveProjectExtensions(
      { "mindcraft-lang/codal": "embedded:mindcraft-lang/codal" },
      { embedded: [STDLIB] }
    );
    assert.equal(mountFor(withoutAmbient.dependencyMounts, coordinateFor("codal")).ambient, undefined);
  });

  test("origin provenance carries the manifest display name, falling back to the coordinate without one", () => {
    const resolved = resolveProjectExtensions(
      {
        "mindcraft-lang/a": "embedded:mindcraft-lang/a",
        "mindcraft-lang/codal": "embedded:mindcraft-lang/codal",
      },
      { embedded: [ext("a", { version: "1.0.0" }), STDLIB] }
    );
    const originFor = (origin: string) => resolved.origins.find((candidate) => candidate.origin === origin);
    assert.equal(originFor(coordinateFor("a"))?.name, "a");
    assert.equal(originFor(coordinateFor("codal"))?.name, coordinateFor("codal"));
  });

  test("a manifest-listed tsconfig.json is opaque payload: it rides the mount verbatim", () => {
    const carriedTsconfig = '{ "compilerOptions": { "strict": false } }';
    const withTsconfig: EmbeddedExtension = {
      canonicalOrigin: coordinateFor("authored"),
      files: [
        { path: "index.ts", content: "export const authored = 1;" },
        { path: "tsconfig.json", content: carriedTsconfig },
        {
          path: "mindcraft.json",
          content: JSON.stringify({ name: "authored", version: "1.0.0", files: ["index.ts", "tsconfig.json"] }),
        },
      ],
    };
    const resolved = resolveProjectExtensions(
      { "mindcraft-lang/authored": "embedded:mindcraft-lang/authored" },
      { embedded: [withTsconfig] }
    );
    const mount = mountFor(resolved.dependencyMounts, coordinateFor("authored"));
    assert.equal(mount.files.get("/tsconfig.json"), carriedTsconfig);
    assert.deepEqual(resolved.warnings, [], "carrying a tsconfig.json raises no resolution warning");
  });

  test("returns empty results for an absent extensions list", () => {
    const resolved = resolveProjectExtensions(undefined, { embedded: [STDLIB] });
    assert.deepEqual(resolved.dependencies, []);
    assert.deepEqual(resolved.dependencyMounts, []);
    assert.deepEqual(resolved.warnings, []);
  });

  test("the stdlib default extension (no manifest) resolves identically regardless of embed-record noise", () => {
    const resolved = resolveProjectExtensions(
      { "mindcraft-lang/codal": "embedded:mindcraft-lang/codal" },
      { embedded: [STDLIB, ext("unused-a", { version: "2.0.0" })] }
    );
    assert.deepEqual(resolved.dependencies, [{ coordinate: "mindcraft-lang/codal" }]);
    assert.equal(resolved.dependencyMounts.length, 1);
    assert.equal(resolved.dependencyMounts[0].namespace, "mindcraft-lang/codal");
    assert.deepEqual(resolved.dependencyMounts[0].dependencies, []);
    assert.deepEqual(resolved.warnings, []);
  });
});

describe("resolveProjectExtensions -- transitive resolution", () => {
  test("an extension's own extensions resolve recursively, dependency mounts carry their own deps", () => {
    // A -> B -> C
    const embed = [
      ext("a", { version: "1.0.0", extensions: { "mindcraft-lang/b": "embedded:mindcraft-lang/b" } }),
      ext("b", { version: "1.0.0", extensions: { "mindcraft-lang/c": "embedded:mindcraft-lang/c" } }),
      ext("c", { version: "1.0.0" }),
    ];
    const resolved = resolveProjectExtensions({ "mindcraft-lang/a": "embedded:mindcraft-lang/a" }, { embedded: embed });

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
      ext("a", { version: "1.0.0", extensions: { "mindcraft-lang/c": "embedded:mindcraft-lang/c" } }),
      ext("b", { version: "1.0.0", extensions: { "mindcraft-lang/c": "embedded:mindcraft-lang/c" } }),
      ext("c", { version: "1.0.0" }),
    ];
    const resolved = resolveProjectExtensions(
      { "mindcraft-lang/a": "embedded:mindcraft-lang/a", "mindcraft-lang/b": "embedded:mindcraft-lang/b" },
      { embedded: embed }
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

describe("resolveProjectExtensions -- shared origin", () => {
  test("the same embedded origin reached directly and transitively unifies to one mount, no warning", () => {
    // host -> c (depth 0); host -> a -> c (depth 1). Because an embedded
    // reference is identity-derived (`embedded:<owner>/<repo>` matches the embed
    // entry whose coordinate is `<owner>/<repo>`), both paths reach the same
    // origin through the same reference and the same content: they unify
    // silently.
    const embed = [
      ext("a", { version: "1.0.0", extensions: { "mindcraft-lang/c": "embedded:mindcraft-lang/c" } }),
      ext("c", { version: "1.0.0" }),
    ];
    const resolved = resolveProjectExtensions(
      { "mindcraft-lang/c": "embedded:mindcraft-lang/c", "mindcraft-lang/a": "embedded:mindcraft-lang/a" },
      { embedded: embed }
    );

    const cMounts = resolved.dependencyMounts.filter((m) => m.namespace === coordinateFor("c"));
    assert.equal(cMounts.length, 1, "one instance of the shared origin");
    assert.deepEqual(resolved.warnings, [], "an identity-derived reference cannot conflict with itself");
    assert.deepEqual(mountFor(resolved.dependencyMounts, coordinateFor("a")).dependencies, [
      { coordinate: "mindcraft-lang/c" },
    ]);
  });
});

describe("resolveProjectExtensions -- cycle rejection", () => {
  test("a dependency cycle throws a precise cycle error naming the origins", () => {
    // A -> B -> A
    const embed = [
      ext("a", { version: "1.0.0", extensions: { "mindcraft-lang/b": "embedded:mindcraft-lang/b" } }),
      ext("b", { version: "1.0.0", extensions: { "mindcraft-lang/a": "embedded:mindcraft-lang/a" } }),
    ];
    assert.throws(
      () => resolveProjectExtensions({ "mindcraft-lang/a": "embedded:mindcraft-lang/a" }, { embedded: embed }),
      (err: unknown) => {
        assert.ok(err instanceof ExtensionResolutionCycleError);
        assert.deepEqual(err.cycle, [coordinateFor("a"), coordinateFor("b"), coordinateFor("a")]);
        return true;
      }
    );
  });

  test("a self-cycle throws", () => {
    const embed = [ext("a", { version: "1.0.0", extensions: { "mindcraft-lang/a": "embedded:mindcraft-lang/a" } })];
    assert.throws(
      () => resolveProjectExtensions({ "mindcraft-lang/a": "embedded:mindcraft-lang/a" }, { embedded: embed }),
      ExtensionResolutionCycleError
    );
  });
});

/**
 * Build a bare origin candidate carrying only the fields conflict resolution
 * reads. An embedded reference is identity-derived, so a version conflict or a
 * reference tie-break cannot arise through `resolveProjectExtensions`; these
 * tests drive the resolution decision at its input level, where a remote
 * transport's versioned references can disagree.
 */
function originCandidate(options: {
  origin?: string;
  version: string;
  reference: string;
  depth: number;
}): OriginCandidate {
  const origin = options.origin ?? coordinateFor("shared");
  return {
    origin,
    version: options.version,
    name: origin,
    reference: options.reference,
    depth: options.depth,
    files: new Map(),
    extensions: {},
    ambient: [],
  };
}

describe("unifyOriginCandidate -- version conflict", () => {
  test("the higher semantic version wins and the warning names both versions", () => {
    const incumbent = originCandidate({ version: "1.0.0", reference: "gh:mindcraft-lang/shared@v1.0.0", depth: 0 });
    const incoming = originCandidate({ version: "2.3.0", reference: "gh:mindcraft-lang/shared@v2.3.0", depth: 1 });

    const { winner, warning } = unifyOriginCandidate(incoming, incumbent);

    assert.equal(winner, incoming, "the higher version is selected");
    assert.equal(winner.version, "2.3.0");
    assert.ok(warning, "a disagreement records a warning");
    assert.equal(warning.kind, "version-conflict");
    assert.equal(warning.origin, coordinateFor("shared"));
    assert.equal(warning.selectedVersion, "2.3.0");
    assert.equal(warning.rejectedVersion, "1.0.0");
    assert.equal(warning.selectedReference, "gh:mindcraft-lang/shared@v2.3.0");
    assert.equal(warning.rejectedReference, "gh:mindcraft-lang/shared@v1.0.0");
    assert.match(warning.message, /2\.3\.0/);
    assert.match(warning.message, /1\.0\.0/);
  });

  test("a lower incoming version loses; the incumbent stays and the warning still names both", () => {
    const incumbent = originCandidate({ version: "2.3.0", reference: "gh:mindcraft-lang/shared@v2.3.0", depth: 0 });
    const incoming = originCandidate({ version: "1.0.0", reference: "gh:mindcraft-lang/shared@v1.0.0", depth: 1 });

    const { winner, warning } = unifyOriginCandidate(incoming, incumbent);

    assert.equal(winner, incumbent, "the incumbent's higher version is kept");
    assert.ok(warning);
    assert.equal(warning.kind, "version-conflict");
    assert.equal(warning.selectedVersion, "2.3.0");
    assert.equal(warning.rejectedVersion, "1.0.0");
  });
});

describe("unifyOriginCandidate -- reference tie-break", () => {
  test("at an equal version, the reference nearest the host project wins", () => {
    const incumbent = originCandidate({ version: "1.0.0", reference: "gh:mindcraft-lang/shared@v1.0.0", depth: 2 });
    const incoming = originCandidate({ version: "1.0.0", reference: "embedded:mindcraft-lang/shared", depth: 0 });

    const { winner, warning } = unifyOriginCandidate(incoming, incumbent);

    assert.equal(winner, incoming, "the shallower reference is selected");
    assert.equal(winner.depth, 0);
    assert.ok(warning, "an equal version reached by two references records a warning");
    assert.equal(warning.kind, "reference-tiebreak");
    assert.equal(warning.origin, coordinateFor("shared"));
    assert.equal(warning.selectedReference, "embedded:mindcraft-lang/shared");
    assert.equal(warning.rejectedReference, "gh:mindcraft-lang/shared@v1.0.0");
    assert.equal(warning.selectedVersion, undefined);
    assert.equal(warning.rejectedVersion, undefined);
  });

  test("identical version and reference unify onto the incumbent with no warning", () => {
    const incumbent = originCandidate({ version: "1.0.0", reference: "embedded:mindcraft-lang/shared", depth: 0 });
    const incoming = originCandidate({ version: "1.0.0", reference: "embedded:mindcraft-lang/shared", depth: 1 });

    const { winner, warning } = unifyOriginCandidate(incoming, incumbent);

    assert.equal(winner, incumbent);
    assert.equal(warning, undefined);
  });
});

describe("resolveProjectExtensions -- fetched content", () => {
  /** Snapshot text files of a fetched extension declaring its manifest and one entry module. */
  function fetchedFiles(options: {
    name: string;
    version: string;
    extensions?: Record<string, string>;
  }): Map<string, string> {
    return new Map([
      [
        "/mindcraft.json",
        JSON.stringify({
          name: options.name,
          version: options.version,
          files: ["index.ts"],
          ...(options.extensions ? { extensions: options.extensions } : {}),
        }),
      ],
      ["/index.ts", "export const value = 1;"],
    ]);
  }

  test("resolves a gh reference from fetched content keyed by reference", () => {
    const reference = "gh:example-org/position-ext@v0.1.0";
    const resolved = resolveProjectExtensions(
      { "example-org/position-ext": reference },
      { embedded: [], fetched: new Map([[reference, fetchedFiles({ name: "Position", version: "0.1.0" })]]) }
    );

    assert.deepStrictEqual(resolved.dependencies, [{ coordinate: "example-org/position-ext" }]);
    const mount = mountFor(resolved.dependencyMounts, "example-org/position-ext");
    assert.equal(mount.files.get("/index.ts"), "export const value = 1;");
    assert.deepStrictEqual(resolved.origins, [
      { origin: "example-org/position-ext", reference, version: "0.1.0", name: "Position" },
    ]);
  });

  test("skips a gh reference with no fetched content; the import surfaces as a compiler diagnostic later", () => {
    const resolved = resolveProjectExtensions(
      { "example-org/position-ext": "gh:example-org/position-ext@v0.1.0" },
      { embedded: [] }
    );
    assert.deepStrictEqual(resolved.dependencies, []);
    assert.deepStrictEqual(resolved.dependencyMounts, []);
  });

  test("resolves transitively through a fetched extension's own gh extensions", () => {
    const rootReference = "gh:example-org/robot-ext@v1.0.0";
    const childReference = "gh:example-org/motor-ext@v2.0.0";
    const fetched = new Map([
      [
        rootReference,
        fetchedFiles({
          name: "Robot",
          version: "1.0.0",
          extensions: { "example-org/motor-ext": childReference },
        }),
      ],
      [childReference, fetchedFiles({ name: "Motor", version: "2.0.0" })],
    ]);

    const resolved = resolveProjectExtensions({ "example-org/robot-ext": rootReference }, { embedded: [], fetched });

    assert.deepStrictEqual(resolved.dependencies, [{ coordinate: "example-org/robot-ext" }]);
    const root = mountFor(resolved.dependencyMounts, "example-org/robot-ext");
    assert.deepStrictEqual(root.dependencies, [{ coordinate: "example-org/motor-ext" }]);
    mountFor(resolved.dependencyMounts, "example-org/motor-ext");
  });

  test("resolves an embedded extension's declared gh dependency", () => {
    const childReference = "gh:example-org/motor-ext@v2.0.0";
    const embedded = ext("robot", { version: "1.0.0", extensions: { "example-org/motor-ext": childReference } });
    const resolved = resolveProjectExtensions(
      { [coordinateFor("robot")]: `embedded:${coordinateFor("robot")}` },
      { embedded: [embedded], fetched: new Map([[childReference, fetchedFiles({ name: "Motor", version: "2.0.0" })]]) }
    );
    mountFor(resolved.dependencyMounts, coordinateFor("robot"));
    mountFor(resolved.dependencyMounts, "example-org/motor-ext");
  });

  test("selects the higher version when two references require the same fetched origin, with a warning", () => {
    const directReference = "gh:example-org/motor-ext@v1.0.0";
    const nestedReference = "gh:example-org/motor-ext@v2.0.0";
    const rootReference = "gh:example-org/robot-ext@v1.0.0";
    const fetched = new Map([
      [directReference, fetchedFiles({ name: "Motor", version: "1.0.0" })],
      [nestedReference, fetchedFiles({ name: "Motor", version: "2.0.0" })],
      [
        rootReference,
        fetchedFiles({
          name: "Robot",
          version: "1.0.0",
          extensions: { "example-org/motor-ext": nestedReference },
        }),
      ],
    ]);

    const resolved = resolveProjectExtensions(
      { "example-org/motor-ext": directReference, "example-org/robot-ext": rootReference },
      { embedded: [], fetched }
    );

    const motor = resolved.origins.find((origin) => origin.origin === "example-org/motor-ext");
    assert.deepStrictEqual(motor, {
      origin: "example-org/motor-ext",
      reference: nestedReference,
      version: "2.0.0",
      name: "Motor",
    });
    assert.equal(resolved.warnings.length, 1);
    assert.equal(resolved.warnings[0].kind, "version-conflict");
    assert.equal(resolved.dependencyMounts.filter((m) => m.namespace === "example-org/motor-ext").length, 1);
  });

  test("rejects a dependency cycle across fetched extensions", () => {
    const aReference = "gh:example-org/a-ext@v1.0.0";
    const bReference = "gh:example-org/b-ext@v1.0.0";
    const fetched = new Map([
      [aReference, fetchedFiles({ name: "A", version: "1.0.0", extensions: { "example-org/b-ext": bReference } })],
      [bReference, fetchedFiles({ name: "B", version: "1.0.0", extensions: { "example-org/a-ext": aReference } })],
    ]);

    assert.throws(
      () => resolveProjectExtensions({ "example-org/a-ext": aReference }, { embedded: [], fetched }),
      (error: unknown) => {
        assert.ok(error instanceof ExtensionResolutionCycleError);
        assert.deepStrictEqual(error.cycle, ["example-org/a-ext", "example-org/b-ext", "example-org/a-ext"]);
        return true;
      }
    );
  });
});

describe("resolveProjectExtensions -- fetched-origin warnings", () => {
  const ABBREVIATED_PIN = "b19b80b";
  const FULL_SHA = "b19b80b029a77303ee575d3ff9b29adbf7021b23";

  /** Fetched content for one reference, carrying the given manifest fields. */
  function fetchedFor(reference: string, manifest: Record<string, unknown>): Map<string, Map<string, string>> {
    return new Map([
      [
        reference,
        new Map([
          ["/mindcraft.json", JSON.stringify(manifest)],
          ["/index.ts", "export const x = 1;"],
        ]),
      ],
    ]);
  }

  test("an abbreviated-SHA pin raises an abbreviated-pin warning; a full SHA and a tag do not", () => {
    const abbreviated = `gh:example-org/position-ext@${ABBREVIATED_PIN}`;
    const warned = resolveProjectExtensions(
      { "example-org/position-ext": abbreviated },
      { embedded: [], fetched: fetchedFor(abbreviated, { name: "P", version: "0.1.0" }) }
    );
    assert.equal(warned.warnings.length, 1);
    const warning = warned.warnings[0];
    assert.equal(warning.kind, "abbreviated-pin");
    if (warning.kind === "abbreviated-pin") {
      assert.equal(warning.origin, "example-org/position-ext");
      assert.equal(warning.reference, abbreviated);
      assert.match(warning.message, /40-character/);
    }

    for (const pin of [FULL_SHA, "v0.1.0"]) {
      const reference = `gh:example-org/position-ext@${pin}`;
      const clean = resolveProjectExtensions(
        { "example-org/position-ext": reference },
        { embedded: [], fetched: fetchedFor(reference, { name: "P", version: "0.1.0" }) }
      );
      assert.deepEqual(clean.warnings, [], `expected no warning for pin "${pin}"`);
    }
  });

  test("a fetched manifest identity differing from the coordinate raises an identity-mismatch warning", () => {
    const reference = "gh:fork-org/position-ext@v0.1.0";
    const resolved = resolveProjectExtensions(
      { "fork-org/position-ext": reference },
      {
        embedded: [],
        fetched: fetchedFor(reference, { name: "P", version: "0.1.0", identity: "upstream-org/position-ext" }),
      }
    );
    assert.equal(resolved.warnings.length, 1);
    const warning = resolved.warnings[0];
    assert.equal(warning.kind, "identity-mismatch");
    if (warning.kind === "identity-mismatch") {
      assert.equal(warning.origin, "fork-org/position-ext");
      assert.equal(warning.declaredIdentity, "upstream-org/position-ext");
      assert.match(warning.message, /upstream-org\/position-ext/);
    }
    // Resolution proceeds under the reference coordinate.
    assert.deepEqual(resolved.dependencies, [{ coordinate: "fork-org/position-ext" }]);
  });

  test("a matching identity and an embedded origin raise no identity warning", () => {
    const reference = "gh:example-org/position-ext@v0.1.0";
    const matching = resolveProjectExtensions(
      { "example-org/position-ext": reference },
      {
        embedded: [],
        fetched: fetchedFor(reference, { name: "P", version: "0.1.0", identity: "example-org/position-ext" }),
      }
    );
    assert.deepEqual(matching.warnings, []);

    const embedded = resolveProjectExtensions(
      { "mindcraft-lang/codal": "embedded:mindcraft-lang/codal" },
      { embedded: [STDLIB] }
    );
    assert.deepEqual(embedded.warnings, []);
  });
});
