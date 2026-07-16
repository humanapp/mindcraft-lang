import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RestoreFailureReason, type RestoreTargetInputs, resolveRestoreTarget } from "./folder-restore";
import type { FolderTargetDescriptor } from "./project-skeleton";

const DESCRIPTOR: FolderTargetDescriptor = { appPath: "/builds/target/dist" };

/** Inputs standing in the vscode-resolved folder and app root with plain strings. */
function inputs(overrides: Partial<RestoreTargetInputs<string, string>>): RestoreTargetInputs<string, string> {
  return {
    descriptor: DESCRIPTOR,
    projectFolders: ["/workspace/project"],
    resolveAppRoot: async () => "/builds/target/dist",
    ...overrides,
  };
}

describe("resolveRestoreTarget", () => {
  it("resolves the first project folder and the descriptor's app root, matching an open of a configured target", async () => {
    let resolvedWith: FolderTargetDescriptor | undefined;
    const resolution = await resolveRestoreTarget(
      inputs({
        resolveAppRoot: async (descriptor) => {
          resolvedWith = descriptor;
          return "/builds/target/dist";
        },
      })
    );

    assert.deepStrictEqual(resolution, { ok: true, folder: "/workspace/project", appRoot: "/builds/target/dist" });
    assert.strictEqual(resolvedWith, DESCRIPTOR);
  });

  it("picks the first candidate when the workspace has several project folders", async () => {
    const resolution = await resolveRestoreTarget(
      inputs({ projectFolders: ["/workspace/first", "/workspace/second"] })
    );
    assert.deepStrictEqual(resolution, { ok: true, folder: "/workspace/first", appRoot: "/builds/target/dist" });
  });

  it("fails with NO_DEV_TARGET when no dev target is configured, without resolving an app root", async () => {
    let appRootResolved = false;
    const resolution = await resolveRestoreTarget(
      inputs({
        descriptor: undefined,
        resolveAppRoot: async () => {
          appRootResolved = true;
          return "/builds/target/dist";
        },
      })
    );

    assert.deepStrictEqual(resolution, { ok: false, reason: RestoreFailureReason.NO_DEV_TARGET });
    assert.strictEqual(appRootResolved, false);
  });

  it("fails with NO_PROJECT_FOLDER when no workspace folder holds a project", async () => {
    let appRootResolved = false;
    const resolution = await resolveRestoreTarget(
      inputs({
        projectFolders: [],
        resolveAppRoot: async () => {
          appRootResolved = true;
          return "/builds/target/dist";
        },
      })
    );

    assert.deepStrictEqual(resolution, { ok: false, reason: RestoreFailureReason.NO_PROJECT_FOLDER });
    assert.strictEqual(appRootResolved, false);
  });

  it("fails with APP_ROOT_UNAVAILABLE when the app root cannot be resolved", async () => {
    const resolution = await resolveRestoreTarget(inputs({ resolveAppRoot: async () => undefined }));
    assert.deepStrictEqual(resolution, { ok: false, reason: RestoreFailureReason.APP_ROOT_UNAVAILABLE });
  });
});
