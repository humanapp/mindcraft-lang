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
    const appClientConnected = projectManager.appClientConnected;
    const pendingChanges = projectManager.pendingChanges;

    switch (status) {
      case "disconnected":
        item.text = "$(debug-disconnect) Mindcraft: Disconnected";
        item.tooltip = "Not connected to bridge";
        item.backgroundColor = undefined;
        break;
      case "connecting":
        item.text = "$(sync~spin) Mindcraft: Connecting...";
        item.tooltip = "Connecting to bridge";
        item.backgroundColor = undefined;
        break;
      case "reconnecting":
        item.text = "$(sync~spin) Mindcraft: Reconnecting...";
        item.tooltip = "Reconnecting to bridge";
        item.backgroundColor = undefined;
        break;
      case "connected":
        if (appBound && appClientConnected) {
          const counts = projectManager.diagnosticsManager.compileCounts;
          if (counts.errors > 0) {
            item.text = `$(error) Mindcraft: ${counts.errors} error(s)`;
            item.tooltip = `${counts.errors} compilation error(s)`;
            item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
          } else if (counts.warnings > 0) {
            item.text = `$(warning) Mindcraft: ${counts.warnings} warning(s)`;
            item.tooltip = `${counts.warnings} compilation warning(s)`;
            item.backgroundColor = undefined;
          } else {
            item.text = "$(pass-filled) Mindcraft: Connected";
            item.tooltip = "Connected to bridge and bound to app";
            item.backgroundColor = undefined;
          }
        } else if (appBound) {
          const pending = pendingChanges > 0 ? ` (${pendingChanges} pending)` : "";
          item.text = `$(warning) Mindcraft: App Offline${pending}`;
          item.tooltip =
            pendingChanges > 0
              ? `App client disconnected -- ${pendingChanges} unsent change(s) will sync on reconnect`
              : "App client disconnected -- waiting for reconnect";
          item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        } else {
          item.text = "$(warning) Mindcraft: No App";
          item.tooltip = "Connected to bridge but no app is bound";
          item.backgroundColor = undefined;
        }
        break;
    }
  }

  update();
  item.show();

  context.subscriptions.push(
    projectManager.onDidChangeStatus(update),
    projectManager.onDidChangeAppBound(update),
    projectManager.onDidChangeAppClientConnected(update),
    projectManager.onDidChangePendingChanges(update),
    projectManager.diagnosticsManager.onDidChangeCounts(update),
    item
  );

  return item;
}
