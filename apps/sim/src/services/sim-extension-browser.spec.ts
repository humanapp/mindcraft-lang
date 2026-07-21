import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ExtensionAddInputErrorCode,
  ExtensionFetchErrorCode,
  resolveExtensionAddInput,
} from "@mindcraft-lang/app-host";
import type { EmbeddedExtension, ExtensionCatalogEntry } from "@mindcraft-lang/bridge-app";
import { ExtensionActionResultCode } from "@mindcraft-lang/bridge-app";
import {
  buildSimExtensionEntries,
  checkSimExtensionUpdates,
  type ExtensionProjectPersistence,
  type ExtensionReferenceInstallSurface,
  installSimExtension,
  installSimExtensionReference,
  installSimReference,
  simLibraryCatalog,
  simLibraryDisplayName,
  toExtensionBrowserEntry,
  uninstallSimExtension,
} from "./sim-extension-browser";
import { CORE_LIB_COORDINATE, SIM_LIB_COORDINATE, SIM_LIB_REFERENCE } from "./sim-extension-coordinates";

/** Build an embedded extension whose bundled `mindcraft.json` declares the given manifest fields. */
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
        path: "mindcraft.json",
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

const FLOCK = "mindcraft-lang/sim-flock";
const MICROBIT_ONLY = "mindcraft-lang/microbit-position";

const coreLib = ext(CORE_LIB_COORDINATE, { name: "Core", version: "0.2.1" });
const simLib = ext(SIM_LIB_COORDINATE, {
  name: "Sim",
  version: "0.1.0",
  extensions: { [CORE_LIB_COORDINATE]: `embedded:${CORE_LIB_COORDINATE}` },
});
/** A sim-compatible add-on carrying a thumbnail. */
const flockAddon = ext(FLOCK, {
  name: "Flock",
  version: "1.0.0",
  thumbnailUrl: "data:,flock",
  targets: { [SIM_LIB_COORDINATE]: { packageVersion: "^0.1.0" } },
});
/** An add-on targeting a platform this stack does not carry. */
const microbitAddon = ext(MICROBIT_ONLY, {
  name: "Position",
  version: "1.0.0",
  targets: { "mindcraft-lang/microbit-v2": { packageVersion: "^0.2.0" } },
});

const embedRecord: readonly EmbeddedExtension[] = [simLib, coreLib, flockAddon, microbitAddon];
const project = { [SIM_LIB_COORDINATE]: SIM_LIB_REFERENCE };

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

describe("buildSimExtensionEntries -- direct dependencies adapted to browser entries", () => {
  test("lists nothing for a fresh project: the platform layer is not an entry card", () => {
    const entries = buildSimExtensionEntries(project, embedRecord);
    assert.deepEqual(
      entries.map((e) => e.coordinate),
      []
    );
  });

  test("lists a directly-installed embedded add-on as an installed entry with no repository URL", () => {
    const withFlock = { ...project, [FLOCK]: `embedded:${FLOCK}` };
    const entries = buildSimExtensionEntries(withFlock, embedRecord);
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
    const entries = buildSimExtensionEntries(project, embedRecord);
    const coordinates = entries.map((e) => e.coordinate);
    assert.equal(coordinates.includes(SIM_LIB_COORDINATE), false);
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
      coordinate: SIM_LIB_COORDINATE,
      name: "Sim",
      version: "0.1.0",
      installed: true,
    };
    assert.equal("thumbnailUrl" in toExtensionBrowserEntry(catalogEntry), false);
  });
});

describe("installSimExtension -- round-trips through the host", () => {
  test("installing an add-on persists an extensions map that gains the coordinate", async () => {
    const persistence = capturingPersistence();
    const result = await installSimExtension(persistence, project, FLOCK, embedRecord);
    assert.equal(result.action.ok, true);
    assert.equal(result.action.code, ExtensionActionResultCode.INSTALLED);
    assert.equal(persistence.patches.length, 1);
    assert.equal(persistence.patches[0]?.[FLOCK], `embedded:${FLOCK}`);
    assert.equal(persistence.patches[0]?.[SIM_LIB_COORDINATE], SIM_LIB_REFERENCE);
  });

  test("installing an already-present coordinate does not persist", async () => {
    const persistence = capturingPersistence();
    const result = await installSimExtension(persistence, project, SIM_LIB_COORDINATE, embedRecord);
    assert.equal(result.action.ok, false);
    assert.equal(result.action.code, ExtensionActionResultCode.ALREADY_INSTALLED);
    assert.equal(persistence.patches.length, 0);
  });
});

describe("uninstallSimExtension -- round-trips through the host", () => {
  const withFlock = { ...project, [FLOCK]: `embedded:${FLOCK}` };

  test("uninstalling an add-on persists an extensions map that loses the coordinate", async () => {
    const persistence = capturingPersistence();
    const result = await uninstallSimExtension(persistence, withFlock, FLOCK, embedRecord);
    assert.equal(result.action.ok, true);
    assert.equal(result.action.code, ExtensionActionResultCode.UNINSTALLED);
    assert.equal(persistence.patches.length, 1);
    assert.equal(FLOCK in (persistence.patches[0] ?? {}), false);
    assert.equal(persistence.patches[0]?.[SIM_LIB_COORDINATE], SIM_LIB_REFERENCE);
  });

  test("uninstalling a locked layer library is rejected and does not persist", async () => {
    const persistence = capturingPersistence();
    const result = await uninstallSimExtension(persistence, project, SIM_LIB_COORDINATE, embedRecord);
    assert.equal(result.action.ok, false);
    assert.equal(result.action.code, ExtensionActionResultCode.LOCKED);
    assert.equal(persistence.patches.length, 0);
  });

  test("uninstalling a coordinate a still-installed add-on depends on is rejected and does not persist", async () => {
    const persistence = capturingPersistence();
    // A depending add-on that requires Flock; both installed.
    const HERD = "mindcraft-lang/sim-herd";
    const herdAddon = ext(HERD, {
      name: "Herd",
      version: "1.0.0",
      targets: { [SIM_LIB_COORDINATE]: { packageVersion: "^0.1.0" } },
      extensions: { [FLOCK]: `embedded:${FLOCK}` },
    });
    const withDependent = { ...withFlock, [HERD]: `embedded:${HERD}` };
    const result = await uninstallSimExtension(persistence, withDependent, FLOCK, [...embedRecord, herdAddon]);
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

describe("installSimExtensionReference -- generous input through the host", () => {
  test("adding a complete gh reference persists it unchanged, keyed by its coordinate", async () => {
    const surface = referenceInstallSurface();
    const result = await installSimExtensionReference(surface, project, "gh:example-org/teleport-ext@v0.1.0");
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
    const result = await installSimExtensionReference(surface, project, "https://github.com/example-org/teleport-ext");
    assert.ok(result.ok);
    assert.equal(result.reference, "gh:example-org/teleport-ext@0.2.0");
    assert.equal(result.action.ok, true);
    assert.equal(surface.patches.length, 1);
    assert.equal(surface.patches[0]?.["example-org/teleport-ext"], "gh:example-org/teleport-ext@0.2.0");
  });

  test("a repository with no published versions is rejected with its code and does not persist", async () => {
    const surface = referenceInstallSurface();
    const result = await installSimExtensionReference(surface, project, "example-org/teleport-ext");
    assert.ok(!result.ok);
    assert.equal(result.code, ExtensionFetchErrorCode.VERSIONS_NOT_FOUND);
    assert.equal(surface.patches.length, 0);
  });

  test("unrecognized input is rejected with its code and does not persist", async () => {
    const surface = referenceInstallSurface();
    const result = await installSimExtensionReference(surface, project, "ffff:x");
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

describe("installSimReference -- routes by transport", () => {
  test("an embedded offer ref installs by writing embedded:<coord> to the map", async () => {
    const surface = referenceInstallSurface();
    const result = await installSimReference(surface, project, embedRecord, `embedded:${FLOCK}`);
    assert.ok(result.ok);
    assert.equal(result.action.ok, true);
    assert.equal(result.action.code, ExtensionActionResultCode.INSTALLED);
    assert.equal(result.action.extensions[FLOCK], `embedded:${FLOCK}`);
    assert.equal(surface.patches[0]?.[FLOCK], `embedded:${FLOCK}`);
  });

  test("a gh reference routes through the remote installer and writes gh:", async () => {
    const surface = referenceInstallSurface();
    const result = await installSimReference(surface, project, embedRecord, "gh:example-org/teleport-ext@v0.1.0");
    assert.ok(result.ok);
    assert.equal(result.action.ok, true);
    assert.equal(surface.patches[0]?.["example-org/teleport-ext"], "gh:example-org/teleport-ext@v0.1.0");
  });
});

describe("simLibraryDisplayName", () => {
  test("prefers the installed library's manifest name", () => {
    const name = simLibraryDisplayName([{ coordinate: FLOCK, name: "Flock" }], FLOCK);
    assert.equal(name, "Flock");
  });

  test("falls back to the bundled catalog entry's name when not installed", () => {
    const entry = simLibraryCatalog.entries[0];
    assert.ok(entry, "the bundled catalog carries at least one entry");
    const name = simLibraryDisplayName([], entry.coordinate);
    assert.equal(name, entry.name);
  });

  test("falls back to the coordinate when nothing names the library", () => {
    const name = simLibraryDisplayName([], "example-org/unknown-lib");
    assert.equal(name, "example-org/unknown-lib");
  });
});
