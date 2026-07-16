import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FetchedExtensionSnapshot } from "@mindcraft-lang/app-host";
import {
  base64ToBytes,
  bytesToBase64,
  decodeInstalledSnapshotFiles,
  fetchedContentFromSnapshots,
  installedExtensionMetadataFromSnapshots,
  installedSnapshotFromFetched,
  parseInstalledExtensionMetadata,
  parseInstalledExtensionSnapshots,
  reconstructInstalledSnapshotsFromTree,
  serializeInstalledExtensionSnapshots,
} from "./fetched-extension-snapshots.js";

const ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]);

describe("fetched extension snapshot records", () => {
  it("round-trips binary bytes through base64", () => {
    assert.deepStrictEqual(base64ToBytes(bytesToBase64(ICON_BYTES)), ICON_BYTES);
    const large = new Uint8Array(200000);
    for (let i = 0; i < large.length; i++) {
      large[i] = i % 256;
    }
    assert.deepStrictEqual(base64ToBytes(bytesToBase64(large)), large);
  });

  it("builds a byte-faithful record from a fetched snapshot and round-trips it through app-data text", () => {
    const fetched: FetchedExtensionSnapshot = {
      coordinate: "example-org/position-ext",
      reference: "gh:example-org/position-ext@v0.1.0",
      specifier: "v0.1.0",
      manifest: { name: "Position", version: "0.1.0", extensions: {} },
      files: [
        { path: "mindcraft.json", content: new TextEncoder().encode('{"name":"Position","version":"0.1.0"}') },
        { path: "assets/icon.png", content: ICON_BYTES },
      ],
    };

    const record = installedSnapshotFromFetched(fetched);
    assert.equal(record.reference, fetched.reference);
    assert.equal(record.specifier, "v0.1.0");
    assert.deepStrictEqual(base64ToBytes(record.files["assets/icon.png"]), ICON_BYTES);

    const raw = serializeInstalledExtensionSnapshots({ "example-org/position-ext": record });
    const parsed = parseInstalledExtensionSnapshots(raw);
    assert.deepStrictEqual(parsed, { "example-org/position-ext": record });
  });

  it("decodes stored files into the leading-slash text map resolution consumes, keyed by reference", () => {
    const record = {
      reference: "gh:example-org/position-ext@v0.1.0",
      specifier: "v0.1.0",
      files: { "index.ts": bytesToBase64(new TextEncoder().encode("export const p = 1;")) },
    };
    const files = decodeInstalledSnapshotFiles(record);
    assert.equal(files.get("/index.ts"), "export const p = 1;");

    const content = fetchedContentFromSnapshots({ "example-org/position-ext": record });
    assert.equal(content.get(record.reference)?.get("/index.ts"), "export const p = 1;");
  });

  it("parses absent or malformed app-data text as an empty record and drops malformed entries", () => {
    assert.deepStrictEqual(parseInstalledExtensionSnapshots(undefined), {});
    assert.deepStrictEqual(parseInstalledExtensionSnapshots("not json"), {});
    assert.deepStrictEqual(parseInstalledExtensionSnapshots("[1]"), {});
    const mixed = JSON.stringify({
      "example-org/good": { reference: "gh:example-org/good@v1", specifier: "v1", files: {} },
      "example-org/bad": { reference: 5 },
    });
    assert.deepStrictEqual(Object.keys(parseInstalledExtensionSnapshots(mixed)), ["example-org/good"]);
  });
});

describe("installed-extensions tree provenance", () => {
  const ORIGIN = "example-org/position-ext";
  const METADATA = { [ORIGIN]: { reference: `gh:${ORIGIN}@v0.1.0`, specifier: "v0.1.0" } };

  it("extracts each record's provenance keyed by origin", () => {
    const snapshots = {
      [ORIGIN]: { reference: `gh:${ORIGIN}@v0.1.0`, specifier: "v0.1.0", files: { "index.ts": "aGk=" } },
    };
    assert.deepStrictEqual(installedExtensionMetadataFromSnapshots(snapshots), METADATA);
  });

  it("parses absent or malformed provenance text as an empty record and drops malformed entries", () => {
    assert.deepStrictEqual(parseInstalledExtensionMetadata(undefined), {});
    assert.deepStrictEqual(parseInstalledExtensionMetadata("not json"), {});
    const mixed = JSON.stringify({
      ...METADATA,
      "example-org/bad": { reference: 5 },
    });
    assert.deepStrictEqual(parseInstalledExtensionMetadata(mixed), METADATA);
  });

  it("rebuilds snapshot records from a materialized tree, scoped to each origin's subtree", () => {
    const snapshots = reconstructInstalledSnapshotsFromTree(METADATA, [
      ["tsconfig.json", "{}"],
      [`.libraries/${ORIGIN}/index.ts`, "export const p = 1;"],
      [`.libraries/${ORIGIN}/docs/readme.md`, "# Position"],
      [".libraries/other-org/other-ext/index.ts", "export const q = 2;"],
    ]);
    const record = snapshots[ORIGIN];
    assert.ok(record);
    assert.equal(record.reference, `gh:${ORIGIN}@v0.1.0`);
    assert.equal(record.specifier, "v0.1.0");
    const files = decodeInstalledSnapshotFiles(record);
    assert.deepStrictEqual([...files.keys()].sort(), ["/docs/readme.md", "/index.ts"]);
    assert.equal(files.get("/index.ts"), "export const p = 1;");
  });

  it("yields no record for an origin whose subtree is absent from the tree", () => {
    assert.deepStrictEqual(reconstructInstalledSnapshotsFromTree(METADATA, [["tsconfig.json", "{}"]]), {});
  });
});
