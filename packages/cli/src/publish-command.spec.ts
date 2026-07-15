import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  cloneAtTag,
  initBareRemote,
  initCheckoutProject,
  listProjectFiles,
  makeScratchDir,
  runCliBin,
  runGit,
  writeProjectFiles,
} from "./test-support/publish-fixtures.js";

const BINARY_CONTENT = Uint8Array.from({ length: 256 }, (_, index) => index);

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

async function readManifestVersion(dir: string): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(dir, "mindcraft.json"), "utf8")) as { version: string };
  return manifest.version;
}

describe("mindcraft publish to a remote (constructed mode)", () => {
  it("publishes exactly the manifest-described tree, tagged and version-matched", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const project = path.join(root, "project");
    await writeProjectFiles(project, {
      "mindcraft.json": JSON.stringify(
        { name: "Blinker", version: "0.1.0", files: ["index.ts", "assets/logo.bin"] },
        null,
        2
      ),
      "index.ts": "export const blink = true;\n",
      "assets/logo.bin": BINARY_CONTENT,
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
    });

    const result = await runCliBin(project, "publish", "patch", "--remote", remote);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /published 0\.1\.1 \(tag v0\.1\.1\)/);

    const clone = await cloneAtTag(root, remote, "v0.1.1");
    assert.deepEqual(await listProjectFiles(clone), ["assets/logo.bin", "index.ts", "mindcraft.json"]);
    assert.equal(existsSync(path.join(clone, "tsconfig.json")), false);
    assert.equal(await readManifestVersion(clone), "0.1.1");
    assert.equal(await readFile(path.join(clone, "index.ts"), "utf8"), "export const blink = true;\n");
    const published = new Uint8Array(await readFile(path.join(clone, "assets/logo.bin")));
    assert.deepEqual(Array.from(published), Array.from(BINARY_CONTENT));
  });

  it("carries unknown manifest fields through the bump byte-faithfully", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const project = path.join(root, "project");
    const original = JSON.stringify(
      {
        name: "Blinker",
        version: "0.1.0",
        files: ["index.ts"],
        brains: { main: { rules: [1, 2, 3], nested: { deep: true } } },
        appChunk: ["verbatim", null, 4],
      },
      null,
      2
    );
    await writeProjectFiles(project, { "mindcraft.json": original, "index.ts": "export {};\n" });

    const result = await runCliBin(project, "publish", "patch", "--remote", remote);

    assert.equal(result.code, 0, result.stderr);
    const clone = await cloneAtTag(root, remote, "v0.1.1");
    const published = await readFile(path.join(clone, "mindcraft.json"), "utf8");
    assert.equal(published, original.replace('"version": "0.1.0"', '"version": "0.1.1"'));
  });

  it("refuses to republish when the source manifest was not bumped", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const project = path.join(root, "project");
    await writeProjectFiles(project, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.1.0", files: ["index.ts"] }, null, 2),
      "index.ts": "export {};\n",
    });

    const first = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(first.code, 0, first.stderr);

    const second = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(second.code, 1);
    assert.match(second.stderr, /PUBLISH_VERSION_ALREADY_PUBLISHED/);
  });

  it("refuses local dependencies without --yes and proceeds with it", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const project = path.join(root, "project");
    await writeProjectFiles(project, {
      "mindcraft.json": JSON.stringify(
        { name: "Blinker", version: "0.1.0", extensions: { "author/scratch": "local:project-1" } },
        null,
        2
      ),
    });

    const refused = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /PUBLISH_LOCAL_DEPENDENCIES_UNCONFIRMED/);
    assert.match(refused.stderr, /--yes/);

    const confirmed = await runCliBin(project, "publish", "patch", "--remote", remote, "--yes");
    assert.equal(confirmed.code, 0, confirmed.stderr);
  });

  it("refuses a manifest-listed file that is missing or outside the project", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const project = path.join(root, "project");
    await writeProjectFiles(project, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.1.0", files: ["ghost.ts"] }, null, 2),
    });

    const missing = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /PUBLISH_LISTED_FILE_MISSING/);
    assert.match(missing.stderr, /ghost\.ts/);

    await writeProjectFiles(root, { "outside.txt": "outside\n" });
    await writeProjectFiles(project, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.1.0", files: ["../outside.txt"] }, null, 2),
    });
    const escaped = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(escaped.code, 1);
    assert.match(escaped.stderr, /PUBLISH_LISTED_FILE_MISSING/);
  });

  it("refuses a directory without a manifest", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const project = path.join(root, "project");
    await writeProjectFiles(project, { "index.ts": "export {};\n" });

    const result = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /PUBLISH_MANIFEST_MISSING/);
  });
});

describe("mindcraft publish in a checkout (in-place mode)", () => {
  it("bumps, commits, tags, and pushes branch and tag to origin", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const checkout = await initCheckoutProject(root, remote, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.2.0" }, null, 2),
      "index.ts": "export const blink = true;\n",
    });

    const result = await runCliBin(checkout, "publish", "minor");

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /published 0\.3\.0 \(tag v0\.3\.0\)/);
    assert.equal(await readManifestVersion(checkout), "0.3.0");
    assert.equal((await runGit(checkout, "status", "--porcelain")).trim(), "");

    const clone = await cloneAtTag(root, remote, "v0.3.0");
    assert.equal(await readManifestVersion(clone), "0.3.0");
    assert.equal(existsSync(path.join(clone, "index.ts")), true);
    const branchClone = path.join(root, "clone-main");
    await runGit(root, "clone", "--quiet", "--branch", "main", remote, branchClone);
    assert.equal(await readManifestVersion(branchClone), "0.3.0");
  });

  it("refuses a dirty working tree", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const checkout = await initCheckoutProject(root, remote, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.2.0" }, null, 2),
      "index.ts": "export const blink = true;\n",
    });
    await writeProjectFiles(checkout, { "index.ts": "export const blink = false;\n" });

    const result = await runCliBin(checkout, "publish", "patch");

    assert.equal(result.code, 1);
    assert.match(result.stderr, /PUBLISH_UNCOMMITTED_CHANGES/);
    assert.equal((await runGit(checkout, "tag", "--list")).trim(), "");
  });

  it("refuses a publish onto an existing tag", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const checkout = await initCheckoutProject(root, remote, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.2.0" }, null, 2),
    });

    const first = await runCliBin(checkout, "publish", "patch");
    assert.equal(first.code, 0, first.stderr);

    await writeProjectFiles(checkout, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.2.0" }, null, 2),
    });
    await runGit(checkout, "add", "--all");
    await runGit(checkout, "commit", "--quiet", "-m", "revert version");

    const second = await runCliBin(checkout, "publish", "patch");
    assert.equal(second.code, 1);
    assert.match(second.stderr, /PUBLISH_TAG_EXISTS/);
  });
});

describe("mindcraft command surface", () => {
  it("rejects missing and unknown arguments with usage output", async () => {
    const root = await scratch();

    const noCommand = await runCliBin(root);
    assert.equal(noCommand.code, 1);
    assert.match(noCommand.stderr, /usage: mindcraft <command>/);

    const unknownCommand = await runCliBin(root, "frobnicate");
    assert.equal(unknownCommand.code, 1);
    assert.match(unknownCommand.stderr, /unknown command "frobnicate"/);

    const badBump = await runCliBin(root, "publish", "huge");
    assert.equal(badBump.code, 1);
    assert.match(badBump.stderr, /usage: mindcraft publish/);

    const noBump = await runCliBin(root, "publish");
    assert.equal(noBump.code, 1);
    assert.match(noBump.stderr, /expected a version bump/);
  });
});

const CODAL_POSITION_EXT_DIR = fileURLToPath(
  new URL("../../../../../apps/microbit-sim/extensions/codal-position-ext", import.meta.url)
);

describe("publishing the codal-position extension content", () => {
  it(
    "publishes exactly its manifest-described tree to a local remote",
    { skip: existsSync(CODAL_POSITION_EXT_DIR) ? false : "codal-position-ext content not present in this checkout" },
    async () => {
      const root = await scratch();
      const remote = await initBareRemote(root);

      const result = await runCliBin(root, "publish", "patch", "--dir", CODAL_POSITION_EXT_DIR, "--remote", remote);

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /published 0\.1\.1 \(tag v0\.1\.1\)/);

      const clone = await cloneAtTag(root, remote, "v0.1.1");
      assert.deepEqual(await listProjectFiles(clone), ["index.ts", "mindcraft.json"]);
      assert.equal(existsSync(path.join(clone, "tsconfig.json")), false);
      assert.equal(await readManifestVersion(clone), "0.1.1");
      const sourceIndex = await readFile(path.join(CODAL_POSITION_EXT_DIR, "index.ts"));
      const publishedIndex = await readFile(path.join(clone, "index.ts"));
      assert.deepEqual(Array.from(new Uint8Array(publishedIndex)), Array.from(new Uint8Array(sourceIndex)));
    }
  );
});
