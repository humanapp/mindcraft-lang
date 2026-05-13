import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MindcraftProjectBrainSelectionCode,
  type MindcraftProjectBrainSelectionResult,
  selectMindcraftProjectBrain,
} from "./project-brain-selection";
import { MINDCRAFT_PROJECT_FORMAT, type MindcraftProjectDocument } from "./project-document";

type BrainSelectionCode = (typeof MindcraftProjectBrainSelectionCode)[keyof typeof MindcraftProjectBrainSelectionCode];

const VALID_DOCUMENT = {
  format: MINDCRAFT_PROJECT_FORMAT,
  name: "Project",
  description: "",
  files: [],
  brains: {
    blink: { version: 1, name: "Blink", pages: [] },
    button: { version: 1, name: "Button", pages: [] },
  },
  targets: {},
} satisfies MindcraftProjectDocument;

function selectionCodes(result: MindcraftProjectBrainSelectionResult): readonly BrainSelectionCode[] {
  assert.equal(result.ok, false);
  return result.errors.map((error) => error.code);
}

describe("selectMindcraftProjectBrain", () => {
  it("selects the only brain when no selector is provided", () => {
    const document = {
      ...VALID_DOCUMENT,
      brains: {
        blink: { version: 1, name: "Blink", pages: [] },
      },
    } satisfies MindcraftProjectDocument;

    const result = selectMindcraftProjectBrain(document);

    assert.equal(result.ok, true);
    assert.equal(result.brain.id, "blink");
    assert.equal(result.brain.name, "Blink");
    assert.deepEqual(result.brain.document, document.brains.blink);
  });

  it("requires a selector when multiple brains are present", () => {
    assert.deepEqual(selectionCodes(selectMindcraftProjectBrain(VALID_DOCUMENT)), [
      MindcraftProjectBrainSelectionCode.MISSING_BRAIN_SELECTOR,
    ]);
  });

  it("selects a brain by id", () => {
    const result = selectMindcraftProjectBrain(VALID_DOCUMENT, { kind: "id", id: "button" });

    assert.equal(result.ok, true);
    assert.equal(result.brain.id, "button");
    assert.equal(result.brain.name, "Button");
    assert.deepEqual(result.brain.document, VALID_DOCUMENT.brains.button);
  });

  it("selects a brain by display name", () => {
    const result = selectMindcraftProjectBrain(VALID_DOCUMENT, { kind: "name", name: "Blink" });

    assert.equal(result.ok, true);
    assert.equal(result.brain.id, "blink");
    assert.equal(result.brain.name, "Blink");
  });

  it("returns stable codes for missing and ambiguous selectors", () => {
    const ambiguous = {
      ...VALID_DOCUMENT,
      brains: {
        first: { version: 1, name: "Blink", pages: [] },
        second: { version: 1, name: "Blink", pages: [] },
      },
    } satisfies MindcraftProjectDocument;

    assert.deepEqual(selectionCodes(selectMindcraftProjectBrain(VALID_DOCUMENT, { kind: "id", id: "missing" })), [
      MindcraftProjectBrainSelectionCode.BRAIN_NOT_FOUND,
    ]);
    assert.deepEqual(selectionCodes(selectMindcraftProjectBrain(VALID_DOCUMENT, { kind: "name", name: "Missing" })), [
      MindcraftProjectBrainSelectionCode.BRAIN_NOT_FOUND,
    ]);
    assert.deepEqual(selectionCodes(selectMindcraftProjectBrain(ambiguous, { kind: "name", name: "Blink" })), [
      MindcraftProjectBrainSelectionCode.AMBIGUOUS_BRAIN_SELECTOR,
    ]);
  });

  it("returns stable codes for empty projects and invalid selected brain documents", () => {
    assert.deepEqual(selectionCodes(selectMindcraftProjectBrain({ ...VALID_DOCUMENT, brains: {} })), [
      MindcraftProjectBrainSelectionCode.NO_BRAINS,
    ]);
    assert.deepEqual(
      selectionCodes(
        selectMindcraftProjectBrain(
          {
            ...VALID_DOCUMENT,
            brains: { blink: null },
          },
          { kind: "id", id: "blink" }
        )
      ),
      [MindcraftProjectBrainSelectionCode.INVALID_SELECTED_BRAIN_DOCUMENT]
    );
  });
});
