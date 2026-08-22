import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionFetchTransport } from "@wendoo-lang/app-host";
import { ExtensionFetchErrorCode, fetchExtensionSnapshot } from "@wendoo-lang/app-host";

const encoder = new TextEncoder();

/** In-memory transport over content keyed by `<owner>/<repo>@<pin>` and branches keyed by `<owner>/<repo>#<branch>`. */
function createRecordingTransport(options: {
  content?: Record<string, Record<string, Uint8Array>>;
  branches?: Record<string, string>;
}): ExtensionFetchTransport & { requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    async fetchFile(owner, repo, pin, path) {
      requests.push(`file ${owner}/${repo}@${pin} ${path}`);
      const files = options.content?.[`${owner}/${repo}@${pin}`];
      const content = files?.[path];
      if (content === undefined) {
        return { ok: false, kind: "not-found" };
      }
      return { ok: true, content };
    },
    async resolveBranch(owner, repo, branch) {
      requests.push(`branch ${owner}/${repo}#${branch}`);
      const sha = options.branches?.[`${owner}/${repo}#${branch}`];
      if (sha === undefined) {
        return { ok: false, kind: "not-found" };
      }
      return { ok: true, sha };
    },
    async listVersionTags(owner, repo) {
      requests.push(`versions ${owner}/${repo}`);
      return { ok: false, kind: "not-found" };
    },
  };
}

const MANIFEST_TEXT = JSON.stringify({
  name: "Position",
  version: "0.1.0",
  identity: "example-org/position-ext",
  files: ["index.ts", "assets/icon.png"],
});

const ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x0d, 0x0a]);

const SNAPSHOT_FILES: Record<string, Uint8Array> = {
  "wendoo.json": encoder.encode(MANIFEST_TEXT),
  "index.ts": encoder.encode("export const position = 1;\n"),
  "assets/icon.png": ICON_BYTES,
};

describe("fetchExtensionSnapshot", () => {
  it("fetches the manifest first, then exactly the manifest-listed files, byte-faithfully", async () => {
    const transport = createRecordingTransport({
      content: { "example-org/position-ext@v0.1.0": SNAPSHOT_FILES },
    });

    const result = await fetchExtensionSnapshot("gh:example-org/position-ext@v0.1.0", transport);

    assert.ok(result.ok);
    assert.equal(result.snapshot.coordinate, "example-org/position-ext");
    assert.equal(result.snapshot.reference, "gh:example-org/position-ext@v0.1.0");
    assert.equal(result.snapshot.specifier, "v0.1.0");
    assert.equal(result.snapshot.manifest.identity, "example-org/position-ext");
    assert.deepStrictEqual(
      result.snapshot.files.map((file) => file.path),
      ["wendoo.json", "index.ts", "assets/icon.png"]
    );
    assert.deepStrictEqual(result.snapshot.files[2].content, ICON_BYTES);
    assert.deepStrictEqual(transport.requests, [
      "file example-org/position-ext@v0.1.0 wendoo.json",
      "file example-org/position-ext@v0.1.0 index.ts",
      "file example-org/position-ext@v0.1.0 assets/icon.png",
    ]);
  });

  it("forwards an @ pin to the transport verbatim, never parsing it", async () => {
    const pin = "0123456789abcdef0123456789abcdef01234567";
    const transport = createRecordingTransport({
      content: {
        [`example-org/position-ext@${pin}`]: {
          "wendoo.json": encoder.encode(JSON.stringify({ name: "P", version: "0.1.0" })),
        },
      },
    });

    const result = await fetchExtensionSnapshot(`gh:example-org/position-ext@${pin}`, transport);

    assert.ok(result.ok);
    assert.equal(result.snapshot.specifier, pin);
    assert.deepStrictEqual(transport.requests, [`file example-org/position-ext@${pin} wendoo.json`]);
  });

  it("resolves a #branch reference to a commit SHA and fetches that commit", async () => {
    const sha = "89abcdef0123456789abcdef0123456789abcdef";
    const transport = createRecordingTransport({
      branches: { "example-org/position-ext#main": sha },
      content: {
        [`example-org/position-ext@${sha}`]: {
          "wendoo.json": encoder.encode(JSON.stringify({ name: "P", version: "0.2.0", files: ["index.ts"] })),
          "index.ts": encoder.encode("export {};\n"),
        },
      },
    });

    const result = await fetchExtensionSnapshot("gh:example-org/position-ext#main", transport);

    assert.ok(result.ok);
    assert.equal(result.snapshot.specifier, sha);
    assert.equal(result.snapshot.manifest.version, "0.2.0");
    assert.deepStrictEqual(transport.requests, [
      "branch example-org/position-ext#main",
      `file example-org/position-ext@${sha} wendoo.json`,
      `file example-org/position-ext@${sha} index.ts`,
    ]);
  });

  it("fails with INVALID_REFERENCE for a reference that is not a gh form", async () => {
    const transport = createRecordingTransport({});
    for (const reference of ["embedded:a/b", "ffff:p1", "gh:owner/repo", "nonsense"]) {
      const result = await fetchExtensionSnapshot(reference, transport);
      assert.ok(!result.ok);
      assert.equal(result.error.code, ExtensionFetchErrorCode.INVALID_REFERENCE);
      assert.equal(result.error.reference, reference);
    }
    assert.deepStrictEqual(transport.requests, []);
  });

  it("fails with BRANCH_NOT_FOUND when the branch does not resolve", async () => {
    const transport = createRecordingTransport({});
    const result = await fetchExtensionSnapshot("gh:example-org/position-ext#missing", transport);
    assert.ok(!result.ok);
    assert.equal(result.error.code, ExtensionFetchErrorCode.BRANCH_NOT_FOUND);
  });

  it("fails with RATE_LIMITED when branch resolution is rate-limited, never reporting branch-not-found", async () => {
    const rateLimited: ExtensionFetchTransport = {
      async fetchFile() {
        return { ok: false, kind: "not-found" };
      },
      async resolveBranch() {
        return { ok: false, kind: "rate-limited" };
      },
      async listVersionTags() {
        return { ok: false, kind: "not-found" };
      },
    };
    const result = await fetchExtensionSnapshot("gh:example-org/position-ext#main", rateLimited);
    assert.ok(!result.ok);
    assert.equal(result.error.code, ExtensionFetchErrorCode.RATE_LIMITED);
  });

  it("fails with MANIFEST_MISSING when the snapshot has no wendoo.json", async () => {
    const transport = createRecordingTransport({ content: { "example-org/position-ext@v0.1.0": {} } });
    const result = await fetchExtensionSnapshot("gh:example-org/position-ext@v0.1.0", transport);
    assert.ok(!result.ok);
    assert.equal(result.error.code, ExtensionFetchErrorCode.MANIFEST_MISSING);
  });

  it("fails with MANIFEST_UNPARSEABLE when the manifest is not a valid content manifest", async () => {
    const transport = createRecordingTransport({
      content: {
        "example-org/position-ext@v0.1.0": { "wendoo.json": encoder.encode("{ not json") },
      },
    });
    const result = await fetchExtensionSnapshot("gh:example-org/position-ext@v0.1.0", transport);
    assert.ok(!result.ok);
    assert.equal(result.error.code, ExtensionFetchErrorCode.MANIFEST_UNPARSEABLE);
  });

  it("fails with LISTED_FILE_MISSING when a manifest-listed file is absent, producing no partial snapshot", async () => {
    const transport = createRecordingTransport({
      content: {
        "example-org/position-ext@v0.1.0": {
          "wendoo.json": encoder.encode(JSON.stringify({ name: "P", version: "0.1.0", files: ["index.ts"] })),
        },
      },
    });
    const result = await fetchExtensionSnapshot("gh:example-org/position-ext@v0.1.0", transport);
    assert.ok(!result.ok);
    assert.equal(result.error.code, ExtensionFetchErrorCode.LISTED_FILE_MISSING);
    assert.match(result.error.message, /index\.ts/);
  });

  it("maps transport unreachable and http-status answers onto their own codes", async () => {
    const unreachable: ExtensionFetchTransport = {
      async fetchFile() {
        return { ok: false, kind: "unreachable", message: "connection refused" };
      },
      async resolveBranch() {
        return { ok: false, kind: "unreachable", message: "connection refused" };
      },
      async listVersionTags() {
        return { ok: false, kind: "unreachable", message: "connection refused" };
      },
    };
    const unreachableResult = await fetchExtensionSnapshot("gh:a/b@v1", unreachable);
    assert.ok(!unreachableResult.ok);
    assert.equal(unreachableResult.error.code, ExtensionFetchErrorCode.UNREACHABLE);

    const status: ExtensionFetchTransport = {
      async fetchFile() {
        return { ok: false, kind: "http-status", status: 500 };
      },
      async resolveBranch() {
        return { ok: false, kind: "http-status", status: 500 };
      },
      async listVersionTags() {
        return { ok: false, kind: "http-status", status: 500 };
      },
    };
    const statusResult = await fetchExtensionSnapshot("gh:a/b@v1", status);
    assert.ok(!statusResult.ok);
    assert.equal(statusResult.error.code, ExtensionFetchErrorCode.HTTP_STATUS);
    assert.match(statusResult.error.message, /500/);
  });
});
