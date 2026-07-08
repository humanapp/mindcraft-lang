import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EmbeddedExtension, ExtensionCatalogEntry } from "@mindcraft-lang/bridge-app";
import { ExtensionActionResultCode } from "@mindcraft-lang/bridge-app";
import {
  buildSimExtensionEntries,
  type ExtensionProjectPersistence,
  githubDocsUrl,
  installSimExtension,
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

/** A persistence double capturing every `updateActive` extensions patch. */
function capturingPersistence(): ExtensionProjectPersistence & { patches: Array<Record<string, string> | undefined> } {
  const patches: Array<Record<string, string> | undefined> = [];
  return {
    patches,
    updateActive: async (updates) => {
      patches.push(updates.extensions as Record<string, string> | undefined);
    },
  };
}

describe("buildSimExtensionEntries -- catalog build and adaptation", () => {
  test("lists the locked sim layer and the compatible add-on, each with a derived docs URL", () => {
    const entries = buildSimExtensionEntries(project, embedRecord);
    assert.deepEqual(entries.map((e) => e.coordinate).sort(), [SIM_LIB_COORDINATE, FLOCK].sort());

    const sim = entries.find((e) => e.coordinate === SIM_LIB_COORDINATE);
    assert.ok(sim);
    assert.equal(sim.locked, true);
    assert.equal(sim.installed, true);
    assert.equal(sim.docsUrl, `https://github.com/${SIM_LIB_COORDINATE}`);

    const flock = entries.find((e) => e.coordinate === FLOCK);
    assert.ok(flock);
    assert.equal(flock.locked, false);
    assert.equal(flock.installed, false);
    assert.equal(flock.name, "Flock");
    assert.equal(flock.thumbnailUrl, "data:,flock");
    assert.equal(flock.docsUrl, `https://github.com/${FLOCK}`);
  });

  test("excludes the transitive core lib and an add-on targeting another platform", () => {
    const entries = buildSimExtensionEntries(project, embedRecord);
    const coordinates = entries.map((e) => e.coordinate);
    assert.equal(coordinates.includes(CORE_LIB_COORDINATE), false);
    assert.equal(coordinates.includes(MICROBIT_ONLY), false);
  });
});

describe("toExtensionBrowserEntry", () => {
  test("derives the docs URL and passes through a declared thumbnail", () => {
    const catalogEntry: ExtensionCatalogEntry = {
      coordinate: FLOCK,
      name: "Flock",
      version: "1.0.0",
      thumbnailUrl: "data:,flock",
      installed: false,
      locked: false,
    };
    assert.deepEqual(toExtensionBrowserEntry(catalogEntry), {
      coordinate: FLOCK,
      name: "Flock",
      version: "1.0.0",
      thumbnailUrl: "data:,flock",
      installed: false,
      locked: false,
      docsUrl: `https://github.com/${FLOCK}`,
    });
  });

  test("omits the thumbnail when the catalog entry declares none", () => {
    const catalogEntry: ExtensionCatalogEntry = {
      coordinate: SIM_LIB_COORDINATE,
      name: "Sim",
      version: "0.1.0",
      installed: true,
      locked: true,
    };
    assert.equal("thumbnailUrl" in toExtensionBrowserEntry(catalogEntry), false);
  });

  test("githubDocsUrl builds the repository URL", () => {
    assert.equal(githubDocsUrl(FLOCK), "https://github.com/mindcraft-lang/sim-flock");
  });
});

describe("installSimExtension -- round-trips through updateActive", () => {
  test("installing an add-on persists an extensions map that gains the coordinate", async () => {
    const persistence = capturingPersistence();
    const result = await installSimExtension(persistence, project, FLOCK, embedRecord);
    assert.equal(result.ok, true);
    assert.equal(result.code, ExtensionActionResultCode.INSTALLED);
    assert.equal(persistence.patches.length, 1);
    assert.equal(persistence.patches[0]?.[FLOCK], `embedded:${FLOCK}`);
    assert.equal(persistence.patches[0]?.[SIM_LIB_COORDINATE], SIM_LIB_REFERENCE);
  });

  test("installing an already-present coordinate does not persist", async () => {
    const persistence = capturingPersistence();
    const result = await installSimExtension(persistence, project, SIM_LIB_COORDINATE, embedRecord);
    assert.equal(result.ok, false);
    assert.equal(result.code, ExtensionActionResultCode.ALREADY_INSTALLED);
    assert.equal(persistence.patches.length, 0);
  });
});

describe("uninstallSimExtension -- round-trips through updateActive", () => {
  const withFlock = { ...project, [FLOCK]: `embedded:${FLOCK}` };

  test("uninstalling an add-on persists an extensions map that loses the coordinate", async () => {
    const persistence = capturingPersistence();
    const result = await uninstallSimExtension(persistence, withFlock, FLOCK);
    assert.equal(result.ok, true);
    assert.equal(result.code, ExtensionActionResultCode.UNINSTALLED);
    assert.equal(persistence.patches.length, 1);
    assert.equal(FLOCK in (persistence.patches[0] ?? {}), false);
    assert.equal(persistence.patches[0]?.[SIM_LIB_COORDINATE], SIM_LIB_REFERENCE);
  });

  test("uninstalling a locked layer library is rejected and does not persist", async () => {
    const persistence = capturingPersistence();
    const result = await uninstallSimExtension(persistence, project, SIM_LIB_COORDINATE);
    assert.equal(result.ok, false);
    assert.equal(result.code, ExtensionActionResultCode.LOCKED);
    assert.equal(persistence.patches.length, 0);
  });
});
