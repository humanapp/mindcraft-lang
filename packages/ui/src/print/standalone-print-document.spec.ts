import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildStandalonePrintDocument, printPortalViaTransport } from "./standalone-print-document";

/** Records every URL passed to it and returns a deterministic data URI. */
function fakeInliner(): ((url: string) => Promise<string>) & { seen: string[] } {
  const seen: string[] = [];
  const inline = async (url: string): Promise<string> => {
    seen.push(url);
    return `data:image/svg+xml;base64,${Buffer.from(url).toString("base64")}`;
  };
  return Object.assign(inline, { seen });
}

describe("buildStandalonePrintDocument", () => {
  it("produces a full standalone document with the title, inlined style, wrapped body, and auto-print script", async () => {
    const html = await buildStandalonePrintDocument({
      bodyHtml: "<div class='brain-print-view'>hi</div>",
      css: ".brain-print-view{color:#000}",
      title: "My Brain",
      rootId: "brain-print-root",
      inlineAsset: fakeInliner(),
    });

    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<title>My Brain<\/title>/);
    assert.match(html, /<style>[\s\S]*\.brain-print-view\{color:#000\}[\s\S]*<\/style>/);
    assert.match(html, /<div id="brain-print-root"><div class='brain-print-view'>hi<\/div><\/div>/);
    assert.match(html, /window\.addEventListener\("load",function\(\)\{window\.print\(\);\}\);/);
  });

  it("promotes @media print blocks to also apply on screen so the doc renders in print appearance", async () => {
    const html = await buildStandalonePrintDocument({
      bodyHtml: "<div class='brain-print-view'>hi</div>",
      css: "@media print { #brain-print-root { display: block !important; } }",
      title: "t",
      rootId: "brain-print-root",
      inlineAsset: fakeInliner(),
    });

    // The print-only reveal now also matches screen media.
    assert.match(html, /@media print, screen \{ #brain-print-root \{ display: block !important; \} \}/);
    // No print-only reveal block survives unpromoted.
    assert.ok(!/@media\s+print\s*\{/.test(html), "no print-only media block remains");
  });

  it("carries a screen-scoped white-page base overriding the app's dark theme, without touching print media", async () => {
    const html = await buildStandalonePrintDocument({
      bodyHtml: "<div class='brain-print-view'>hi</div>",
      css: "body{background:#0f172a;color:#e2e8f0}",
      title: "t",
      rootId: "docs-print-root",
      inlineAsset: fakeInliner(),
    });

    // The base override is screen-scoped: it cannot alter print output.
    assert.match(html, /@media screen\{html,body\{background:#ffffff !important;color:#1e293b !important;\}/);
    // It targets the actual print root by id.
    assert.match(html, /#docs-print-root\{background:#ffffff !important;\}\}/);
    // The base override is appended after the collected app CSS so it wins the cascade.
    assert.ok(
      html.indexOf("body{background:#0f172a") < html.indexOf("@media screen{html,body"),
      "base override follows the collected CSS"
    );
  });

  it("escapes markup-significant characters in the title", async () => {
    const html = await buildStandalonePrintDocument({
      bodyHtml: "<p>x</p>",
      css: "",
      title: "A & B <script>",
      rootId: "docs-print-root",
      inlineAsset: fakeInliner(),
    });
    assert.match(html, /<title>A &amp; B &lt;script&gt;<\/title>/);
  });

  it("inlines src and url() asset references, leaving no host-relative or webview URLs", async () => {
    const inliner = fakeInliner();
    const bodyHtml =
      '<img src="/assets/brain/icons/q.svg" alt="">' +
      '<img src="https://file+.vscode-resource.vscode-cdn.net/x/icon.svg">' +
      '<div style="-webkit-mask-image:url(blob:vscode-webview://abc/mask.svg);mask-image:url(blob:vscode-webview://abc/mask.svg)"></div>';
    const html = await buildStandalonePrintDocument({
      bodyHtml,
      css: "",
      title: "t",
      rootId: "brain-print-root",
      inlineAsset: inliner,
    });

    assert.ok(!html.includes("vscode-resource"), "no vscode-resource URLs remain");
    assert.ok(!html.includes("/assets/"), "no host-relative asset paths remain");
    assert.ok(!html.includes("blob:"), "no blob URLs remain");
    assert.ok(html.includes("data:image/svg+xml;base64,"), "assets are inlined as data URIs");
    // Each distinct URL is inlined once.
    assert.deepEqual(
      new Set(inliner.seen),
      new Set([
        "/assets/brain/icons/q.svg",
        "https://file+.vscode-resource.vscode-cdn.net/x/icon.svg",
        "blob:vscode-webview://abc/mask.svg",
      ])
    );
  });

  it("does not inline already-inlined data URIs", async () => {
    const inliner = fakeInliner();
    const html = await buildStandalonePrintDocument({
      bodyHtml: '<img src="data:image/png;base64,AAAA">',
      css: "",
      title: "t",
      rootId: "brain-print-root",
      inlineAsset: inliner,
    });
    assert.equal(inliner.seen.length, 0);
    assert.ok(html.includes("data:image/png;base64,AAAA"));
  });

  it("leaves an asset URL in place when its inlining rejects", async () => {
    const html = await buildStandalonePrintDocument({
      bodyHtml: '<img src="/assets/x.svg">',
      css: "",
      title: "t",
      rootId: "brain-print-root",
      inlineAsset: async () => {
        throw new Error("unreachable asset");
      },
    });
    assert.ok(html.includes("/assets/x.svg"));
  });
});

describe("printPortalViaTransport", () => {
  it("serializes the portal content and hands the built document to the transport", async () => {
    let received: string | undefined;
    const portal = { innerHTML: "<div class='docs-print-view'>doc</div>" } as HTMLElement;

    await printPortalViaTransport(portal, "docs-print-root", "Docs", (html) => {
      received = html;
    });

    assert.ok(received);
    assert.match(received, /<div id="docs-print-root"><div class='docs-print-view'>doc<\/div><\/div>/);
    assert.match(received, /window\.print\(\);/);
  });
});
