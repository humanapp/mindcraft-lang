import type { ConnectionStatus } from "@mindcraft-lang/bridge-client";
import * as vscode from "vscode";
import type { ProjectManager } from "../services/project-manager";

export function createStatusBarItem(
  context: vscode.ExtensionContext,
  projectManager: ProjectManager
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  item.command = "mindcraft.show";

  function update(): void {
    const status = projectManager.status;
    const appBound = projectManager.appBound;

    switch (status) {
      case "disconnected":
        item.text = "$(debug-disconnect) Mindcraft: Disconnected";
        item.tooltip = "Not connected to bridge";
        break;
      case "connecting":
        item.text = "$(sync~spin) Mindcraft: Connecting...";
        item.tooltip = "Connecting to bridge";
        break;
      case "reconnecting":
        item.text = "$(sync~spin) Mindcraft: Reconnecting...";
        item.tooltip = "Reconnecting to bridge";
        break;
      case "connected":
        if (appBound) {
          item.text = "$(pass-filled) Mindcraft: Connected";
          item.tooltip = "Connected to bridge and bound to app";
        } else {
          item.text = "$(warning) Mindcraft: No App";
          item.tooltip = "Connected to bridge but no app is bound";
        }
        break;
    }
  }

  update();
  item.show();

  context.subscriptions.push(
    projectManager.onDidChangeStatus(update),
    projectManager.onDidChangeAppBound(update),
    item
  );

  return item;
}
