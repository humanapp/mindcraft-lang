import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DocsEntryLink } from "./DocsEntryLink";
import { DocsSidebarProvider } from "./DocsSidebarContext";

const ENTRY_HREF = "/docs/tiles/tile.example";

function renderEntry(showDocsPageLinks?: boolean): string {
  return renderToStaticMarkup(
    <DocsSidebarProvider showDocsPageLinks={showDocsPageLinks}>
      <DocsEntryLink href={ENTRY_HREF} onOpen={() => {}}>
        <span />
      </DocsEntryLink>
    </DocsSidebarProvider>
  );
}

describe("DocsEntryLink", () => {
  test("renders an anchor to the entry's docs page by default", () => {
    const html = renderEntry();
    assert.match(html, /<a\s/);
    assert.ok(html.includes(`href="${ENTRY_HREF}"`));
  });

  test("renders a button with no anchor or href when docs page links are disabled", () => {
    const html = renderEntry(false);
    assert.match(html, /<button\s[^>]*type="button"/);
    assert.doesNotMatch(html, /<a[\s>]/);
    assert.doesNotMatch(html, /href=/);
  });
});
