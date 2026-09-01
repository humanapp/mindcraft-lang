/**
 * Pins how the markdown renderer wraps fenced code: a brain fence draws its own
 * container, and every other fence keeps a block wrapper.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DocMarkdown } from "./DocMarkdown";
import { DocsSidebarProvider } from "./DocsSidebarContext";

const BRAIN_FENCE = '```brain\n[{ "version": 1, "when": [], "do": [] }]\n```\n';
const PLAIN_FENCE = "```\nfirst line\nsecond line\n```\n";
const LANGUAGE_FENCE = "```json\n{ }\n```\n";

function render(markdown: string): string {
  return renderToStaticMarkup(
    <DocsSidebarProvider>
      <DocMarkdown>{markdown}</DocMarkdown>
    </DocsSidebarProvider>
  );
}

describe("the wrapper a fenced code block renders in", () => {
  test("is a block for a fence carrying no language", () => {
    assert.match(render(PLAIN_FENCE), /<pre[\s>]/);
  });

  test("is a block for a fence carrying a language the renderer does not draw", () => {
    assert.match(render(LANGUAGE_FENCE), /<pre[\s>]/);
  });

  test("is absent for a brain fence, which draws its own", () => {
    assert.doesNotMatch(render(BRAIN_FENCE), /<pre[\s>]/);
  });
});
