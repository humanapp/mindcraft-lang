import { type ConnectionStatus, type FileSystemNotification, Project } from "@mindcraft-lang/bridge-client";
import type { ExtensionClientMessage, ExtensionServerMessage } from "@mindcraft-lang/bridge-protocol";

type ExtensionProject = Project<ExtensionClientMessage, ExtensionServerMessage>;

import * as vscode from "vscode";
import { DiagnosticsManager } from "./diagnostics-manager";
import { MINDCRAFT_SCHEME, MindcraftFileSystemProvider } from "./mindcraft-fs-provider";

const BINDING_TOKEN_KEY = "mindcraft.bindingToken";

// Deduplication key for pending changes: same action + path overwrites the
// previous pending entry so only the latest write/delete is sent after reconnect.
// Import has no key (always appended) since imports are full-state snapshots.
function pendingChangeKey(ev: FileSystemNotification): string | undefined {
  switch (ev.action) {
    case "write":
    case "delete":
    case "mkdir":
    case "rmdir":
      return `${ev.action}:${ev.path}`;
    case "rename":
      return `rename:${ev.oldPath}`;
    case "import":
      return undefined;
  }
}

export class ProjectManager implements vscode.Disposable {
  private _project: ExtensionProject | undefined;
  private _appBound = false;
  private _appClientConnected = false;
  private _pendingChanges: FileSystemNotification[] = [];
  private readonly _unsubs: (() => void)[] = [];
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _fsProvider = new MindcraftFileSystemProvider();
  private readonly _diagnosticsManager = new DiagnosticsManager();
  private _globalState: vscode.Memento | undefined;
  private _workspaceFolderName = "Mindcraft";

  private readonly _onDidChangeProject = new vscode.EventEmitter<void>();
  readonly onDidChangeProject = this._onDidChangeProject.event;

  private readonly _onDidChangeStatus = new vscode.EventEmitter<ConnectionStatus>();
  readonly onDidChangeStatus = this._onDidChangeStatus.event;

  private readonly _onDidChangeAppBound = new vscode.EventEmitter<boolean>();
  readonly onDidChangeAppBound = this._onDidChangeAppBound.event;

  private readonly _onDidChangeAppClientConnected = new vscode.EventEmitter<boolean>();
  readonly onDidChangeAppClientConnected = this._onDidChangeAppClientConnected.event;

  private readonly _onDidChangePendingChanges = new vscode.EventEmitter<number>();
  readonly onDidChangePendingChanges = this._onDidChangePendingChanges.event;

  get fsProvider(): MindcraftFileSystemProvider {
    return this._fsProvider;
  }

  get diagnosticsManager(): DiagnosticsManager {
    return this._diagnosticsManager;
  }

  get project(): ExtensionProject | undefined {
    return this._project;
  }

  get status(): ConnectionStatus {
    return this._project?.session.status ?? "disconnected";
  }

  get appBound(): boolean {
    return this._appBound;
  }

  get appClientConnected(): boolean {
    return this._appClientConnected;
  }

  get pendingChanges(): number {
    return this._pendingChanges.length;
  }

  initialize(globalState: vscode.Memento): void {
    this._globalState = globalState;
    const bindingToken = globalState.get<string>(BINDING_TOKEN_KEY);
    if (bindingToken) {
      this.connect(undefined, bindingToken);
    } else {
      this.removeWorkspaceFolder();
    }
  }

  connect(joinCode?: string, savedToken?: string): void {
    this.disconnectActive();

    const bridgeUrl = vscode.workspace.getConfiguration("mindcraft").get<string>("bridgeUrl", "");
    if (!bridgeUrl) {
      throw new Error("mindcraft.bridgeUrl is not configured");
    }

    const bindingToken = savedToken ?? this._globalState?.get<string>(BINDING_TOKEN_KEY);
    this._globalState?.update(BINDING_TOKEN_KEY, undefined);

    const project = new Project<ExtensionClientMessage, ExtensionServerMessage>({
      appName: "vscode",
      projectId: "vscode-extension",
      projectName: "VS Code",
      bridgeUrl,
      wsPath: "extension",
      filesystem: new Map(),
      joinCode,
      bindingToken,
    });

    this._unsubs.push(
      project.session.addEventListener("status", (status) => {
        this._onDidChangeStatus.fire(status);
        if (status === "connected") {
          if (this._appBound) {
            this._appBound = false;
            this._onDidChangeAppBound.fire(false);
          }
          if (this._appClientConnected) {
            this._appClientConnected = false;
            this._onDidChangeAppClientConnected.fire(false);
          }
        } else if (status === "disconnected") {
          this.disconnect();
        }
      })
    );

    this._unsubs.push(
      project.session.on("session:appStatus", (msg) => {
        const bound = msg.payload?.bound ?? false;
        const clientConnected = msg.payload?.clientConnected ?? false;
        if (bound) {
          const p = msg.payload;
          if (p?.appName) project.options.appName = p.appName;
          if (p?.projectId) project.options.projectId = p.projectId;
          if (p?.projectName) project.options.projectName = p.projectName;
          if (p?.bindingToken) {
            this._globalState?.update(BINDING_TOKEN_KEY, p.bindingToken);
          }
          this.renameWorkspaceFolder(`${project.options.projectName} (${project.options.appName})`);
        }
        const wasBound = this._appBound;
        const wasClientConnected = this._appClientConnected;
        if (this._appBound !== bound) {
          this._appBound = bound;
          this._onDidChangeAppBound.fire(bound);
        }
        if (this._appClientConnected !== clientConnected) {
          this._appClientConnected = clientConnected;
          this._onDidChangeAppClientConnected.fire(clientConnected);
        }
        if (bound && clientConnected) {
          if (!wasBound || !wasClientConnected) {
            this.syncWithRetry(project);
          }
          if (this._pendingChanges.length > 0) {
            this.syncAndClearPending();
          }
        }
        if (!bound && this._project) {
          this.disconnect();
        }
      })
    );

    this._unsubs.push(
      project.session.on("compile:diagnostics", (msg) => {
        this._diagnosticsManager.handleDiagnostics(msg.payload);
      })
    );

    project.toRemoteFileChange = (ev) => this.sendChangeWithAck(project, ev);
    project.fromRemoteFileChange = (ev) => this.handleFilesystemNotification(ev);

    this._fsProvider.setFileSystems(project.files.raw, project.files.toRemote);

    this._project = project;
    project.session.start();

    this._onDidChangeProject.fire();
  }

  disconnect(): void {
    this.disconnectActive();
    this.closeMindcraftTabs();
    this.removeWorkspaceFolder();
    this._globalState?.update(BINDING_TOKEN_KEY, undefined);
  }

  async sync(): Promise<void> {
    if (!this._project) return;
    await this._project.requestSync();
    this.fireRootChanged();
  }

  private sendChangeWithAck(project: ExtensionProject, ev: FileSystemNotification): void {
    project.session.request("filesystem:change", ev).then(
      (response) => {
        if (this._project !== project) return;
        if (response.type === "session:error") {
          this.enqueuePendingChange(ev);
        }
      },
      () => {
        if (this._project !== project) return;
        this.enqueuePendingChange(ev);
      }
    );
  }

  private enqueuePendingChange(ev: FileSystemNotification): void {
    const key = pendingChangeKey(ev);
    if (key !== undefined) {
      const idx = this._pendingChanges.findIndex((e) => pendingChangeKey(e) === key);
      if (idx !== -1) {
        this._pendingChanges.splice(idx, 1);
      }
    }
    this._pendingChanges.push(ev);
    this._onDidChangePendingChanges.fire(this._pendingChanges.length);
  }

  private async syncAndClearPending(): Promise<void> {
    const project = this._project;
    if (!project) return;
    const pending = this._pendingChanges.splice(0);
    if (pending.length === 0) return;
    this._onDidChangePendingChanges.fire(0);
    const failed: FileSystemNotification[] = [];
    for (const ev of pending) {
      if (this._project !== project) return;
      try {
        const response = await project.session.request("filesystem:change", ev);
        if (response.type === "session:error") {
          failed.push(ev);
        }
      } catch {
        failed.push(ev);
      }
    }
    if (this._project !== project) return;
    if (failed.length > 0) {
      this._pendingChanges.unshift(...failed);
      this._onDidChangePendingChanges.fire(this._pendingChanges.length);
    } else {
      try {
        await project.requestSync();
        this.fireRootChanged();
      } catch {
        // Sync pull failed; not critical since pending changes were delivered
      }
    }
  }

  private async syncWithRetry(project: ExtensionProject, maxAttempts = 3): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      if (this._project !== project) return;
      try {
        await project.requestSync();
        if (!this.hasWorkspaceFolder()) {
          this.addWorkspaceFolder();
        }
        this.fireRootChanged();
        return;
      } catch (e) {
        if (i < maxAttempts - 1) {
          await new Promise<void>((r) => setTimeout(r, 1000 * 2 ** i));
        }
      }
    }
  }

  private disconnectActive(): void {
    if (!this._project) return;
    for (const unsub of this._unsubs) unsub();
    this._unsubs.length = 0;
    this._project.session.stop();
    this._project = undefined;
    this._fsProvider.setFileSystems(undefined, undefined);
    this._diagnosticsManager.clear();
    this._onDidChangeProject.fire();
    this._onDidChangeStatus.fire("disconnected");
    if (this._appBound) {
      this._appBound = false;
      this._onDidChangeAppBound.fire(false);
    }
    if (this._appClientConnected) {
      this._appClientConnected = false;
      this._onDidChangeAppClientConnected.fire(false);
    }
    if (this._pendingChanges.length > 0) {
      this._pendingChanges.length = 0;
      this._onDidChangePendingChanges.fire(0);
    }
  }

  private handleFilesystemNotification(ev: FileSystemNotification): void {
    const events: vscode.FileChangeEvent[] = [];
    const uri = (path: string) => vscode.Uri.from({ scheme: MINDCRAFT_SCHEME, path: `/${path}` });

    switch (ev.action) {
      case "write":
        events.push({ type: vscode.FileChangeType.Created, uri: uri(ev.path) });
        events.push({ type: vscode.FileChangeType.Changed, uri: uri(ev.path) });
        break;
      case "delete":
        events.push({ type: vscode.FileChangeType.Deleted, uri: uri(ev.path) });
        break;
      case "rename":
        events.push({ type: vscode.FileChangeType.Deleted, uri: uri(ev.oldPath) });
        events.push({ type: vscode.FileChangeType.Created, uri: uri(ev.newPath) });
        break;
      case "mkdir":
        events.push({ type: vscode.FileChangeType.Created, uri: uri(ev.path) });
        break;
      case "rmdir":
        events.push({ type: vscode.FileChangeType.Deleted, uri: uri(ev.path) });
        break;
      case "import":
        break;
    }

    this._fsProvider.fireChanges(events);
  }

  private fireRootChanged(): void {
    const uri = vscode.Uri.from({ scheme: MINDCRAFT_SCHEME, path: "/" });
    this._fsProvider.fireChanges([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  private hasWorkspaceFolder(): boolean {
    return this.findWorkspaceFolderIndex() !== -1;
  }

  private addWorkspaceFolder(): void {
    const uri = vscode.Uri.from({ scheme: MINDCRAFT_SCHEME, path: "/" });
    const existing = this.findWorkspaceFolderIndex();
    if (existing !== -1) return;
    vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, {
      uri,
      name: this._workspaceFolderName,
    });
    vscode.commands.executeCommand("typescript.restartTsServer");
  }

  private renameWorkspaceFolder(name: string): void {
    this._workspaceFolderName = name;
    const index = this.findWorkspaceFolderIndex();
    if (index === -1) return;
    const folder = vscode.workspace.workspaceFolders![index];
    if (folder.name === name) return;
    vscode.workspace.updateWorkspaceFolders(index, 1, { uri: folder.uri, name });
  }

  private closeMindcraftTabs(): void {
    const tabs = vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.filter((tab) => {
        if (tab.input instanceof vscode.TabInputText) return tab.input.uri.scheme === MINDCRAFT_SCHEME;
        if (tab.input instanceof vscode.TabInputCustom) return tab.input.uri.scheme === MINDCRAFT_SCHEME;
        return false;
      })
    );
    if (tabs.length > 0) {
      vscode.window.tabGroups.close(tabs);
    }
  }

  private removeWorkspaceFolder(): void {
    const index = this.findWorkspaceFolderIndex();
    if (index === -1) return;
    vscode.workspace.updateWorkspaceFolders(index, 1);
  }

  private findWorkspaceFolderIndex(): number {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return -1;
    return folders.findIndex((f) => f.uri.scheme === MINDCRAFT_SCHEME);
  }

  dispose(): void {
    this.disconnectActive();
    this._fsProvider.dispose();
    this._diagnosticsManager.dispose();
    this._onDidChangeProject.dispose();
    this._onDidChangeStatus.dispose();
    this._onDidChangeAppBound.dispose();
    this._onDidChangeAppClientConnected.dispose();
    this._onDidChangePendingChanges.dispose();
    for (const d of this._disposables) d.dispose();
  }
}
