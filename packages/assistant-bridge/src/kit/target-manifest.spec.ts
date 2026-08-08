import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { readTargetIdentity, targetManifestPath } from "./target-manifest.js";

/** Temporary trees this file created, removed once it finishes. */
const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

/** A fresh app directory whose published manifest holds `manifest`. */
async function appWithManifest(manifest: unknown): Promise<string> {
  const appDir = await mkdtemp(join(tmpdir(), "target-manifest-"));
  roots.push(appDir);
  const path = targetManifestPath(appDir);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(manifest), "utf8");
  return appDir;
}

describe("reading the identity a target app declares", () => {
  test("returns the identity the published manifest declares", async () => {
    const appDir = await appWithManifest({ identity: "example-target", version: "1.0.0" });

    assert.equal(readTargetIdentity(appDir), "example-target");
  });

  test("throws when the manifest declares an empty identity", async () => {
    const appDir = await appWithManifest({ identity: "", version: "1.0.0" });

    assert.throws(() => readTargetIdentity(appDir));
  });

  test("throws when the app publishes no manifest", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "target-manifest-"));
    roots.push(appDir);

    assert.throws(() => readTargetIdentity(appDir));
  });
});
