import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { createStatusBarItem } from "./ui/statusBar";
import { MindcraftSessionsProvider } from "./views/mindcraftSessionsProvider";

export function activate(context: vscode.ExtensionContext) {
  const sessionsProvider = new MindcraftSessionsProvider();
  const treeView = vscode.window.createTreeView("mindcraft.sessions", {
    treeDataProvider: sessionsProvider,
  });

  registerCommands(context, sessionsProvider);
  createStatusBarItem(context);

  context.subscriptions.push(treeView);
}

export function deactivate() {}
