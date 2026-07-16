import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type {
  ExtensionFetchBranchResult,
  ExtensionFetchFileResult,
  ExtensionFetchResult,
  ExtensionFetchTransport,
  ExtensionVersionListResult,
  FetchedExtensionFile,
  ProjectContentManifest,
  ProjectContentManifestParseResult,
} from "@mindcraft-lang/app-host";
import {
  deriveTargetAppCacheDir,
  ensureCachedTargetAppInStore,
  TargetAppCacheErrorCode,
  type TargetAppCacheFileAccess,
  type TargetAppSource,
} from "./target-app-cache";

const REFERENCE = "gh:mindcraft-lang/microbit-v2@v0.1.0";
const COORDINATE = "mindcraft-lang/microbit-v2";
const SPECIFIER = "v0.1.0";
const CACHE_DIR = `targets/${COORDINATE}/${SPECIFIER}`;

const encoder = new TextEncoder();

/** An in-memory cache-root file store implementing the cache's file access. */
class FakeStore implements TargetAppCacheFileAccess {
  readonly files = new Map<string, Uint8Array>();

  async isDirectory(relPath: string): Promise<boolean> {
    const prefix = `${relPath}/`;
    for (const path of this.files.keys()) {
      if (path.startsWith(prefix)) return true;
    }
    return false;
  }

  async readTextFile(relPath: string): Promise<string | undefined> {
    const bytes = this.files.get(relPath);
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
  }

  async writeFile(relPath: string, content: Uint8Array): Promise<void> {
    this.files.set(relPath, content);
  }
}

/** A transport serving app-bundle files from a path map, counting fetchFile calls. */
function fakeTransport(bundleFiles: Record<string, string>): ExtensionFetchTransport & { calls: number } {
  return {
    calls: 0,
    async fetchFile(_owner, _repo, _pin, path): Promise<ExtensionFetchFileResult> {
      this.calls++;
      const content = bundleFiles[path];
      if (content === undefined) return { ok: false, kind: "not-found" };
      return { ok: true, content: encoder.encode(content) };
    },
    async resolveBranch(): Promise<ExtensionFetchBranchResult> {
      throw new Error("resolveBranch is not used for pinned references");
    },
    async listVersionTags(): Promise<ExtensionVersionListResult> {
      throw new Error("listVersionTags is not used");
    },
  };
}

/** A source that keys the fixture reference and answers with `snapshotResult`, counting fetch calls. */
function fakeSource(snapshotResult: ExtensionFetchResult): TargetAppSource & { fetches: number } {
  return {
    fetches: 0,
    pinnedKey(reference: string) {
      const match = /^gh:([^/]+)\/([^@]+)@(.+)$/.exec(reference);
      return match ? { coordinate: `${match[1]}/${match[2]}`, specifier: match[3] } : undefined;
    },
    async fetchSnapshot(): Promise<ExtensionFetchResult> {
      this.fetches++;
      return snapshotResult;
    },
    parseManifest(text: string): ProjectContentManifestParseResult {
      const parsed = JSON.parse(text) as ProjectContentManifest;
      return { ok: true, manifest: parsed, errors: [] };
    },
  };
}

function manifest(hostApp: ProjectContentManifest["hostApp"], files?: readonly string[]): ProjectContentManifest {
  return {
    name: "Microbit V2",
    version: "0.1.0",
    extensions: {},
    ...(hostApp ? { hostApp } : {}),
    ...(files ? { files } : {}),
  };
}

function snapshot(m: ProjectContentManifest, extraFiles: readonly FetchedExtensionFile[] = []): ExtensionFetchResult {
  const manifestFile: FetchedExtensionFile = {
    path: "mindcraft.json",
    content: encoder.encode(JSON.stringify(m)),
  };
  return {
    ok: true,
    snapshot: {
      coordinate: COORDINATE,
      reference: REFERENCE,
      specifier: SPECIFIER,
      manifest: m,
      files: [manifestFile, ...extraFiles],
    },
  };
}

const APP = { path: "app", files: ["app/index.html", "app/main.js"] } as const;
const APP_BUNDLE = { "app/index.html": "<!doctype html><title>target</title>", "app/main.js": "console.log('x');" };

function failureCode(result: { ok: boolean } & Partial<{ code: string }>): string {
  return result.ok ? "ok" : (result.code as string);
}

describe("deriveTargetAppCacheDir", () => {
  it("keys under targets/<coordinate>/<specifier>", () => {
    assert.strictEqual(deriveTargetAppCacheDir(COORDINATE, SPECIFIER), CACHE_DIR);
  });

  it("rejects a specifier that would escape the cache root", () => {
    assert.strictEqual(deriveTargetAppCacheDir(COORDINATE, ".."), undefined);
    assert.strictEqual(deriveTargetAppCacheDir(COORDINATE, "a/../../b"), undefined);
  });
});

describe("ensureCachedTargetAppInStore", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it("fetches and materializes on a miss, returning the app dir from app.path", async () => {
    const source = fakeSource(snapshot(manifest(APP)));
    const transport = fakeTransport(APP_BUNDLE);
    const result = await ensureCachedTargetAppInStore(store, REFERENCE, source, transport);
    assert.deepStrictEqual(result, { ok: true, appDir: `${CACHE_DIR}/app` });
    assert.strictEqual(source.fetches, 1);
    assert.ok(store.files.has(`${CACHE_DIR}/mindcraft.json`));
    assert.ok(store.files.has(`${CACHE_DIR}/app/index.html`));
    assert.ok(store.files.has(`${CACHE_DIR}/app/main.js`));
    // The served index.html sits directly under the returned app dir.
    if (result.ok) {
      assert.ok(store.files.has(`${result.appDir}/index.html`));
    }
  });

  it("returns from the cache on a hit without touching source or transport", async () => {
    await ensureCachedTargetAppInStore(
      store,
      REFERENCE,
      fakeSource(snapshot(manifest(APP))),
      fakeTransport(APP_BUNDLE)
    );
    const source = fakeSource(snapshot(manifest(APP)));
    const transport = fakeTransport(APP_BUNDLE);
    const result = await ensureCachedTargetAppInStore(store, REFERENCE, source, transport);
    assert.deepStrictEqual(result, { ok: true, appDir: `${CACHE_DIR}/app` });
    assert.strictEqual(source.fetches, 0);
    assert.strictEqual(transport.calls, 0);
  });

  it("fails with FETCH_FAILED when the snapshot cannot be fetched", async () => {
    const source = fakeSource({
      ok: false,
      error: { code: "EXTENSION_FETCH_MANIFEST_MISSING", reference: REFERENCE, message: "missing" },
    });
    const result = await ensureCachedTargetAppInStore(store, REFERENCE, source, fakeTransport({}));
    assert.strictEqual(failureCode(result), TargetAppCacheErrorCode.FETCH_FAILED);
  });

  it("fails with MANIFEST_HAS_NO_APP when the manifest declares no app", async () => {
    const result = await ensureCachedTargetAppInStore(
      store,
      REFERENCE,
      fakeSource(snapshot(manifest(undefined))),
      fakeTransport(APP_BUNDLE)
    );
    assert.strictEqual(failureCode(result), TargetAppCacheErrorCode.MANIFEST_HAS_NO_APP);
    assert.strictEqual(store.files.size, 0);
  });

  it("rejects an escaping app-bundle path and writes nothing", async () => {
    const result = await ensureCachedTargetAppInStore(
      store,
      REFERENCE,
      fakeSource(snapshot(manifest({ path: "app", files: ["../escape.js"] }))),
      fakeTransport({ "app/index.html": "<!doctype html>" })
    );
    assert.strictEqual(failureCode(result), TargetAppCacheErrorCode.SNAPSHOT_PATH_UNSAFE);
    assert.strictEqual(store.files.size, 0);
  });

  it("rejects an escaping top-level snapshot path and writes nothing", async () => {
    const escaping: FetchedExtensionFile = { path: "../escape.ts", content: encoder.encode("escaped") };
    const result = await ensureCachedTargetAppInStore(
      store,
      REFERENCE,
      fakeSource(snapshot(manifest(APP, ["../escape.ts"]), [escaping])),
      fakeTransport(APP_BUNDLE)
    );
    assert.strictEqual(failureCode(result), TargetAppCacheErrorCode.SNAPSHOT_PATH_UNSAFE);
    assert.strictEqual(store.files.size, 0);
  });

  it("rejects a reference whose specifier escapes the cache root without fetching", async () => {
    const source = fakeSource(snapshot(manifest(APP)));
    const transport = fakeTransport(APP_BUNDLE);
    const result = await ensureCachedTargetAppInStore(store, "gh:mindcraft-lang/microbit-v2@..", source, transport);
    assert.strictEqual(failureCode(result), TargetAppCacheErrorCode.SNAPSHOT_PATH_UNSAFE);
    assert.strictEqual(source.fetches, 0);
    assert.strictEqual(transport.calls, 0);
    assert.strictEqual(store.files.size, 0);
  });
});
