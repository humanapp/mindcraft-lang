import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionFetchResult } from "@mindcraft-lang/app-host";
import { ExtensionFetchErrorCode } from "@mindcraft-lang/app-host";
import type { WorkspaceDiagnosticEntry } from "@mindcraft-lang/ts-compiler";
import type { EmbeddedExtension } from "./embedded-extensions.js";
import { collectExtensionFetchClosure, diffProjectDiagnostics } from "./extension-install.js";
import { appendExtensionInstallLog, parseExtensionInstallLog } from "./extension-install-log.js";
import { bytesToBase64 } from "./fetched-extension-snapshots.js";

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
          { path: "mindcraft.json", content: encoder.encode(manifest) },
          { path: "index.ts", content: encoder.encode("export {};") },
        ],
      },
    };
  }

  it("fetches every reachable gh reference transitively, through embedded manifests too", async () => {
    const embedded: EmbeddedExtension = {
      canonicalOrigin: "mindcraft-lang/stdlib",
      files: [
        { path: "index.ts", content: "export {};" },
        {
          path: "mindcraft.json",
          content: manifestText("stdlib", { "example-org/from-embedded": "gh:example-org/from-embedded@v1" }),
        },
      ],
    };
    const fetches: string[] = [];
    const result = await collectExtensionFetchClosure({
      extensions: {
        "mindcraft-lang/stdlib": "embedded:mindcraft-lang/stdlib",
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
        files: { "mindcraft.json": bytesToBase64(new TextEncoder().encode(manifestText("root"))) },
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
});

describe("extension install log", () => {
  it("appends events to the stored log text and parses malformed text as empty", () => {
    const first = appendExtensionInstallLog(undefined, [
      { kind: "install", at: 1, origin: "example-org/a", reference: "gh:example-org/a@v1", specifier: "v1" },
    ]);
    const second = appendExtensionInstallLog(first, [{ kind: "undo", at: 2 }]);
    const events = parseExtensionInstallLog(second);
    assert.equal(events.length, 2);
    assert.equal(events[0].kind, "install");
    assert.equal(events[1].kind, "undo");
    assert.deepStrictEqual(parseExtensionInstallLog("not json"), []);
  });
});
