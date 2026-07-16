import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, cp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { deriveCoordinateFromRemoteUrl } from "@mindcraft-lang/app-host";
import { resolvePublishTarget } from "./publish-command.js";
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

async function readManifest(dir: string): Promise<{ version: string; identity?: string }> {
  return JSON.parse(await readFile(path.join(dir, "mindcraft.json"), "utf8")) as {
    version: string;
    identity?: string;
  };
}

async function readManifestVersion(dir: string): Promise<string> {
  return (await readManifest(dir)).version;
}

describe("resolvePublishTarget", () => {
  it("uses constructed mode to an explicit --remote, whatever the identity or origin", () => {
    assert.deepEqual(
      resolvePublishTarget({
        explicitRemote: "git@github.com:acme/blinker.git",
        identity: undefined,
        originCoordinate: undefined,
      }),
      { mode: "constructed", remote: "git@github.com:acme/blinker.git" }
    );
    assert.deepEqual(
      resolvePublishTarget({
        explicitRemote: "git@github.com:acme/blinker.git",
        identity: "acme/blinker",
        originCoordinate: "acme/blinker",
      }),
      { mode: "constructed", remote: "git@github.com:acme/blinker.git" }
    );
  });

  it("uses in-place mode when the recorded identity equals the origin coordinate", () => {
    assert.deepEqual(
      resolvePublishTarget({ explicitRemote: undefined, identity: "acme/blinker", originCoordinate: "acme/blinker" }),
      { mode: "in-place" }
    );
  });

  it("derives the GitHub remote when the origin coordinate differs from the recorded identity", () => {
    assert.deepEqual(
      resolvePublishTarget({ explicitRemote: undefined, identity: "acme/blinker", originCoordinate: "acme/monorepo" }),
      { mode: "constructed", remote: "https://github.com/acme/blinker.git" }
    );
  });

  it("derives the GitHub remote when there is no origin but an identity is recorded", () => {
    assert.deepEqual(
      resolvePublishTarget({ explicitRemote: undefined, identity: "acme/blinker", originCoordinate: undefined }),
      { mode: "constructed", remote: "https://github.com/acme/blinker.git" }
    );
  });

  it("derives a remote that round-trips back to the recorded identity", () => {
    const target = resolvePublishTarget({
      explicitRemote: undefined,
      identity: "acme/blinker",
      originCoordinate: "acme/monorepo",
    });
    assert.equal(target.mode, "constructed");
    if (target.mode === "constructed") {
      assert.equal(deriveCoordinateFromRemoteUrl(target.remote), "acme/blinker");
    }
  });

  it("uses in-place mode for a first publish with no recorded identity, with or without an origin", () => {
    assert.deepEqual(
      resolvePublishTarget({ explicitRemote: undefined, identity: undefined, originCoordinate: "acme/blinker" }),
      { mode: "in-place" }
    );
    assert.deepEqual(
      resolvePublishTarget({ explicitRemote: undefined, identity: undefined, originCoordinate: undefined }),
      { mode: "in-place" }
    );
  });
});

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
    const remote = await initBareRemote(root, "example-org/blinker.git");
    const project = path.join(root, "project");
    const original = JSON.stringify(
      {
        name: "Blinker",
        version: "0.1.0",
        identity: "example-org/blinker",
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

  it("writes the published version and identity back so a repeat publish succeeds", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root, "example-org/blinker.git");
    const project = path.join(root, "project");
    const brains = { main: { rules: [1, 2, 3], nested: { deep: true } } };
    const appChunk = ["verbatim", null, 4];
    await writeProjectFiles(project, {
      "mindcraft.json": JSON.stringify(
        { name: "Blinker", version: "0.1.0", files: ["index.ts"], brains, appChunk },
        null,
        2
      ),
      "index.ts": "export {};\n",
    });

    const first = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(first.code, 0, first.stderr);
    assert.doesNotMatch(first.stderr, /identity changed/);

    const writtenBack = await readFile(path.join(project, "mindcraft.json"), "utf8");
    const expected = JSON.stringify(
      {
        name: "Blinker",
        version: "0.1.1",
        identity: "example-org/blinker",
        files: ["index.ts"],
        brains,
        appChunk,
      },
      null,
      2
    );
    assert.equal(writtenBack, expected);

    const second = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(second.code, 0, second.stderr);
    assert.doesNotMatch(second.stderr, /identity changed/);
    assert.match(second.stdout, /published 0\.1\.2 \(tag v0\.1\.2\)/);
    const clone = await cloneAtTag(root, remote, "v0.1.2");
    assert.equal(await readManifestVersion(clone), "0.1.2");
  });

  it("still refuses when the source manifest version is manually reverted", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const project = path.join(root, "project");
    const manifest = JSON.stringify({ name: "Blinker", version: "0.1.0", files: ["index.ts"] }, null, 2);
    await writeProjectFiles(project, { "mindcraft.json": manifest, "index.ts": "export {};\n" });

    const first = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(first.code, 0, first.stderr);

    await writeProjectFiles(project, { "mindcraft.json": manifest });
    const second = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(second.code, 1);
    assert.match(second.stderr, /PUBLISH_VERSION_ALREADY_PUBLISHED/);
  });

  it("restamps a changed identity with a warning, and the write-back makes the next publish warning-free", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root, "example-org/blinker.git");
    const project = path.join(root, "project");
    await writeProjectFiles(project, {
      "mindcraft.json": JSON.stringify(
        { name: "Blinker", version: "0.3.0", identity: "old-org/blinker", files: ["index.ts"] },
        null,
        2
      ),
      "index.ts": "export {};\n",
    });

    const first = await runCliBin(project, "publish", "--remote", remote);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stderr, /warning: identity changed: old-org\/blinker -> example-org\/blinker/);
    const clone = await cloneAtTag(root, remote, "v0.3.0");
    assert.equal((await readManifest(clone)).identity, "example-org/blinker");
    assert.equal((await readManifest(project)).identity, "example-org/blinker");

    const second = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(second.code, 0, second.stderr);
    assert.doesNotMatch(second.stderr, /identity changed/);
    assert.match(second.stdout, /published 0\.3\.1 \(tag v0\.3\.1\)/);
  });

  it("refuses a remote that yields no identity coordinate", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root, "_remote.git");
    const project = path.join(root, "project");
    await writeProjectFiles(project, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.1.0" }, null, 2),
    });

    const result = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /PUBLISH_IDENTITY_UNKNOWN/);
  });

  it("reports a write-back failure after a successful publish", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const project = path.join(root, "project");
    await writeProjectFiles(project, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.1.0" }, null, 2),
    });

    await chmod(path.join(project, "mindcraft.json"), 0o444);
    try {
      const result = await runCliBin(project, "publish", "patch", "--remote", remote);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /PUBLISH_WRITE_BACK_FAILED/);
      assert.match(result.stderr, /was published \(tag v0\.1\.1\)/);
    } finally {
      await chmod(path.join(project, "mindcraft.json"), 0o644);
    }
    const clone = await cloneAtTag(root, remote, "v0.1.1");
    assert.equal(await readManifestVersion(clone), "0.1.1");
  });

  it("refuses a branch dependency without --yes and proceeds with it", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const project = path.join(root, "project");
    await writeProjectFiles(project, {
      "mindcraft.json": JSON.stringify(
        { name: "Blinker", version: "0.1.0", extensions: { "author/steering": "gh:author/steering#main" } },
        null,
        2
      ),
    });

    const refused = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /PUBLISH_UNSTABLE_DEPENDENCIES_UNCONFIRMED/);
    assert.match(refused.stderr, /DEPENDENCY_BRANCH_REFERENCE/);
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

  it("publishes the manifest's current version as-is to an empty remote, stamping the identity", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root, "example-org/blinker.git");
    const project = path.join(root, "project");
    await writeProjectFiles(project, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.4.0", files: ["index.ts"] }, null, 2),
      "index.ts": "export {};\n",
    });

    const result = await runCliBin(project, "publish", "--remote", remote);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /published 0\.4\.0 \(tag v0\.4\.0\)/);
    assert.doesNotMatch(result.stderr, /identity changed/);

    const clone = await cloneAtTag(root, remote, "v0.4.0");
    assert.deepEqual(await readManifest(clone), await readManifest(project));
    assert.equal((await readManifest(clone)).version, "0.4.0");
    assert.equal((await readManifest(clone)).identity, "example-org/blinker");
  });

  it("refuses an as-is publish to a remote that was already published", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const project = path.join(root, "project");
    await writeProjectFiles(project, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.4.0" }, null, 2),
    });

    const first = await runCliBin(project, "publish", "--remote", remote);
    assert.equal(first.code, 0, first.stderr);

    await writeProjectFiles(project, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.5.0" }, null, 2),
    });
    const second = await runCliBin(project, "publish", "--remote", remote);
    assert.equal(second.code, 1);
    assert.match(second.stderr, /PUBLISH_VERSION_BUMP_REQUIRED/);

    const bumped = await runCliBin(project, "publish", "patch", "--remote", remote);
    assert.equal(bumped.code, 0, bumped.stderr);
    assert.match(bumped.stdout, /published 0\.5\.1 \(tag v0\.5\.1\)/);
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
    assert.equal((await readManifest(checkout)).identity, deriveCoordinateFromRemoteUrl(remote));
    assert.equal((await runGit(checkout, "status", "--porcelain")).trim(), "");

    const clone = await cloneAtTag(root, remote, "v0.3.0");
    assert.equal(await readManifestVersion(clone), "0.3.0");
    assert.equal(existsSync(path.join(clone, "index.ts")), true);
    const branchClone = path.join(root, "clone-main");
    await runGit(root, "clone", "--quiet", "--branch", "main", remote, branchClone);
    assert.equal(await readManifestVersion(branchClone), "0.3.0");
  });

  it("publishes with no flags from a published project's folder, using the recorded identity", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root, "example-org/blinker.git");
    const checkout = await initCheckoutProject(root, remote, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.2.0", identity: "example-org/blinker" }, null, 2),
      "index.ts": "export const blink = true;\n",
    });

    const result = await runCliBin(checkout, "publish", "patch");

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /published 0\.2\.1 \(tag v0\.2\.1\)/);
    assert.doesNotMatch(result.stderr, /identity changed/);
    assert.equal(await readManifestVersion(checkout), "0.2.1");
    assert.equal((await readManifest(checkout)).identity, "example-org/blinker");

    const clone = await cloneAtTag(root, remote, "v0.2.1");
    assert.equal(await readManifestVersion(clone), "0.2.1");
  });

  it("fails with a clear missing-manifest error when the current folder has no mindcraft.json", async () => {
    const root = await scratch();
    const project = path.join(root, "project");
    await writeProjectFiles(project, { "index.ts": "export {};\n" });

    const result = await runCliBin(project, "publish", "patch");

    assert.equal(result.code, 1);
    assert.match(result.stderr, /PUBLISH_MANIFEST_MISSING/);
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

  it("publishes the manifest's current version as-is on an untagged checkout, and only once", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root);
    const checkout = await initCheckoutProject(root, remote, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.2.0" }, null, 2),
      "index.ts": "export const blink = true;\n",
    });

    const result = await runCliBin(checkout, "publish");

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /published 0\.2\.0 \(tag v0\.2\.0\)/);
    assert.doesNotMatch(result.stderr, /identity changed/);
    assert.equal(await readManifestVersion(checkout), "0.2.0");
    assert.equal((await readManifest(checkout)).identity, deriveCoordinateFromRemoteUrl(remote));
    // The identity stamp changed the manifest, so this as-is publish commits.
    assert.equal((await runGit(checkout, "rev-list", "--count", "HEAD")).trim(), "2");
    assert.equal((await runGit(checkout, "status", "--porcelain")).trim(), "");

    const clone = await cloneAtTag(root, remote, "v0.2.0");
    assert.equal(await readManifestVersion(clone), "0.2.0");
    assert.equal((await readManifest(clone)).identity, deriveCoordinateFromRemoteUrl(remote));

    const second = await runCliBin(checkout, "publish");
    assert.equal(second.code, 1);
    assert.match(second.stderr, /PUBLISH_VERSION_BUMP_REQUIRED/);
  });

  it("records an as-is publish as a tag only when the manifest already carries the identity", async () => {
    const root = await scratch();
    const remote = await initBareRemote(root, "example-org/blinker.git");
    const checkout = await initCheckoutProject(root, remote, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.2.0", identity: "example-org/blinker" }, null, 2),
      "index.ts": "export const blink = true;\n",
    });

    const result = await runCliBin(checkout, "publish");

    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /identity changed/);
    assert.equal((await runGit(checkout, "rev-list", "--count", "HEAD")).trim(), "1");
    const head = (await runGit(checkout, "rev-parse", "HEAD")).trim();
    assert.equal((await runGit(checkout, "rev-parse", "v0.2.0^{commit}")).trim(), head);
  });

  it("refuses when the checkout has no origin remote to derive the identity from", async () => {
    const root = await scratch();
    const checkout = path.join(root, "checkout");
    await writeProjectFiles(checkout, {
      "mindcraft.json": JSON.stringify({ name: "Blinker", version: "0.2.0" }, null, 2),
    });
    await runGit(checkout, "init", "--quiet");
    await runGit(checkout, "add", "--all");
    await runGit(checkout, "commit", "--quiet", "-m", "initial content");

    const result = await runCliBin(checkout, "publish", "patch");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /PUBLISH_IDENTITY_UNKNOWN/);
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

    // Bare publish is the as-is surface; in a directory with no project it
    // refuses on the missing manifest, not on the missing bump argument.
    const noBump = await runCliBin(root, "publish");
    assert.equal(noBump.code, 1);
    assert.match(noBump.stderr, /PUBLISH_MANIFEST_MISSING/);
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
      // A successful publish to a remote writes the published version and
      // identity back into --dir, so the real extension source is copied to
      // scratch and the copy is published.
      const project = path.join(root, "codal-position-ext");
      await cp(CODAL_POSITION_EXT_DIR, project, { recursive: true });

      const [major, minor, patch] = (await readManifestVersion(project)).split(".").map(Number);
      const expectedVersion = `${major}.${minor}.${patch + 1}`;

      const result = await runCliBin(root, "publish", "patch", "--dir", project, "--remote", remote);

      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, `published ${expectedVersion} (tag v${expectedVersion})\n`);

      const clone = await cloneAtTag(root, remote, `v${expectedVersion}`);
      assert.deepEqual(await listProjectFiles(clone), ["index.ts", "mindcraft.json"]);
      assert.equal(existsSync(path.join(clone, "tsconfig.json")), false);
      assert.equal(await readManifestVersion(clone), expectedVersion);
      const sourceIndex = await readFile(path.join(CODAL_POSITION_EXT_DIR, "index.ts"));
      const publishedIndex = await readFile(path.join(clone, "index.ts"));
      assert.deepEqual(Array.from(new Uint8Array(publishedIndex)), Array.from(new Uint8Array(sourceIndex)));
    }
  );
});
