import { type ConnectionStatus, type FileSystemNotification, Project } from "@mindcraft-lang/bridge-client";
import type { ExtensionClientMessage, ExtensionServerMessage } from "@mindcraft-lang/bridge-protocol";
import * as vscode from "vscode";
import { MINDCRAFT_SCHEME, MindcraftFileSystemProvider } from "./mindcraft-fs-provider";

const PENDING_JOIN_CODE_KEY = "mindcraft.pendingJoinCode";

export class ProjectManager implements vscode.Disposable {
  private _project: Project<ExtensionClientMessage, ExtensionServerMessage> | undefined;
  private _appBound = false;
  private readonly _unsubs: (() => void)[] = [];
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _fsProvider = new MindcraftFileSystemProvider();
  private _globalState: vscode.Memento | undefined;

  private readonly _onDidChangeProject = new vscode.EventEmitter<void>();
  readonly onDidChangeProject = this._onDidChangeProject.event;

  private readonly _onDidChangeStatus = new vscode.EventEmitter<ConnectionStatus>();
  readonly onDidChangeStatus = this._onDidChangeStatus.event;

  private readonly _onDidChangeAppBound = new vscode.EventEmitter<boolean>();
  readonly onDidChangeAppBound = this._onDidChangeAppBound.event;

  get fsProvider(): MindcraftFileSystemProvider {
    return this._fsProvider;
  }

  get project(): Project<ExtensionClientMessage, ExtensionServerMessage> | undefined {
    return this._project;
  }

  get status(): ConnectionStatus {
    return this._project?.session.status ?? "disconnected";
  }

  get appBound(): boolean {
    return this._appBound;
  }

  initialize(globalState: vscode.Memento): void {
    this._globalState = globalState;
    const pendingCode = globalState.get<string>(PENDING_JOIN_CODE_KEY);
    if (pendingCode) {
      globalState.update(PENDING_JOIN_CODE_KEY, undefined);
      this.connect(pendingCode);
    }
  }

  connect(joinCode: string): void {
    this.disconnectActive();

    const bridgeUrl = vscode.workspace.getConfiguration("mindcraft").get<string>("bridgeUrl", "");
    if (!bridgeUrl) {
      throw new Error("mindcraft.bridgeUrl is not configured");
    }

    const project = new Project<ExtensionClientMessage, ExtensionServerMessage>({
      appName: "vscode",
      projectId: `vscode-${joinCode}`,
      projectName: "VS Code",
      bridgeUrl,
      wsPath: "extension",
      filesystem: new Map(),
      joinCode,
    });

    this._unsubs.push(
      project.session.addEventListener("status", (status) => {
        this._onDidChangeStatus.fire(status);
        if (status === "connected") {
          project
            .requestSync()
            .then(() => {
              if (!this.hasWorkspaceFolder()) {
                this._globalState?.update(PENDING_JOIN_CODE_KEY, joinCode);
                this.addWorkspaceFolder();
              }
              this.fireRootChanged();
            })
            .catch(() => {});
        }
      })
    );

    this._unsubs.push(
      project.session.on("session:appStatus", (msg) => {
        const bound = msg.payload?.bound ?? false;
        if (this._appBound !== bound) {
          this._appBound = bound;
          this._onDidChangeAppBound.fire(bound);
        }
      })
    );

    project.fromRemoteFileChange = (ev) => this.handleFilesystemNotification(ev);

    this._fsProvider.setFileSystems(project.files.raw, project.files.toRemote);

    this._project = project;
    project.session.start();

    this._onDidChangeProject.fire();
  }

  disconnect(): void {
    this.disconnectActive();
    this.removeWorkspaceFolder();
    this._globalState?.update(PENDING_JOIN_CODE_KEY, undefined);
  }

  private disconnectActive(): void {
    if (!this._project) return;
    for (const unsub of this._unsubs) unsub();
    this._unsubs.length = 0;
    this._project.session.stop();
    this._project = undefined;
    this._fsProvider.setFileSystems(undefined, undefined);
    this._onDidChangeProject.fire();
    this._onDidChangeStatus.fire("disconnected");
    if (this._appBound) {
      this._appBound = false;
      this._onDidChangeAppBound.fire(false);
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
      name: "Mindcraft",
    });
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
    this._onDidChangeProject.dispose();
    this._onDidChangeStatus.dispose();
    this._onDidChangeAppBound.dispose();
    for (const d of this._disposables) d.dispose();
  }
}
