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
        manifest: {
          name: string;
          version: string;
          extensions: Record<string, string>;
          brains: Record<string, unknown>;
          app: Record<string, unknown>;
        };
        contents: Record<string, string>;
      };
      const contentPaths = Object.keys(document.contents);
      assert.ok(contentPaths.length > 0, "the app export fixture should carry project files");

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

      // The fixture project carries a branch dependency, so the publish needs the confirmation flag.
      const published = await runCliBin(root, "publish", "--dir", project, "--remote", remote, "--yes");
      assert.equal(published.code, 0, published.stderr);
      assert.doesNotMatch(published.stderr, /identity changed/);
      const version = document.manifest.version;
      const tag = `v${version}`;
      assert.match(published.stdout, new RegExp(`published ${version.replaceAll(".", "\\.")} \\(tag ${tag}\\)`));

      const clone = await cloneAtTag(root, remote, tag);
      const expectedTree = [...contentPaths, "mindcraft.json", "README.md"].sort();
      assert.deepEqual(await listProjectFiles(clone), expectedTree);
      for (const contentPath of contentPaths) {
        assert.equal(await readFile(path.join(clone, contentPath), "utf8"), document.contents[contentPath]);
      }

      const manifest = JSON.parse(await readFile(path.join(clone, "mindcraft.json"), "utf8")) as Record<
        string,
        unknown
      >;
      assert.equal(manifest.name, document.manifest.name);
      assert.equal(manifest.version, version);
      assert.equal(manifest.identity, "example-org/sample-project");
      assert.deepEqual(manifest.files, contentPaths);
      assert.deepEqual(manifest.extensions, document.manifest.extensions);
      assert.equal(JSON.stringify(manifest.brains), JSON.stringify(document.manifest.brains));
      assert.equal(JSON.stringify(manifest.app), JSON.stringify(document.manifest.app));
    }
  );
});
