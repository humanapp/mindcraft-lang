import type { FolderHostMessage } from "@mindcraft-lang/bridge-protocol";
import * as vscode from "vscode";
import { MINDCRAFT_JSON } from "../mindcraft-json";
import { buildAppHostHtml, buildAppLoadFailureHtml } from "./app-host-html";
import { DiagnosticsManager } from "./diagnostics-manager";
import { RestoreFailureReason as Reason, type RestoreFailureReason, resolveRestoreTarget } from "./folder-restore";
import { FolderStoreHost } from "./folder-store-host";
import { findProjectFolderCandidates, resolveTargetAppRoot } from "./folder-target-resolver";
import type { ProjectSession } from "./project-session";
import { readDevTargetDescriptor } from "./project-skeleton";
import type { RemovableVolumeRoot } from "./removable-volume";

/** Webview panel view type of the hosted app tab; also the key the panel serializer restores. */
const FOLDER_APP_VIEW_TYPE = "mindcraft.folderApp";

let currentSession: FolderProjectSession | undefined;

let handshakeCompleted = false;

/** Test-only: true once any folder session has answered an app's `folder:hello` with `folder:welcome`. */
export function hasFolderSessionHandshakeCompleted(): boolean {
  return handshakeCompleted;
}

/**
 * Test-only: dispose the running folder session and clear the handshake flag,
 * so a subsequent open resolves its app root and handshakes afresh.
 */
export function disposeFolderSessionForTest(): void {
  currentSession?.dispose();
  currentSession = undefined;
  handshakeCompleted = false;
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
  const session = new FolderProjectSession(folder, appRoot, () => {
    currentSession = undefined;
  });
  currentSession = session;
  context.subscriptions.push(session);
  session.openNewPanel();
}

/**
 * Register the panel serializer that restores the hosted app tab after a
 * window reload: VS Code recreates the empty tab shell and hands it to
 * {@link restoreFolderSessionIntoPanel}, which rebuilds the session bound to it.
 */
export function registerFolderSessionSerializer(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.window.registerWebviewPanelSerializer(FOLDER_APP_VIEW_TYPE, {
    async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
      await restoreFolderSessionIntoPanel(context, panel);
    },
  });
}

/** Outcome of {@link restoreFolderSessionIntoPanel}. */
export type RestoreFolderSessionOutcome =
  | { readonly adopted: true }
  | { readonly adopted: false; readonly reason: RestoreFailureReason };

/**
 * Rebuild the folder session bound to a restored (or freshly created) app
 * panel: resolve the project folder and app root the same way an interactive
 * open does, then adopt `panel` into a new session. On a resolution failure the
 * panel shows the app-load-failure page, keeping the restored tab non-blank.
 */
export async function restoreFolderSessionIntoPanel(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel
): Promise<RestoreFolderSessionOutcome> {
  const resolution = await resolveRestoreTarget<vscode.WorkspaceFolder, vscode.Uri>({
    descriptor: readDevTargetDescriptor(),
    projectFolders: await findProjectFolderCandidates(),
    resolveAppRoot: (descriptor) => resolveTargetAppRoot(context, descriptor),
  });
  if (!resolution.ok) {
    panel.webview.html = buildAppLoadFailureHtml(restoreFailureMessage(resolution.reason));
    return { adopted: false, reason: resolution.reason };
  }
  currentSession?.dispose();
  const session = new FolderProjectSession(resolution.folder, resolution.appRoot, () => {
    currentSession = undefined;
  });
  currentSession = session;
  context.subscriptions.push(session);
  await session.adoptPanel(panel);
  return { adopted: true };
}

/**
 * Test-only: drive the panel-serializer restore path against a freshly created
 * app panel, standing in for the window reload that a test-electron harness
 * cannot trigger. Returns whether the session adopted the panel, the failure
 * reason otherwise, and the composed webview HTML length.
 */
export async function restoreFolderSessionForTest(
  context: vscode.ExtensionContext
): Promise<{ readonly adopted: boolean; readonly reason?: RestoreFailureReason; readonly htmlLength: number }> {
  const panel = vscode.window.createWebviewPanel(
    FOLDER_APP_VIEW_TYPE,
    "Mindcraft: restored",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
    }
  );
  const outcome = await restoreFolderSessionIntoPanel(context, panel);
  const htmlLength = panel.webview.html.length;
  return outcome.adopted ? { adopted: true, htmlLength } : { adopted: false, reason: outcome.reason, htmlLength };
}

/** The user-facing message shown on the app-load-failure page for a restore that could not resolve. */
function restoreFailureMessage(reason: RestoreFailureReason): string {
  switch (reason) {
    case Reason.NO_DEV_TARGET:
      return 'Set the "mindcraft.devTarget" setting to host a target app for this project.';
    case Reason.NO_PROJECT_FOLDER:
      return `Open a workspace folder containing ${MINDCRAFT_JSON} to restore the Mindcraft editor.`;
    case Reason.APP_ROOT_UNAVAILABLE:
      return 'Could not load the target app. Check the "mindcraft.devTarget" setting.';
  }
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
    this.openNewPanel();
  }

  /** Create a fresh app tab, wire it to this session, and compose its host document. */
  openNewPanel(): void {
    const panel = vscode.window.createWebviewPanel(
      FOLDER_APP_VIEW_TYPE,
      `Mindcraft: ${this.folderName}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.appRoot],
      }
    );
    this.wirePanel(panel);
    void this.initializeWebviewHtml(panel);
  }

  /**
   * Adopt an already-existing app tab (a panel VS Code restored on reload) into
   * this session: re-establish its webview options, wire it to this session,
   * and compose its host document. Resolves once the document is composed.
   */
  async adoptPanel(panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.appRoot] };
    this.wirePanel(panel);
    await this.initializeWebviewHtml(panel);
  }

  private wirePanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.storeHost.handleAppMessage(message);
    });
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
      }
    });
  }

  private async initializeWebviewHtml(panel: vscode.WebviewPanel): Promise<void> {
    const webview = panel.webview;
    const indexUri = vscode.Uri.joinPath(this.appRoot, "index.html");
    let appIndexHtml: string;
    try {
      appIndexHtml = new TextDecoder().decode(await vscode.workspace.fs.readFile(indexUri));
    } catch {
      if (!this.disposed && this.panel === panel) {
        webview.html = buildAppLoadFailureHtml(
          `Cannot read the target app's index.html at ${indexUri.fsPath}. Check the "mindcraft.devTarget" setting.`
        );
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
