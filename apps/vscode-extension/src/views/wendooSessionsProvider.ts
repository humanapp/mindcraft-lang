import * as vscode from "vscode";
import type { ProjectManager } from "../services/project-manager";

export class WendooSessionsProvider implements vscode.TreeDataProvider<SessionItem> {
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

  getChildren(element?: SessionItem): SessionItem[] {
    if (!element) {
      return this.getRootChildren();
    }
    return [];
  }

  private getRootChildren(): SessionItem[] {
    const project = this.projectManager.project;
    if (!project) {
      return [
        new SessionItem("Connect to Wendoo...", vscode.TreeItemCollapsibleState.None, "wendoo.connect", "plug"),
        new SessionItem("Open settings", vscode.TreeItemCollapsibleState.None, "wendoo.openSettings", "settings-gear"),
      ];
    }

    return [
      new SessionItem("Create new sensor", vscode.TreeItemCollapsibleState.None, "wendoo.createSensor", "eye"),
      new SessionItem("Create new actuator", vscode.TreeItemCollapsibleState.None, "wendoo.createActuator", "zap"),
      new SessionItem(
        "Disconnect",
        vscode.TreeItemCollapsibleState.None,
        "wendoo.confirmDisconnect",
        "debug-disconnect"
      ),
      new SessionItem("Open settings", vscode.TreeItemCollapsibleState.None, "wendoo.openSettings", "settings-gear"),
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
