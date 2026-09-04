import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assistantSectionFromMarkdown, descriptionFromMarkdown } from "./tile-descriptions.js";

/** The teaching prose the fixtures below reserve for the model. */
const TEACHING = "Give it a note name, not a number.\nA rest is an empty slot.";

/** A tile document carrying its description first and its assistant section after the body. */
const SECTION_AFTER_BODY = [
  "# Play tone",
  "",
  "Plays one note through the speaker.",
  "",
  "## Rules",
  "",
  "- one tone at a time",
  "",
  "```assistant",
  TEACHING,
  "```",
  "",
].join("\n");

/** The same document with its assistant section standing before any prose. */
const SECTION_BEFORE_PROSE = [
  "# Play tone",
  "",
  "```assistant",
  TEACHING,
  "```",
  "",
  "Plays one note through the speaker.",
  "",
].join("\n");

describe("the assistant section a tile document carries", () => {
  test("reads the content of the fenced block whose info string is assistant", () => {
    assert.equal(assistantSectionFromMarkdown(SECTION_AFTER_BODY), TEACHING);
  });

  test("is absent for a document carrying no such fence", () => {
    assert.equal(assistantSectionFromMarkdown("# Play tone\n\nPlays one note.\n"), undefined);
  });

  test("is absent for a document whose only fences carry another info string", () => {
    const brained = '# Play tone\n\nPlays one note.\n\n```brain\n[{ "version": 1 }]\n```\n';

    assert.equal(assistantSectionFromMarkdown(brained), undefined);
  });

  test("is absent for a fence holding nothing", () => {
    assert.equal(assistantSectionFromMarkdown("# Play tone\n\n```assistant\n```\n"), undefined);
  });

  test("takes the first of several, and stops at that fence's close", () => {
    const twice = `# Play tone\n\n\`\`\`assistant\nfirst\n\`\`\`\n\nbetween\n\n\`\`\`assistant\nsecond\n\`\`\`\n`;

    assert.equal(assistantSectionFromMarkdown(twice), "first");
  });

  test("reads past a fence of another kind standing before it", () => {
    const preceded = `# Play tone\n\n\`\`\`brain\n[]\n\`\`\`\n\n\`\`\`assistant\n${TEACHING}\n\`\`\`\n`;

    assert.equal(assistantSectionFromMarkdown(preceded), TEACHING);
  });

  test("keeps the blank lines and indentation inside the block", () => {
    const shaped = "# Play tone\n\n```assistant\nfirst\n\n  indented\n```\n";

    assert.equal(assistantSectionFromMarkdown(shaped), "first\n\n  indented");
  });
});

describe("the description a document carrying an assistant section yields", () => {
  test("is the opening prose, with none of the section, when the section follows the body", () => {
    const description = descriptionFromMarkdown(SECTION_AFTER_BODY);

    assert.equal(description, "Plays one note through the speaker.");
    assert.ok(!description?.includes("note name"), description);
  });

  test("carries none of the section when the section stands before the prose", () => {
    const description = descriptionFromMarkdown(SECTION_BEFORE_PROSE);

    assert.equal(description, undefined);
    assert.equal(assistantSectionFromMarkdown(SECTION_BEFORE_PROSE), TEACHING);
  });
});
