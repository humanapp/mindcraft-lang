import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExtensionFetchErrorCode } from "@wendoo-lang/app-host";
import type { ExtensionInstallOutcome, ExtensionInstallProblem, ExtensionInstallReport } from "./extension-install.js";
import type { ExtensionTransactionToasts } from "./extension-report-presenter.js";
import { presentExtensionTransaction } from "./extension-report-presenter.js";

type RecordedCall = { kind: "failed"; code?: string; message: string } | { kind: "confirmed"; libraryName: string };

function recordingToasts(): { toasts: ExtensionTransactionToasts; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    toasts: {
      failed: (refusal) => {
        calls.push({
          kind: "failed",
          ...(refusal.code !== undefined ? { code: refusal.code } : {}),
          message: refusal.message,
        });
      },
      confirmed: (libraryName) => {
        calls.push({ kind: "confirmed", libraryName });
      },
    },
  };
}

const PROBLEM: ExtensionInstallProblem = {
  location: "brain-1",
  description: "Page 1/Rule 1 type 2004: Actuator anonymous slot references unknown tileId tile.parameter->anon",
};

function committedReport(outcome: ExtensionInstallOutcome): ExtensionInstallReport {
  return { committed: true, outcome, warnings: [] };
}

describe("presentExtensionTransaction", () => {
  it("presents nothing without a report", () => {
    const { toasts, calls } = recordingToasts();
    presentExtensionTransaction({ report: undefined, flavor: "install", libraryName: "Cutebot", toasts });
    assert.deepEqual(calls, []);
  });

  it("presents a refusal as failed with its stable code and confirms nothing", () => {
    const { toasts, calls } = recordingToasts();
    presentExtensionTransaction({
      report: {
        committed: false,
        refusal: {
          kind: "fetch",
          error: {
            code: ExtensionFetchErrorCode.UNREACHABLE,
            reference: "gh:acme/lib-x@1.0.0",
            message: "unreachable",
          },
        },
      },
      flavor: "install",
      libraryName: "Cutebot",
      toasts,
    });
    assert.deepEqual(calls, [{ kind: "failed", code: ExtensionFetchErrorCode.UNREACHABLE, message: "unreachable" }]);
  });

  it("presents a worsened install commit as the confirmation alone, consuming no undo", () => {
    const { toasts, calls } = recordingToasts();
    presentExtensionTransaction({
      report: committedReport({ kind: "worsened", newProblems: [PROBLEM], resolvedProblems: [] }),
      flavor: "install",
      libraryName: "Cutebot",
      toasts,
    });
    assert.deepEqual(calls, [{ kind: "confirmed", libraryName: "Cutebot" }]);
  });

  it("presents a worsened uninstall commit as the confirmation alone", () => {
    const { toasts, calls } = recordingToasts();
    presentExtensionTransaction({
      report: committedReport({ kind: "worsened", newProblems: [PROBLEM], resolvedProblems: [] }),
      flavor: "uninstall",
      libraryName: "Cutebot",
      toasts,
    });
    assert.deepEqual(calls, [{ kind: "confirmed", libraryName: "Cutebot" }]);
  });

  it("presents a worsened refresh commit as nothing at all", () => {
    const { toasts, calls } = recordingToasts();
    presentExtensionTransaction({
      report: committedReport({ kind: "worsened", newProblems: [PROBLEM], resolvedProblems: [] }),
      flavor: "refresh",
      toasts,
    });
    assert.deepEqual(calls, []);
  });

  it("presents an improved commit as the confirmation alone", () => {
    const { toasts, calls } = recordingToasts();
    presentExtensionTransaction({
      report: committedReport({ kind: "improved", newProblems: [], resolvedProblems: [PROBLEM, PROBLEM] }),
      flavor: "uninstall",
      libraryName: "Cutebot",
      toasts,
    });
    assert.deepEqual(calls, [{ kind: "confirmed", libraryName: "Cutebot" }]);
  });

  it("presents an improved refresh commit as nothing at all", () => {
    const { toasts, calls } = recordingToasts();
    presentExtensionTransaction({
      report: committedReport({ kind: "improved", newProblems: [], resolvedProblems: [PROBLEM] }),
      flavor: "refresh",
      toasts,
    });
    assert.deepEqual(calls, []);
  });

  it("confirms an unchanged commit and presents nothing else", () => {
    const { toasts, calls } = recordingToasts();
    presentExtensionTransaction({
      report: committedReport({ kind: "unchanged", newProblems: [], resolvedProblems: [] }),
      flavor: "install",
      libraryName: "Cutebot",
      toasts,
    });
    assert.deepEqual(calls, [{ kind: "confirmed", libraryName: "Cutebot" }]);
  });

  it("keeps every toast payload free of diagnostics and reference strings", () => {
    const { toasts, calls } = recordingToasts();
    presentExtensionTransaction({
      report: committedReport({ kind: "worsened", newProblems: [PROBLEM], resolvedProblems: [PROBLEM] }),
      flavor: "install",
      libraryName: "Cutebot",
      toasts,
    });
    const rendered = JSON.stringify(calls.map(({ kind, ...payload }) => payload));
    assert.doesNotMatch(rendered, /tile\./);
    assert.doesNotMatch(rendered, /->/);
    assert.doesNotMatch(rendered, /::/);
    assert.doesNotMatch(rendered, /\b\d{4}\b/);
    assert.doesNotMatch(rendered, /\bgh:/);
  });
});
