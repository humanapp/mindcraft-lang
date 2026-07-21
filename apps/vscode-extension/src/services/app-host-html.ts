import { FOLDER_HOST_MODE_FOLDER, FOLDER_HOST_MODE_GLOBAL } from "@mindcraft-lang/bridge-protocol";

/** Inputs for {@link buildAppHostHtml}. */
export interface AppHostHtmlOptions {
  /** Text of the target app's built `index.html`. */
  readonly appIndexHtml: string;
  /** Webview-resource URI of the app's built directory. */
  readonly appBaseUri: string;
  /** The webview's content-security-policy source for local resources. */
  readonly cspSource: string;
  /** Nonce authorizing the injected bootstrap script. */
  readonly nonce: string;
}

/**
 * Build the webview document hosting the target app: the app's built
 * `index.html` with three elements injected at the start of `<head>`, ahead
 * of every asset reference and app script -- the content-security policy, a
 * `<base>` resolving the app's relative asset URLs against its
 * webview-resource directory, and a nonce'd bootstrap script. When the app
 * document has no `<head>`, the injection is prepended instead.
 *
 * The app document IS the webview's main document; its subresource fetches
 * resolve on the webview-resource origin, which serves only fetches
 * attributed to the webview's own client. The bootstrap preserves the app's
 * host transport contract: it redefines `window.parent` (a Replaceable
 * window attribute) as a shim forwarding `postMessage` to the VS Code
 * webview API, and host messages already arrive as `message` events on the
 * app's window. It also defines the folder host-mode global flag.
 *
 * The policy admits the bootstrap by nonce, the app's scripts, styles,
 * fonts, and images from the webview-resource origin (`cspSource`), the
 * app's runtime-injected styles ('unsafe-inline'), its minted icon and
 * favicon URLs (`blob:`/`data:`), and its extension-install fetches
 * (`https:`).
 */
export function buildAppHostHtml(options: AppHostHtmlOptions): string {
  const { appIndexHtml, appBaseUri, cspSource, nonce } = options;
  const baseHref = appBaseUri.endsWith("/") ? appBaseUri : `${appBaseUri}/`;
  const csp = [
    "default-src 'none'",
    `img-src ${cspSource} blob: data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' ${cspSource}`,
    `font-src ${cspSource}`,
    `connect-src ${cspSource} https:`,
  ].join("; ");
  const bootstrap =
    `"use strict";` +
    `const vscodeApi = acquireVsCodeApi();` +
    `Object.defineProperty(window, "parent", { value: { postMessage: (message) => vscodeApi.postMessage(message) } });` +
    `globalThis[${JSON.stringify(FOLDER_HOST_MODE_GLOBAL)}] = ${JSON.stringify(FOLDER_HOST_MODE_FOLDER)};`;
  const injection =
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<base href="${escapeAttribute(baseHref)}">` +
    `<script nonce="${nonce}">${bootstrap}</script>`;
  const headOpen = appIndexHtml.match(/<head(?:\s[^>]*)?>/i);
  if (headOpen?.index !== undefined) {
    const at = headOpen.index + headOpen[0].length;
    return `${appIndexHtml.slice(0, at)}${injection}${appIndexHtml.slice(at)}`;
  }
  return `${injection}${appIndexHtml}`;
}

/** Build the webview document shown when the target app cannot be hosted, stating `message` to the user. */
export function buildAppLoadFailureHtml(message: string): string {
  return buildStaticPage(message);
}

/** Build the webview document shown while the app the tab will host is being prepared. */
export function buildAppLoadingHtml(): string {
  return buildStaticPage("Loading the Mindcraft editor...");
}

function buildStaticPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'">
</head>
<body>
<p>${escapeText(message)}</p>
</body>
</html>`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
