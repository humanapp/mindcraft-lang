/**
 * Pins the markup the safe renderer stands for a text: the element each block
 * and inline run draws as, how they nest, and that nothing the text carries
 * ever reaches the page as live markup.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeMarkdown } from "./SafeMarkdown";

/** The markup the renderer stands for `text`. */
function render(text: string): string {
  return renderToStaticMarkup(<SafeMarkdown text={text} />);
}

/** The tag names in `markup`, in the order they open. */
function tags(markup: string): string[] {
  return (markup.match(/<([a-z]+)[^>]*>/g) ?? []).map((tag) => tag.replace(/^<([a-z]+).*$/, "$1"));
}

describe("blocks", () => {
  test("stands one paragraph per blank-line separated block", () => {
    assert.deepEqual(tags(render("one\n\ntwo")), ["p", "p"]);
  });

  test("keeps a paragraph's own line breaks", () => {
    assert.match(render("one\ntwo"), /whitespace-pre-wrap/);
    assert.match(render("one\ntwo"), />one\ntwo</);
  });

  test("draws a header as a paragraph and never as a heading element", () => {
    const markup = render("# Title");

    assert.deepEqual(tags(markup), ["p"]);
    assert.match(markup, /font-semibold/);
    assert.doesNotMatch(markup, /<h[1-6]/);
  });

  test("stands a bulleted list as items inside one list element", () => {
    assert.deepEqual(tags(render("- one\n- two")), ["ul", "li", "li"]);
  });

  test("stands a numbered list as items inside one ordered list element", () => {
    assert.deepEqual(tags(render("1. one\n2. two")), ["ol", "li", "li"]);
  });

  test("nests a flattened item at the one level the list stands", () => {
    assert.deepEqual(tags(render("- one\n  - under one")), ["ul", "li", "li"]);
  });

  test("stands nothing at all for a text with no content", () => {
    assert.equal(render(""), "");
  });
});

describe("inline runs", () => {
  test("draws bold, italic and inline code inside the paragraph holding them", () => {
    assert.deepEqual(tags(render("**loud** and *soft* and `typed`")), ["p", "strong", "em", "code"]);
  });

  test("keeps the literal text around a claimed run", () => {
    assert.match(render("say **this** now"), /<p[^>]*>say <strong[^>]*>this<\/strong> now<\/p>/);
  });

  test("keeps a marker with no close as the characters the person typed", () => {
    const markup = render("**loud");

    assert.deepEqual(tags(markup), ["p"]);
    assert.match(markup, /\*\*loud/);
  });
});

describe("what the renderer refuses to make live", () => {
  test("escapes raw HTML instead of standing it", () => {
    const markup = render('<img src="x" onerror="steal()">');

    assert.deepEqual(tags(markup), ["p"]);
    assert.match(markup, /&lt;img/);
    assert.doesNotMatch(markup, /<img/);
  });

  test("escapes a script tag instead of standing it", () => {
    const markup = render("<script>alert(1)</script>");

    assert.deepEqual(tags(markup), ["p"]);
    assert.doesNotMatch(markup, /<script/);
  });

  test("stands a link's label with no anchor and no address", () => {
    const markup = render("read [the docs](https://example.com/page)");

    assert.deepEqual(tags(markup), ["p"]);
    assert.doesNotMatch(markup, /href/);
    assert.doesNotMatch(markup, /example\.com/);
  });

  test("drops an address no navigation should ever reach", () => {
    const markup = render("[press me](javascript:steal())");

    assert.doesNotMatch(markup, /<a/);
    assert.doesNotMatch(markup, /javascript:/);
  });
});

describe("references", () => {
  test("stands a reference the caller draws nothing for as the id it names, marked unresolved", () => {
    const markup = render("my `rule:rule-0` fired");

    assert.match(markup, /<code[^>]*text-warning[^>]*>rule-0<\/code>/);
    assert.doesNotMatch(markup, /rule:/);
  });

  test("stands what the caller draws for a reference in its place", () => {
    const markup = renderToStaticMarkup(
      <SafeMarkdown
        text="my `tile:sensor.see` sees"
        renderReference={(span) => <b data-drawn={span.form}>{span.id}</b>}
      />
    );

    assert.match(markup, /<b data-drawn="tile">sensor.see<\/b>/);
    assert.doesNotMatch(markup, /text-warning/);
  });

  test("falls back to the unresolved form for a reference the caller draws nothing for", () => {
    const markup = renderToStaticMarkup(
      <SafeMarkdown
        text="`page:gone` and `tile:here`"
        renderReference={(span) => (span.form === "tile" ? <b /> : undefined)}
      />
    );

    assert.match(markup, /<code[^>]*text-warning[^>]*>gone<\/code>/);
    assert.match(markup, /<b><\/b>/);
  });
});
