/**
 * Pins how the markdown renderer wraps fenced code: a brain fence and an
 * assistant section each draw their own container, and every other fence keeps
 * a block wrapper. Also pins that an assistant section opens closed, holding
 * none of its text until a reader opens it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DocMarkdown } from "./DocMarkdown";
import { DocsSidebarProvider } from "./DocsSidebarContext";

const BRAIN_FENCE = '```brain\n[{ "version": 1, "when": [], "do": [] }]\n```\n';
const PLAIN_FENCE = "```\nfirst line\nsecond line\n```\n";
const LANGUAGE_FENCE = "```json\n{ }\n```\n";
const ASSISTANT_TEACHING = "notenamesnotnumbers";
const ASSISTANT_FENCE = `\`\`\`assistant\n${ASSISTANT_TEACHING}\n\`\`\`\n`;

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

  test("is absent for an assistant fence, which draws its own", () => {
    assert.doesNotMatch(render(ASSISTANT_FENCE), /<pre[\s>]/);
  });
});

describe("the assistant section an assistant fence renders", () => {
  test("opens closed, on a control reporting that it is closed", () => {
    const html = render(ASSISTANT_FENCE);

    assert.match(html, /<button\s[^>]*type="button"/);
    assert.match(html, /aria-expanded="false"/);
  });

  test("holds none of its text while it is closed", () => {
    assert.ok(!render(ASSISTANT_FENCE).includes(ASSISTANT_TEACHING), "the teaching is not rendered");
  });

  test("leaves a fence of another kind rendering its text as before", () => {
    assert.ok(render(LANGUAGE_FENCE).includes("{ }"));
  });
});
