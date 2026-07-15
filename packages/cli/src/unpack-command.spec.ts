import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, describe, it } from "node:test";
import { listProjectFiles, makeScratchDir, runCliBin, writeProjectFiles } from "./test-support/publish-fixtures.js";

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

const TILE_SOURCE = 'import { Sensor } from "mindcraft";\nexport default Sensor({ name: "probe" });\n';
const SVG_ASSET = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>\n';

/** A shared-format export document carrying files, brains, targets, and extensions. */
function sampleDocument(): Record<string, unknown> {
  return {
    format: "mindcraft.project",
    name: "Rover",
    version: "0.2.0",
    description: "A rover project",
    files: [
      { path: "tiles/probe.ts", content: TILE_SOURCE },
      { path: "assets/logo.svg", content: SVG_ASSET },
      { path: "notes.txt", content: "scratch notes\n" },
    ],
    brains: { main: { rules: [1, 2, 3], nested: { deep: true } } },
    targets: { "@example/app": { actors: [{ archetype: "rover", desiredCount: 2 }] } },
    extensions: { "example-org/position": "gh:example-org/position@v1.2.0" },
  };
}

async function writeDocument(dir: string, document: unknown): Promise<string> {
  const file = path.join(dir, "rover.mindcraft");
  await writeProjectFiles(dir, { "rover.mindcraft": JSON.stringify(document, null, 2) });
  return file;
}

async function readManifest(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(dir, "mindcraft.json"), "utf8")) as Record<string, unknown>;
}

describe("mindcraft unpack", () => {
  it("writes the document files and assembles a manifest carrying everything else verbatim", async () => {
    const root = await scratch();
    const document = sampleDocument();
    const file = await writeDocument(root, document);
    const target = path.join(root, "unpacked");

    const result = await runCliBin(root, "unpack", file, target);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /unpacked 3 project files and mindcraft\.json/);
    assert.match(result.stdout, /prune mindcraft\.json before publishing/);
    assert.match(result.stdout, /repository is now the canonical project/);

    assert.deepEqual(await listProjectFiles(target), [
      "assets/logo.svg",
      "mindcraft.json",
      "notes.txt",
      "tiles/probe.ts",
    ]);
    assert.equal(await readFile(path.join(target, "tiles/probe.ts"), "utf8"), TILE_SOURCE);
    assert.equal(await readFile(path.join(target, "assets/logo.svg"), "utf8"), SVG_ASSET);

    const manifest = await readManifest(target);
    assert.equal(manifest.name, "Rover");
    assert.equal(manifest.version, "0.2.0");
    assert.equal(manifest.description, "A rover project");
    assert.deepEqual(manifest.files, ["tiles/probe.ts", "assets/logo.svg", "notes.txt"]);
    assert.deepEqual(manifest.extensions, document.extensions);
    assert.equal(JSON.stringify(manifest.brains), JSON.stringify(document.brains));
    assert.equal(JSON.stringify(manifest.projectTargets), JSON.stringify(document.targets));
    assert.equal("targets" in manifest, false);
    assert.equal("format" in manifest, false);
  });

  it("records the published identity when --coordinate is given and refuses a malformed one", async () => {
    const root = await scratch();
    const file = await writeDocument(root, sampleDocument());

    const malformed = await runCliBin(root, "unpack", file, path.join(root, "a"), "--coordinate", "not-a-coordinate");
    assert.equal(malformed.code, 1);
    assert.match(malformed.stderr, /UNPACK_INVALID_COORDINATE/);
    assert.equal(existsSync(path.join(root, "a")), false);

    const target = path.join(root, "b");
    const result = await runCliBin(root, "unpack", file, target, "--coordinate", "example-org/rover");
    assert.equal(result.code, 0, result.stderr);
    assert.equal((await readManifest(target)).identity, "example-org/rover");
  });

  it("defaults the target directory to the document's base name", async () => {
    const root = await scratch();
    await writeDocument(root, sampleDocument());

    const result = await runCliBin(root, "unpack", "rover.mindcraft");

    assert.equal(result.code, 0, result.stderr);
    assert.equal((await readManifest(path.join(root, "rover"))).name, "Rover");
  });

  it("refuses a missing or unreadable document", async () => {
    const root = await scratch();
    const result = await runCliBin(root, "unpack", path.join(root, "ghost.mindcraft"));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /UNPACK_DOCUMENT_MISSING/);
  });

  it("refuses a document that is not valid JSON or not a valid project document", async () => {
    const root = await scratch();
    await writeProjectFiles(root, { "broken.mindcraft": "{not json" });
    const notJson = await runCliBin(root, "unpack", path.join(root, "broken.mindcraft"));
    assert.equal(notJson.code, 1);
    assert.match(notJson.stderr, /UNPACK_DOCUMENT_INVALID/);

    const { format: _format, ...missingFormat } = sampleDocument();
    await writeProjectFiles(root, { "legacy.mindcraft": JSON.stringify(missingFormat) });
    const invalid = await runCliBin(root, "unpack", path.join(root, "legacy.mindcraft"));
    assert.equal(invalid.code, 1);
    assert.match(invalid.stderr, /UNPACK_DOCUMENT_INVALID/);
    assert.match(invalid.stderr, /MINDCRAFT_PROJECT_INVALID_FORMAT/);
  });

  it("refuses a document whose fields do not assemble into a valid manifest", async () => {
    const root = await scratch();
    const file = await writeDocument(root, { ...sampleDocument(), ambient: 5 });

    const result = await runCliBin(root, "unpack", file, path.join(root, "out"));

    assert.equal(result.code, 1);
    assert.match(result.stderr, /UNPACK_DOCUMENT_INVALID/);
    assert.match(result.stderr, /PROJECT_MANIFEST_INVALID_AMBIENT/);
  });

  it("refuses a non-empty target directory unless --force is passed", async () => {
    const root = await scratch();
    const file = await writeDocument(root, sampleDocument());
    const target = path.join(root, "occupied");
    await writeProjectFiles(target, { "existing.txt": "keep\n" });

    const refused = await runCliBin(root, "unpack", file, target);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /UNPACK_TARGET_DIR_NOT_EMPTY/);
    assert.match(refused.stderr, /--force/);

    const forced = await runCliBin(root, "unpack", file, target, "--force");
    assert.equal(forced.code, 0, forced.stderr);
    assert.equal(await readFile(path.join(target, "existing.txt"), "utf8"), "keep\n");
    assert.equal((await readManifest(target)).name, "Rover");
  });

  it("refuses a target that exists as a file", async () => {
    const root = await scratch();
    const file = await writeDocument(root, sampleDocument());
    await writeProjectFiles(root, { occupied: "a file, not a directory\n" });

    const result = await runCliBin(root, "unpack", file, path.join(root, "occupied"));

    assert.equal(result.code, 1);
    assert.match(result.stderr, /UNPACK_TARGET_DIR_NOT_EMPTY/);
    assert.match(result.stderr, /not a directory/);
  });

  it("preserves a files list declared by a manifest carried inside the document", async () => {
    const root = await scratch();
    const document = sampleDocument();
    (document.files as Array<{ path: string; content: string }>).push({
      path: "mindcraft.json",
      content: JSON.stringify({ name: "Rover", version: "0.2.0", files: ["tiles/probe.ts"] }),
    });
    const file = await writeDocument(root, document);
    const target = path.join(root, "unpacked");

    const result = await runCliBin(root, "unpack", file, target);

    assert.equal(result.code, 0, result.stderr);
    const manifest = await readManifest(target);
    assert.deepEqual(manifest.files, ["tiles/probe.ts"]);
  });
});
