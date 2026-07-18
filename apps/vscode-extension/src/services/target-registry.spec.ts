import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseExtensionReference, validateExtensionCatalogDocument } from "@mindcraft-lang/app-host";
import bundledTargetsRegistry from "../../../../packages/cli/targets.json";
import {
  findTargetRegistryEntry,
  registryProjectSeed,
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

describe("registryProjectSeed", () => {
  it("seeds the coordinate as an embedded library and a caret-range target", () => {
    const seed = registryProjectSeed(MICROBIT_V2_COORDINATE, "0.3.0");
    assert.deepEqual(seed, {
      extensions: { [MICROBIT_V2_COORDINATE]: `embedded:${MICROBIT_V2_COORDINATE}` },
      targets: { [MICROBIT_V2_COORDINATE]: { packageVersion: "^0.3.0" } },
    });
  });
});
