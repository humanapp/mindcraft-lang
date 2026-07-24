import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionCatalogDocumentEntry } from "@mindcraft-lang/app-host";
import {
  parseExtensionReference,
  parseProjectContentManifest,
  seedProjectTargets,
  validateExtensionCatalogDocument,
} from "@mindcraft-lang/app-host";
import bundledTargetsRegistry from "../../../../packages/cli/targets.json";
import {
  findTargetRegistryEntry,
  registryProjectSeed,
  resolveProjectTargetDescriptor,
  TargetResolutionErrorCode,
  targetRegistryEntries,
  targetRegistryPickItems,
} from "./target-registry";

const MICROBIT_V2_COORDINATE = "mindcraft-lang/trg-microbit-v2";

describe("bundled targets registry", () => {
  it("validates with zero errors, zero warnings, and at least one entry", () => {
    const result = validateExtensionCatalogDocument(bundledTargetsRegistry);
    assert.ok(result.ok);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
    assert.ok(result.document.entries.length >= 1);
    assert.equal(targetRegistryEntries().length, result.document.entries.length);
  });

  it("carries the micro:bit v2 seed entry with a pinned gh ref", () => {
    const entry = findTargetRegistryEntry(MICROBIT_V2_COORDINATE);
    assert.ok(entry !== undefined);
    assert.equal(entry.coordinate, MICROBIT_V2_COORDINATE);
    const parsed = parseExtensionReference(entry.ref);
    assert.ok(parsed !== undefined && parsed.transport === "gh");
    assert.equal(`${parsed.owner}/${parsed.repo}`, MICROBIT_V2_COORDINATE);
    assert.equal(parsed.routing.kind, "pin");
    assert.equal(entry.thumbnail, undefined);
  });

  it("finds no entry for an unknown coordinate", () => {
    assert.equal(findTargetRegistryEntry("example-org/absent"), undefined);
  });
});

describe("targetRegistryPickItems", () => {
  it("maps each entry to one item carrying its entry and display data", () => {
    const entries = targetRegistryEntries();
    const items = targetRegistryPickItems(entries);
    assert.equal(items.length, entries.length);
    for (const [index, item] of items.entries()) {
      assert.equal(item.entry, entries[index]);
      assert.equal(item.label, entries[index].name);
      assert.equal(item.detail, entries[index].description);
    }
  });
});

/** A registry entry fixture with the given coordinate and a pinned ref derived from it. */
function entry(coordinate: string): ExtensionCatalogDocumentEntry {
  return {
    coordinate,
    kind: "library",
    ref: `gh:${coordinate}@${"a".repeat(40)}`,
    name: coordinate,
    version: "1.0.0",
    description: `Entry for ${coordinate}`,
  };
}

describe("resolveProjectTargetDescriptor", () => {
  const WIDGET_ENTRY = entry("acme/widget-platform");

  it("returns the devTarget descriptor unchanged when set, without consulting the registry", () => {
    const devTarget = { appPath: "/builds/target/dist" };
    const resolution = resolveProjectTargetDescriptor(devTarget, [WIDGET_ENTRY.coordinate], [WIDGET_ENTRY]);
    assert.deepStrictEqual(resolution, { ok: true, descriptor: devTarget });
  });

  it("returns a devTarget appRef descriptor unchanged when set", () => {
    const devTarget = { appRef: "gh:acme/other-target@v1.2.3" };
    const resolution = resolveProjectTargetDescriptor(devTarget, [WIDGET_ENTRY.coordinate], [WIDGET_ENTRY]);
    assert.deepStrictEqual(resolution, { ok: true, descriptor: devTarget });
  });

  it("resolves the registry-listed declared coordinate by membership, not by coordinate prefix", () => {
    const resolution = resolveProjectTargetDescriptor(
      undefined,
      ["mindcraft-lang/lib-cutebot", "acme/trg-unregistered", WIDGET_ENTRY.coordinate],
      [WIDGET_ENTRY]
    );
    assert.deepStrictEqual(resolution, { ok: true, descriptor: { appRef: WIDGET_ENTRY.ref } });
  });

  it("fails with NO_REGISTRY_MATCH when no declared coordinate is registry-listed, naming the declared coordinates", () => {
    const declared = ["mindcraft-lang/lib-cutebot", "acme/trg-unregistered"];
    const resolution = resolveProjectTargetDescriptor(undefined, declared, [WIDGET_ENTRY]);
    assert.deepStrictEqual(resolution, {
      ok: false,
      code: TargetResolutionErrorCode.NO_REGISTRY_MATCH,
      declaredCoordinates: declared,
    });
  });

  it("fails with NO_REGISTRY_MATCH when the project declares no targets", () => {
    const resolution = resolveProjectTargetDescriptor(undefined, [], [WIDGET_ENTRY]);
    assert.deepStrictEqual(resolution, {
      ok: false,
      code: TargetResolutionErrorCode.NO_REGISTRY_MATCH,
      declaredCoordinates: [],
    });
  });

  it("fails with AMBIGUOUS_REGISTRY_MATCH when more than one declared coordinate is registry-listed", () => {
    const otherEntry = entry("acme/other-platform");
    const declared = [WIDGET_ENTRY.coordinate, otherEntry.coordinate];
    const resolution = resolveProjectTargetDescriptor(undefined, declared, [WIDGET_ENTRY, otherEntry]);
    assert.deepStrictEqual(resolution, {
      ok: false,
      code: TargetResolutionErrorCode.AMBIGUOUS_REGISTRY_MATCH,
      declaredCoordinates: declared,
    });
  });
});

describe("registryProjectSeed", () => {
  it("seeds the coordinate as an embedded library and a caret-range target", () => {
    const seed = registryProjectSeed(MICROBIT_V2_COORDINATE, "0.3.0");
    assert.deepEqual(seed, {
      extensions: { [MICROBIT_V2_COORDINATE]: `embedded:${MICROBIT_V2_COORDINATE}` },
      targets: { [MICROBIT_V2_COORDINATE]: { packageVersion: "^0.3.0" } },
    });
  });
});

describe("seedProjectTargets wiring", () => {
  it("seeds an imported project from the bundled registry entries, resolving to that target", () => {
    const entry = findTargetRegistryEntry(MICROBIT_V2_COORDINATE);
    assert.ok(entry !== undefined);
    const seeded = seedProjectTargets(
      JSON.stringify({
        name: "Imported",
        version: "0.1.0",
        extensions: { [MICROBIT_V2_COORDINATE]: `embedded:${MICROBIT_V2_COORDINATE}` },
      }),
      targetRegistryEntries()
    );
    const parsed = parseProjectContentManifest(seeded);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.manifest.targets, { [MICROBIT_V2_COORDINATE]: { packageVersion: `^${entry.version}` } });
    const resolution = resolveProjectTargetDescriptor(
      undefined,
      Object.keys(parsed.manifest.targets ?? {}),
      targetRegistryEntries()
    );
    assert.deepStrictEqual(resolution, { ok: true, descriptor: { appRef: entry.ref } });
  });
});
