import assert from "node:assert/strict";
import { resolveObjectURL } from "node:buffer";
import { describe, it } from "node:test";
import { createInMemoryProjectFileSystem } from "@wendoo/app-host";
import { createVfsAssetUrlProvider } from "./vfs-asset-url-provider.js";

const ICON_PATH = "tiles/icon.svg";
const ICON_SVG = '<svg id="icon"></svg>';
const ICON_SVG_V2 = '<svg id="icon-v2"></svg>';

const PNG_PATH = "tiles/icon.png";
/** The first bytes of a real PNG: signature plus the IHDR chunk header. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function createFixture() {
  const filesystem = createInMemoryProjectFileSystem();
  filesystem.applyLocalChange({ action: "write", path: ICON_PATH, content: ICON_SVG, newEtag: "e0" });
  filesystem.applyLocalChange({ action: "write", path: PNG_PATH, content: PNG_BYTES, newEtag: "e1" });
  let revision = 0;
  const provider = createVfsAssetUrlProvider({
    getProjectFileSystem: () => filesystem,
    getVfsRevision: () => revision,
  });
  return {
    filesystem,
    provider,
    bumpRevision: () => {
      revision++;
    },
  };
}

async function readObjectUrl(url: string): Promise<{ type: string; text: string; bytes: Uint8Array }> {
  const blob = resolveObjectURL(url);
  assert.ok(blob, `object URL ${url} must resolve to a blob`);
  return { type: blob.type, text: await blob.text(), bytes: new Uint8Array(await blob.arrayBuffer()) };
}

describe("createVfsAssetUrlProvider", () => {
  it("mints an object URL carrying the snapshot's svg content and MIME type", async () => {
    const { provider } = createFixture();

    const url = provider.resolveAssetUrl(`/vfs/${ICON_PATH}`);
    assert.ok(url.startsWith("blob:"), "a /vfs/ path resolves to an object URL");

    const { type, text } = await readObjectUrl(url);
    assert.equal(type, "image/svg+xml");
    assert.equal(text, ICON_SVG);
  });

  it("returns the cached URL for the same path at the same revision", () => {
    const { provider } = createFixture();

    const first = provider.resolveAssetUrl(`/vfs/${ICON_PATH}`);
    const second = provider.resolveAssetUrl(`/vfs/${ICON_PATH}`);
    assert.equal(second, first);
  });

  it("re-mints fresh content and revokes the superseded generation when the revision advances", async () => {
    const { filesystem, provider, bumpRevision } = createFixture();

    const stale = provider.resolveAssetUrl(`/vfs/${ICON_PATH}`);
    filesystem.applyLocalChange({ action: "write", path: ICON_PATH, content: ICON_SVG_V2, newEtag: "e2" });
    bumpRevision();

    const fresh = provider.resolveAssetUrl(`/vfs/${ICON_PATH}`);
    assert.notEqual(fresh, stale, "the new generation mints a new URL");
    const { text } = await readObjectUrl(fresh);
    assert.equal(text, ICON_SVG_V2, "the new URL carries the recompiled content");

    assert.equal(resolveObjectURL(stale), undefined, "the superseded generation's URL is revoked");
  });

  it("mints a png object URL whose bytes are the file's bytes", async () => {
    const { provider } = createFixture();

    const url = provider.resolveAssetUrl(`/vfs/${PNG_PATH}`);
    const { type, bytes } = await readObjectUrl(url);
    assert.equal(type, "image/png");
    assert.deepEqual([...bytes], [...PNG_BYTES], "the blob carries the source bytes, not a UTF-8 re-encoding");
  });

  it("returns non-vfs URLs and unknown vfs paths unchanged", () => {
    const { provider } = createFixture();

    assert.equal(provider.resolveAssetUrl("/assets/brain/icons/page3.svg"), "/assets/brain/icons/page3.svg");
    assert.equal(provider.resolveAssetUrl("/vfs/missing.svg"), "/vfs/missing.svg");
  });
});
