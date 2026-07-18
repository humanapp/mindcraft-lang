import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeProjectContentManifest } from "@mindcraft-lang/app-host";
import {
  applyTargetRangeToManifest,
  planTargetUpdate,
  type TargetReleaseListing,
  type TargetUpdateCheckResult,
  type TargetUpdateIo,
  TargetUpdateOutcome,
} from "./target-update";

/** An io whose every operation fails the test when invoked, except the given overrides. */
function io(overrides: Partial<TargetUpdateIo> = {}): TargetUpdateIo {
  return {
    listLatestRelease: () => {
      throw new Error("listLatestRelease must not be invoked");
    },
    checkPinUpdate: () => {
      throw new Error("checkPinUpdate must not be invoked");
    },
    ...overrides,
  };
}

const listing = (latestRelease: string): Promise<TargetReleaseListing> => Promise.resolve({ ok: true, latestRelease });

const listingFailure: Promise<TargetReleaseListing> = Promise.resolve({
  ok: false,
  error: { code: "EXTENSION_FETCH_UNREACHABLE", message: "offline" },
});

const pinCurrent: Promise<TargetUpdateCheckResult> = Promise.resolve({ ok: true, updateAvailable: false });

const pinUpdate = (reference: string): Promise<TargetUpdateCheckResult> =>
  Promise.resolve({ ok: true, updateAvailable: true, update: { reference } });

describe("planTargetUpdate", () => {
  it("plans nothing to update when neither reference resolves", async () => {
    const plan = await planTargetUpdate({ appRef: undefined, registryAppRef: undefined, manifestRanges: {} }, io());
    assert.deepEqual(plan, { outcome: TargetUpdateOutcome.NOT_UPDATABLE });
  });

  it("plans a failure with the invalid-reference code for a non-gh appRef", async () => {
    const plan = await planTargetUpdate(
      { appRef: "embedded:example-org/hello-target", registryAppRef: undefined, manifestRanges: {} },
      io()
    );
    assert.ok(plan.outcome === TargetUpdateOutcome.CHECK_FAILED);
    assert.equal(plan.errorCode, "EXTENSION_FETCH_INVALID_REFERENCE");
  });

  it("selects the appRef coordinate over the registry reference", async () => {
    const listed: string[] = [];
    const checked: string[] = [];
    const plan = await planTargetUpdate(
      {
        appRef: "gh:example-org/hello-target@v0.1.0",
        registryAppRef: "gh:other-org/other-target@abc",
        manifestRanges: {},
      },
      io({
        listLatestRelease: (coordinate) => {
          listed.push(coordinate);
          return listing("0.2.0");
        },
        checkPinUpdate: (reference) => {
          checked.push(reference);
          return pinUpdate("gh:example-org/hello-target@0.2.0");
        },
      })
    );
    assert.deepEqual(listed, ["example-org/hello-target"]);
    assert.deepEqual(checked, ["gh:example-org/hello-target@v0.1.0"]);
    assert.ok(plan.outcome === TargetUpdateOutcome.APPLY);
    assert.equal(plan.coordinate, "example-org/hello-target");
    assert.equal(plan.updatedAppRef, "gh:example-org/hello-target@0.2.0");
  });

  it("plans a manifest add for an absent target entry with a current pin", async () => {
    const plan = await planTargetUpdate(
      { appRef: "gh:example-org/hello-target@v0.2.0", registryAppRef: undefined, manifestRanges: {} },
      io({ listLatestRelease: () => listing("0.2.0"), checkPinUpdate: () => pinCurrent })
    );
    assert.ok(plan.outcome === TargetUpdateOutcome.APPLY);
    assert.equal(plan.updateManifest, true);
    assert.equal(plan.updatedAppRef, undefined);
    assert.equal(plan.latestVersion, "0.2.0");
  });

  it("plans a pin rewrite without a manifest write when the declared range is current", async () => {
    const plan = await planTargetUpdate(
      {
        appRef: "gh:example-org/hello-target@v0.1.0",
        registryAppRef: undefined,
        manifestRanges: { "example-org/hello-target": "^0.2.0" },
      },
      io({
        listLatestRelease: () => listing("0.2.0"),
        checkPinUpdate: () => pinUpdate("gh:example-org/hello-target@0.2.0"),
      })
    );
    assert.ok(plan.outcome === TargetUpdateOutcome.APPLY);
    assert.equal(plan.updateManifest, false);
    assert.equal(plan.updatedAppRef, "gh:example-org/hello-target@0.2.0");
  });

  it("plans up to date when the range is current and the pin needs no rewrite", async () => {
    const plan = await planTargetUpdate(
      {
        appRef: "gh:example-org/hello-target@v0.2.0",
        registryAppRef: undefined,
        manifestRanges: { "example-org/hello-target": "^0.2.0" },
      },
      io({ listLatestRelease: () => listing("0.2.0"), checkPinUpdate: () => pinCurrent })
    );
    assert.deepEqual(plan, {
      outcome: TargetUpdateOutcome.UP_TO_DATE,
      coordinate: "example-org/hello-target",
      latestVersion: "0.2.0",
    });
  });

  it("plans a registry-tier apply carrying the newest release's reference to write", async () => {
    const plan = await planTargetUpdate(
      {
        appRef: undefined,
        registryAppRef: "gh:example-org/hello-target@abc123",
        manifestRanges: { "example-org/hello-target": "^0.1.0" },
      },
      io({ listLatestRelease: () => listing("1.0.0") })
    );
    assert.deepEqual(plan, {
      outcome: TargetUpdateOutcome.APPLY,
      coordinate: "example-org/hello-target",
      latestVersion: "1.0.0",
      updateManifest: true,
      updatedAppRef: "gh:example-org/hello-target@1.0.0",
    });
  });

  it("plans a registry-tier apply with the reference to write when the declared range is current", async () => {
    const plan = await planTargetUpdate(
      {
        appRef: undefined,
        registryAppRef: "gh:example-org/hello-target@abc123",
        manifestRanges: { "example-org/hello-target": "^1.0.0" },
      },
      io({ listLatestRelease: () => listing("1.0.0") })
    );
    assert.deepEqual(plan, {
      outcome: TargetUpdateOutcome.APPLY,
      coordinate: "example-org/hello-target",
      latestVersion: "1.0.0",
      updateManifest: false,
      updatedAppRef: "gh:example-org/hello-target@1.0.0",
    });
  });

  it("plans a branch rebuild with the manifest update when the listing succeeds", async () => {
    const appRef = "gh:example-org/hello-target#main";
    const plan = await planTargetUpdate(
      { appRef, registryAppRef: undefined, manifestRanges: { "example-org/hello-target": "^0.1.0" } },
      io({ listLatestRelease: () => listing("0.2.0") })
    );
    assert.deepEqual(plan, {
      outcome: TargetUpdateOutcome.REBUILD_BRANCH,
      appRef,
      branch: "main",
      coordinate: "example-org/hello-target",
      latestVersion: "0.2.0",
      updateManifest: true,
    });
  });

  it("plans a branch rebuild without a manifest update when the range is current", async () => {
    const plan = await planTargetUpdate(
      {
        appRef: "gh:example-org/hello-target#main",
        registryAppRef: undefined,
        manifestRanges: { "example-org/hello-target": "^0.2.0" },
      },
      io({ listLatestRelease: () => listing("0.2.0") })
    );
    assert.ok(plan.outcome === TargetUpdateOutcome.REBUILD_BRANCH);
    assert.equal(plan.updateManifest, false);
  });

  it("falls back to a rebuild alone when the listing fails for a branch reference", async () => {
    const appRef = "gh:example-org/hello-target#main";
    const plan = await planTargetUpdate(
      { appRef, registryAppRef: undefined, manifestRanges: {} },
      io({ listLatestRelease: () => listingFailure })
    );
    assert.deepEqual(plan, {
      outcome: TargetUpdateOutcome.REBUILD_BRANCH,
      appRef,
      branch: "main",
      coordinate: "example-org/hello-target",
      updateManifest: false,
    });
  });

  it("plans a failure carrying the listing's stable code when the listing fails", async () => {
    const plan = await planTargetUpdate(
      { appRef: "gh:example-org/hello-target@v0.1.0", registryAppRef: undefined, manifestRanges: {} },
      io({ listLatestRelease: () => listingFailure })
    );
    assert.ok(plan.outcome === TargetUpdateOutcome.CHECK_FAILED);
    assert.equal(plan.errorCode, "EXTENSION_FETCH_UNREACHABLE");
  });

  it("plans a failure carrying the pin check's stable code when the check fails", async () => {
    const plan = await planTargetUpdate(
      { appRef: "gh:example-org/hello-target@v0.1.0", registryAppRef: undefined, manifestRanges: {} },
      io({
        listLatestRelease: () => listing("0.2.0"),
        checkPinUpdate: () =>
          Promise.resolve({ ok: false, error: { code: "EXTENSION_FETCH_RATE_LIMITED", message: "later" } }),
      })
    );
    assert.ok(plan.outcome === TargetUpdateOutcome.CHECK_FAILED);
    assert.equal(plan.errorCode, "EXTENSION_FETCH_RATE_LIMITED");
  });
});

/** A canonical project manifest fixture carrying user content beside the schema fields. */
const FIXTURE_EXTRAS = {
  app: {
    brains: [{ id: "brain-1", name: "Main Brain", chunks: ["rule when button.a.pressed do display.show"] }],
    activeBrainId: "brain-1",
  },
  chunkFormat: 3,
} as const;

const FIXTURE_MANIFEST = serializeProjectContentManifest({
  name: "Fixture Project",
  version: "0.1.0",
  extensions: { "example-org/hello-target": "embedded:example-org/hello-target" },
  targets: { "example-org/hello-target": { packageVersion: "^0.1.0" } },
  extras: FIXTURE_EXTRAS,
});

describe("applyTargetRangeToManifest", () => {
  it("rewrites only the target entry's range, byte-preserving the rest", () => {
    const updated = applyTargetRangeToManifest(FIXTURE_MANIFEST, "example-org/hello-target", "0.2.0");
    assert.ok(updated.ok);
    assert.equal(updated.changed, true);
    assert.equal(updated.content, FIXTURE_MANIFEST.replace('"packageVersion": "^0.1.0"', '"packageVersion": "^0.2.0"'));
    const parsed = JSON.parse(updated.content);
    assert.equal(parsed.targets["example-org/hello-target"].packageVersion, "^0.2.0");
    assert.deepEqual(parsed.app, FIXTURE_EXTRAS.app);
    assert.equal(parsed.chunkFormat, FIXTURE_EXTRAS.chunkFormat);
  });

  it("adds the target entry when absent, preserving extras and extensions", () => {
    const withoutTargets = serializeProjectContentManifest({
      name: "Fixture Project",
      version: "0.1.0",
      extensions: { "example-org/hello-target": "embedded:example-org/hello-target" },
      extras: FIXTURE_EXTRAS,
    });
    const updated = applyTargetRangeToManifest(withoutTargets, "example-org/hello-target", "0.2.0");
    assert.ok(updated.ok);
    assert.equal(updated.changed, true);
    const parsed = JSON.parse(updated.content);
    assert.equal(parsed.targets["example-org/hello-target"].packageVersion, "^0.2.0");
    assert.deepEqual(parsed.extensions, { "example-org/hello-target": "embedded:example-org/hello-target" });
    assert.deepEqual(parsed.app, FIXTURE_EXTRAS.app);
    assert.equal(parsed.chunkFormat, FIXTURE_EXTRAS.chunkFormat);
  });

  it("returns the input bytes unchanged when the entry already carries the range", () => {
    const nonCanonical = `{"name":"X","version":"0.1.0","targets":{"example-org/hello-target":{"packageVersion":"^0.2.0"}}}`;
    const updated = applyTargetRangeToManifest(nonCanonical, "example-org/hello-target", "0.2.0");
    assert.ok(updated.ok);
    assert.equal(updated.changed, false);
    assert.equal(updated.content, nonCanonical);
  });

  it("reports the stable parse code for a document that is not valid JSON", () => {
    const updated = applyTargetRangeToManifest("{not json", "example-org/hello-target", "0.2.0");
    assert.ok(!updated.ok);
    assert.equal(updated.errorCode, "PROJECT_MANIFEST_INVALID_JSON");
  });
});
