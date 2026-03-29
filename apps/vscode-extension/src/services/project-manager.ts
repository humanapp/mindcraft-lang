import type { ConnectionStatus } from "@mindcraft-lang/bridge-client";
import { Project } from "@mindcraft-lang/bridge-client";
import * as vscode from "vscode";

export class ProjectManager implements vscode.Disposable {
  private _project: Project<"extension"> | undefined;
  private readonly _unsubs: (() => void)[] = [];
  private readonly _disposables: vscode.Disposable[] = [];

  private readonly _onDidChangeProject = new vscode.EventEmitter<void>();
  readonly onDidChangeProject = this._onDidChangeProject.event;

  private readonly _onDidChangeStatus = new vscode.EventEmitter<ConnectionStatus>();
  readonly onDidChangeStatus = this._onDidChangeStatus.event;

  get project(): Project<"extension"> | undefined {
    return this._project;
  }

  get status(): ConnectionStatus {
    return this._project?.session.status ?? "disconnected";
  }

  connect(joinCode: string): void {
    this.disconnectActive();

    const bridgeUrl = vscode.workspace.getConfiguration("mindcraft").get<string>("bridgeUrl", "");
    if (!bridgeUrl) {
      throw new Error("mindcraft.bridgeUrl is not configured");
    }

    const project = new Project({
      appName: "vscode",
      projectId: `vscode-${joinCode}`,
      projectName: "VS Code",
      bridgeUrl,
      clientRole: "extension",
      filesystem: new Map(),
    });

    this._unsubs.push(
      project.session.addEventListener("status", (status) => {
        this._onDidChangeStatus.fire(status);
      })
    );

    project.session.start();

    this._project = project;
    this._onDidChangeProject.fire();
  }

  disconnect(): void {
    this.disconnectActive();
  }

  private disconnectActive(): void {
    if (!this._project) return;
    for (const unsub of this._unsubs) unsub();
    this._unsubs.length = 0;
    this._project.session.stop();
    this._project = undefined;
    this._onDidChangeProject.fire();
    this._onDidChangeStatus.fire("disconnected");
  }

  dispose(): void {
    this.disconnectActive();
    this._onDidChangeProject.dispose();
    this._onDidChangeStatus.dispose();
    for (const d of this._disposables) d.dispose();
  }
}
