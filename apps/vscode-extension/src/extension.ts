import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { MINDCRAFT_SCHEME } from "./services/mindcraft-fs-provider";
import { ProjectManager } from "./services/project-manager";
import { createStatusBarItem } from "./ui/statusBar";
import { MindcraftSessionsProvider } from "./views/mindcraftSessionsProvider";

export function activate(context: vscode.ExtensionContext) {
  const projectManager = new ProjectManager();

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(MINDCRAFT_SCHEME, projectManager.fsProvider, {
      isCaseSensitive: true,
    }),
    vscode.window.registerFileDecorationProvider(projectManager.fsProvider)
  );

  const sessionsProvider = new MindcraftSessionsProvider(projectManager);
  const treeView = vscode.window.createTreeView("mindcraft.sessions", {
    treeDataProvider: sessionsProvider,
  });

  registerCommands(context, projectManager);
  createStatusBarItem(context, projectManager);

  projectManager.initialize(context.globalState);

  context.subscriptions.push(treeView, projectManager);
}

export function deactivate() {}
