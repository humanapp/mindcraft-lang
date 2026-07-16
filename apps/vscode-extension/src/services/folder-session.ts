import { FOLDER_HOST_MODE_FOLDER, FOLDER_HOST_MODE_URL_PARAM } from "@mindcraft-lang/bridge-protocol";
import * as vscode from "vscode";
import { DiagnosticsManager } from "./diagnostics-manager";
import { FolderStoreHost } from "./folder-store-host";
import type { ProjectSession } from "./project-session";

let currentSession: FolderProjectSession | undefined;

/**
 * Open (or reveal) the folder session for `folder`: an app tab hosting the
 * target's built webapp from `appRoot`, wired to the folder over the
 * folder-session protocol. One folder session runs at a time; opening a
 * different folder replaces it.
 */
export function openFolderProjectSession(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  appRoot: vscode.Uri
): void {
  if (currentSession?.isFor(folder.uri)) {
    currentSession.reveal();
    return;
  }
  currentSession?.dispose();
  currentSession = new FolderProjectSession(folder, appRoot, () => {
    currentSession = undefined;
  });
  context.subscriptions.push(currentSession);
}

/** The desktop folder-mode {@link ProjectSession}: one workspace folder, one hosted app tab. */
class FolderProjectSession implements ProjectSession {
  private readonly folderUri: vscode.Uri;
  private readonly panel: vscode.WebviewPanel;
  private readonly diagnostics: DiagnosticsManager;
  private readonly storeHost: FolderStoreHost;
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly onClosed: () => void;
  private disposed = false;

  constructor(folder: vscode.WorkspaceFolder, appRoot: vscode.Uri, onClosed: () => void) {
    this.folderUri = folder.uri;
    this.onClosed = onClosed;

    this.panel = vscode.window.createWebviewPanel(
      "mindcraft.folderApp",
      `Mindcraft: ${folder.name}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [appRoot],
      }
    );

    this.diagnostics = new DiagnosticsManager((file) => vscode.Uri.joinPath(folder.uri, file));
    this.storeHost = new FolderStoreHost(
      folder.uri,
      (message) => {
        void this.panel.webview.postMessage(message);
      },
      this.diagnostics
    );

    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.storeHost.handleAppMessage(message);
    });
    this.panel.webview.html = buildWebviewHtml(this.panel.webview, appRoot);

    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "**/*"));
    this.watcher.onDidCreate((uri) => {
      void this.storeHost.handleWatcherEvent("create", uri);
    });
    this.watcher.onDidChange((uri) => {
      void this.storeHost.handleWatcherEvent("change", uri);
    });
    this.watcher.onDidDelete((uri) => {
      void this.storeHost.handleWatcherEvent("delete", uri);
    });

    this.panel.onDidDispose(() => {
      this.dispose();
    });
  }

  isFor(folderUri: vscode.Uri): boolean {
    return this.folderUri.toString() === folderUri.toString();
  }

  reveal(): void {
    this.panel.reveal();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.watcher.dispose();
    this.diagnostics.dispose();
    this.panel.dispose();
    this.onClosed();
  }
}

function buildWebviewHtml(webview: vscode.Webview, appRoot: vscode.Uri): string {
  const indexUri = webview.asWebviewUri(vscode.Uri.joinPath(appRoot, "index.html"));
  const appUrl = `${indexUri.toString()}?${FOLDER_HOST_MODE_URL_PARAM}=${FOLDER_HOST_MODE_FOLDER}`;
  const nonce = mintNonce();
  const csp = [
    "default-src 'none'",
    `frame-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} blob: data:`,
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style nonce="${nonce}">
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  iframe { border: 0; width: 100%; height: 100%; }
</style>
</head>
<body>
<iframe id="mindcraft-app" src="${appUrl}" allow="clipboard-read; clipboard-write"></iframe>
<script nonce="${nonce}">
  const vscodeApi = acquireVsCodeApi();
  const frame = document.getElementById("mindcraft-app");
  window.addEventListener("message", (event) => {
    if (event.source === frame.contentWindow) {
      vscodeApi.postMessage(event.data);
    } else if (frame.contentWindow) {
      frame.contentWindow.postMessage(event.data, "*");
    }
  });
</script>
</body>
</html>`;
}

function mintNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
