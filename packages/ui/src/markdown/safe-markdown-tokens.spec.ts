/**
 * Pins the safe markdown subset at the token level: which blocks a text reads
 * as, which inline forms are claimed, and which stretches stay literal because
 * the subset does not read them.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MarkdownBlock, MarkdownSpan } from "./safe-markdown-tokens";
import { parseMarkdownBlocks } from "./safe-markdown-tokens";

/** The kind of each block `text` reads as, in order. */
function blockKinds(text: string): string[] {
  return parseMarkdownBlocks(text).map((block) => block.kind);
}

/** The spans of the one block `text` reads as. */
function onlyBlockSpans(text: string): readonly MarkdownSpan[] {
  const blocks = parseMarkdownBlocks(text);
  assert.equal(blocks.length, 1, "the text reads as one block");
  const block = blocks[0];
  assert.notEqual(block.kind, "list", "the one block holds spans of its own");
  return (block as Extract<MarkdownBlock, { spans: readonly MarkdownSpan[] }>).spans;
}

/** The one list `text` reads as. */
function onlyList(text: string): Extract<MarkdownBlock, { kind: "list" }> {
  const blocks = parseMarkdownBlocks(text);
  assert.equal(blocks.length, 1, "the text reads as one list");
  const block = blocks[0];
  assert.equal(block.kind, "list");
  return block as Extract<MarkdownBlock, { kind: "list" }>;
}

/** Asserts `text` is claimed by nothing, reading as one literal run holding it whole. */
function readsLiterally(text: string): void {
  assert.deepEqual(onlyBlockSpans(text), [{ kind: "text", text }], text);
}

describe("blocks", () => {
  test("separates paragraphs on blank lines and keeps a single newline inside one", () => {
    assert.deepEqual(blockKinds("one\n\ntwo"), ["paragraph", "paragraph"]);
    assert.deepEqual(blockKinds("one\ntwo"), ["paragraph"]);
    assert.deepEqual(onlyBlockSpans("one\ntwo"), [{ kind: "text", text: "one\ntwo" }]);
  });

  test("reads nothing out of empty and blank text", () => {
    assert.deepEqual(parseMarkdownBlocks(""), []);
    assert.deepEqual(parseMarkdownBlocks("\n \n"), []);
  });

  test("keeps carriage returns out of the text a paragraph carries", () => {
    assert.deepEqual(onlyBlockSpans("one\r\ntwo"), [{ kind: "text", text: "one\ntwo" }]);
  });
});

describe("inline forms", () => {
  test("claims bold, italic under either marker, and inline code", () => {
    assert.deepEqual(onlyBlockSpans("**loud**"), [{ kind: "strong", text: "loud" }]);
    assert.deepEqual(onlyBlockSpans("*soft*"), [{ kind: "emphasis", text: "soft" }]);
    assert.deepEqual(onlyBlockSpans("_soft_"), [{ kind: "emphasis", text: "soft" }]);
    assert.deepEqual(onlyBlockSpans("`code`"), [{ kind: "code", text: "code" }]);
  });

  test("reads bold ahead of italic where both start at the same place", () => {
    assert.deepEqual(onlyBlockSpans("**both**"), [{ kind: "strong", text: "both" }]);
  });

  test("keeps the literal text around and between claimed runs", () => {
    assert.deepEqual(onlyBlockSpans("say **this** and `that` now"), [
      { kind: "text", text: "say " },
      { kind: "strong", text: "this" },
      { kind: "text", text: " and " },
      { kind: "code", text: "that" },
      { kind: "text", text: " now" },
    ]);
  });

  test("keeps a marker with no close literal", () => {
    readsLiterally("**loud");
    readsLiterally("half *open");
    readsLiterally("a `tick");
    readsLiterally("2 * 3 * 4");
  });

  test("keeps an underscore inside a word literal", () => {
    readsLiterally("read_catalog_now");
  });

  test("keeps a marker spanning a line break literal", () => {
    assert.deepEqual(onlyBlockSpans("**start\nend**"), [{ kind: "text", text: "**start\nend**" }]);
  });
});

describe("forms the subset refuses", () => {
  test("keeps raw HTML as text", () => {
    readsLiterally('<img src="x" onerror="steal()">');
    readsLiterally("<script>alert(1)</script>");
  });

  test("keeps a link's label and drops its address", () => {
    assert.deepEqual(onlyBlockSpans("[the docs](https://example.com/page)"), [{ kind: "text", text: "the docs" }]);
    assert.deepEqual(onlyBlockSpans("see [here](javascript:alert) now"), [{ kind: "text", text: "see here now" }]);
  });

  test("keeps a fenced block's fence as text", () => {
    assert.deepEqual(blockKinds("```js\nlet x = 1;\n```"), ["paragraph"]);
  });
});

describe("headers", () => {
  test("reads every level the subset takes as its own emphasized block", () => {
    for (const marks of ["#", "##", "###", "####"]) {
      assert.deepEqual(blockKinds(`${marks} Title`), ["heading"], marks);
      assert.deepEqual(onlyBlockSpans(`${marks} Title`), [{ kind: "text", text: "Title" }], marks);
    }
  });

  test("carries the header's own inline forms", () => {
    assert.deepEqual(onlyBlockSpans("## A `tile` header"), [
      { kind: "text", text: "A " },
      { kind: "code", text: "tile" },
      { kind: "text", text: " header" },
    ]);
  });

  test("keeps a deeper header and a hash with no space as text", () => {
    assert.deepEqual(blockKinds("##### Title"), ["paragraph"]);
    assert.deepEqual(blockKinds("#Title"), ["paragraph"]);
  });

  test("ends the paragraph above it and starts one below it", () => {
    assert.deepEqual(blockKinds("before\n# Title\nafter"), ["paragraph", "heading", "paragraph"]);
  });
});

describe("lists", () => {
  test("gathers a run of bulleted items under either marker into one list", () => {
    const list = onlyList("- one\n- two\n* three");
    assert.equal(list.ordered, false);
    assert.equal(list.items.length, 3);
  });

  test("gathers a run of numbered items into one ordered list", () => {
    const list = onlyList("1. one\n2. two\n3. three");
    assert.equal(list.ordered, true);
    assert.equal(list.items.length, 3);
  });

  test("flattens nested indentation into one level", () => {
    const list = onlyList("- one\n  - under one\n    - deeper\n- two");
    assert.equal(list.items.length, 4);
  });

  test("carries each item's own inline forms", () => {
    const list = onlyList("- a **loud** one");
    assert.deepEqual(list.items[0], [
      { kind: "text", text: "a " },
      { kind: "strong", text: "loud" },
      { kind: "text", text: " one" },
    ]);
  });

  test("starts a new list where the run changes kind", () => {
    assert.deepEqual(blockKinds("- one\n1. two"), ["list", "list"]);
    const blocks = parseMarkdownBlocks("- one\n1. two");
    assert.deepEqual(
      blocks.map((block) => (block.kind === "list" ? block.ordered : undefined)),
      [false, true]
    );
  });

  test("stands between the paragraphs around it", () => {
    assert.deepEqual(blockKinds("here they are:\n- one\n- two\nand that is all"), ["paragraph", "list", "paragraph"]);
  });

  test("keeps a bullet marker with no space after it as text", () => {
    assert.deepEqual(blockKinds("-one"), ["paragraph"]);
    assert.deepEqual(onlyBlockSpans("*soft* start"), [
      { kind: "emphasis", text: "soft" },
      { kind: "text", text: " start" },
    ]);
  });
});
