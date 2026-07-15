import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  checkExtensionReferenceUpdate,
  createJsDelivrExtensionTransport,
  fetchExtensionSnapshot,
  JSDELIVR_CDN_BASE_URL,
  resolveExtensionAddInput,
} from "@mindcraft-lang/app-host";

const LIVE_COORDINATE = "mindcraft-lang/codal-position-ext";
const LIVE_TAG = "v0.1.0";

/**
 * Commit SHA of the `v0.1.0` tag on mindcraft-lang/codal-position-ext,
 * resolved once (read-only) and pinned here as the published contract
 * guarantees tag immutability.
 */
const LIVE_TAG_COMMIT_SHA = "b19b80b029a77303ee575d3ff9b29adbf7021b23";

const PROBE_TIMEOUT_MS = 15000;

/** True when the live jsDelivr CDN answers within the probe timeout. */
async function liveCdnAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${JSDELIVR_CDN_BASE_URL}/gh/${LIVE_COORDINATE}@${LIVE_TAG}/mindcraft.json`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

describe("live jsDelivr probes (self-skipping offline)", () => {
  let online = false;

  before(async () => {
    online = await liveCdnAvailable();
  });

  it("fetches the published v0.1.0 snapshot by tag with its manifest identity and exact files list", async (t) => {
    if (!online) return t.skip("jsDelivr is unreachable");

    const result = await fetchExtensionSnapshot(
      `gh:${LIVE_COORDINATE}@${LIVE_TAG}`,
      createJsDelivrExtensionTransport()
    );

    assert.ok(result.ok, result.ok ? "" : result.error.message);
    assert.equal(result.snapshot.coordinate, LIVE_COORDINATE);
    assert.equal(result.snapshot.specifier, LIVE_TAG);
    assert.equal(result.snapshot.manifest.identity, LIVE_COORDINATE);
    assert.equal(result.snapshot.manifest.version, "0.1.0");
    // The snapshot carries mindcraft.json plus exactly the manifest-listed files.
    assert.deepStrictEqual(
      result.snapshot.files.map((file) => file.path),
      ["mindcraft.json", ...(result.snapshot.manifest.files ?? [])]
    );
    for (const file of result.snapshot.files) {
      assert.ok(file.content.byteLength > 0, `expected bytes for ${file.path}`);
    }
  });

  it("fetches the same content by the tag's full 40-character commit SHA, which the CDN pins as an immutable commit", async (t) => {
    if (!online) return t.skip("jsDelivr is unreachable");

    const transport = createJsDelivrExtensionTransport();
    const byTag = await fetchExtensionSnapshot(`gh:${LIVE_COORDINATE}@${LIVE_TAG}`, transport);
    const bySha = await fetchExtensionSnapshot(`gh:${LIVE_COORDINATE}@${LIVE_TAG_COMMIT_SHA}`, transport);

    assert.ok(byTag.ok && bySha.ok);
    assert.equal(bySha.snapshot.specifier, LIVE_TAG_COMMIT_SHA);
    assert.deepStrictEqual(
      bySha.snapshot.files.map((file) => [file.path, Buffer.from(file.content).toString("base64")]),
      byTag.snapshot.files.map((file) => [file.path, Buffer.from(file.content).toString("base64")])
    );

    // Finding: the CDN classifies only the full 40-character form as an
    // immutable commit; an abbreviated SHA is served but classified (and
    // cached) as a mutable branch-like specifier.
    const fullForm = await fetch(
      `${JSDELIVR_CDN_BASE_URL}/gh/${LIVE_COORDINATE}@${LIVE_TAG_COMMIT_SHA}/mindcraft.json`,
      { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }
    );
    assert.equal(fullForm.headers.get("x-jsd-version-type"), "commit");
    const shortForm = await fetch(
      `${JSDELIVR_CDN_BASE_URL}/gh/${LIVE_COORDINATE}@${LIVE_TAG_COMMIT_SHA.slice(0, 7)}/mindcraft.json`,
      { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }
    );
    t.diagnostic(
      `abbreviated SHA: status ${shortForm.status}, x-jsd-version-type ${shortForm.headers.get("x-jsd-version-type")}`
    );
    assert.equal(shortForm.headers.get("x-jsd-version-type"), "branch");
  });

  it("installs a #branch reference end to end: GitHub API resolves the head SHA, jsDelivr serves that commit", async (t) => {
    if (!online) return t.skip("jsDelivr is unreachable");

    const transport = createJsDelivrExtensionTransport();
    const resolved = await transport.resolveBranch("mindcraft-lang", "codal-position-ext", "main");
    t.diagnostic(`resolveBranch(main) -> ${JSON.stringify(resolved)}`);
    if (!resolved.ok && (resolved.kind === "rate-limited" || resolved.kind === "unreachable")) {
      return t.skip(`GitHub API unavailable: ${resolved.kind}`);
    }
    assert.ok(resolved.ok);
    assert.match(resolved.sha, /^[0-9a-f]{40}$/);

    const result = await fetchExtensionSnapshot(`gh:${LIVE_COORDINATE}#main`, transport);
    assert.ok(result.ok, result.ok ? "" : result.error.message);
    // The snapshot records the resolved commit SHA, not the branch name.
    assert.equal(result.snapshot.specifier, resolved.sha);
    assert.equal(result.snapshot.manifest.identity, LIVE_COORDINATE);
  });

  it("answers not-found for a branch the repository does not have", async (t) => {
    if (!online) return t.skip("jsDelivr is unreachable");

    const resolved = await createJsDelivrExtensionTransport().resolveBranch(
      "mindcraft-lang",
      "codal-position-ext",
      "definitely-absent-branch"
    );
    if (!resolved.ok && (resolved.kind === "rate-limited" || resolved.kind === "unreachable")) {
      return t.skip(`GitHub API unavailable: ${resolved.kind}`);
    }
    assert.deepStrictEqual(resolved, { ok: false, kind: "not-found" });
  });

  it("normalizes a pasted repository URL to the latest published version and installs it", async (t) => {
    if (!online) return t.skip("jsDelivr is unreachable");

    const transport = createJsDelivrExtensionTransport();
    const resolved = await resolveExtensionAddInput(`https://github.com/${LIVE_COORDINATE}`, transport);
    assert.deepStrictEqual(resolved, { ok: true, reference: `gh:${LIVE_COORDINATE}@0.1.0` });

    const installed = await fetchExtensionSnapshot(resolved.ok ? resolved.reference : "", transport);
    assert.ok(installed.ok, installed.ok ? "" : installed.error.message);
    assert.equal(installed.snapshot.manifest.identity, LIVE_COORDINATE);
    assert.equal(installed.snapshot.manifest.version, "0.1.0");
  });

  it("lists the published versions through the data API and reports no update available for the installed v0.1.0", async (t) => {
    if (!online) return t.skip("jsDelivr is unreachable");

    const transport = createJsDelivrExtensionTransport();
    // Finding: /v1/packages/gh/<owner>/<repo> lists the repository's tags as
    // versions with a leading "v" stripped; the tag v0.1.0 lists as "0.1.0",
    // and the CDN serves both the "@0.1.0" and "@v0.1.0" pin forms.
    const listed = await transport.listVersionTags("mindcraft-lang", "codal-position-ext");
    t.diagnostic(`listVersionTags -> ${JSON.stringify(listed)}`);
    assert.ok(listed.ok);
    assert.ok(listed.versions.includes("0.1.0"));

    const check = await checkExtensionReferenceUpdate({
      reference: `gh:${LIVE_COORDINATE}@${LIVE_TAG}`,
      installedSpecifier: LIVE_TAG,
      installedVersion: "0.1.0",
      transport,
    });
    assert.deepStrictEqual(check, { ok: true, updateAvailable: false });
  });
});
