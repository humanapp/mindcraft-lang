import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ExtensionCatalogDocument } from "@wendoo/app-host";
import type { EmbeddedExtension } from "./embedded-extensions.js";
import { resolveProjectExtensions } from "./embedded-extensions.js";
import type { ExtensionCatalogEntry, PlatformStackLayer } from "./extension-catalog.js";
import {
  buildExtensionCatalog,
  buildExtensionCatalogOffers,
  deriveProjectPlatformStack,
  ExtensionActionResultCode,
  installEmbeddedExtension,
  installExtensionReference,
  isExtensionCompatible,
  satisfiesRange,
  uninstallExtension,
} from "./extension-catalog.js";

/** Build an embedded extension whose bundled `wendoo.json` declares the given manifest fields. */
function ext(
  coordinate: string,
  manifest: {
    name?: string;
    version?: string;
    description?: string;
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
          ...(manifest.description !== undefined ? { description: manifest.description } : {}),
          ...(manifest.thumbnailUrl !== undefined ? { thumbnailUrl: manifest.thumbnailUrl } : {}),
          ...(manifest.extensions !== undefined ? { extensions: manifest.extensions } : {}),
          ...(manifest.targets !== undefined ? { targets: manifest.targets } : {}),
        }),
      },
    ],
  };
}

const CORE = "wendoo-lang/core";
const CODAL = "wendoo-lang/codal";
const MICROBIT = "wendoo-lang/microbit-v2";
const SIM = "wendoo-lang/lib-ecosim";
const POSITION = "wendoo-lang/microbit-position";
const FLOCK = "wendoo-lang/lib-ecosim-flock";
const SHARED_MATH = "wendoo-lang/shared-math";
const LEGACY = "wendoo-lang/legacy-widget";

const coreLib = ext(CORE, { name: "Core", version: "0.2.1" });
const codalLib = ext(CODAL, { name: "Codal", version: "0.2.1", extensions: { [CORE]: `embedded:${CORE}` } });
const microbitLib = ext(MICROBIT, {
  name: "Micro:bit v2",
  version: "0.2.1",
  extensions: { [CODAL]: `embedded:${CODAL}` },
});
const ecosimLib = ext(SIM, { name: "Sim", version: "0.1.0", extensions: { [CORE]: `embedded:${CORE}` } });

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
const ecosimEmbedRecord: readonly EmbeddedExtension[] = [ecosimLib, coreLib, ...ADDONS];

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

  test("an apps/ecosim project's stack is core and sim with their declared versions", () => {
    const stack = deriveProjectPlatformStack(simProject, ecosimEmbedRecord, simLayers);
    assert.deepEqual(coordinatesOf(stack), [CORE, SIM]);
    assert.equal(stack.find((layer) => layer.coordinate === SIM)?.version, "0.1.0");
    assert.equal(stack.find((layer) => layer.coordinate === CORE)?.version, "0.2.1");
  });
});

describe("isExtensionCompatible -- stack inclusion and semver ranges", () => {
  const microbitStack = deriveProjectPlatformStack(microbitProject, microbitEmbedRecord, microbitLayers);
  const simStack = deriveProjectPlatformStack(simProject, ecosimEmbedRecord, simLayers);

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

describe("isExtensionCompatible -- shared mid-tier layer, differing top-level target", () => {
  const LIB_CODAL = "wendoo-lang/lib-codal";
  const TRG_MICROBIT = "wendoo-lang/trg-microbit-v2";
  const TRG_ARCADE = "wendoo-lang/trg-arcade";

  // A library that targets the shared codal mid-tier layer, agnostic to which
  // codal-based top-level target sits above it.
  const codalMidTierTargets = { [LIB_CODAL]: { packageVersion: "^0.2.0" } };

  // Two codal-based stacks with different top-level targets, both carrying the
  // shared mid-tier layer at a satisfying version.
  const microbitStack: PlatformStackLayer[] = [
    { coordinate: TRG_MICROBIT, version: "0.8.0" },
    { coordinate: LIB_CODAL, version: "0.2.1" },
  ];
  const arcadeStack: PlatformStackLayer[] = [
    { coordinate: TRG_ARCADE, version: "0.1.0" },
    { coordinate: LIB_CODAL, version: "0.2.1" },
  ];

  test("a mid-tier-targeting library is compatible with a micro:bit-topped stack carrying that layer", () => {
    assert.equal(isExtensionCompatible(codalMidTierTargets, microbitStack), true);
  });

  test("the same library is compatible with an arcade-topped stack carrying that layer", () => {
    assert.equal(isExtensionCompatible(codalMidTierTargets, arcadeStack), true);
  });

  test("it is incompatible with a stack whose different top-level target carries no mid-tier layer", () => {
    const arcadeOnlyStack: PlatformStackLayer[] = [{ coordinate: TRG_ARCADE, version: "0.1.0" }];
    assert.equal(isExtensionCompatible(codalMidTierTargets, arcadeOnlyStack), false);
  });

  test("it is incompatible when the mid-tier layer is present below the range", () => {
    const belowRange: PlatformStackLayer[] = [
      { coordinate: TRG_ARCADE, version: "0.1.0" },
      { coordinate: LIB_CODAL, version: "0.1.9" },
    ];
    assert.equal(isExtensionCompatible(codalMidTierTargets, belowRange), false);
  });

  test("it is incompatible when the mid-tier layer is present above the range", () => {
    const aboveRange: PlatformStackLayer[] = [
      { coordinate: TRG_ARCADE, version: "0.1.0" },
      { coordinate: LIB_CODAL, version: "0.3.0" },
    ];
    assert.equal(isExtensionCompatible(codalMidTierTargets, aboveRange), false);
  });

  test("an unmatched second target does not poison a matched one", () => {
    const twoTargets = {
      [LIB_CODAL]: { packageVersion: "^0.2.0" },
      [TRG_ARCADE]: { packageVersion: "^0.1.0" },
    };
    assert.equal(isExtensionCompatible(twoTargets, microbitStack), true);
  });
});

describe("buildExtensionCatalog -- two platforms", () => {
  test("a fresh micro:bit project lists nothing: no platform layer, no compatible bundled add-on", () => {
    const entries = buildExtensionCatalog(microbitProject, microbitEmbedRecord, microbitLayers);
    // The locked platform target is not an entry card; POSITION and SHARED_MATH
    // are compatible bundled add-ons surfaced only through the catalog offers.
    assert.deepEqual(coordinatesOf(entries), []);
    assert.equal(entryFor(entries, MICROBIT), undefined);
    assert.equal(entryFor(entries, POSITION), undefined);
    assert.equal(entryFor(entries, SHARED_MATH), undefined);
  });

  test("the entry list excludes platform layers and every non-referenced bundled add-on", () => {
    const entries = buildExtensionCatalog(microbitProject, microbitEmbedRecord, microbitLayers);
    assert.equal(entryFor(entries, MICROBIT), undefined);
    assert.equal(entryFor(entries, CODAL), undefined);
    assert.equal(entryFor(entries, CORE), undefined);
    assert.equal(entryFor(entries, FLOCK), undefined);
    assert.equal(entryFor(entries, LEGACY), undefined);
  });

  test("a fresh apps/ecosim project lists nothing: its platform layer is not an entry card", () => {
    const entries = buildExtensionCatalog(simProject, ecosimEmbedRecord, simLayers);
    assert.deepEqual(coordinatesOf(entries), []);
    assert.equal(entryFor(entries, SIM), undefined);
    assert.equal(entryFor(entries, POSITION), undefined);
    assert.equal(entryFor(entries, FLOCK), undefined);
    assert.equal(entryFor(entries, CORE), undefined);
  });

  test("a top-level embedded install is listed as an installed management card", () => {
    // Edge 2: a direct, non-layer embedded install (a top-level manifest-map
    // entry) is listed so it carries its uninstall affordance.
    const installed = installEmbeddedExtension(microbitProject, microbitEmbedRecord, POSITION);
    assert.equal(installed.ok, true);
    const entries = buildExtensionCatalog(installed.extensions, microbitEmbedRecord, microbitLayers);
    assert.deepEqual(coordinatesOf(entries), [POSITION]);
    const position = entryFor(entries, POSITION);
    assert.ok(position);
    assert.equal(position.installed, true);
    assert.equal(position.name, "Position");
    assert.equal(position.thumbnailUrl, "data:,pos");
    // An embedded entry's coordinate is not a GitHub repository, so it carries no repoUrl.
    assert.equal("repoUrl" in position, false);
  });

  test("a transitively-resolved embedded dep is not listed; only the top-level non-layer lib is", () => {
    // GAMEPAD is a top-level embedded install whose manifest depends on POSITION.
    // POSITION resolves transitively but is not a top-level manifest-map entry,
    // so it is not an entry card; the platform layer is never an entry card.
    const GAMEPAD = "wendoo-lang/microbit-gamepad";
    const gamepadAddon = ext(GAMEPAD, {
      name: "Gamepad",
      version: "1.0.0",
      targets: { [MICROBIT]: { packageVersion: "^0.2.0" } },
      extensions: { [POSITION]: `embedded:${POSITION}` },
    });
    const embedRecord = [...microbitEmbedRecord, gamepadAddon];
    const project = { ...microbitProject, [GAMEPAD]: `embedded:${GAMEPAD}` };

    const entries = buildExtensionCatalog(project, embedRecord, microbitLayers);
    assert.deepEqual(coordinatesOf(entries), [GAMEPAD]);
    assert.equal(entryFor(entries, GAMEPAD)?.installed, true);
    assert.equal(entryFor(entries, POSITION), undefined);
    assert.equal(entryFor(entries, MICROBIT), undefined);
  });

  test("an entry missing its manifest name falls back to its coordinate", () => {
    const noManifest: EmbeddedExtension = {
      canonicalOrigin: POSITION,
      files: [{ path: "index.ts", content: "export {};" }],
    };
    const project = { ...microbitProject, [POSITION]: `embedded:${POSITION}` };
    const entries = buildExtensionCatalog(project, [microbitLib, noManifest], microbitLayers);
    assert.equal(entryFor(entries, POSITION)?.name, POSITION);
  });
});

describe("installEmbeddedExtension", () => {
  test("adds an embedded reference that then resolves into the closure", () => {
    const result = installEmbeddedExtension(microbitProject, microbitEmbedRecord, POSITION);
    assert.equal(result.ok, true);
    assert.equal(result.code, ExtensionActionResultCode.INSTALLED);
    assert.equal(result.extensions[POSITION], `embedded:${POSITION}`);

    const resolved = resolveProjectExtensions(result.extensions, { embedded: microbitEmbedRecord });
    assert.ok(resolved.dependencyMounts.some((mount) => mount.namespace === POSITION));
  });

  test("does not mutate the input extensions map", () => {
    const input = { ...microbitProject };
    installEmbeddedExtension(input, microbitEmbedRecord, POSITION);
    assert.deepEqual(input, microbitProject);
  });

  test("rejects a coordinate that names no bundled extension", () => {
    const result = installEmbeddedExtension(microbitProject, microbitEmbedRecord, "wendoo-lang/nonexistent");
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

describe("uninstallExtension", () => {
  const withPosition = { ...microbitProject, [POSITION]: `embedded:${POSITION}` };

  test("removes an add-on so it no longer resolves", () => {
    const result = uninstallExtension(withPosition, POSITION, microbitLayers, microbitEmbedRecord);
    assert.equal(result.ok, true);
    assert.equal(result.code, ExtensionActionResultCode.UNINSTALLED);
    assert.equal(POSITION in result.extensions, false);

    const resolved = resolveProjectExtensions(result.extensions, { embedded: microbitEmbedRecord });
    assert.equal(
      resolved.dependencyMounts.some((mount) => mount.namespace === POSITION),
      false
    );
  });

  test("rejects uninstalling a locked layer library", () => {
    const result = uninstallExtension(microbitProject, MICROBIT, microbitLayers, microbitEmbedRecord);
    assert.equal(result.ok, false);
    assert.equal(result.code, ExtensionActionResultCode.LOCKED);
    assert.deepEqual(result.extensions, microbitProject);
  });

  test("reports an absent coordinate as a no-op", () => {
    const result = uninstallExtension(microbitProject, POSITION, microbitLayers, microbitEmbedRecord);
    assert.equal(result.ok, false);
    assert.equal(result.code, ExtensionActionResultCode.NOT_INSTALLED);
    assert.deepEqual(result.extensions, microbitProject);
  });

  test("rejects uninstalling a coordinate another installed extension depends on", () => {
    // A gamepad add-on that depends on the Position add-on, both installed.
    const GAMEPAD = "wendoo-lang/microbit-gamepad";
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

    const blocked = uninstallExtension(project, POSITION, microbitLayers, embedRecord);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, ExtensionActionResultCode.REQUIRED_BY_DEPENDENT);
    assert.deepEqual(blocked.extensions, project);

    // The depending add-on itself uninstalls freely; nothing depends on it.
    const allowed = uninstallExtension(project, GAMEPAD, microbitLayers, embedRecord);
    assert.equal(allowed.ok, true);
    assert.equal(allowed.code, ExtensionActionResultCode.UNINSTALLED);

    // With the dependent removed, Position is no longer depended upon.
    const nowAllowed = uninstallExtension(allowed.extensions, POSITION, microbitLayers, embedRecord);
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

describe("remote (gh:) catalog entries and actions", () => {
  const REMOTE = "example-org/position-ext";
  const REMOTE_REFERENCE = `gh:${REMOTE}@v0.1.0`;

  /** Fetched snapshot content for the remote add-on, keyed by its reference. */
  function remoteContent(manifest: {
    name: string;
    version: string;
    extensions?: Record<string, string>;
    identity?: string;
  }) {
    return new Map([
      [
        REMOTE_REFERENCE,
        new Map([
          ["/wendoo.json", JSON.stringify({ ...manifest, files: ["index.ts"] })],
          ["/index.ts", "export const p = 1;"],
        ]),
      ],
    ]);
  }

  test("installExtensionReference adds a gh reference keyed by its coordinate", () => {
    const result = installExtensionReference({}, REMOTE_REFERENCE);
    assert.ok(result.ok);
    assert.equal(result.code, ExtensionActionResultCode.INSTALLED);
    assert.deepStrictEqual(result.extensions, { [REMOTE]: REMOTE_REFERENCE });
  });

  test("installExtensionReference trims surrounding whitespace", () => {
    const result = installExtensionReference({}, `  ${REMOTE_REFERENCE}  `);
    assert.ok(result.ok);
    assert.deepStrictEqual(result.extensions, { [REMOTE]: REMOTE_REFERENCE });
  });

  test("installExtensionReference rejects a malformed or non-gh reference", () => {
    for (const reference of ["gh:owner/repo", "embedded:a/b", "ffff:p1", "owner/repo@v1", ""]) {
      const result = installExtensionReference({}, reference);
      assert.ok(!result.ok);
      assert.equal(result.code, ExtensionActionResultCode.INVALID_REFERENCE);
    }
  });

  test("installExtensionReference reports an already-present coordinate as a no-op", () => {
    const current = { [REMOTE]: REMOTE_REFERENCE };
    const result = installExtensionReference(current, `gh:${REMOTE}#main`);
    assert.ok(!result.ok);
    assert.equal(result.code, ExtensionActionResultCode.ALREADY_INSTALLED);
    assert.deepStrictEqual(result.extensions, current);
  });

  test("buildExtensionCatalog lists an installed remote dependency with its snapshot identity", () => {
    const entries = buildExtensionCatalog(
      { [REMOTE]: REMOTE_REFERENCE },
      [],
      new Set(),
      remoteContent({ name: "Position", version: "0.1.0" })
    );
    assert.deepStrictEqual(entries, [
      {
        coordinate: REMOTE,
        name: "Position",
        version: "0.1.0",
        installed: true,
        repoUrl: `https://github.com/${REMOTE}`,
        updatable: true,
      },
    ]);
  });

  test("buildExtensionCatalog sets a gh entry's repoUrl to its GitHub repository", () => {
    const entries = buildExtensionCatalog(
      { [REMOTE]: REMOTE_REFERENCE },
      [],
      new Set(),
      remoteContent({ name: "Position", version: "0.1.0" })
    );
    assert.equal(entries[0].repoUrl, `https://github.com/${REMOTE}`);
  });

  test("buildExtensionCatalog lists a remote reference without content as broken so it can be retried or removed", () => {
    const entries = buildExtensionCatalog({ [REMOTE]: REMOTE_REFERENCE }, [], new Set());
    assert.deepStrictEqual(entries, [
      {
        coordinate: REMOTE,
        name: REMOTE,
        version: "0.0.0",
        installed: false,
        repoUrl: `https://github.com/${REMOTE}`,
        broken: { message: `No content is installed for "${REMOTE_REFERENCE}".` },
      },
    ]);
  });

  test("buildExtensionCatalog carries the last recorded fetch failure on a broken entry", () => {
    const failures = new Map([
      [REMOTE_REFERENCE, { code: "EXTENSION_FETCH_UNREACHABLE", message: "The source is unreachable: refused" }],
    ]);
    const entries = buildExtensionCatalog({ [REMOTE]: REMOTE_REFERENCE }, [], new Set(), undefined, failures);
    assert.deepStrictEqual(entries[0].broken, {
      code: "EXTENSION_FETCH_UNREACHABLE",
      message: "The source is unreachable: refused",
    });
  });

  test("buildExtensionCatalog annotates a remote dependency whose manifest identity differs from its coordinate", () => {
    const entries = buildExtensionCatalog(
      { [REMOTE]: REMOTE_REFERENCE },
      [],
      new Set(),
      remoteContent({ name: "Position", version: "0.1.0", identity: "upstream-org/position-ext" })
    );
    assert.deepStrictEqual(entries[0].identityMismatch, { declaredIdentity: "upstream-org/position-ext" });
  });

  test("uninstallExtension removes a remote dependency and blocks one another extension depends on", () => {
    const removable = uninstallExtension({ [REMOTE]: REMOTE_REFERENCE }, REMOTE, new Set(), []);
    assert.ok(removable.ok);
    assert.deepStrictEqual(removable.extensions, {});

    // An embedded extension's manifest requires the remote coordinate: after
    // removing its explicit entry the dependent would pull it back, so the
    // removal is refused.
    const dependent = ext("wendoo-lang/robot", {
      name: "Robot",
      version: "1.0.0",
      extensions: { [REMOTE]: REMOTE_REFERENCE },
    });
    const blocked = uninstallExtension(
      { "wendoo-lang/robot": "embedded:wendoo-lang/robot", [REMOTE]: REMOTE_REFERENCE },
      REMOTE,
      new Set(),
      [dependent],
      remoteContent({ name: "Position", version: "0.1.0" })
    );
    assert.ok(!blocked.ok);
    assert.equal(blocked.code, ExtensionActionResultCode.REQUIRED_BY_DEPENDENT);
  });
});

describe("buildExtensionCatalogOffers -- compatibility-filtered against the project stack", () => {
  const PIN_SHA = "b19b80b029a77303ee575d3ff9b29adbf7021b23";
  const GH_COMPATIBLE = "ext-org/gh-microbit";
  const GH_OUT_OF_RANGE = "ext-org/gh-microbit-legacy";
  const GH_WRONG_PLATFORM = "ext-org/gh-sim";
  const GH_NO_TARGETS = "ext-org/gh-bare";
  const ghRef = (coordinate: string) => `gh:${coordinate}@${PIN_SHA}`;

  // A catalog mixing embedded offers (targets read from the embed-record
  // manifest) and gh: offers (targets read from the catalog entry) against the
  // micro:bit stack (core, codal, microbit-v2 at 0.2.1).
  const document: ExtensionCatalogDocument = {
    format: "wendoo.catalog/1",
    entries: [
      // Embedded, declared target coordinate (MICROBIT) is a stack layer.
      {
        coordinate: POSITION,
        kind: "library",
        ref: `embedded:${POSITION}`,
        name: "Position",
        version: "1.3.0",
        description: "Position sensing.",
        thumbnail: "data:,pos",
      },
      // Embedded, declared target coordinate (SIM) is not a micro:bit stack layer.
      {
        coordinate: FLOCK,
        kind: "library",
        ref: `embedded:${FLOCK}`,
        name: "Flock",
        version: "1.0.0",
        description: "Flocking.",
      },
      // gh:, target coordinate in stack and version in range.
      {
        coordinate: GH_COMPATIBLE,
        kind: "library",
        ref: ghRef(GH_COMPATIBLE),
        name: "GH Compatible",
        version: "1.0.0",
        description: "A compatible remote library.",
        targets: { [MICROBIT]: { packageVersion: "^0.2.0" } },
      },
      // gh:, target coordinate in stack but version out of range (0.2.1 not in ^0.3.0).
      {
        coordinate: GH_OUT_OF_RANGE,
        kind: "library",
        ref: ghRef(GH_OUT_OF_RANGE),
        name: "GH Out Of Range",
        version: "1.0.0",
        description: "A remote library the stack version excludes.",
        targets: { [MICROBIT]: { packageVersion: "^0.3.0" } },
      },
      // gh:, target coordinate not in the micro:bit stack.
      {
        coordinate: GH_WRONG_PLATFORM,
        kind: "library",
        ref: ghRef(GH_WRONG_PLATFORM),
        name: "GH Wrong Platform",
        version: "1.0.0",
        description: "A remote library for another platform.",
        targets: { [SIM]: { packageVersion: "^0.1.0" } },
      },
      // gh:, no declared targets -> unverifiable -> excluded (fail-closed).
      {
        coordinate: GH_NO_TARGETS,
        kind: "library",
        ref: ghRef(GH_NO_TARGETS),
        name: "GH No Targets",
        version: "1.0.0",
        description: "A remote library declaring no compatibility.",
      },
    ],
    moves: {},
  };

  test("includes only compatible offers: embedded by target coordinate, gh: by coordinate and version range", () => {
    const offers = buildExtensionCatalogOffers(document, microbitProject, microbitEmbedRecord, microbitLayers);
    assert.deepEqual(coordinatesOf(offers), [GH_COMPATIBLE, POSITION].sort());
  });

  test("an embedded offer whose target coordinate is not in the stack is excluded", () => {
    const offers = buildExtensionCatalogOffers(document, microbitProject, microbitEmbedRecord, microbitLayers);
    assert.equal(
      offers.some((offer) => offer.coordinate === FLOCK),
      false
    );
  });

  test("a gh: offer with a target coordinate in the stack but an out-of-range version is excluded", () => {
    const offers = buildExtensionCatalogOffers(document, microbitProject, microbitEmbedRecord, microbitLayers);
    assert.equal(
      offers.some((offer) => offer.coordinate === GH_OUT_OF_RANGE),
      false
    );
  });

  test("a gh: offer for another platform is excluded", () => {
    const offers = buildExtensionCatalogOffers(document, microbitProject, microbitEmbedRecord, microbitLayers);
    assert.equal(
      offers.some((offer) => offer.coordinate === GH_WRONG_PLATFORM),
      false
    );
  });

  test("a gh: offer declaring no targets is excluded (fail-closed)", () => {
    const offers = buildExtensionCatalogOffers(document, microbitProject, microbitEmbedRecord, microbitLayers);
    assert.equal(
      offers.some((offer) => offer.coordinate === GH_NO_TARGETS),
      false
    );
  });

  test("adapts a compatible not-installed entry from display metadata alone", () => {
    const offers = buildExtensionCatalogOffers(document, microbitProject, microbitEmbedRecord, microbitLayers);
    const position = offers.find((offer) => offer.coordinate === POSITION);
    assert.deepStrictEqual(position, {
      coordinate: POSITION,
      name: "Position",
      version: "1.3.0",
      description: "Position sensing.",
      thumbnailUrl: "data:,pos",
      ref: `embedded:${POSITION}`,
    });
  });

  test("drops an offer whose coordinate the project has already installed", () => {
    const withPosition = { ...microbitProject, [POSITION]: `embedded:${POSITION}` };
    const offers = buildExtensionCatalogOffers(document, withPosition, microbitEmbedRecord, microbitLayers);
    assert.equal(
      offers.some((offer) => offer.coordinate === POSITION),
      false
    );
  });
});

describe("library descriptions on entry cards", () => {
  const DESCRIBED = "example-org/described-lib";
  const BARE = "example-org/bare-lib";
  const DESCRIPTION = "Drives the described chassis.";
  const noLayers: ReadonlySet<string> = new Set();

  test("an installed embedded library's entry carries its manifest description", () => {
    const entries = buildExtensionCatalog(
      { [DESCRIBED]: `embedded:${DESCRIBED}` },
      [ext(DESCRIBED, { name: "Described", description: DESCRIPTION })],
      noLayers
    );
    assert.equal(entryFor(entries, DESCRIBED)?.description, DESCRIPTION);
  });

  test("an installed remote library's entry carries its installed manifest's description", () => {
    const reference = `gh:${DESCRIBED}@v1.0.0`;
    const fetched = new Map([
      [
        reference,
        new Map([
          [
            "/wendoo.json",
            JSON.stringify({ name: "Described", version: "1.0.0", description: DESCRIPTION, files: ["index.ts"] }),
          ],
          ["/index.ts", "export {};"],
        ]),
      ],
    ]);
    const entries = buildExtensionCatalog({ [DESCRIBED]: reference }, [], noLayers, fetched);
    assert.equal(entryFor(entries, DESCRIBED)?.description, DESCRIPTION);
  });

  test("a library declaring no description gets none", () => {
    const entries = buildExtensionCatalog({ [BARE]: `embedded:${BARE}` }, [ext(BARE, { name: "Bare" })], noLayers);
    assert.equal(entryFor(entries, BARE)?.description, undefined);
  });

  test("a manifest without a description falls back to the catalog document's entry description", () => {
    const catalog: ExtensionCatalogDocument = {
      format: "wendoo.catalog/1",
      entries: [
        {
          kind: "library",
          coordinate: BARE,
          name: "Bare",
          version: "1.0.0",
          description: "Catalog-listed bare library.",
          ref: `embedded:${BARE}`,
        },
      ],
      moves: {},
    };
    const entries = buildExtensionCatalog(
      { [BARE]: `embedded:${BARE}` },
      [ext(BARE, { name: "Bare" })],
      noLayers,
      undefined,
      undefined,
      catalog
    );
    assert.equal(entryFor(entries, BARE)?.description, "Catalog-listed bare library.");
  });

  test("the installed manifest's description wins over the catalog document's", () => {
    const catalog: ExtensionCatalogDocument = {
      format: "wendoo.catalog/1",
      entries: [
        {
          kind: "library",
          coordinate: DESCRIBED,
          name: "Described",
          version: "1.0.0",
          description: "Catalog wording.",
          ref: `embedded:${DESCRIBED}`,
        },
      ],
      moves: {},
    };
    const entries = buildExtensionCatalog(
      { [DESCRIBED]: `embedded:${DESCRIBED}` },
      [ext(DESCRIBED, { name: "Described", description: DESCRIPTION })],
      noLayers,
      undefined,
      undefined,
      catalog
    );
    assert.equal(entryFor(entries, DESCRIBED)?.description, DESCRIPTION);
  });
});
