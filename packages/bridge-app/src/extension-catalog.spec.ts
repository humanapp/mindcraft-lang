import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EmbeddedExtension } from "./embedded-extensions.js";
import { resolveEmbeddedExtensions } from "./embedded-extensions.js";
import type { ExtensionCatalogEntry, PlatformStackLayer } from "./extension-catalog.js";
import {
  buildExtensionCatalog,
  deriveProjectPlatformStack,
  ExtensionActionResultCode,
  installEmbeddedExtension,
  isExtensionCompatible,
  satisfiesRange,
  uninstallEmbeddedExtension,
} from "./extension-catalog.js";

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

const CORE = "mindcraft-lang/core";
const CODAL = "mindcraft-lang/codal";
const MICROBIT = "mindcraft-lang/microbit-v2";
const SIM = "mindcraft-lang/sim";
const POSITION = "mindcraft-lang/microbit-position";
const FLOCK = "mindcraft-lang/sim-flock";
const SHARED_MATH = "mindcraft-lang/shared-math";
const LEGACY = "mindcraft-lang/legacy-widget";

const coreLib = ext(CORE, { name: "Core", version: "0.2.1" });
const codalLib = ext(CODAL, { name: "Codal", version: "0.2.1", extensions: { [CORE]: `embedded:${CORE}` } });
const microbitLib = ext(MICROBIT, {
  name: "Micro:bit v2",
  version: "0.2.1",
  extensions: { [CODAL]: `embedded:${CODAL}` },
});
const simLib = ext(SIM, { name: "Sim", version: "0.1.0", extensions: { [CORE]: `embedded:${CORE}` } });

/** A compatible add-on targeting the micro:bit stack, carrying a thumbnail. */
const positionAddon = ext(POSITION, {
  name: "Position",
  version: "1.3.0",
  thumbnailUrl: "data:,pos",
  targets: { [MICROBIT]: { packageVersion: "^0.2.0" } },
});
/** A compatible add-on targeting the sim stack. */
const flockAddon = ext(FLOCK, { name: "Flock", version: "1.0.0", targets: { [SIM]: { packageVersion: "^0.1.0" } } });
/** An add-on targeting the shared core layer, compatible with every stack. */
const sharedMathAddon = ext(SHARED_MATH, {
  name: "Shared Math",
  version: "1.0.0",
  targets: { [CORE]: { packageVersion: "^0.2.0" } },
});
/** An add-on whose micro:bit target is in the micro:bit stack but at a version the range excludes. */
const legacyAddon = ext(LEGACY, {
  name: "Legacy Widget",
  version: "1.0.0",
  targets: { [MICROBIT]: { packageVersion: "^0.1.0" } },
});

const ADDONS = [positionAddon, flockAddon, sharedMathAddon, legacyAddon];

const microbitEmbedRecord: readonly EmbeddedExtension[] = [microbitLib, codalLib, coreLib, ...ADDONS];
const simEmbedRecord: readonly EmbeddedExtension[] = [simLib, coreLib, ...ADDONS];

const microbitLayers = new Set([CORE, CODAL, MICROBIT]);
const simLayers = new Set([CORE, SIM]);

const microbitProject = { [MICROBIT]: `embedded:${MICROBIT}` };
const simProject = { [SIM]: `embedded:${SIM}` };

function entryFor(entries: readonly ExtensionCatalogEntry[], coordinate: string): ExtensionCatalogEntry | undefined {
  return entries.find((entry) => entry.coordinate === coordinate);
}

function coordinatesOf(items: readonly { coordinate: string }[]): string[] {
  return items.map((item) => item.coordinate).sort();
}

describe("deriveProjectPlatformStack -- two platforms", () => {
  test("a micro:bit project's stack is core, codal, and microbit-v2 with their declared versions", () => {
    const stack = deriveProjectPlatformStack(microbitProject, microbitEmbedRecord, microbitLayers);
    assert.deepEqual(coordinatesOf(stack), [CODAL, CORE, MICROBIT]);
    assert.equal(stack.find((layer) => layer.coordinate === MICROBIT)?.version, "0.2.1");
    assert.equal(stack.find((layer) => layer.coordinate === CORE)?.version, "0.2.1");
  });

  test("an apps/sim project's stack is core and sim with their declared versions", () => {
    const stack = deriveProjectPlatformStack(simProject, simEmbedRecord, simLayers);
    assert.deepEqual(coordinatesOf(stack), [CORE, SIM]);
    assert.equal(stack.find((layer) => layer.coordinate === SIM)?.version, "0.1.0");
    assert.equal(stack.find((layer) => layer.coordinate === CORE)?.version, "0.2.1");
  });
});

describe("isExtensionCompatible -- stack inclusion and semver ranges", () => {
  const microbitStack = deriveProjectPlatformStack(microbitProject, microbitEmbedRecord, microbitLayers);
  const simStack = deriveProjectPlatformStack(simProject, simEmbedRecord, simLayers);

  test("a micro:bit-targeting add-on is compatible with the micro:bit stack and not the sim stack", () => {
    const targets = { [MICROBIT]: { packageVersion: "^0.2.0" } };
    assert.equal(isExtensionCompatible(targets, microbitStack), true);
    assert.equal(isExtensionCompatible(targets, simStack), false);
  });

  test("a sim-targeting add-on is compatible with the sim stack and not the micro:bit stack", () => {
    const targets = { [SIM]: { packageVersion: "^0.1.0" } };
    assert.equal(isExtensionCompatible(targets, simStack), true);
    assert.equal(isExtensionCompatible(targets, microbitStack), false);
  });

  test("a core-targeting add-on is universally compatible through stack inclusion", () => {
    const targets = { [CORE]: { packageVersion: "^0.2.0" } };
    assert.equal(isExtensionCompatible(targets, microbitStack), true);
    assert.equal(isExtensionCompatible(targets, simStack), true);
  });

  test("a target in the stack at a non-satisfying version is incompatible", () => {
    assert.equal(isExtensionCompatible({ [MICROBIT]: { packageVersion: "^0.1.0" } }, microbitStack), false);
  });

  test("an add-on that declares no targets is compatible with nothing", () => {
    assert.equal(isExtensionCompatible(undefined, microbitStack), false);
    assert.equal(isExtensionCompatible({}, microbitStack), false);
  });
});

describe("buildExtensionCatalog -- two platforms", () => {
  test("a micro:bit project lists its locked target lib plus directly-compatible add-ons", () => {
    const entries = buildExtensionCatalog(microbitProject, microbitEmbedRecord, microbitLayers);
    assert.deepEqual(coordinatesOf(entries), [MICROBIT, POSITION, SHARED_MATH].sort());

    const target = entryFor(entries, MICROBIT);
    assert.ok(target);
    assert.equal(target.locked, true);
    assert.equal(target.installed, true);
    assert.equal(target.name, "Micro:bit v2");
    assert.equal(target.version, "0.2.1");

    const position = entryFor(entries, POSITION);
    assert.ok(position);
    assert.equal(position.locked, false);
    assert.equal(position.installed, false);
    assert.equal(position.name, "Position");
    assert.equal(position.version, "1.3.0");
    assert.equal(position.thumbnailUrl, "data:,pos");
  });

  test("the micro:bit catalog excludes transitive layer libs, an incompatible add-on, and a version mismatch", () => {
    const entries = buildExtensionCatalog(microbitProject, microbitEmbedRecord, microbitLayers);
    assert.equal(entryFor(entries, CODAL), undefined);
    assert.equal(entryFor(entries, CORE), undefined);
    assert.equal(entryFor(entries, FLOCK), undefined);
    assert.equal(entryFor(entries, LEGACY), undefined);
  });

  test("an apps/sim project lists its own locked target lib plus its directly-compatible add-ons", () => {
    const entries = buildExtensionCatalog(simProject, simEmbedRecord, simLayers);
    assert.deepEqual(coordinatesOf(entries), [SIM, FLOCK, SHARED_MATH].sort());

    const target = entryFor(entries, SIM);
    assert.ok(target);
    assert.equal(target.locked, true);
    assert.equal(target.installed, true);

    assert.equal(entryFor(entries, POSITION), undefined);
    assert.equal(entryFor(entries, CORE), undefined);
  });

  test("installing an add-on flips its catalog entry to installed", () => {
    const installed = installEmbeddedExtension(microbitProject, microbitEmbedRecord, POSITION);
    assert.equal(installed.ok, true);
    const entries = buildExtensionCatalog(installed.extensions, microbitEmbedRecord, microbitLayers);
    assert.equal(entryFor(entries, POSITION)?.installed, true);
  });

  test("an add-on missing its manifest name falls back to its coordinate", () => {
    const noManifest: EmbeddedExtension = {
      canonicalOrigin: CORE,
      files: [{ path: "index.ts", content: "export {};" }],
    };
    const entries = buildExtensionCatalog(microbitProject, [microbitLib, codalLib, noManifest], microbitLayers);
    assert.equal(entryFor(entries, MICROBIT)?.name, "Micro:bit v2");
  });
});

describe("installEmbeddedExtension", () => {
  test("adds an embedded reference that then resolves into the closure", () => {
    const result = installEmbeddedExtension(microbitProject, microbitEmbedRecord, POSITION);
    assert.equal(result.ok, true);
    assert.equal(result.code, ExtensionActionResultCode.INSTALLED);
    assert.equal(result.extensions[POSITION], `embedded:${POSITION}`);

    const resolved = resolveEmbeddedExtensions(result.extensions, microbitEmbedRecord);
    assert.ok(resolved.dependencyMounts.some((mount) => mount.namespace === POSITION));
  });

  test("does not mutate the input extensions map", () => {
    const input = { ...microbitProject };
    installEmbeddedExtension(input, microbitEmbedRecord, POSITION);
    assert.deepEqual(input, microbitProject);
  });

  test("rejects a coordinate that names no bundled extension", () => {
    const result = installEmbeddedExtension(microbitProject, microbitEmbedRecord, "mindcraft-lang/nonexistent");
    assert.equal(result.ok, false);
    assert.equal(result.code, ExtensionActionResultCode.UNKNOWN_COORDINATE);
    assert.deepEqual(result.extensions, microbitProject);
  });

  test("reports an already-present coordinate as a no-op", () => {
    const result = installEmbeddedExtension(microbitProject, microbitEmbedRecord, MICROBIT);
    assert.equal(result.ok, false);
    assert.equal(result.code, ExtensionActionResultCode.ALREADY_INSTALLED);
    assert.deepEqual(result.extensions, microbitProject);
  });
});

describe("uninstallEmbeddedExtension", () => {
  const withPosition = { ...microbitProject, [POSITION]: `embedded:${POSITION}` };

  test("removes an add-on so it no longer resolves", () => {
    const result = uninstallEmbeddedExtension(withPosition, POSITION, microbitLayers, microbitEmbedRecord);
    assert.equal(result.ok, true);
    assert.equal(result.code, ExtensionActionResultCode.UNINSTALLED);
    assert.equal(POSITION in result.extensions, false);

    const resolved = resolveEmbeddedExtensions(result.extensions, microbitEmbedRecord);
    assert.equal(
      resolved.dependencyMounts.some((mount) => mount.namespace === POSITION),
      false
    );
  });

  test("rejects uninstalling a locked layer library", () => {
    const result = uninstallEmbeddedExtension(microbitProject, MICROBIT, microbitLayers, microbitEmbedRecord);
    assert.equal(result.ok, false);
    assert.equal(result.code, ExtensionActionResultCode.LOCKED);
    assert.deepEqual(result.extensions, microbitProject);
  });

  test("reports an absent coordinate as a no-op", () => {
    const result = uninstallEmbeddedExtension(microbitProject, POSITION, microbitLayers, microbitEmbedRecord);
    assert.equal(result.ok, false);
    assert.equal(result.code, ExtensionActionResultCode.NOT_INSTALLED);
    assert.deepEqual(result.extensions, microbitProject);
  });

  test("rejects uninstalling a coordinate another installed extension depends on", () => {
    // A gamepad add-on that depends on the Position add-on, both installed.
    const GAMEPAD = "mindcraft-lang/microbit-gamepad";
    const gamepadAddon = ext(GAMEPAD, {
      name: "Gamepad",
      version: "1.0.0",
      targets: { [MICROBIT]: { packageVersion: "^0.2.0" } },
      extensions: { [POSITION]: `embedded:${POSITION}` },
    });
    const embedRecord = [...microbitEmbedRecord, gamepadAddon];
    const project = {
      ...microbitProject,
      [POSITION]: `embedded:${POSITION}`,
      [GAMEPAD]: `embedded:${GAMEPAD}`,
    };

    const blocked = uninstallEmbeddedExtension(project, POSITION, microbitLayers, embedRecord);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, ExtensionActionResultCode.REQUIRED_BY_DEPENDENT);
    assert.deepEqual(blocked.extensions, project);

    // The depending add-on itself uninstalls freely; nothing depends on it.
    const allowed = uninstallEmbeddedExtension(project, GAMEPAD, microbitLayers, embedRecord);
    assert.equal(allowed.ok, true);
    assert.equal(allowed.code, ExtensionActionResultCode.UNINSTALLED);

    // With the dependent removed, Position is no longer depended upon.
    const nowAllowed = uninstallEmbeddedExtension(allowed.extensions, POSITION, microbitLayers, embedRecord);
    assert.equal(nowAllowed.ok, true);
    assert.equal(nowAllowed.code, ExtensionActionResultCode.UNINSTALLED);
  });
});

describe("satisfiesRange", () => {
  test("exact and equals-prefixed ranges match only the exact version", () => {
    assert.equal(satisfiesRange("1.2.3", "1.2.3"), true);
    assert.equal(satisfiesRange("1.2.3", "=1.2.3"), true);
    assert.equal(satisfiesRange("1.2.4", "1.2.3"), false);
  });

  test("caret ranges pin the leftmost non-zero component", () => {
    assert.equal(satisfiesRange("1.4.0", "^1.2.3"), true);
    assert.equal(satisfiesRange("2.0.0", "^1.2.3"), false);
    assert.equal(satisfiesRange("0.2.9", "^0.2.0"), true);
    assert.equal(satisfiesRange("0.3.0", "^0.2.0"), false);
    assert.equal(satisfiesRange("0.0.3", "^0.0.3"), true);
    assert.equal(satisfiesRange("0.0.4", "^0.0.3"), false);
  });

  test("tilde ranges pin the minor", () => {
    assert.equal(satisfiesRange("1.2.9", "~1.2.0"), true);
    assert.equal(satisfiesRange("1.3.0", "~1.2.0"), false);
  });

  test("comparator conjunctions and wildcards behave", () => {
    assert.equal(satisfiesRange("1.5.0", ">=1.0.0 <2.0.0"), true);
    assert.equal(satisfiesRange("2.0.0", ">=1.0.0 <2.0.0"), false);
    assert.equal(satisfiesRange("9.9.9", "*"), true);
  });

  test("a malformed version or bound never matches", () => {
    assert.equal(satisfiesRange("1.2", "^1.0.0"), false);
    assert.equal(satisfiesRange("1.2.3", "^1.0"), false);
  });
});
