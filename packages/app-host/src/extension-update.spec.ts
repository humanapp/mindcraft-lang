import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ExtensionFetchBranchResult,
  ExtensionFetchTransport,
  ExtensionVersionListResult,
} from "@mindcraft-lang/app-host";
import { checkExtensionReferenceUpdate, ExtensionFetchErrorCode } from "@mindcraft-lang/app-host";

const SHA_A = "0123456789abcdef0123456789abcdef01234567";
const SHA_B = "89abcdef0123456789abcdef0123456789abcdef";

function transportWith(options: {
  versions?: ExtensionVersionListResult;
  branch?: ExtensionFetchBranchResult;
}): ExtensionFetchTransport {
  return {
    async fetchFile() {
      return { ok: false, kind: "not-found" };
    },
    async resolveBranch() {
      return options.branch ?? { ok: false, kind: "not-found" };
    },
    async listVersionTags() {
      return options.versions ?? { ok: false, kind: "not-found" };
    },
  };
}

describe("checkExtensionReferenceUpdate for @pin references", () => {
  it("offers the highest published release above the installed version, rewriting the reference", async () => {
    const result = await checkExtensionReferenceUpdate({
      reference: "gh:example-org/position-ext@v0.1.0",
      installedSpecifier: "v0.1.0",
      installedVersion: "0.1.0",
      transport: transportWith({
        versions: { ok: true, versions: ["0.2.0", "0.3.0-rc.1", "not-semver", "0.1.0"] },
      }),
    });

    assert.ok(result.ok && result.updateAvailable);
    assert.deepStrictEqual(result.update, {
      coordinate: "example-org/position-ext",
      reference: "gh:example-org/position-ext@0.2.0",
      latestVersion: "0.2.0",
    });
  });

  it("reports no update when the installed version is the highest published release", async () => {
    const result = await checkExtensionReferenceUpdate({
      reference: "gh:example-org/position-ext@v0.2.0",
      installedSpecifier: "v0.2.0",
      installedVersion: "0.2.0",
      transport: transportWith({ versions: { ok: true, versions: ["0.1.0", "0.2.0"] } }),
    });

    assert.deepStrictEqual(result, { ok: true, updateAvailable: false });
  });

  it("reports no update when the source lists no parseable releases", async () => {
    const result = await checkExtensionReferenceUpdate({
      reference: "gh:example-org/position-ext@v0.1.0",
      installedSpecifier: "v0.1.0",
      installedVersion: "0.1.0",
      transport: transportWith({ versions: { ok: true, versions: [] } }),
    });

    assert.deepStrictEqual(result, { ok: true, updateAvailable: false });
  });

  it("maps version-listing failures onto stable codes", async () => {
    const cases: ReadonlyArray<[ExtensionVersionListResult, string]> = [
      [{ ok: false, kind: "not-found" }, ExtensionFetchErrorCode.VERSIONS_NOT_FOUND],
      [{ ok: false, kind: "http-status", status: 500 }, ExtensionFetchErrorCode.HTTP_STATUS],
      [{ ok: false, kind: "unreachable", message: "refused" }, ExtensionFetchErrorCode.UNREACHABLE],
    ];
    for (const [versions, code] of cases) {
      const result = await checkExtensionReferenceUpdate({
        reference: "gh:example-org/position-ext@v0.1.0",
        installedSpecifier: "v0.1.0",
        installedVersion: "0.1.0",
        transport: transportWith({ versions }),
      });
      assert.ok(!result.ok);
      assert.equal(result.error.code, code);
      assert.equal(result.error.reference, "gh:example-org/position-ext@v0.1.0");
    }
  });
});

describe("checkExtensionReferenceUpdate for #branch references", () => {
  it("offers a refetch when the branch head moved, keeping the reference text unchanged", async () => {
    const result = await checkExtensionReferenceUpdate({
      reference: "gh:example-org/position-ext#main",
      installedSpecifier: SHA_A,
      installedVersion: "0.1.0",
      transport: transportWith({ branch: { ok: true, sha: SHA_B } }),
    });

    assert.ok(result.ok && result.updateAvailable);
    assert.deepStrictEqual(result.update, {
      coordinate: "example-org/position-ext",
      reference: "gh:example-org/position-ext#main",
      resolvedSha: SHA_B,
    });
  });

  it("reports no update when the branch head matches the installed specifier", async () => {
    const result = await checkExtensionReferenceUpdate({
      reference: "gh:example-org/position-ext#main",
      installedSpecifier: SHA_A,
      installedVersion: "0.1.0",
      transport: transportWith({ branch: { ok: true, sha: SHA_A } }),
    });

    assert.deepStrictEqual(result, { ok: true, updateAvailable: false });
  });

  it("maps branch-resolution failures onto stable codes, distinguishing rate-limited from not-found", async () => {
    const cases: ReadonlyArray<[ExtensionFetchBranchResult, string]> = [
      [{ ok: false, kind: "not-found" }, ExtensionFetchErrorCode.BRANCH_NOT_FOUND],
      [{ ok: false, kind: "rate-limited" }, ExtensionFetchErrorCode.RATE_LIMITED],
      [{ ok: false, kind: "http-status", status: 500 }, ExtensionFetchErrorCode.HTTP_STATUS],
      [{ ok: false, kind: "unreachable", message: "refused" }, ExtensionFetchErrorCode.UNREACHABLE],
    ];
    for (const [branch, code] of cases) {
      const result = await checkExtensionReferenceUpdate({
        reference: "gh:example-org/position-ext#main",
        installedSpecifier: SHA_A,
        installedVersion: "0.1.0",
        transport: transportWith({ branch }),
      });
      assert.ok(!result.ok);
      assert.equal(result.error.code, code);
    }
  });
});

describe("checkExtensionReferenceUpdate reference validation", () => {
  it("fails with INVALID_REFERENCE for non-gh references", async () => {
    for (const reference of ["embedded:a/b", "nonsense"]) {
      const result = await checkExtensionReferenceUpdate({
        reference,
        installedSpecifier: "v0.1.0",
        installedVersion: "0.1.0",
        transport: transportWith({}),
      });
      assert.ok(!result.ok);
      assert.equal(result.error.code, ExtensionFetchErrorCode.INVALID_REFERENCE);
    }
  });
});
