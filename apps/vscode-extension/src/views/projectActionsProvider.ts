import * as vscode from "vscode";
import { PROJECT_ACTIONS } from "./projectActions";

/** Tree data provider for the desktop Mindcraft explorer view: a flat list of command launchers. */
export class ProjectActionsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  // TreeView.reveal resolves elements by identity, so getChildren must return
  // the same instances on every call.
  private readonly items = PROJECT_ACTIONS.map((action) => {
    const item = new vscode.TreeItem(action.label, vscode.TreeItemCollapsibleState.None);
    item.command = { command: action.commandId, title: action.label };
    item.iconPath = new vscode.ThemeIcon(action.icon);
    return item;
  });

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    return element ? [] : this.items;
  }

  /** Every action is a root item. TreeView.reveal requires getParent. */
  getParent(): undefined {
    return undefined;
  }
}
