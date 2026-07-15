import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { ExtensionFetchTransport, ExtensionVersionListResult } from "@mindcraft-lang/app-host";
import {
  createJsDelivrExtensionTransport,
  ExtensionAddInputErrorCode,
  ExtensionFetchErrorCode,
  parseExtensionAddInput,
  resolveExtensionAddInput,
} from "@mindcraft-lang/app-host";

describe("parseExtensionAddInput accepted shapes", () => {
  const passThroughReferences: readonly string[] = [
    "gh:example-org/position-ext@v0.1.0",
    "gh:example-org/position-ext@0123456789abcdef0123456789abcdef01234567",
    "gh:example-org/position-ext#main",
    "gh:example-org/position-ext#feature/steering",
    "embedded:example-org/position-ext",
  ];

  it("passes a complete reference through unchanged", () => {
    for (const reference of passThroughReferences) {
      assert.deepStrictEqual(parseExtensionAddInput(reference), { kind: "reference", reference }, reference);
    }
  });

  const coordinateShapes: ReadonlyArray<[string, string]> = [
    ["example-org/position-ext", "example-org/position-ext"],
    ["gh:example-org/position-ext", "example-org/position-ext"],
    ["github.com/example-org/position-ext", "example-org/position-ext"],
    ["https://github.com/example-org/position-ext", "example-org/position-ext"],
    ["https://github.com/example-org/position-ext/", "example-org/position-ext"],
    ["https://github.com/example-org/position-ext.git", "example-org/position-ext"],
    ["http://GitHub.com/example-org/position-ext", "example-org/position-ext"],
    ["git@github.com:example-org/position-ext.git", "example-org/position-ext"],
    ["git@github.com:example-org/position-ext", "example-org/position-ext"],
    ["  https://github.com/example-org/position-ext  ", "example-org/position-ext"],
  ];

  it("classifies repository-naming input as a coordinate needing version resolution", () => {
    for (const [input, coordinate] of coordinateShapes) {
      assert.deepStrictEqual(parseExtensionAddInput(input), { kind: "coordinate", coordinate }, input);
    }
  });

  const urlReferenceShapes: ReadonlyArray<[string, string]> = [
    ["https://github.com/example-org/position-ext/tree/v0.1.0", "gh:example-org/position-ext@v0.1.0"],
    ["https://github.com/example-org/position-ext/tree/0.1.0", "gh:example-org/position-ext@0.1.0"],
    ["https://github.com/example-org/position-ext/tree/main", "gh:example-org/position-ext#main"],
    ["github.com/example-org/position-ext/tree/feature/steering", "gh:example-org/position-ext#feature/steering"],
    ["https://github.com/example-org/position-ext/releases/tag/v0.1.0", "gh:example-org/position-ext@v0.1.0"],
    ["https://github.com/example-org/position-ext/releases/tag/nightly", "gh:example-org/position-ext#nightly"],
    ["https://github.com/example-org/position-ext/commit/b19b80b", "gh:example-org/position-ext@b19b80b"],
    [
      "https://github.com/example-org/position-ext/commit/b19b80b029a77303ee575d3ff9b29adbf7021b23",
      "gh:example-org/position-ext@b19b80b029a77303ee575d3ff9b29adbf7021b23",
    ],
  ];

  it("maps revision-naming GitHub URLs onto the corresponding reference form", () => {
    for (const [input, reference] of urlReferenceShapes) {
      assert.deepStrictEqual(parseExtensionAddInput(input), { kind: "reference", reference }, input);
    }
  });

  const rejects: readonly string[] = [
    "",
    "position-ext",
    "ffff:x",
    "gh:",
    "gh:example-org",
    "example-org/position-ext/extra",
    "https://example.com/example-org/position-ext",
    "github.com/example-org",
    "git@gitlab.com:example-org/position-ext.git",
    "https://github.com/example-org/position-ext/pulls",
    "https://github.com/example-org/position-ext/tree/",
    "https://github.com/example-org/position-ext/commit/not-hex",
    "https://github.com/-bad-owner/position-ext",
  ];

  it("rejects everything else with the stable unrecognized code", () => {
    for (const input of rejects) {
      const parsed = parseExtensionAddInput(input);
      assert.equal(parsed.kind, "invalid", input);
      assert.ok(parsed.kind === "invalid" && parsed.code === ExtensionAddInputErrorCode.UNRECOGNIZED, input);
    }
  });
});

function transportListing(versions: ExtensionVersionListResult): ExtensionFetchTransport & { listings: string[] } {
  const listings: string[] = [];
  return {
    listings,
    async fetchFile() {
      return { ok: false, kind: "not-found" };
    },
    async resolveBranch() {
      return { ok: false, kind: "not-found" };
    },
    async listVersionTags(owner, repo) {
      listings.push(`${owner}/${repo}`);
      return versions;
    },
  };
}

describe("resolveExtensionAddInput", () => {
  it("pins a coordinate to the highest listed plain release, ignoring prerelease and non-semver strings", async () => {
    const transport = transportListing({ ok: true, versions: ["0.2.0", "0.10.0", "1.0.0-rc.1", "not-semver"] });
    const resolved = await resolveExtensionAddInput("https://github.com/example-org/position-ext", transport);
    assert.deepStrictEqual(resolved, { ok: true, reference: "gh:example-org/position-ext@0.10.0" });
    assert.deepStrictEqual(transport.listings, ["example-org/position-ext"]);
  });

  it("passes a complete reference through without touching the transport", async () => {
    const transport = transportListing({ ok: true, versions: ["0.2.0"] });
    const resolved = await resolveExtensionAddInput("gh:example-org/position-ext#main", transport);
    assert.deepStrictEqual(resolved, { ok: true, reference: "gh:example-org/position-ext#main" });
    assert.deepStrictEqual(transport.listings, []);
  });

  it("fails with VERSIONS_NOT_FOUND when the repository has no published release version", async () => {
    for (const versions of [
      { ok: true, versions: [] },
      { ok: true, versions: ["1.0.0-rc.1"] },
      { ok: false, kind: "not-found" },
    ] satisfies ExtensionVersionListResult[]) {
      const resolved = await resolveExtensionAddInput("example-org/position-ext", transportListing(versions));
      assert.ok(!resolved.ok);
      assert.equal(resolved.code, ExtensionFetchErrorCode.VERSIONS_NOT_FOUND);
      assert.match(resolved.message, /#<branch>/);
    }
  });

  it("surfaces listing failures as the distinct fetch error states", async () => {
    const cases: ReadonlyArray<[ExtensionVersionListResult, string]> = [
      [{ ok: false, kind: "http-status", status: 500 }, ExtensionFetchErrorCode.HTTP_STATUS],
      [{ ok: false, kind: "unreachable", message: "refused" }, ExtensionFetchErrorCode.UNREACHABLE],
    ];
    for (const [versions, code] of cases) {
      const resolved = await resolveExtensionAddInput("example-org/position-ext", transportListing(versions));
      assert.ok(!resolved.ok);
      assert.equal(resolved.code, code);
    }
  });

  it("rejects unrecognized input with its stable code before reaching the transport", async () => {
    const transport = transportListing({ ok: true, versions: ["0.2.0"] });
    const resolved = await resolveExtensionAddInput("ffff:x", transport);
    assert.ok(!resolved.ok);
    assert.equal(resolved.code, ExtensionAddInputErrorCode.UNRECOGNIZED);
    assert.deepStrictEqual(transport.listings, []);
  });
});

describe("resolveExtensionAddInput against a local server with the jsDelivr data API layout", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", baseUrl);
      if (url.pathname === "/v1/packages/gh/example-org/position-ext") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            type: "gh",
            name: "example-org/position-ext",
            tags: {},
            versions: [{ version: "0.1.0" }, { version: "0.2.0" }],
          })
        );
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ status: 404, message: "Couldn't find the requested package." }));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("normalizes a pasted repository URL to the highest listed version through the real transport", async () => {
    const transport = createJsDelivrExtensionTransport({
      cdnBaseUrl: baseUrl,
      dataApiBaseUrl: baseUrl,
      githubApiBaseUrl: baseUrl,
    });
    const resolved = await resolveExtensionAddInput("https://github.com/example-org/position-ext", transport);
    assert.deepStrictEqual(resolved, { ok: true, reference: "gh:example-org/position-ext@0.2.0" });
  });
});
