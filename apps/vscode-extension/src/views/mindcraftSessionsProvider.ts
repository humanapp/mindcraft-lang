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
        new SessionItem("Connect to Mindcraft...", vscode.TreeItemCollapsibleState.None, "mindcraft.connect", "plug"),
      ];
    }

    const status = this.projectManager.status;
    return [
      new SessionItem(
        "Disconnect",
        vscode.TreeItemCollapsibleState.None,
        "mindcraft.confirmDisconnect",
        "debug-disconnect"
      ),
      new SessionItem("Create new sensor", vscode.TreeItemCollapsibleState.None, "mindcraft.createSensor", "eye"),
      new SessionItem("Create new actuator", vscode.TreeItemCollapsibleState.None, "mindcraft.createActuator", "zap"),
    ];
  }
}

class SessionItem extends vscode.TreeItem {
  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, commandId?: string, icon?: string) {
    super(label, collapsibleState);
    if (commandId) {
      this.command = { command: commandId, title: label };
    }
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
  }
}
