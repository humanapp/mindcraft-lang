import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionCatalogDocumentEntry } from "./extension-catalog-document.js";
import { parseProjectContentManifest } from "./project-content-manifest.js";
import { registryTargetEntry, seedProjectTargets } from "./project-target-seed.js";

const TARGET_COORDINATE = "wendoo-lang/trg-ecosim";
const OTHER_TARGET_COORDINATE = "wendoo-lang/trg-microbit-v2";

/** Registry entries a `wendoo.json` import or unpack seeds a target from. */
const CATALOG: readonly Pick<ExtensionCatalogDocumentEntry, "coordinate" | "kind" | "version">[] = [
  { coordinate: TARGET_COORDINATE, kind: "target", version: "0.1.0" },
  { coordinate: OTHER_TARGET_COORDINATE, kind: "target", version: "0.9.2" },
  { coordinate: "wendoo-lang/lib-cutebot", kind: "library", version: "1.4.0" },
];

/** A `wendoo.json` text declaring `extensions` (by coordinate) and optionally `targets`. */
function manifestText(
  extensions: Readonly<Record<string, string>>,
  targets?: Readonly<Record<string, { packageVersion: string }>>
): string {
  return JSON.stringify({ name: "Imported", version: "0.1.0", extensions, ...(targets ? { targets } : {}) }, null, 2);
}

describe("registryTargetEntry", () => {
  it("floors the package version at a caret range", () => {
    assert.deepEqual(registryTargetEntry("0.3.0"), { packageVersion: "^0.3.0" });
  });
});

describe("seedProjectTargets", () => {
  it("seeds the compatibility target for the single declared registry target", () => {
    const seeded = seedProjectTargets(manifestText({ [TARGET_COORDINATE]: `embedded:${TARGET_COORDINATE}` }), CATALOG);
    const parsed = parseProjectContentManifest(seeded);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.manifest.targets, { [TARGET_COORDINATE]: { packageVersion: "^0.1.0" } });
  });

  it("preserves all other manifest fields when seeding", () => {
    const source = JSON.stringify(
      {
        name: "Imported",
        version: "0.1.0",
        description: "A seeded project",
        extensions: { [TARGET_COORDINATE]: `embedded:${TARGET_COORDINATE}` },
        files: ["tiles/probe.ts"],
      },
      null,
      2
    );
    const parsed = parseProjectContentManifest(seedProjectTargets(source, CATALOG));
    assert.ok(parsed.ok);
    assert.equal(parsed.manifest.description, "A seeded project");
    assert.deepEqual(parsed.manifest.files, ["tiles/probe.ts"]);
    assert.deepEqual(parsed.manifest.targets, { [TARGET_COORDINATE]: { packageVersion: "^0.1.0" } });
  });

  it("leaves an already-declared target entry untouched", () => {
    const text = manifestText(
      { [TARGET_COORDINATE]: `embedded:${TARGET_COORDINATE}` },
      { [TARGET_COORDINATE]: { packageVersion: "^9.9.9" } }
    );
    assert.equal(seedProjectTargets(text, CATALOG), text);
  });

  it("seeds nothing when no declared extension is a registry target", () => {
    const text = manifestText({ "acme/lib-widget": `gh:acme/lib-widget@${"a".repeat(40)}` });
    assert.equal(seedProjectTargets(text, CATALOG), text);
  });

  it("ignores a declared coordinate that is a non-target catalog entry", () => {
    const text = manifestText({ "wendoo-lang/lib-cutebot": "embedded:wendoo-lang/lib-cutebot" });
    assert.equal(seedProjectTargets(text, CATALOG), text);
  });

  it("seeds nothing when more than one declared extension is a registry target", () => {
    const text = manifestText({
      [TARGET_COORDINATE]: `embedded:${TARGET_COORDINATE}`,
      [OTHER_TARGET_COORDINATE]: `embedded:${OTHER_TARGET_COORDINATE}`,
    });
    assert.equal(seedProjectTargets(text, CATALOG), text);
  });

  it("returns unparseable manifest text unchanged", () => {
    assert.equal(seedProjectTargets("{not json", CATALOG), "{not json");
  });
});
