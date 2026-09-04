import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionFetchBranchResult, ExtensionFetchTransport, ExtensionVersionListResult } from "@wendoo/app-host";
import { checkExtensionReferenceUpdate, ExtensionFetchErrorCode } from "@wendoo/app-host";

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

describe("checkExtensionReferenceUpdate for coordinates an approved catalog lists", () => {
  const COORDINATE = "example-org/position-ext";
  const APPROVED_REF = `gh:${COORDINATE}@${SHA_B}`;

  /** A transport that answers every source read and records how many it was asked. */
  function countingTransport(): ExtensionFetchTransport & { calls: number } {
    const transport = {
      calls: 0,
      async fetchFile() {
        transport.calls++;
        return { ok: false, kind: "not-found" } as const;
      },
      async resolveBranch() {
        transport.calls++;
        return { ok: true, sha: SHA_A } as const;
      },
      async listVersionTags() {
        transport.calls++;
        return { ok: true, versions: ["0.1.0", "0.9.0"] } as const;
      },
    };
    return transport;
  }

  const approvedEntry = (coordinate: string): { ref: string; version: string } | undefined =>
    coordinate === COORDINATE ? { ref: APPROVED_REF, version: "0.2.0" } : undefined;

  const cases: ReadonlyArray<{
    name: string;
    installedSpecifier: string;
    installedVersion: string;
    expected: Awaited<ReturnType<typeof checkExtensionReferenceUpdate>>;
  }> = [
    {
      name: "offers the entry's approved pin to an install at an earlier approved pin",
      installedSpecifier: SHA_A,
      installedVersion: "0.1.0",
      expected: {
        ok: true,
        updateAvailable: true,
        update: { coordinate: COORDINATE, reference: APPROVED_REF, latestVersion: "0.2.0" },
      },
    },
    {
      name: "reports no update for an install already at the entry's approved version",
      installedSpecifier: SHA_B,
      installedVersion: "0.2.0",
      expected: { ok: true, updateAvailable: false },
    },
    {
      name: "reports no update for an install newer than the entry's approved version",
      installedSpecifier: SHA_A,
      installedVersion: "0.3.0",
      expected: { ok: true, updateAvailable: false },
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const transport = countingTransport();
      const result = await checkExtensionReferenceUpdate({
        reference: `gh:${COORDINATE}@${testCase.installedSpecifier}`,
        installedSpecifier: testCase.installedSpecifier,
        installedVersion: testCase.installedVersion,
        transport,
        approvedEntry,
      });

      assert.deepStrictEqual(result, testCase.expected);
      assert.equal(transport.calls, 0);
    });
  }

  it("keeps the published-tag path for a coordinate the catalog does not list", async () => {
    const transport = countingTransport();
    const result = await checkExtensionReferenceUpdate({
      reference: "gh:example-org/unlisted-ext@v0.1.0",
      installedSpecifier: "v0.1.0",
      installedVersion: "0.1.0",
      transport,
      approvedEntry,
    });

    assert.ok(result.ok && result.updateAvailable);
    assert.deepStrictEqual(result.update, {
      coordinate: "example-org/unlisted-ext",
      reference: "gh:example-org/unlisted-ext@0.9.0",
      latestVersion: "0.9.0",
    });
    assert.equal(transport.calls, 1);
  });

  it("keeps branch semantics for an approved coordinate referenced by branch", async () => {
    const transport = countingTransport();
    const reference = `gh:${COORDINATE}#main`;
    const result = await checkExtensionReferenceUpdate({
      reference,
      installedSpecifier: SHA_B,
      installedVersion: "0.1.0",
      transport,
      approvedEntry,
    });

    assert.ok(result.ok && result.updateAvailable);
    assert.deepStrictEqual(result.update, { coordinate: COORDINATE, reference, resolvedSha: SHA_A });
    assert.equal(transport.calls, 1);
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
