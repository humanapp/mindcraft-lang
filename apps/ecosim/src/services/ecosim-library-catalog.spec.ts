import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CATALOG_ENTRY_KIND_EXTENSION, validateExtensionCatalogDocument } from "@wendoo-lang/app-host";
import type { EmbeddedExtension, FetchedExtensionContentMap } from "@wendoo-lang/bridge-app";
import {
  buildEcosimCatalogOffers,
  buildEcosimExtensionEntries,
  loadSimLibraryCatalog,
} from "./ecosim-extension-browser";
import { ECOSIM_LIB_COORDINATE, ECOSIM_LIB_REFERENCE } from "./ecosim-extension-coordinates";
import ecosimLibraryCatalogDocument from "./ecosim-library-catalog.json";

const TELEPORT = "wendoo-lang/lib-ecosim-teleport";
const DETECT = "wendoo-lang/lib-ecosim-detect";

/** Read a host-bundled embedded library's manifest version from its source directory. */
function bundledManifestVersion(dir: string): string {
  const url = new URL(`../../extensions/${dir}/wendoo.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")).version;
}

describe("sim library catalog document", () => {
  test("the seeded catalog validates with no errors and no warnings", () => {
    const result = validateExtensionCatalogDocument(ecosimLibraryCatalogDocument);
    assert.ok(result.ok);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
  });

  test("every entry is a library with an embedded ref matching its coordinate and no alias", () => {
    const result = validateExtensionCatalogDocument(ecosimLibraryCatalogDocument);
    assert.ok(result.ok);
    assert.deepEqual(result.document.entries.map((entry) => entry.coordinate).sort(), [TELEPORT, DETECT].sort());
    for (const entry of result.document.entries) {
      assert.equal(entry.kind, CATALOG_ENTRY_KIND_EXTENSION);
      assert.equal("alias" in entry, false);
      assert.equal(entry.ref, `embedded:${entry.coordinate}`);
    }
  });

  test("each embedded catalog entry version equals its host-bundled manifest version", () => {
    const result = validateExtensionCatalogDocument(ecosimLibraryCatalogDocument);
    assert.ok(result.ok);
    const versionByCoordinate = new Map(result.document.entries.map((entry) => [entry.coordinate, entry.version]));
    assert.equal(versionByCoordinate.get(TELEPORT), bundledManifestVersion("lib-ecosim-teleport"));
    assert.equal(versionByCoordinate.get(DETECT), bundledManifestVersion("lib-ecosim-detect"));
  });

  test("the startup loader throws with the stable codes when the bundled document is invalid", () => {
    assert.throws(
      () =>
        loadSimLibraryCatalog({
          format: "wendoo.catalog/1",
          entries: [],
          moves: { "example-org/moved": { ref: "not-a-reference" } },
        }),
      (thrown: unknown) => thrown instanceof Error && thrown.message.includes("CATALOG_DOCUMENT_INVALID_MOVE_REF")
    );
  });
});

describe("buildEcosimCatalogOffers -- compatibility-filtered against the sim stack", () => {
  const layer: EmbeddedExtension = {
    canonicalOrigin: ECOSIM_LIB_COORDINATE,
    files: [
      { path: "index.ts", content: "export {};" },
      { path: "wendoo.json", content: JSON.stringify({ name: "Sim", version: "0.2.1" }) },
    ],
  };
  /** A bundled add-on targeting the sim layer, as the real teleport and detect manifests declare. */
  function addon(coordinate: string): EmbeddedExtension {
    return {
      canonicalOrigin: coordinate,
      files: [
        { path: "index.ts", content: "export {};" },
        {
          path: "wendoo.json",
          content: JSON.stringify({
            name: coordinate,
            version: "0.1.1",
            targets: { [ECOSIM_LIB_COORDINATE]: { packageVersion: "^0.1.0" } },
          }),
        },
      ],
    };
  }
  const embedRecord: readonly EmbeddedExtension[] = [layer, addon(TELEPORT), addon(DETECT)];
  const project = { [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE };

  test("the seeded teleport and detect offers are compatible with a fresh sim project", () => {
    const offers = buildEcosimCatalogOffers(project, embedRecord);
    assert.deepEqual(offers.map((offer) => offer.coordinate).sort(), [TELEPORT, DETECT].sort());
    for (const offer of offers) {
      assert.equal(offer.ref, `embedded:${offer.coordinate}`);
    }
  });

  test("a project carrying an offer's coordinate drops that offer, leaving the not-installed one", () => {
    const offers = buildEcosimCatalogOffers({ ...project, [TELEPORT]: `embedded:${TELEPORT}` }, embedRecord);
    assert.deepEqual(
      offers.map((offer) => offer.coordinate),
      [DETECT]
    );
  });
});

describe("buildEcosimExtensionEntries -- manifest-map membership drives gh: cards", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const TOP_LIB = "example-org/top-lib";
  const TRANSITIVE_DEP = "example-org/transitive-dep";
  const topRef = `gh:${TOP_LIB}@${SHA}`;
  const transitiveRef = `gh:${TRANSITIVE_DEP}@${SHA}`;

  const ecosimLayer: EmbeddedExtension = {
    canonicalOrigin: ECOSIM_LIB_COORDINATE,
    files: [
      { path: "index.ts", content: "export {};" },
      { path: "wendoo.json", content: JSON.stringify({ name: "Sim", version: "0.2.1" }) },
    ],
  };

  function manifestFiles(name: string): ReadonlyMap<string, string> {
    return new Map([["/wendoo.json", JSON.stringify({ name, version: "1.0.0" })]]);
  }

  test("lists a top-level gh: install from the map and omits a transitive gh: dep held only in the snapshot store", () => {
    const extensions = { [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE, [TOP_LIB]: topRef };
    // The transitive dep's content sits in the fetched-content snapshot store,
    // but its coordinate is NOT in the manifest extensions map.
    const installedContent: FetchedExtensionContentMap = new Map([
      [topRef, manifestFiles("Top Lib")],
      [transitiveRef, manifestFiles("Transitive Dep")],
    ]);
    const entries = buildEcosimExtensionEntries(extensions, [ecosimLayer], installedContent);
    const coordinates = entries.map((entry) => entry.coordinate);
    assert.equal(coordinates.includes(TOP_LIB), true);
    assert.equal(coordinates.includes(TRANSITIVE_DEP), false);
  });
});
