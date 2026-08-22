import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FolderSessionErrorCode } from "@wendoo/bridge-protocol";
import type { RemovableVolumeFileAccess } from "./removable-volume";
import { writeFileToRemovableVolume } from "./removable-volume";

/**
 * In-memory volume access over a set of existing directory paths, capturing
 * writes into a path->content map. `failWrites` makes every write reject.
 */
function memoryVolumeAccess(
  directories: readonly string[],
  options?: { failWrites?: boolean }
): RemovableVolumeFileAccess & { written: Map<string, string> } {
  const existing = new Set(directories);
  const written = new Map<string, string>();
  return {
    written,
    isDirectory: async (path) => existing.has(path),
    listSubdirectories: async (path) => {
      const prefix = `${path}/`;
      const names = new Set<string>();
      for (const directory of existing) {
        if (directory.startsWith(prefix)) {
          names.add(directory.slice(prefix.length).split("/")[0]);
        }
      }
      return [...names];
    },
    writeTextFile: async (path, contents) => {
      if (options?.failWrites) {
        throw new Error("device removed");
      }
      written.set(path, contents);
    },
  };
}

const HEX = ":020000040000FA\n:00000001FF\n";

describe("writeFileToRemovableVolume", () => {
  it("writes into a volume found directly under a mount root", async () => {
    const access = memoryVolumeAccess(["/mnt-a/OTHER", "/mnt-a/TARGET"]);
    const outcome = await writeFileToRemovableVolume("TARGET", "program.hex", HEX, access, [
      { path: "/mnt-a", perUser: false },
    ]);
    assert.deepStrictEqual(outcome, { ok: true });
    assert.equal(access.written.get("/mnt-a/TARGET/program.hex"), HEX);
  });

  it("writes into a volume found under a per-user mount root", async () => {
    const access = memoryVolumeAccess(["/mnt-b/alice", "/mnt-b/bob", "/mnt-b/bob/TARGET"]);
    const outcome = await writeFileToRemovableVolume("TARGET", "program.hex", HEX, access, [
      { path: "/mnt-b", perUser: true },
    ]);
    assert.deepStrictEqual(outcome, { ok: true });
    assert.equal(access.written.get("/mnt-b/bob/TARGET/program.hex"), HEX);
  });

  it("searches the mount roots in order and writes to the first match only", async () => {
    const access = memoryVolumeAccess(["/mnt-a/TARGET", "/mnt-b/carol", "/mnt-b/carol/TARGET"]);
    const outcome = await writeFileToRemovableVolume("TARGET", "program.hex", HEX, access, [
      { path: "/mnt-a", perUser: false },
      { path: "/mnt-b", perUser: true },
    ]);
    assert.deepStrictEqual(outcome, { ok: true });
    assert.deepStrictEqual([...access.written.keys()], ["/mnt-a/TARGET/program.hex"]);
  });

  it("reports the not-found code when no mount root carries the volume", async () => {
    const access = memoryVolumeAccess(["/mnt-a/OTHER", "/mnt-b/dave"]);
    const outcome = await writeFileToRemovableVolume("TARGET", "program.hex", HEX, access, [
      { path: "/mnt-a", perUser: false },
      { path: "/mnt-b", perUser: true },
    ]);
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.code, FolderSessionErrorCode.REMOVABLE_VOLUME_NOT_FOUND);
    assert.equal(access.written.size, 0);
  });

  it("reports the write-failed code when the write rejects", async () => {
    const access = memoryVolumeAccess(["/mnt-a/TARGET"], { failWrites: true });
    const outcome = await writeFileToRemovableVolume("TARGET", "program.hex", HEX, access, [
      { path: "/mnt-a", perUser: false },
    ]);
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.code, FolderSessionErrorCode.WRITE_FAILED);
  });
});
