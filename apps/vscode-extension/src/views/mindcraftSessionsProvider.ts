import * as vscode from "vscode";

export class MindcraftSessionsProvider implements vscode.TreeDataProvider<SessionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SessionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SessionItem[] {
    return [
      new SessionItem("No active sessions", vscode.TreeItemCollapsibleState.None),
      new SessionItem("Connect to Mindcraft", vscode.TreeItemCollapsibleState.None, "mindcraft.connect"),
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
