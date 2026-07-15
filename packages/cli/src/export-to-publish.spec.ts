import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  cloneAtTag,
  initBareRemote,
  listProjectFiles,
  makeScratchDir,
  runCliBin,
} from "./test-support/publish-fixtures.js";

/** A committed .mindcraft document generated (and byte-pinned) by the microbit-sim app's real export path. */
const APP_EXPORT_DOCUMENT = fileURLToPath(
  new URL("../../../../../apps/microbit-sim/src/services/__fixtures__/sample-project.mindcraft", import.meta.url)
);

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

describe("export to published repository", () => {
  it(
    "unpacks a real app export and first-publishes it as-is to a bare remote",
    { skip: existsSync(APP_EXPORT_DOCUMENT) ? false : "app export fixture not present in this checkout" },
    async () => {
      const document = JSON.parse(readFileSync(APP_EXPORT_DOCUMENT, "utf8")) as {
        name: string;
        version: string;
        files: Array<{ path: string; content: string }>;
        brains: Record<string, unknown>;
        targets: Record<string, unknown>;
        extensions: Record<string, string>;
      };
      assert.ok(document.files.length > 0, "the app export fixture should carry project files");

      const root = await scratch();
      // The remote's path tail is the coordinate the publish stamps, matching
      // the identity the unpack records.
      const remote = await initBareRemote(root, "example-org/sample-project.git");
      const project = path.join(root, "project");

      const unpacked = await runCliBin(
        root,
        "unpack",
        APP_EXPORT_DOCUMENT,
        project,
        "--coordinate",
        "example-org/sample-project"
      );
      assert.equal(unpacked.code, 0, unpacked.stderr);

      // The fixture project carries a local: dependency, so the publish needs the confirmation flag.
      const published = await runCliBin(root, "publish", "--dir", project, "--remote", remote, "--yes");
      assert.equal(published.code, 0, published.stderr);
      assert.doesNotMatch(published.stderr, /identity changed/);
      const tag = `v${document.version}`;
      assert.match(
        published.stdout,
        new RegExp(`published ${document.version.replaceAll(".", "\\.")} \\(tag ${tag}\\)`)
      );

      const clone = await cloneAtTag(root, remote, tag);
      const expectedTree = [...document.files.map((file) => file.path), "mindcraft.json"].sort();
      assert.deepEqual(await listProjectFiles(clone), expectedTree);
      for (const file of document.files) {
        assert.equal(await readFile(path.join(clone, file.path), "utf8"), file.content);
      }

      const manifest = JSON.parse(await readFile(path.join(clone, "mindcraft.json"), "utf8")) as Record<
        string,
        unknown
      >;
      assert.equal(manifest.name, document.name);
      assert.equal(manifest.version, document.version);
      assert.equal(manifest.identity, "example-org/sample-project");
      assert.deepEqual(
        manifest.files,
        document.files.map((file) => file.path)
      );
      assert.deepEqual(manifest.extensions, document.extensions);
      assert.equal(JSON.stringify(manifest.brains), JSON.stringify(document.brains));
      assert.equal(JSON.stringify(manifest.projectTargets), JSON.stringify(document.targets));
    }
  );
});
