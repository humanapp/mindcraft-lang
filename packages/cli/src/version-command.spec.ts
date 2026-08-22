import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, describe, it } from "node:test";
import { makeScratchDir, runCliBin, writeProjectFiles } from "./test-support/publish-fixtures.js";

const scratchDirs: string[] = [];

async function scratch(): Promise<string> {
  const dir = await makeScratchDir();
  scratchDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of scratchDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function readManifest(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(dir, "wendoo.json"), "utf8")) as Record<string, unknown>;
}

describe("wendoo version", () => {
  it("increments each component and writes the new version back to the manifest", async () => {
    const cases: ReadonlyArray<[string, string, string]> = [
      ["patch", "1.2.3", "1.2.4"],
      ["minor", "1.2.3", "1.3.0"],
      ["major", "1.2.3", "2.0.0"],
    ];
    for (const [component, from, expected] of cases) {
      const project = await scratch();
      await writeProjectFiles(project, {
        "wendoo.json": JSON.stringify({ name: "Blinker", version: from }, null, 2),
      });

      const result = await runCliBin(project, "version", component);

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`version ${expected.replace(/\./g, "\\.")}`));
      assert.equal((await readManifest(project)).version, expected);
    }
  });

  it("preserves other manifest fields, including a build-version stamp, while bumping the version", async () => {
    const project = await scratch();
    await writeProjectFiles(project, {
      "wendoo.json": JSON.stringify(
        {
          name: "Microbit V2",
          version: "0.9.1",
          identity: "example-org/microbit",
          hostApp: { path: "app", files: ["app/index.html"] },
          buildVersion: "0.9.1",
        },
        null,
        2
      ),
    });

    const result = await runCliBin(project, "version", "patch");

    assert.equal(result.code, 0, result.stderr);
    const manifest = await readManifest(project);
    assert.equal(manifest.version, "0.9.2");
    assert.equal(manifest.identity, "example-org/microbit");
    assert.deepEqual(manifest.hostApp, { path: "app", files: ["app/index.html"] });
    // The stamp is left at the packaged version, so a publish before repackaging
    // detects the drift.
    assert.equal(manifest.buildVersion, "0.9.1");
  });

  it("refuses when the directory has no manifest", async () => {
    const project = await scratch();
    const result = await runCliBin(project, "version", "patch");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /VERSION_MANIFEST_MISSING/);
  });

  it("rejects a missing or unknown component with usage output", async () => {
    const project = await scratch();
    await writeProjectFiles(project, {
      "wendoo.json": JSON.stringify({ name: "Blinker", version: "1.0.0" }, null, 2),
    });

    const missing = await runCliBin(project, "version");
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /usage: wendoo version/);

    const unknown = await runCliBin(project, "version", "huge");
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /usage: wendoo version/);
    // A refused bump does not touch the manifest.
    assert.equal((await readManifest(project)).version, "1.0.0");
  });
});
