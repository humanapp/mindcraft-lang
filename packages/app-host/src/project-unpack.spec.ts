import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WENDOO_PROJECT_FORMAT } from "@wendoo/service-api";
import type { WendooProjectDocument } from "./project-io.js";
import { buildUnpackedTree, isUnpackRefusal, UnpackErrorCode } from "./project-unpack.js";

const TILE_SOURCE = 'import { Sensor } from "wendoo";\nexport default Sensor({ name: "probe" });\n';

/** A document whose embedded manifest carries brains and an app chunk but declares no files list. */
function sampleDocument(manifestOverrides: Record<string, unknown> = {}): WendooProjectDocument {
  return {
    format: WENDOO_PROJECT_FORMAT,
    manifest: {
      name: "Rover",
      version: "0.2.0",
      description: "A rover project",
      extensions: { "example-org/position": "gh:example-org/position@v1.2.0" },
      brains: { main: { rules: [1, 2, 3] } },
      app: { "@example/app": { actors: [{ archetype: "rover", desiredCount: 2 }] } },
      ...manifestOverrides,
    },
    contents: {
      "wendoo.json": "{ stale generated file that must be dropped }",
      "tiles/probe.ts": TILE_SOURCE,
      "notes.txt": "scratch notes\n",
    },
  };
}

function unpackedManifest(document: WendooProjectDocument, coordinate?: string): Record<string, unknown> {
  const tree = buildUnpackedTree(document, coordinate);
  assert.equal(isUnpackRefusal(tree), false);
  if (isUnpackRefusal(tree)) {
    throw new Error("unreachable");
  }
  return JSON.parse(tree.manifestText) as Record<string, unknown>;
}

describe("buildUnpackedTree", () => {
  it("drops wendoo.json from the contents and synthesizes a files list when none is declared", () => {
    const document = sampleDocument();
    const tree = buildUnpackedTree(document, undefined);
    assert.equal(isUnpackRefusal(tree), false);
    if (isUnpackRefusal(tree)) {
      throw new Error("unreachable");
    }

    assert.deepEqual(
      tree.files.map((file) => file.path),
      ["tiles/probe.ts", "notes.txt"]
    );
    assert.equal(tree.declaredFilesList, false);

    const manifest = unpackedManifest(document);
    assert.deepEqual(manifest.files, ["tiles/probe.ts", "notes.txt"]);
    assert.equal("format" in manifest, false);
    assert.equal("contents" in manifest, false);
  });

  it("preserves a files list the embedded manifest declares", () => {
    const document = sampleDocument({ files: ["tiles/probe.ts"] });
    const tree = buildUnpackedTree(document, undefined);
    assert.equal(isUnpackRefusal(tree), false);
    if (isUnpackRefusal(tree)) {
      throw new Error("unreachable");
    }
    assert.equal(tree.declaredFilesList, true);
    assert.deepEqual(unpackedManifest(document).files, ["tiles/probe.ts"]);
  });

  it("records the published identity only when a coordinate is passed", () => {
    assert.equal("identity" in unpackedManifest(sampleDocument()), false);
    assert.equal(unpackedManifest(sampleDocument(), "example-org/rover").identity, "example-org/rover");
  });

  it("carries the embedded brains and app chunks through verbatim", () => {
    const manifest = unpackedManifest(sampleDocument());
    assert.deepEqual(manifest.brains, { main: { rules: [1, 2, 3] } });
    assert.deepEqual(manifest.app, { "@example/app": { actors: [{ archetype: "rover", desiredCount: 2 }] } });
  });

  it("refuses a document whose embedded manifest is not a valid content manifest", () => {
    const tree = buildUnpackedTree(sampleDocument({ ambient: 5 }), undefined);
    assert.equal(isUnpackRefusal(tree), true);
    if (!isUnpackRefusal(tree)) {
      throw new Error("unreachable");
    }
    assert.equal(tree.code, UnpackErrorCode.DOCUMENT_INVALID);
    assert.match(tree.message, /PROJECT_MANIFEST_INVALID_AMBIENT/);
  });
});
