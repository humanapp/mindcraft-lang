import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EmbeddedExtension } from "./embedded-extensions.js";
import { collectLibraryUninstallImpact, runGuardedLibraryUninstall } from "./library-uninstall-guard.js";

const CUTEBOT = "acme/lib-cutebot";
const POSITION = "acme/lib-codal-position";
const OTHER = "acme/lib-other";

function embedded(coordinate: string, extensions?: Record<string, string>): EmbeddedExtension {
  return {
    canonicalOrigin: coordinate,
    files: [
      {
        path: "wendoo.json",
        content: JSON.stringify({
          name: coordinate,
          version: "1.0.0",
          files: ["index.ts"],
          ...(extensions ? { extensions } : {}),
        }),
      },
      { path: "index.ts", content: "export {};" },
    ],
  };
}

// The cutebot library pulls the position library in as a transitive dependency.
const EMBEDDED = [embedded(CUTEBOT, { [POSITION]: `embedded:${POSITION}` }), embedded(POSITION), embedded(OTHER)];

const EXTENSIONS = {
  [CUTEBOT]: `embedded:${CUTEBOT}`,
  [OTHER]: `embedded:${OTHER}`,
};

/** A persisted brain with one rule referencing an actuator tile owned by `ns`. */
function brainJsonUsing(ns: string): Record<string, unknown> {
  return {
    version: 1,
    id: "brain00000000001",
    name: "Test Brain",
    catalog: [],
    pages: [
      {
        version: 2,
        pageId: "page000000000001",
        name: "Page 1",
        rules: [
          {
            version: 1,
            when: [],
            do: [{ k: "action", area: "actuator", id: "abcd000000000001", ns }],
            children: [],
          },
        ],
      },
    ],
  };
}

/** A persisted brain referencing platform tiles only. */
function platformBrainJson(): Record<string, unknown> {
  return {
    version: 1,
    id: "brain00000000002",
    name: "Platform Brain",
    catalog: [],
    pages: [
      {
        version: 2,
        pageId: "page000000000002",
        name: "Page 1",
        rules: [{ version: 1, when: ["tile.actuator->core.say"], do: [], children: [] }],
      },
    ],
  };
}

describe("collectLibraryUninstallImpact", () => {
  it("names a brain directly using a tile of the uninstalled library", () => {
    const impact = collectLibraryUninstallImpact({
      extensions: EXTENSIONS,
      coordinate: CUTEBOT,
      embedded: EMBEDDED,
      brains: [{ name: "Driver", json: brainJsonUsing(CUTEBOT) }],
    });
    assert.ok(impact.leavingNamespaces.has(CUTEBOT));
    assert.deepEqual(impact.brainNames, ["Driver"]);
    assert.deepEqual(impact.filePaths, []);
  });

  it("names a brain using only a transitive dependency that leaves the closure", () => {
    const impact = collectLibraryUninstallImpact({
      extensions: EXTENSIONS,
      coordinate: CUTEBOT,
      embedded: EMBEDDED,
      brains: [{ name: "Locator", json: brainJsonUsing(POSITION) }],
    });
    assert.ok(impact.leavingNamespaces.has(POSITION), "the transitive dependency leaves with its dependent");
    assert.deepEqual(impact.brainNames, ["Locator"]);
  });

  it("does not count a transitive dependency another dependent keeps in the closure", () => {
    const embeddedWithSharedDep = [
      embedded(CUTEBOT, { [POSITION]: `embedded:${POSITION}` }),
      embedded(POSITION),
      embedded(OTHER, { [POSITION]: `embedded:${POSITION}` }),
    ];
    const impact = collectLibraryUninstallImpact({
      extensions: EXTENSIONS,
      coordinate: CUTEBOT,
      embedded: embeddedWithSharedDep,
      brains: [{ name: "Locator", json: brainJsonUsing(POSITION) }],
    });
    assert.equal(impact.leavingNamespaces.has(POSITION), false, "the other dependent still pulls the dependency in");
    assert.deepEqual(impact.brainNames, []);
  });

  it("names a user content file importing the uninstalled library through @lib", () => {
    const impact = collectLibraryUninstallImpact({
      extensions: EXTENSIONS,
      coordinate: CUTEBOT,
      embedded: EMBEDDED,
      brains: [],
      files: new Map([
        ["src/drive.ts", `import { drive } from "@lib/${CUTEBOT}";\n`],
        ["src/main.ts", `import { helper } from "@lib/${OTHER}";\n`],
      ]),
    });
    assert.deepEqual(impact.filePaths, ["src/drive.ts"]);
  });

  it("reports nothing when no brain or file uses a leaving namespace", () => {
    const impact = collectLibraryUninstallImpact({
      extensions: EXTENSIONS,
      coordinate: CUTEBOT,
      embedded: EMBEDDED,
      brains: [
        { name: "Platform Brain", json: platformBrainJson() },
        { name: "Other User", json: brainJsonUsing(OTHER) },
      ],
      files: new Map([["src/main.ts", `import { helper } from "@lib/${OTHER}";\n`]]),
    });
    assert.deepEqual(impact.brainNames, []);
    assert.deepEqual(impact.filePaths, []);
  });
});

describe("runGuardedLibraryUninstall", () => {
  it("uninstalls without confirming when nothing is in use", async () => {
    const calls: string[] = [];
    const outcome = await runGuardedLibraryUninstall({
      impact: { brainNames: [], filePaths: [] },
      confirmRemoval: () => {
        calls.push("confirm");
        return true;
      },
      uninstall: () => {
        calls.push("uninstall");
      },
    });
    assert.equal(outcome, "removed");
    assert.deepEqual(calls, ["uninstall"]);
  });

  it("confirms before uninstalling an in-use library and proceeds on yes", async () => {
    const calls: string[] = [];
    const outcome = await runGuardedLibraryUninstall({
      impact: { brainNames: ["Driver"], filePaths: [] },
      confirmRemoval: () => {
        calls.push("confirm");
        return Promise.resolve(true);
      },
      uninstall: () => {
        calls.push("uninstall");
      },
    });
    assert.equal(outcome, "removed");
    assert.deepEqual(calls, ["confirm", "uninstall"]);
  });

  it("cancels without uninstalling when confirmation is declined", async () => {
    const calls: string[] = [];
    const outcome = await runGuardedLibraryUninstall({
      impact: { brainNames: [], filePaths: ["src/drive.ts"] },
      confirmRemoval: () => {
        calls.push("confirm");
        return false;
      },
      uninstall: () => {
        calls.push("uninstall");
      },
    });
    assert.equal(outcome, "cancelled");
    assert.deepEqual(calls, ["confirm"]);
  });
});
