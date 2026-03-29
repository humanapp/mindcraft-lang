import * as vscode from "vscode";
import type { ProjectManager } from "../services/project-manager";

export class MindcraftSessionsProvider implements vscode.TreeDataProvider<SessionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly projectManager: ProjectManager) {
    projectManager.onDidChangeProject(() => this.refresh());
    projectManager.onDidChangeStatus(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SessionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SessionItem[] {
    const project = this.projectManager.project;
    if (!project) {
      return [
        new SessionItem("No active session", vscode.TreeItemCollapsibleState.None),
        new SessionItem("Connect to Mindcraft", vscode.TreeItemCollapsibleState.None, "mindcraft.connect"),
      ];
    }

    const status = this.projectManager.status;
    return [
      new SessionItem(`Session: ${status}`, vscode.TreeItemCollapsibleState.None),
      new SessionItem("Disconnect", vscode.TreeItemCollapsibleState.None, "mindcraft.disconnect"),
    ];
  }
}

class SessionItem extends vscode.TreeItem {
  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, commandId?: string) {
    super(label, collapsibleState);
    if (commandId) {
      this.command = { command: commandId, title: label };
    }
  }
}
