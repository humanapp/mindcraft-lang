import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createJsDelivrExtensionTransport, highestListedRelease } from "@wendoo/app-host";

/** A captured fetch invocation: the URL requested and the init the transport passed. */
interface CapturedCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/**
 * A fetch stub that records every `(url, init)` pair and answers each URL with a
 * canned 200 response, so tests can assert which init a transport method passes.
 */
function recordingFetch(): { readonly calls: CapturedCall[]; readonly fetchImpl: typeof fetch } {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    let body = "";
    if (url.includes("/branches/")) {
      body = JSON.stringify({ commit: { sha: "0123456789abcdef0123456789abcdef01234567" } });
    } else if (url.includes("/tags")) {
      body = JSON.stringify([{ name: "v0.2.0" }]);
    }
    return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
  };
  return { calls, fetchImpl };
}

const encoder = new TextEncoder();

const BRANCH_SHA = "0123456789abcdef0123456789abcdef01234567";

const ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80]);

/** Files served under the jsDelivr URL layout, keyed by `/gh/<owner>/<repo>@<pin>/<path>`. */
const SERVED_FILES: Record<string, Uint8Array> = {
  "/gh/example-org/position-ext@v0.1.0/wendoo.json": encoder.encode('{"name":"P","version":"0.1.0"}'),
  "/gh/example-org/position-ext@v0.1.0/assets/icon.png": ICON_BYTES,
  [`/gh/example-org/position-ext@${BRANCH_SHA}/wendoo.json`]: encoder.encode('{"name":"P","version":"0.2.0"}'),
};

describe("createJsDelivrExtensionTransport against local servers with the jsDelivr and GitHub API layouts", () => {
  let server: Server;
  let baseUrl: string;
  let broken: Server;
  let brokenBaseUrl: string;

  before(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", baseUrl);
      // GitHub REST API branch endpoint shape: /repos/<owner>/<repo>/branches/<branch>.
      if (url.pathname === "/repos/example-org/position-ext/branches/main") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ name: "main", commit: { sha: BRANCH_SHA } }));
        return;
      }
      if (url.pathname === "/repos/example-org/position-ext/branches/limited") {
        response.statusCode = 403;
        response.setHeader("x-ratelimit-limit", "60");
        response.setHeader("x-ratelimit-remaining", "0");
        response.end(JSON.stringify({ message: "API rate limit exceeded" }));
        return;
      }
      if (url.pathname === "/repos/example-org/position-ext/branches/throttled") {
        response.statusCode = 429;
        response.end(JSON.stringify({ message: "too many requests" }));
        return;
      }
      if (url.pathname.startsWith("/repos/example-org/position-ext/branches/")) {
        response.statusCode = 404;
        response.end(JSON.stringify({ message: "Branch not found" }));
        return;
      }
      // GitHub REST API tags endpoint shape: /repos/<owner>/<repo>/tags.
      if (url.pathname === "/repos/example-org/position-ext/tags") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify([{ name: "v0.2.0" }, { name: "v0.1.0" }]));
        return;
      }
      if (url.pathname.startsWith("/repos/") && url.pathname.endsWith("/tags")) {
        response.statusCode = 404;
        response.end(JSON.stringify({ status: 404, message: "Not Found" }));
        return;
      }
      const file = SERVED_FILES[decodeURIComponent(url.pathname)];
      if (file === undefined) {
        response.statusCode = 404;
        response.end("not found");
        return;
      }
      response.setHeader("content-type", "application/octet-stream");
      response.end(Buffer.from(file));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    broken = createServer((_request, response) => {
      response.statusCode = 500;
      response.end("boom");
    });
    await new Promise<void>((resolve) => {
      broken.listen(0, "127.0.0.1", resolve);
    });
    brokenBaseUrl = `http://127.0.0.1:${(broken.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => broken.close(resolve));
  });

  function transport() {
    return createJsDelivrExtensionTransport({
      cdnBaseUrl: baseUrl,
      githubApiBaseUrl: baseUrl,
    });
  }

  it("fetches file bytes exactly, including binary content that is not valid UTF-8", async () => {
    const result = await transport().fetchFile("example-org", "position-ext", "v0.1.0", "assets/icon.png");
    assert.ok(result.ok);
    assert.deepStrictEqual(result.content, ICON_BYTES);
  });

  it("answers not-found for a missing file or version", async () => {
    const missingFile = await transport().fetchFile("example-org", "position-ext", "v0.1.0", "absent.ts");
    assert.deepStrictEqual(missingFile, { ok: false, kind: "not-found" });
    const missingVersion = await transport().fetchFile("example-org", "position-ext", "v9.9.9", "wendoo.json");
    assert.deepStrictEqual(missingVersion, { ok: false, kind: "not-found" });
  });

  it("resolves a branch to its head commit SHA through the GitHub API and fetches the resolved commit", async () => {
    const resolved = await transport().resolveBranch("example-org", "position-ext", "main");
    assert.ok(resolved.ok);
    assert.equal(resolved.sha, BRANCH_SHA);

    const manifest = await transport().fetchFile("example-org", "position-ext", resolved.sha, "wendoo.json");
    assert.ok(manifest.ok);
    assert.match(new TextDecoder().decode(manifest.content), /0\.2\.0/);
  });

  it("answers not-found for a branch the repository does not have", async () => {
    const resolved = await transport().resolveBranch("example-org", "position-ext", "absent-branch");
    assert.deepStrictEqual(resolved, { ok: false, kind: "not-found" });
  });

  it("answers rate-limited, not branch-not-found, when the API's anonymous rate limit is exhausted", async () => {
    const limited = await transport().resolveBranch("example-org", "position-ext", "limited");
    assert.deepStrictEqual(limited, { ok: false, kind: "rate-limited" });
    const throttled = await transport().resolveBranch("example-org", "position-ext", "throttled");
    assert.deepStrictEqual(throttled, { ok: false, kind: "rate-limited" });
  });

  it("lists a repository's published versions through the GitHub tags API, dropping the leading v", async () => {
    const listed = await transport().listVersionTags("example-org", "position-ext");
    assert.deepStrictEqual(listed, { ok: true, versions: ["0.2.0", "0.1.0"] });
  });

  it("answers not-found for a repository the GitHub tags API does not know", async () => {
    const listed = await transport().listVersionTags("example-org", "absent-ext");
    assert.deepStrictEqual(listed, { ok: false, kind: "not-found" });
  });

  it("reports an unexpected HTTP status as http-status", async () => {
    const failing = createJsDelivrExtensionTransport({
      cdnBaseUrl: brokenBaseUrl,
      githubApiBaseUrl: brokenBaseUrl,
    });
    const file = await failing.fetchFile("example-org", "position-ext", "v0.1.0", "wendoo.json");
    assert.deepStrictEqual(file, { ok: false, kind: "http-status", status: 500 });
    const branch = await failing.resolveBranch("example-org", "position-ext", "main");
    assert.deepStrictEqual(branch, { ok: false, kind: "http-status", status: 500 });
    const versions = await failing.listVersionTags("example-org", "position-ext");
    assert.deepStrictEqual(versions, { ok: false, kind: "http-status", status: 500 });
  });

  it("reports a connection failure as unreachable", async () => {
    const unreachable = createJsDelivrExtensionTransport({
      // A closed loopback port: connections are refused immediately.
      cdnBaseUrl: "http://127.0.0.1:1",
      githubApiBaseUrl: "http://127.0.0.1:1",
    });
    const file = await unreachable.fetchFile("example-org", "position-ext", "v0.1.0", "wendoo.json");
    assert.ok(!file.ok && file.kind === "unreachable");
    const branch = await unreachable.resolveBranch("example-org", "position-ext", "main");
    assert.ok(!branch.ok && branch.kind === "unreachable");
    const versions = await unreachable.listVersionTags("example-org", "position-ext");
    assert.ok(!versions.ok && versions.kind === "unreachable");
  });
});

describe("createJsDelivrExtensionTransport HTTP cache handling", () => {
  it("bypasses the HTTP cache for the version-list query", async () => {
    const { calls, fetchImpl } = recordingFetch();
    await createJsDelivrExtensionTransport({ fetchImpl }).listVersionTags("example-org", "position-ext");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.init?.cache, "no-store");
  });

  it("bypasses the HTTP cache for the branch-resolution query", async () => {
    const { calls, fetchImpl } = recordingFetch();
    await createJsDelivrExtensionTransport({ fetchImpl }).resolveBranch("example-org", "position-ext", "main");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.init?.cache, "no-store");
  });

  it("leaves the immutable pinned-file query cacheable", async () => {
    const { calls, fetchImpl } = recordingFetch();
    await createJsDelivrExtensionTransport({ fetchImpl }).fetchFile(
      "example-org",
      "position-ext",
      "v0.1.0",
      "wendoo.json"
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.init?.cache, undefined);
  });

  it("carries no-store through a wrapping fetchImpl that also attaches a timeout signal", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const signal = AbortSignal.timeout(15000);
    // Mirrors the update-check transport's timeout wrapper, which merges the
    // transport-supplied init with its own abort signal.
    const wrapped: typeof fetch = (input, init) => fetchImpl(input, { ...init, signal });
    await createJsDelivrExtensionTransport({ fetchImpl: wrapped }).listVersionTags("example-org", "position-ext");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.init?.cache, "no-store");
    assert.equal(calls[0]?.init?.signal, signal);
  });
});

describe("createJsDelivrExtensionTransport version listing over the GitHub tags API", () => {
  /** Build a transport whose fetch answers every call with `response`, capturing the requested URL. */
  function stubbing(response: Response): {
    readonly urls: string[];
    readonly transport: ReturnType<typeof createJsDelivrExtensionTransport>;
  } {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = (input) => {
      urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(response.clone());
    };
    return { urls, transport: createJsDelivrExtensionTransport({ fetchImpl }) };
  }

  it("requests the GitHub tags endpoint with a per-page bound", async () => {
    const { urls, transport } = stubbing(new Response("[]", { status: 200 }));
    await transport.listVersionTags("example-org", "position-ext");
    assert.equal(urls.length, 1);
    assert.equal(urls[0], "https://api.github.com/repos/example-org/position-ext/tags?per_page=100");
  });

  it("normalizes v-prefixed tag names into the form the release comparators accept", async () => {
    const body = JSON.stringify([{ name: "v0.8.0" }, { name: "v0.7.0" }]);
    const { transport } = stubbing(new Response(body, { status: 200 }));
    const listed = await transport.listVersionTags("example-org", "position-ext");
    assert.ok(listed.ok);
    assert.deepStrictEqual(listed.versions, ["0.8.0", "0.7.0"]);
    assert.equal(highestListedRelease(listed.versions), "0.8.0");
  });

  it("answers not-found for a 404 and http-status for any other non-ok status", async () => {
    const notFound = stubbing(new Response("Not Found", { status: 404 }));
    assert.deepStrictEqual(await notFound.transport.listVersionTags("example-org", "position-ext"), {
      ok: false,
      kind: "not-found",
    });
    const rateLimited = stubbing(new Response("rate limited", { status: 403 }));
    assert.deepStrictEqual(await rateLimited.transport.listVersionTags("example-org", "position-ext"), {
      ok: false,
      kind: "http-status",
      status: 403,
    });
  });
});
