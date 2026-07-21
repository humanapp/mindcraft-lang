import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import { collectSimLibraryUninstallImpact, type UninstallGuardHost } from "./library-uninstall-guard";

const DETECT = "acme/lib-ecosim-detect";

function embedded(coordinate: string): EmbeddedExtension {
  return {
    canonicalOrigin: coordinate,
    files: [
      {
        path: "mindcraft.json",
        content: JSON.stringify({ name: coordinate, version: "1.0.0", files: ["index.ts"] }),
      },
      { path: "index.ts", content: "export {};" },
    ],
  };
}

/** A persisted brain with one rule referencing an actuator tile owned by `ns`. */
function brainJsonUsing(ns: string): Record<string, unknown> {
  return {
    version: 1,
    id: "brain00000000001",
    name: "Stored Brain",
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

interface StubBrain {
  json: unknown;
  name(): string;
}

function stubHost(brains: Record<string, Record<string, unknown>>): UninstallGuardHost {
  const byKey = new Map<string, StubBrain>(
    Object.entries(brains).map(([key, json]) => [key, { json, name: () => key }])
  );
  return {
    getCachedBrainKeys: () => [...byKey.keys()],
    getCachedBrain: (key) => byKey.get(key),
    serializeBrainForStorage: (brain) => (brain as StubBrain).json,
  };
}

describe("collectSimLibraryUninstallImpact", () => {
  test("names affected archetype brains through the display-name lookup", () => {
    const host = stubHost({ carnivore: brainJsonUsing(DETECT), plant: brainJsonUsing("acme/lib-other") });
    const impact = collectSimLibraryUninstallImpact(
      host,
      { [DETECT]: `embedded:${DETECT}` },
      DETECT,
      [embedded(DETECT)],
      undefined,
      (key) => `label:${key}`
    );
    assert.deepEqual(impact.brainNames, ["label:carnivore"]);
    assert.deepEqual(impact.filePaths, []);
  });

  test("reports an empty impact when no archetype brain uses the library", () => {
    const host = stubHost({ plant: brainJsonUsing("acme/lib-other") });
    const impact = collectSimLibraryUninstallImpact(
      host,
      { [DETECT]: `embedded:${DETECT}` },
      DETECT,
      [embedded(DETECT)],
      undefined,
      (key) => key
    );
    assert.deepEqual(impact.brainNames, []);
    assert.deepEqual(impact.filePaths, []);
  });
});
