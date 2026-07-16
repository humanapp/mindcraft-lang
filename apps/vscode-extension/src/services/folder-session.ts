import type { FolderHostMessage } from "@mindcraft-lang/bridge-protocol";
import * as vscode from "vscode";
import { buildAppHostHtml, buildAppLoadFailureHtml } from "./app-host-html";
import { DiagnosticsManager } from "./diagnostics-manager";
import { FolderStoreHost } from "./folder-store-host";
import type { ProjectSession } from "./project-session";
import type { RemovableVolumeRoot } from "./removable-volume";

let currentSession: FolderProjectSession | undefined;

let handshakeCompleted = false;

/** Test-only: true once any folder session has answered an app's `folder:hello` with `folder:welcome`. */
export function hasFolderSessionHandshakeCompleted(): boolean {
  return handshakeCompleted;
}

/** Test-only: true while the running session's app tab is open. */
export function isFolderSessionEditorOpen(): boolean {
  return currentSession?.hasOpenPanel() ?? false;
}

/**
 * Test-only: drive one removable-volume write through the running session's
 * store host. Returns the reply message, or undefined when no session runs.
 */
export async function folderSessionVolumeWriteForTest(
  payload: unknown,
  mountRoots?: readonly RemovableVolumeRoot[]
): Promise<FolderHostMessage | undefined> {
  return currentSession?.volumeWriteForTest(payload, mountRoots);
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
    currentSession.revealOrReopenPanel();
    return;
  }
  currentSession?.dispose();
  currentSession = new FolderProjectSession(folder, appRoot, () => {
    currentSession = undefined;
  });
  context.subscriptions.push(currentSession);
}

/**
 * Bring the running session's app tab to front, recreating the tab when it
 * was closed. Returns false when no session is running.
 */
export function revealFolderSessionEditor(): boolean {
  if (!currentSession) {
    return false;
  }
  currentSession.revealOrReopenPanel();
  return true;
}

/** The project folder of the running session, or undefined when none is running. */
export function activeFolderSessionFolder(): vscode.Uri | undefined {
  return currentSession?.folder;
}

/**
 * The desktop {@link ProjectSession}: one workspace folder plus one hosted
 * app tab. The session -- store host, file watcher, and diagnostics --
 * belongs to the workspace and outlives its app tab; closing the tab leaves
 * the session running, and reopening the tab boots a fresh app instance
 * against it.
 */
class FolderProjectSession implements ProjectSession {
  private readonly folderUri: vscode.Uri;
  private readonly folderName: string;
  private readonly appRoot: vscode.Uri;
  private panel: vscode.WebviewPanel | undefined;
  private readonly diagnostics: DiagnosticsManager;
  private readonly storeHost: FolderStoreHost;
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly onClosed: () => void;
  private disposed = false;

  constructor(folder: vscode.WorkspaceFolder, appRoot: vscode.Uri, onClosed: () => void) {
    this.folderUri = folder.uri;
    this.folderName = folder.name;
    this.appRoot = appRoot;
    this.onClosed = onClosed;

    this.diagnostics = new DiagnosticsManager((file) => vscode.Uri.joinPath(folder.uri, file));
    this.storeHost = new FolderStoreHost(
      folder.uri,
      (message) => {
        void this.panel?.webview.postMessage(message);
      },
      this.diagnostics,
      () => {
        handshakeCompleted = true;
      }
    );

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

    this.openPanel();
  }

  get folder(): vscode.Uri {
    return this.folderUri;
  }

  hasOpenPanel(): boolean {
    return this.panel !== undefined;
  }

  /** Test-only: drive one volume write through this session's store host. */
  volumeWriteForTest(payload: unknown, mountRoots?: readonly RemovableVolumeRoot[]): Promise<FolderHostMessage> {
    return this.storeHost.handleVolumeWrite(undefined, payload, mountRoots);
  }

  /** Bring the app tab to front, recreating it when it was closed. */
  revealOrReopenPanel(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.openPanel();
  }

  private openPanel(): void {
    const panel = vscode.window.createWebviewPanel(
      "mindcraft.folderApp",
      `Mindcraft: ${this.folderName}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.appRoot],
      }
    );
    this.panel = panel;
    panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.storeHost.handleAppMessage(message);
    });
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
      }
    });
    void this.initializeWebviewHtml(panel);
  }

  private async initializeWebviewHtml(panel: vscode.WebviewPanel): Promise<void> {
    const webview = panel.webview;
    const indexUri = vscode.Uri.joinPath(this.appRoot, "index.html");
    let appIndexHtml: string;
    try {
      appIndexHtml = new TextDecoder().decode(await vscode.workspace.fs.readFile(indexUri));
    } catch {
      if (!this.disposed && this.panel === panel) {
        webview.html = buildAppLoadFailureHtml(indexUri.fsPath);
      }
      return;
    }
    if (this.disposed || this.panel !== panel) {
      return;
    }
    webview.html = buildAppHostHtml({
      appIndexHtml,
      appBaseUri: webview.asWebviewUri(this.appRoot).toString(),
      cspSource: webview.cspSource,
      nonce: mintNonce(),
    });
  }

  isFor(folderUri: vscode.Uri): boolean {
    return this.folderUri.toString() === folderUri.toString();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.watcher.dispose();
    this.diagnostics.dispose();
    this.panel?.dispose();
    this.panel = undefined;
    this.onClosed();
  }
}

function mintNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
