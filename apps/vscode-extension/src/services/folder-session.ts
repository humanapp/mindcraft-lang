import * as vscode from "vscode";
import { buildAppHostHtml, buildAppLoadFailureHtml } from "./app-host-html";
import { DiagnosticsManager } from "./diagnostics-manager";
import { FolderStoreHost } from "./folder-store-host";
import type { ProjectSession } from "./project-session";

let currentSession: FolderProjectSession | undefined;

let handshakeCompleted = false;

/** Test-only: true once any folder session has answered an app's `folder:hello` with `folder:welcome`. */
export function hasFolderSessionHandshakeCompleted(): boolean {
  return handshakeCompleted;
}

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
      this.diagnostics,
      () => {
        handshakeCompleted = true;
      }
    );

    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.storeHost.handleAppMessage(message);
    });
    void this.initializeWebviewHtml(appRoot);

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

  private async initializeWebviewHtml(appRoot: vscode.Uri): Promise<void> {
    const webview = this.panel.webview;
    const indexUri = vscode.Uri.joinPath(appRoot, "index.html");
    let appIndexHtml: string;
    try {
      appIndexHtml = new TextDecoder().decode(await vscode.workspace.fs.readFile(indexUri));
    } catch {
      if (!this.disposed) {
        webview.html = buildAppLoadFailureHtml(indexUri.fsPath);
      }
      return;
    }
    if (this.disposed) {
      return;
    }
    webview.html = buildAppHostHtml({
      appIndexHtml,
      appBaseUri: webview.asWebviewUri(appRoot).toString(),
      cspSource: webview.cspSource,
      nonce: mintNonce(),
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

function mintNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
