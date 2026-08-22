import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeProjectContentManifest } from "@wendoo-lang/app-host";
import {
  applyTargetRangeToManifest,
  resolveTargetUpdateAction,
  specificAppRef,
  type TargetUpdateChoice,
  targetUpdateChoices,
} from "./target-update";

const COORD = "example-org/hello-target";

/** The choice kinds offered, in display order. */
const kinds = (choices: readonly TargetUpdateChoice[]): readonly string[] => choices.map((choice) => choice.kind);

describe("targetUpdateChoices", () => {
  it("offers the approved choice first when the coordinate is in the registry", () => {
    const choices = targetUpdateChoices({ approvedVersion: "0.7.0", latestPublished: undefined });
    assert.deepEqual(kinds(choices), ["approved", "specific"]);
    assert.deepEqual(choices[0], { kind: "approved", version: "0.7.0" });
  });

  it("offers the published choice only when it is newer than the approved version", () => {
    const newer = targetUpdateChoices({ approvedVersion: "0.7.0", latestPublished: "0.8.0" });
    assert.deepEqual(kinds(newer), ["approved", "published", "specific"]);
    assert.deepEqual(newer[1], { kind: "published", version: "0.8.0" });
  });

  it("omits the published choice when it is not newer than the approved version", () => {
    assert.deepEqual(kinds(targetUpdateChoices({ approvedVersion: "0.7.0", latestPublished: "0.7.0" })), [
      "approved",
      "specific",
    ]);
    assert.deepEqual(kinds(targetUpdateChoices({ approvedVersion: "0.8.0", latestPublished: "0.7.0" })), [
      "approved",
      "specific",
    ]);
  });

  it("offers the published choice with no approved version when the coordinate is not in the registry", () => {
    const choices = targetUpdateChoices({ approvedVersion: undefined, latestPublished: "0.8.0" });
    assert.deepEqual(kinds(choices), ["published", "specific"]);
    assert.deepEqual(choices[0], { kind: "published", version: "0.8.0" });
  });

  it("offers only the specific choice when neither an approved nor a published version resolves", () => {
    assert.deepEqual(kinds(targetUpdateChoices({ approvedVersion: undefined, latestPublished: undefined })), [
      "specific",
    ]);
  });
});

describe("resolveTargetUpdateAction", () => {
  it("clears the appRef and floors the range at the approved version for an approved selection", () => {
    const action = resolveTargetUpdateAction({ kind: "approved", coordinate: COORD, version: "0.7.0" });
    assert.deepEqual(action, { coordinate: COORD, version: "0.7.0", appRef: { op: "clear" } });
  });

  it("writes the published pin and floors the range at the published release for a published selection", () => {
    const action = resolveTargetUpdateAction({ kind: "published", coordinate: COORD, version: "0.8.0" });
    assert.deepEqual(action, {
      coordinate: COORD,
      version: "0.8.0",
      appRef: { op: "write", reference: `gh:${COORD}@0.8.0` },
    });
  });

  it("writes the entered pin and floors the range at the fetched version for a specific selection", () => {
    const action = resolveTargetUpdateAction({
      kind: "specific",
      coordinate: COORD,
      reference: "v0.5.0",
      version: "0.5.0",
    });
    assert.deepEqual(action, {
      coordinate: COORD,
      version: "0.5.0",
      appRef: { op: "write", reference: `gh:${COORD}@v0.5.0` },
    });
  });

  it("routes a #branch specific reference as a branch appRef, flooring the range at the fetched version", () => {
    const action = resolveTargetUpdateAction({
      kind: "specific",
      coordinate: COORD,
      reference: "#main",
      version: "0.6.0",
    });
    assert.deepEqual(action.appRef, { op: "write", reference: `gh:${COORD}#main` });
    assert.equal(action.version, "0.6.0");
  });
});

describe("specificAppRef", () => {
  it("pins a tag or SHA entry with @ and routes a #branch entry as a branch", () => {
    assert.equal(specificAppRef(COORD, "v1.2.3"), `gh:${COORD}@v1.2.3`);
    assert.equal(specificAppRef(COORD, "abc1234def"), `gh:${COORD}@abc1234def`);
    assert.equal(specificAppRef(COORD, "#feature"), `gh:${COORD}#feature`);
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
