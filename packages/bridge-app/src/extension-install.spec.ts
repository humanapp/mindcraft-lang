import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionFetchResult } from "@wendoo/app-host";
import { bytesToBase64, ExtensionFetchErrorCode } from "@wendoo/app-host";
import type { WorkspaceDiagnosticEntry } from "@wendoo/ts-compiler";
import type { EmbeddedExtension } from "./embedded-extensions.js";
import {
  collectExtensionFetchClosure,
  diffProjectDiagnostics,
  movedClosureHasMissingContent,
} from "./extension-install.js";
import { appendExtensionInstallLog, parseExtensionInstallLog } from "./extension-install-log.js";

function entry(message: string, severity: "error" | "warning" = "error"): WorkspaceDiagnosticEntry {
  return {
    severity,
    message,
    code: "MC1",
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
  };
}

function state(options: { files?: Record<string, WorkspaceDiagnosticEntry[]>; brains?: Record<string, string[]> }): {
  files: Map<string, WorkspaceDiagnosticEntry[]>;
  brains: Map<string, string[]>;
} {
  return {
    files: new Map(Object.entries(options.files ?? {})),
    brains: new Map(Object.entries(options.brains ?? {})),
  };
}

describe("diffProjectDiagnostics", () => {
  it("classifies identical states as unchanged", () => {
    const before = state({ files: { "main.ts": [entry("boom")] }, brains: { b1: ["p1"] } });
    const after = state({ files: { "main.ts": [entry("boom")] }, brains: { b1: ["p1"] } });
    const outcome = diffProjectDiagnostics(before, after);
    assert.equal(outcome.kind, "unchanged");
    assert.deepStrictEqual(outcome.newProblems, []);
    assert.deepStrictEqual(outcome.resolvedProblems, []);
  });

  it("classifies vanished problems as improved and names them", () => {
    const before = state({ files: { "main.ts": [entry("boom")] } });
    const after = state({});
    const outcome = diffProjectDiagnostics(before, after);
    assert.equal(outcome.kind, "improved");
    assert.deepStrictEqual(outcome.resolvedProblems, [{ location: "main.ts", description: "error MC1: boom" }]);
  });

  it("classifies any new problem as worsened, even when others resolved", () => {
    const before = state({ files: { "main.ts": [entry("boom")] } });
    const after = state({ files: { ".libraries/o/r/index.ts": [entry("broken ext")] } });
    const outcome = diffProjectDiagnostics(before, after);
    assert.equal(outcome.kind, "worsened");
    assert.deepStrictEqual(outcome.newProblems, [
      { location: ".libraries/o/r/index.ts", description: "error MC1: broken ext" },
    ]);
    assert.equal(outcome.resolvedProblems.length, 1);
  });

  it("treats a problem that only moved within its file as unchanged", () => {
    const moved: WorkspaceDiagnosticEntry = {
      ...entry("boom"),
      range: { startLine: 9, startColumn: 1, endLine: 9, endColumn: 2 },
    };
    const outcome = diffProjectDiagnostics(
      state({ files: { "main.ts": [entry("boom")] } }),
      state({ files: { "main.ts": [moved] } })
    );
    assert.equal(outcome.kind, "unchanged");
  });

  it("counts duplicate problems per location as a multiset", () => {
    const outcome = diffProjectDiagnostics(
      state({ files: { "main.ts": [entry("boom")] } }),
      state({ files: { "main.ts": [entry("boom"), entry("boom")] } })
    );
    assert.equal(outcome.kind, "worsened");
    assert.equal(outcome.newProblems.length, 1);
  });

  it("diffs brain problems keyed by brain", () => {
    const outcome = diffProjectDiagnostics(
      state({ brains: { b1: [] } }),
      state({ brains: { b1: ["rule 1 when parse 12: unknown tile"] } })
    );
    assert.equal(outcome.kind, "worsened");
    assert.deepStrictEqual(outcome.newProblems, [
      { location: "b1", description: "rule 1 when parse 12: unknown tile" },
    ]);
  });
});

describe("collectExtensionFetchClosure", () => {
  const encoder = new TextEncoder();

  function manifestText(name: string, extensions?: Record<string, string>): string {
    return JSON.stringify({ name, version: "1.0.0", files: ["index.ts"], ...(extensions ? { extensions } : {}) });
  }

  function okFetch(reference: string, manifest: string): ExtensionFetchResult {
    const coordinate = reference.slice("gh:".length).split(/[@#]/)[0];
    return {
      ok: true,
      snapshot: {
        coordinate,
        reference,
        specifier: reference.split("@")[1] ?? "resolved-sha",
        manifest: { name: coordinate, version: "1.0.0", extensions: {} },
        files: [
          { path: "wendoo.json", content: encoder.encode(manifest) },
          { path: "index.ts", content: encoder.encode("export {};") },
        ],
      },
    };
  }

  it("fetches every reachable gh reference transitively, through embedded manifests too", async () => {
    const embedded: EmbeddedExtension = {
      canonicalOrigin: "wendoo-lang/stdlib",
      files: [
        { path: "index.ts", content: "export {};" },
        {
          path: "wendoo.json",
          content: manifestText("stdlib", { "example-org/from-embedded": "gh:example-org/from-embedded@v1" }),
        },
      ],
    };
    const fetches: string[] = [];
    const result = await collectExtensionFetchClosure({
      extensions: {
        "wendoo-lang/stdlib": "embedded:wendoo-lang/stdlib",
        "example-org/root": "gh:example-org/root@v1",
      },
      embedded: [embedded],
      stored: {},
      fetchSnapshot: async (reference) => {
        fetches.push(reference);
        if (reference === "gh:example-org/root@v1") {
          return okFetch(reference, manifestText("root", { "example-org/nested": "gh:example-org/nested@v2" }));
        }
        return okFetch(reference, manifestText("leaf"));
      },
    });

    assert.ok(result.ok);
    assert.deepStrictEqual(fetches.sort(), [
      "gh:example-org/from-embedded@v1",
      "gh:example-org/nested@v2",
      "gh:example-org/root@v1",
    ]);
    assert.deepStrictEqual([...result.snapshotsByReference.keys()].sort(), fetches.sort());
  });

  it("reuses a stored record whose reference matches without fetching", async () => {
    const stored = {
      "example-org/root": {
        reference: "gh:example-org/root@v1",
        specifier: "v1",
        files: { "wendoo.json": bytesToBase64(new TextEncoder().encode(manifestText("root"))) },
      },
    };
    const fetches: string[] = [];
    const result = await collectExtensionFetchClosure({
      extensions: { "example-org/root": "gh:example-org/root@v1" },
      embedded: [],
      stored,
      fetchSnapshot: async (reference) => {
        fetches.push(reference);
        return okFetch(reference, manifestText("root"));
      },
    });
    assert.ok(result.ok);
    assert.deepStrictEqual(fetches, []);
    assert.equal(result.snapshotsByReference.get("gh:example-org/root@v1"), stored["example-org/root"]);
  });

  it("refetches and replaces a stored record whose files carry no parseable manifest", async () => {
    const stored = {
      "example-org/root": {
        reference: "gh:example-org/root@v1",
        specifier: "v1",
        files: {},
      },
    };
    const fetches: string[] = [];
    const result = await collectExtensionFetchClosure({
      extensions: { "example-org/root": "gh:example-org/root@v1" },
      embedded: [],
      stored,
      fetchSnapshot: async (reference) => {
        fetches.push(reference);
        return okFetch(reference, manifestText("root"));
      },
    });
    assert.ok(result.ok);
    assert.deepStrictEqual(fetches, ["gh:example-org/root@v1"]);
    const record = result.snapshotsByReference.get("gh:example-org/root@v1");
    assert.ok(record, "the walk produced a record for the reference");
    assert.notEqual(record, stored["example-org/root"], "the unusable stored record is replaced by the fresh fetch");
    assert.ok(record.files["wendoo.json"], "the replacement carries the fetched manifest");
  });

  it("dry mode reports missing content for a stored record whose files carry no parseable manifest", async () => {
    const stored = {
      "example-org/root": {
        reference: "gh:example-org/root@v1",
        specifier: "v1",
        files: {},
      },
    };
    assert.equal(
      await movedClosureHasMissingContent({
        extensions: { "example-org/root": "gh:example-org/root@v1" },
        embedded: [],
        stored,
      }),
      true
    );
    const usable = {
      "example-org/root": {
        reference: "gh:example-org/root@v1",
        specifier: "v1",
        files: { "wendoo.json": bytesToBase64(new TextEncoder().encode(manifestText("root"))) },
      },
    };
    assert.equal(
      await movedClosureHasMissingContent({
        extensions: { "example-org/root": "gh:example-org/root@v1" },
        embedded: [],
        stored: usable,
      }),
      false
    );
  });

  it("propagates the first fetch failure and produces no partial closure", async () => {
    const result = await collectExtensionFetchClosure({
      extensions: { "example-org/root": "gh:example-org/root@v1" },
      embedded: [],
      stored: {},
      fetchSnapshot: async (reference) => ({
        ok: false,
        error: { code: ExtensionFetchErrorCode.UNREACHABLE, reference, message: "offline" },
      }),
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, ExtensionFetchErrorCode.UNREACHABLE);
  });

  it("re-applies a range-scoped move to a transitive pin whose version is learned by fetching it, within one walk", async () => {
    const DEP = "example-org/dep";
    const OLD = "gh:example-org/versioned@1111111111111111111111111111111111111111";
    const NEW = "gh:example-org/versioned@2222222222222222222222222222222222222222";
    const contentByReference: Record<string, string> = {
      [`gh:${DEP}@v1`]: manifestText("Dep", { "example-org/versioned": OLD }),
      [OLD]: JSON.stringify({ name: "Versioned", version: "0.1.2", files: ["index.ts"] }),
      [NEW]: JSON.stringify({ name: "Versioned", version: "0.2.0", files: ["index.ts"] }),
    };
    const result = await collectExtensionFetchClosure({
      extensions: { [DEP]: `gh:${DEP}@v1` },
      embedded: [],
      stored: {},
      moves: { "example-org/versioned": [{ from: { packageVersion: "^0.1.0" }, ref: NEW }] },
      fetchSnapshot: async (reference) => okFetch(reference, contentByReference[reference] ?? manifestText("leaf")),
    });
    assert.ok(result.ok);
    // The old pin's content taught its version (in range), so the moved
    // destination is in the final closure.
    assert.ok(result.snapshotsByReference.has(NEW));
    assert.deepStrictEqual(result.warnings, []);
  });

  it("resolves a floating hop to a pin and lets a downstream range entry capture the pin, within one walk", async () => {
    const DEP = "example-org/dep";
    const X = "example-org/x";
    const Y_REF = "gh:example-org/y@3333333333333333333333333333333333333333";
    const contentByReference: Record<string, string> = {
      [`gh:${DEP}@v1`]: manifestText("Dep", { [X]: `embedded:${X}` }),
      [`gh:${X}@1.2.0`]: JSON.stringify({ name: "X", version: "1.2.0", files: ["index.ts"] }),
      [Y_REF]: JSON.stringify({ name: "Y", version: "2.0.0", files: ["index.ts"] }),
    };
    const result = await collectExtensionFetchClosure({
      extensions: { [DEP]: `gh:${DEP}@v1` },
      embedded: [],
      stored: {},
      moves: {
        [X]: [
          { from: { transport: "embedded" }, ref: `gh:${X}` },
          { from: { transport: "gh", packageVersion: "^1.0.0" }, ref: Y_REF },
        ],
      },
      fetchSnapshot: async (reference) => okFetch(reference, contentByReference[reference] ?? manifestText("leaf")),
      listVersions: async () => ({ ok: true, versions: ["1.2.0", "2.0.0-rc.1"] }),
    });
    assert.ok(result.ok);
    // The floating hop pinned at the highest stable version, its fetched
    // content taught the version, and the range entry completed the chain.
    assert.equal(result.floatingPins.get(X), `gh:${X}@1.2.0`);
    assert.ok(result.snapshotsByReference.has(Y_REF));
    assert.deepStrictEqual(result.warnings, []);
  });
});

describe("extension install log", () => {
  it("appends events, preserves historical entries of retired kinds, and parses malformed text as empty", () => {
    // A log persisted before the transaction-undo mechanism was removed still
    // carries its "undo" entries; they parse and survive appends unchanged.
    const historical = JSON.stringify([{ kind: "undo", at: 1 }]);
    const appended = appendExtensionInstallLog(historical, [
      { kind: "install", at: 2, origin: "example-org/a", reference: "gh:example-org/a@v1", specifier: "v1" },
    ]);
    const events = parseExtensionInstallLog(appended);
    assert.deepStrictEqual(
      events.map((event) => event.kind),
      ["undo", "install"]
    );
    assert.deepStrictEqual(parseExtensionInstallLog("not json"), []);
  });
});
