/**
 * Sink for a self-contained printable HTML document. In a plain browser the
 * print action calls `window.print()` directly; in a hosted app that cannot
 * open the browser print dialog (an iframe sandbox without `allow-modals`),
 * the app injects a transport that forwards the document elsewhere -- for
 * example to a host that opens it in the system browser.
 */
export type PrintTransport = (html: string) => void;

/** Inputs to {@link buildStandalonePrintDocument}. */
export interface StandalonePrintDocumentInput {
  /** Serialized inner HTML of the print portal: the subtree the print stylesheet reveals. */
  bodyHtml: string;
  /** CSS text reproducing the print layout, inlined into a single `<style>`. */
  css: string;
  /** Document `<title>`. */
  title: string;
  /** DOM id wrapping the body content so the print stylesheet reveals it (e.g. "brain-print-root"). */
  rootId: string;
  /**
   * Resolves an asset URL found in the body to an inline `data:` URI. A
   * rejection leaves the original URL in place.
   */
  inlineAsset: (url: string) => Promise<string>;
}

const ASSET_ATTR_PATTERN = /\bsrc=(?:"([^"]+)"|'([^']+)')/g;
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
const PRINT_MEDIA_QUERY_PATTERN = /@media\s+print\s*\{/g;

/**
 * Rewrites print-only `@media print { ... }` blocks in `css` so their rules
 * also apply on screen, turning each into `@media print, screen { ... }`.
 * Print media still matches, so the printed result is unchanged; on screen the
 * print reveal rules (unhide the print root, strip tile backgrounds) now take
 * effect. Complex print media queries (`@media print and (...)`) are left
 * untouched.
 */
function applyPrintRulesOnScreen(css: string): string {
  return css.replace(PRINT_MEDIA_QUERY_PATTERN, "@media print, screen {");
}

/**
 * Screen-only page base that reproduces the print white page under any host
 * theme. It is scoped to `@media screen`, so it never reaches print media (the
 * printed page already drops backgrounds); appended last with `!important`, it
 * overrides the app's dark theme cascade for the on-screen view.
 */
function screenPageBaseCss(rootId: string): string {
  return (
    "@media screen{" +
    "html,body{background:#ffffff !important;color:#1e293b !important;}" +
    `#${rootId}{background:#ffffff !important;}` +
    "}"
  );
}

/** Collects every asset URL referenced by an `src` attribute or a CSS `url(...)` in `bodyHtml`. */
function collectAssetUrls(bodyHtml: string): string[] {
  const urls = new Set<string>();
  for (const match of bodyHtml.matchAll(ASSET_ATTR_PATTERN)) {
    const url = match[1] ?? match[2];
    if (url) {
      urls.add(url);
    }
  }
  for (const match of bodyHtml.matchAll(CSS_URL_PATTERN)) {
    const url = match[2];
    if (url) {
      urls.add(url);
    }
  }
  return [...urls].filter((url) => !url.startsWith("data:"));
}

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Builds a fully self-contained printable HTML document from the rendered
 * print-portal markup: `css` is inlined into a `<style>`, every `src`/`url(...)`
 * asset reference is replaced with an inline `data:` URI via `inlineAsset`, and
 * a load-time script invokes the browser print dialog. The result references no
 * external host, so it renders standalone from any origin. The body is wrapped
 * in a `<div id="${rootId}">` that the inlined print stylesheet reveals.
 *
 * The document's only content is the print portal, so it renders in print
 * appearance on screen as well: `@media print` rules are promoted to also match
 * screen, and a white-page base overrides the app's theme for the on-screen
 * view. Neither change affects what print produces.
 */
export async function buildStandalonePrintDocument(input: StandalonePrintDocumentInput): Promise<string> {
  const urls = collectAssetUrls(input.bodyHtml);
  const replacements = new Map<string, string>();
  await Promise.all(
    urls.map(async (url) => {
      try {
        replacements.set(url, await input.inlineAsset(url));
      } catch {
        // Leave the original URL in place when the asset cannot be inlined.
      }
    })
  );
  // Replace longer URLs first so one URL that is a substring of another does
  // not corrupt the longer match.
  let body = input.bodyHtml;
  for (const url of [...replacements.keys()].sort((a, b) => b.length - a.length)) {
    body = body.split(url).join(replacements.get(url) as string);
  }
  const css = `${applyPrintRulesOnScreen(input.css)}\n${screenPageBaseCss(input.rootId)}`;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtmlText(input.title)}</title>`,
    `<style>${css}</style>`,
    "</head>",
    "<body>",
    `<div id="${input.rootId}">${body}</div>`,
    '<script>window.addEventListener("load",function(){window.print();});</script>',
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * Concatenates the text of every readable, same-origin stylesheet on the
 * current document, dropping `@import` rules so the result depends on no
 * external resource. Cross-origin sheets whose rules cannot be read are
 * skipped. Returns an empty string when no document is available.
 */
export function collectDocumentStyleText(): string {
  if (typeof document === "undefined") {
    return "";
  }
  let css = "";
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (rule.cssText.startsWith("@import")) {
        continue;
      }
      css += `${rule.cssText}\n`;
    }
  }
  return css;
}

/** Fetches `url` and returns its content as a `data:` URI. */
export async function fetchAssetAsDataUri(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read asset ${url}`));
    reader.readAsDataURL(blob);
  });
}

/**
 * Serializes the rendered `portal` element's content into a self-contained
 * printable document -- inlining the document's stylesheets and every asset --
 * and hands it to `transport`. `rootId` is the DOM id the print stylesheet
 * reveals (for example "brain-print-root" or "docs-print-root").
 */
export async function printPortalViaTransport(
  portal: HTMLElement,
  rootId: string,
  title: string,
  transport: PrintTransport
): Promise<void> {
  const html = await buildStandalonePrintDocument({
    bodyHtml: portal.innerHTML,
    css: collectDocumentStyleText(),
    title,
    rootId,
    inlineAsset: fetchAssetAsDataUri,
  });
  transport(html);
}
