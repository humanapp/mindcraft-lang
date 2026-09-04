import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExtensionFetchErrorCode } from "@wendoo/app-host";
import { ExtensionActionResultCode } from "./extension-catalog.js";
import type { ExtensionInstallOutcomeKind, ExtensionInstallReport } from "./extension-install.js";
import type { LibraryInstallAttempt, LibraryOfferToasts } from "./library-offer.js";
import { addOfferedLibrary } from "./library-offer.js";

const COORDINATE = "acme/lib-position";
const REFERENCE = `gh:${COORDINATE}@1.0.0`;
const DISPLAY_NAME = "Position";

/** One presentation the offer made, as the recording surface kept it. */
type RecordedCall =
  | { kind: "failed"; code?: string; message: string }
  | { kind: "confirmed"; libraryName: string }
  | { kind: "worsened"; libraryName: string };

function recordingToasts(): { toasts: LibraryOfferToasts; calls: RecordedCall[] } {
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
      worsened: (libraryName) => {
        calls.push({ kind: "worsened", libraryName });
      },
    },
  };
}

/** A committed report whose outcome is of `kind`. */
function committed(kind: ExtensionInstallOutcomeKind): ExtensionInstallReport {
  return { committed: true, outcome: { kind, newProblems: [], resolvedProblems: [] }, warnings: [] };
}

/**
 * Run one offer of {@link COORDINATE} whose install answers `attempt`, over a
 * catalog that approves {@link REFERENCE} for it unless `approved` says it
 * approves nothing.
 */
async function offer(
  attempt: LibraryInstallAttempt,
  approved = true
): Promise<{ added: boolean; calls: RecordedCall[]; installed: string[] }> {
  const { toasts, calls } = recordingToasts();
  const installed: string[] = [];
  const added = await addOfferedLibrary(
    {
      approvedReference: () => (approved ? REFERENCE : undefined),
      install: async (asked) => {
        installed.push(asked);
        return attempt;
      },
      displayName: () => DISPLAY_NAME,
      toasts,
    },
    COORDINATE
  );
  return { added, calls, installed };
}

describe("addOfferedLibrary", () => {
  it("installs the reference the app's catalog approves for the coordinate", async () => {
    const { added, installed, calls } = await offer({
      ok: true,
      action: { ok: true, code: ExtensionActionResultCode.INSTALLED, extensions: {} },
      report: committed("unchanged"),
    });

    assert.deepEqual(installed, [REFERENCE]);
    assert.equal(added, true);
    assert.deepEqual(calls, [{ kind: "confirmed", libraryName: DISPLAY_NAME }]);
  });

  it("refuses a coordinate the catalog approves nothing for, running no install", async () => {
    const { added, installed, calls } = await offer(
      { ok: true, action: { ok: true, code: ExtensionActionResultCode.INSTALLED, extensions: {} } },
      false
    );

    assert.deepEqual(installed, []);
    assert.equal(added, false);
    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls.map((call) => call.kind),
      ["failed"]
    );
  });

  it("presents an input rejection as failed with its stable code", async () => {
    const { added, calls } = await offer({
      ok: false,
      code: ExtensionFetchErrorCode.UNREACHABLE,
      message: "unreachable",
    });

    assert.equal(added, false);
    assert.deepEqual(calls, [{ kind: "failed", code: ExtensionFetchErrorCode.UNREACHABLE, message: "unreachable" }]);
  });

  it("presents a transaction refusal as failed and reports that nothing was added", async () => {
    const { added, calls } = await offer({
      ok: true,
      action: { ok: true, code: ExtensionActionResultCode.INSTALLED, extensions: {} },
      report: {
        committed: false,
        refusal: {
          kind: "fetch",
          error: { code: ExtensionFetchErrorCode.UNREACHABLE, reference: REFERENCE, message: "unreachable" },
        },
      },
    });

    assert.equal(added, false);
    assert.deepEqual(calls, [{ kind: "failed", code: ExtensionFetchErrorCode.UNREACHABLE, message: "unreachable" }]);
  });

  it("adds nothing for a library the project already held, presenting nothing", async () => {
    const { added, calls } = await offer({
      ok: true,
      action: { ok: false, code: ExtensionActionResultCode.ALREADY_INSTALLED, extensions: {} },
    });

    assert.equal(added, false);
    assert.deepEqual(calls, []);
  });

  it("presents an action that changed nothing else as failed", async () => {
    const { added, calls } = await offer({
      ok: true,
      action: { ok: false, code: ExtensionActionResultCode.UNKNOWN_COORDINATE, extensions: {} },
    });

    assert.equal(added, false);
    assert.deepEqual(
      calls.map((call) => call.kind),
      ["failed"]
    );
  });

  it("notes new problems after the confirmation when the commit worsened the project", async () => {
    const { added, calls } = await offer({
      ok: true,
      action: { ok: true, code: ExtensionActionResultCode.INSTALLED, extensions: {} },
      report: committed("worsened"),
    });

    assert.equal(added, true);
    assert.deepEqual(calls, [
      { kind: "confirmed", libraryName: DISPLAY_NAME },
      { kind: "worsened", libraryName: DISPLAY_NAME },
    ]);
  });

  it("notes nothing beyond the confirmation when the commit improved the project", async () => {
    const { calls } = await offer({
      ok: true,
      action: { ok: true, code: ExtensionActionResultCode.INSTALLED, extensions: {} },
      report: committed("improved"),
    });

    assert.deepEqual(calls, [{ kind: "confirmed", libraryName: DISPLAY_NAME }]);
  });
});
