import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MINDCRAFT_PROJECT_FORMAT, validateMindcraftProjectDocument } from "./project-document";

/** Minimal well-formed document fields, without a `version`. */
function baseDocumentFields(): Record<string, unknown> {
  return {
    format: MINDCRAFT_PROJECT_FORMAT,
    name: "Project",
    description: "",
    files: [],
    brains: {},
    targets: {},
  };
}

describe("MindcraftProjectDocument version", () => {
  it("carries a valid semver version through validation", () => {
    const result = validateMindcraftProjectDocument({ ...baseDocumentFields(), version: "2.3.4" });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.document.version, "2.3.4");
  });

  it("backfills a missing version to the lowest content version", () => {
    const result = validateMindcraftProjectDocument(baseDocumentFields());
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.document.version, "0.0.0");
  });

  it("backfills a non-semver version to the lowest content version without rejecting", () => {
    const result = validateMindcraftProjectDocument({ ...baseDocumentFields(), version: "not-a-semver" });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.document.version, "0.0.0");
  });
});
