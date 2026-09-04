import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ExtensionAddInputErrorCode, ExtensionFetchErrorCode, resolveExtensionAddInput } from "@wendoo/app-host";
import type { EmbeddedExtension, ExtensionCatalogEntry, LibraryOfferToasts } from "@wendoo/bridge-app";
import { ExtensionActionResultCode } from "@wendoo/bridge-app";
import {
  addEcosimLibrary,
  buildEcosimExtensionEntries,
  checkSimExtensionUpdates,
  type ExtensionProjectPersistence,
  type ExtensionReferenceInstallSurface,
  ecosimLibraryCatalog,
  ecosimLibraryDisplayName,
  installEcosimExtension,
  installEcosimExtensionReference,
  installEcosimReference,
  type LibraryOfferInstallHost,
  toExtensionBrowserEntry,
  uninstallEcosimExtension,
} from "./ecosim-extension-browser";
import { CORE_LIB_COORDINATE, ECOSIM_LIB_COORDINATE, ECOSIM_LIB_REFERENCE } from "./ecosim-extension-coordinates";

/** Build an embedded extension whose bundled `wendoo.json` declares the given manifest fields. */
function ext(
  coordinate: string,
  manifest: {
    name?: string;
    version?: string;
    extensions?: Record<string, string>;
    targets?: Record<string, { packageVersion: string }>;
    thumbnailUrl?: string;
  }
): EmbeddedExtension {
  return {
    canonicalOrigin: coordinate,
    files: [
      { path: "index.ts", content: "export {};" },
      {
        path: "wendoo.json",
        content: JSON.stringify({
          name: manifest.name ?? coordinate,
          version: manifest.version ?? "1.0.0",
          ...(manifest.thumbnailUrl !== undefined ? { thumbnailUrl: manifest.thumbnailUrl } : {}),
          ...(manifest.extensions !== undefined ? { extensions: manifest.extensions } : {}),
          ...(manifest.targets !== undefined ? { targets: manifest.targets } : {}),
        }),
      },
    ],
  };
}

const FLOCK = "wendoo-lang/lib-ecosim-flock";
const MICROBIT_ONLY = "wendoo-lang/microbit-position";

const coreLib = ext(CORE_LIB_COORDINATE, { name: "Core", version: "0.2.1" });
const ecosimLib = ext(ECOSIM_LIB_COORDINATE, {
  name: "Sim",
  version: "0.1.0",
  extensions: { [CORE_LIB_COORDINATE]: `embedded:${CORE_LIB_COORDINATE}` },
});
/** A sim-compatible add-on carrying a thumbnail. */
const flockAddon = ext(FLOCK, {
  name: "Flock",
  version: "1.0.0",
  thumbnailUrl: "data:,flock",
  targets: { [ECOSIM_LIB_COORDINATE]: { packageVersion: "^0.1.0" } },
});
/** An add-on targeting a platform this stack does not carry. */
const microbitAddon = ext(MICROBIT_ONLY, {
  name: "Position",
  version: "1.0.0",
  targets: { "wendoo-lang/microbit-v2": { packageVersion: "^0.2.0" } },
});

const embedRecord: readonly EmbeddedExtension[] = [ecosimLib, coreLib, flockAddon, microbitAddon];
const project = { [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE };

/** A persistence double capturing every extensions map applied through the host. */
function capturingPersistence(): ExtensionProjectPersistence & { patches: Array<Record<string, string> | undefined> } {
  const patches: Array<Record<string, string> | undefined> = [];
  return {
    patches,
    updateProjectExtensions: async (extensions) => {
      patches.push(extensions);
      return {
        committed: true,
        outcome: { kind: "unchanged" as const, newProblems: [], resolvedProblems: [] },
        warnings: [],
      };
    },
  };
}

describe("buildEcosimExtensionEntries -- direct dependencies adapted to browser entries", () => {
  test("lists nothing for a fresh project: the platform layer is not an entry card", () => {
    const entries = buildEcosimExtensionEntries(project, embedRecord);
    assert.deepEqual(
      entries.map((e) => e.coordinate),
      []
    );
  });

  test("lists a directly-installed embedded add-on as an installed entry with no repository URL", () => {
    const withFlock = { ...project, [FLOCK]: `embedded:${FLOCK}` };
    const entries = buildEcosimExtensionEntries(withFlock, embedRecord);
    assert.deepEqual(
      entries.map((e) => e.coordinate),
      [FLOCK]
    );

    const flock = entries.find((e) => e.coordinate === FLOCK);
    assert.ok(flock);
    assert.equal(flock.installed, true);
    assert.equal(flock.name, "Flock");
    assert.equal(flock.thumbnailUrl, "data:,flock");
    // An embedded add-on's coordinate is not a GitHub repository, so it carries no repoUrl.
    assert.equal("repoUrl" in flock, false);
  });

  test("excludes the platform layer, the transitive core lib, and every non-referenced add-on", () => {
    const entries = buildEcosimExtensionEntries(project, embedRecord);
    const coordinates = entries.map((e) => e.coordinate);
    assert.equal(coordinates.includes(ECOSIM_LIB_COORDINATE), false);
    assert.equal(coordinates.includes(CORE_LIB_COORDINATE), false);
    assert.equal(coordinates.includes(FLOCK), false);
    assert.equal(coordinates.includes(MICROBIT_ONLY), false);
  });
});

describe("toExtensionBrowserEntry", () => {
  test("carries a repository URL and thumbnail through when the catalog entry declares them", () => {
    const catalogEntry: ExtensionCatalogEntry = {
      coordinate: FLOCK,
      name: "Flock",
      version: "1.0.0",
      thumbnailUrl: "data:,flock",
      installed: false,
      repoUrl: `https://github.com/${FLOCK}`,
    };
    assert.deepEqual(toExtensionBrowserEntry(catalogEntry), {
      coordinate: FLOCK,
      name: "Flock",
      version: "1.0.0",
      thumbnailUrl: "data:,flock",
      installed: false,
      repoUrl: `https://github.com/${FLOCK}`,
    });
  });

  test("omits the repository URL when the catalog entry declares none", () => {
    const catalogEntry: ExtensionCatalogEntry = {
      coordinate: FLOCK,
      name: "Flock",
      version: "1.0.0",
      installed: false,
    };
    assert.equal("repoUrl" in toExtensionBrowserEntry(catalogEntry), false);
  });

  test("omits the thumbnail when the catalog entry declares none", () => {
    const catalogEntry: ExtensionCatalogEntry = {
      coordinate: ECOSIM_LIB_COORDINATE,
      name: "Sim",
      version: "0.1.0",
      installed: true,
    };
    assert.equal("thumbnailUrl" in toExtensionBrowserEntry(catalogEntry), false);
  });
});

describe("installEcosimExtension -- round-trips through the host", () => {
  test("installing an add-on persists an extensions map that gains the coordinate", async () => {
    const persistence = capturingPersistence();
    const result = await installEcosimExtension(persistence, project, FLOCK, embedRecord);
    assert.equal(result.action.ok, true);
    assert.equal(result.action.code, ExtensionActionResultCode.INSTALLED);
    assert.equal(persistence.patches.length, 1);
    assert.equal(persistence.patches[0]?.[FLOCK], `embedded:${FLOCK}`);
    assert.equal(persistence.patches[0]?.[ECOSIM_LIB_COORDINATE], ECOSIM_LIB_REFERENCE);
  });

  test("installing an already-present coordinate does not persist", async () => {
    const persistence = capturingPersistence();
    const result = await installEcosimExtension(persistence, project, ECOSIM_LIB_COORDINATE, embedRecord);
    assert.equal(result.action.ok, false);
    assert.equal(result.action.code, ExtensionActionResultCode.ALREADY_INSTALLED);
    assert.equal(persistence.patches.length, 0);
  });
});

describe("uninstallEcosimExtension -- round-trips through the host", () => {
  const withFlock = { ...project, [FLOCK]: `embedded:${FLOCK}` };

  test("uninstalling an add-on persists an extensions map that loses the coordinate", async () => {
    const persistence = capturingPersistence();
    const result = await uninstallEcosimExtension(persistence, withFlock, FLOCK, embedRecord);
    assert.equal(result.action.ok, true);
    assert.equal(result.action.code, ExtensionActionResultCode.UNINSTALLED);
    assert.equal(persistence.patches.length, 1);
    assert.equal(FLOCK in (persistence.patches[0] ?? {}), false);
    assert.equal(persistence.patches[0]?.[ECOSIM_LIB_COORDINATE], ECOSIM_LIB_REFERENCE);
  });

  test("uninstalling a locked layer library is rejected and does not persist", async () => {
    const persistence = capturingPersistence();
    const result = await uninstallEcosimExtension(persistence, project, ECOSIM_LIB_COORDINATE, embedRecord);
    assert.equal(result.action.ok, false);
    assert.equal(result.action.code, ExtensionActionResultCode.LOCKED);
    assert.equal(persistence.patches.length, 0);
  });

  test("uninstalling a coordinate a still-installed add-on depends on is rejected and does not persist", async () => {
    const persistence = capturingPersistence();
    // A depending add-on that requires Flock; both installed.
    const HERD = "wendoo-lang/lib-ecosim-herd";
    const herdAddon = ext(HERD, {
      name: "Herd",
      version: "1.0.0",
      targets: { [ECOSIM_LIB_COORDINATE]: { packageVersion: "^0.1.0" } },
      extensions: { [FLOCK]: `embedded:${FLOCK}` },
    });
    const withDependent = { ...withFlock, [HERD]: `embedded:${HERD}` };
    const result = await uninstallEcosimExtension(persistence, withDependent, FLOCK, [...embedRecord, herdAddon]);
    assert.equal(result.action.ok, false);
    assert.equal(result.action.code, ExtensionActionResultCode.REQUIRED_BY_DEPENDENT);
    assert.equal(persistence.patches.length, 0);
  });
});

/**
 * An install surface running real input normalization over a stub version
 * listing, capturing every extensions map applied through the host.
 */
function referenceInstallSurface(
  versions: Record<string, readonly string[]> = {}
): ExtensionReferenceInstallSurface & { patches: Array<Record<string, string> | undefined> } {
  return {
    ...capturingPersistence(),
    resolveExtensionInstallInput: (input: string) =>
      resolveExtensionAddInput(input, {
        async fetchFile() {
          return { ok: false, kind: "not-found" };
        },
        async resolveBranch() {
          return { ok: false, kind: "not-found" };
        },
        async listVersionTags(owner: string, repo: string) {
          const listed = versions[`${owner}/${repo}`];
          return listed !== undefined ? { ok: true, versions: listed } : { ok: false, kind: "not-found" };
        },
      }),
  };
}

describe("installEcosimExtensionReference -- generous input through the host", () => {
  test("adding a complete gh reference persists it unchanged, keyed by its coordinate", async () => {
    const surface = referenceInstallSurface();
    const result = await installEcosimExtensionReference(surface, project, "gh:example-org/teleport-ext@v0.1.0");
    assert.ok(result.ok);
    assert.equal(result.reference, "gh:example-org/teleport-ext@v0.1.0");
    assert.equal(result.action.ok, true);
    assert.equal(result.action.code, ExtensionActionResultCode.INSTALLED);
    assert.ok(result.report);
    assert.equal(surface.patches.length, 1);
    assert.equal(surface.patches[0]?.["example-org/teleport-ext"], "gh:example-org/teleport-ext@v0.1.0");
  });

  test("pasting a GitHub repository URL resolves the latest published version and persists the resolved reference", async () => {
    const surface = referenceInstallSurface({ "example-org/teleport-ext": ["0.1.0", "0.2.0"] });
    const result = await installEcosimExtensionReference(
      surface,
      project,
      "https://github.com/example-org/teleport-ext"
    );
    assert.ok(result.ok);
    assert.equal(result.reference, "gh:example-org/teleport-ext@0.2.0");
    assert.equal(result.action.ok, true);
    assert.equal(surface.patches.length, 1);
    assert.equal(surface.patches[0]?.["example-org/teleport-ext"], "gh:example-org/teleport-ext@0.2.0");
  });

  test("a repository with no published versions is rejected with its code and does not persist", async () => {
    const surface = referenceInstallSurface();
    const result = await installEcosimExtensionReference(surface, project, "example-org/teleport-ext");
    assert.ok(!result.ok);
    assert.equal(result.code, ExtensionFetchErrorCode.VERSIONS_NOT_FOUND);
    assert.equal(surface.patches.length, 0);
  });

  test("unrecognized input is rejected with its code and does not persist", async () => {
    const surface = referenceInstallSurface();
    const result = await installEcosimExtensionReference(surface, project, "ffff:x");
    assert.ok(!result.ok);
    assert.equal(result.code, ExtensionAddInputErrorCode.UNRECOGNIZED);
    assert.equal(surface.patches.length, 0);
  });
});

describe("toExtensionBrowserEntry -- fetched-dependency annotations", () => {
  test("passes updatable, broken, and identityMismatch through to the view model", () => {
    const catalogEntry: ExtensionCatalogEntry = {
      coordinate: "example-org/position-ext",
      name: "Position",
      version: "0.1.0",
      installed: true,
      updatable: true,
      broken: { code: "EXTENSION_FETCH_UNREACHABLE", message: "The source is unreachable: refused" },
      identityMismatch: { declaredIdentity: "upstream-org/position-ext" },
    };
    const entry = toExtensionBrowserEntry(catalogEntry);
    assert.equal(entry.updatable, true);
    assert.deepEqual(entry.broken, {
      code: "EXTENSION_FETCH_UNREACHABLE",
      message: "The source is unreachable: refused",
    });
    assert.deepEqual(entry.identityMismatch, { declaredIdentity: "upstream-org/position-ext" });
  });
});

describe("checkSimExtensionUpdates", () => {
  test("buckets available updates, current dependencies, and failed checks", async () => {
    const surface = {
      checkExtensionUpdate: async (coordinate: string) => {
        if (coordinate === "example-org/current-ext") {
          return { ok: true as const, updateAvailable: false as const };
        }
        if (coordinate === "example-org/stale-ext") {
          return {
            ok: true as const,
            updateAvailable: true as const,
            update: {
              coordinate,
              reference: "gh:example-org/stale-ext@0.2.0",
              latestVersion: "0.2.0",
            },
          };
        }
        return {
          ok: false as const,
          error: {
            code: "EXTENSION_FETCH_UNREACHABLE" as const,
            reference: coordinate,
            message: "The source is unreachable: refused",
          },
        };
      },
    };

    const summary = await checkSimExtensionUpdates(surface, [
      "example-org/current-ext",
      "example-org/stale-ext",
      "example-org/offline-ext",
    ]);

    assert.deepEqual(summary.current, ["example-org/current-ext"]);
    assert.deepEqual(
      summary.updates.map((update) => update.reference),
      ["gh:example-org/stale-ext@0.2.0"]
    );
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.failures[0].coordinate, "example-org/offline-ext");
    assert.equal(summary.failures[0].error.code, "EXTENSION_FETCH_UNREACHABLE");
  });
});

describe("installEcosimReference -- routes by transport", () => {
  test("an embedded offer ref installs by writing embedded:<coord> to the map", async () => {
    const surface = referenceInstallSurface();
    const result = await installEcosimReference(surface, project, embedRecord, `embedded:${FLOCK}`);
    assert.ok(result.ok);
    assert.equal(result.action.ok, true);
    assert.equal(result.action.code, ExtensionActionResultCode.INSTALLED);
    assert.equal(result.action.extensions[FLOCK], `embedded:${FLOCK}`);
    assert.equal(surface.patches[0]?.[FLOCK], `embedded:${FLOCK}`);
  });

  test("a gh reference routes through the remote installer and writes gh:", async () => {
    const surface = referenceInstallSurface();
    const result = await installEcosimReference(surface, project, embedRecord, "gh:example-org/teleport-ext@v0.1.0");
    assert.ok(result.ok);
    assert.equal(result.action.ok, true);
    assert.equal(surface.patches[0]?.["example-org/teleport-ext"], "gh:example-org/teleport-ext@v0.1.0");
  });
});

describe("ecosimLibraryDisplayName", () => {
  test("prefers the installed library's manifest name", () => {
    const name = ecosimLibraryDisplayName([{ coordinate: FLOCK, name: "Flock" }], FLOCK);
    assert.equal(name, "Flock");
  });

  test("falls back to the bundled catalog entry's name when not installed", () => {
    const entry = ecosimLibraryCatalog.entries[0];
    assert.ok(entry, "the bundled catalog carries at least one entry");
    const name = ecosimLibraryDisplayName([], entry.coordinate);
    assert.equal(name, entry.name);
  });

  test("falls back to the coordinate when nothing names the library", () => {
    const name = ecosimLibraryDisplayName([], "example-org/unknown-lib");
    assert.equal(name, "example-org/unknown-lib");
  });
});

describe("addEcosimLibrary -- an offer the assistant made, added through the app's own install", () => {
  /** The first library the bundled catalog shelves, which every offer here names. */
  const shelved = ecosimLibraryCatalog.entries[0];

  /** An install host over an embed record carrying the shelved library, naming nothing installed yet. */
  function offerHost(versions: Record<string, readonly string[]> = {}): LibraryOfferInstallHost & {
    patches: Array<Record<string, string> | undefined>;
  } {
    return { ...referenceInstallSurface(versions), installedLibraries: [] };
  }

  /** A toast surface recording the kind of every outcome presented through it. */
  function recordingToasts(): { toasts: LibraryOfferToasts; kinds: string[] } {
    const kinds: string[] = [];
    return {
      kinds,
      toasts: {
        failed: () => kinds.push("failed"),
        confirmed: () => kinds.push("confirmed"),
        worsened: () => kinds.push("worsened"),
      },
    };
  }

  test("installs the reference the bundled catalog approves, through the transaction the browser uses", async () => {
    assert.ok(shelved, "the bundled catalog shelves at least one library");
    const host = offerHost();
    const { toasts, kinds } = recordingToasts();

    const held = await addEcosimLibrary(
      host,
      project,
      [...embedRecord, ext(shelved.coordinate, { name: shelved.name })],
      shelved.coordinate,
      toasts
    );

    assert.equal(held, true);
    assert.equal(host.patches.length, 1);
    assert.equal(host.patches[0]?.[shelved.coordinate], shelved.ref);
    assert.deepEqual(kinds, ["confirmed"]);
  });

  test("refuses a coordinate the bundled catalog shelves nothing for, persisting nothing", async () => {
    const host = offerHost();
    const { toasts, kinds } = recordingToasts();

    const held = await addEcosimLibrary(host, project, embedRecord, "example-org/unshelved-lib", toasts);

    assert.equal(held, false);
    assert.deepEqual(host.patches, []);
    assert.deepEqual(kinds, ["failed"]);
  });
});
