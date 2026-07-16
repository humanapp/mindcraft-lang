import * as vscode from "vscode";
import { registerCommands } from "../commands";
import { BuildMembershipCodeLensProvider } from "../providers/build-membership-codelens-provider";
import { BuildMembershipDecorationProvider } from "../providers/build-membership-decoration-provider";
import { MindcraftJsonCodeLensProvider } from "../providers/mindcraft-json-codelens-provider";
import { setMindcraftEnabled } from "../state/context";
import { createStatusBarItem } from "../ui/statusBar";
import { MindcraftSessionsProvider } from "../views/mindcraftSessionsProvider";
import { MINDCRAFT_SCHEME } from "./mindcraft-fs-provider";
import { ProjectManager } from "./project-manager";
import type { ProjectSession } from "./project-session";

/**
 * Activate bridge mode: the virtual `mindcraft:` filesystem mirroring a
 * remote app over the websocket relay, with its sessions view, status bar,
 * and commands.
 */
export function activateBridgeSession(context: vscode.ExtensionContext): ProjectSession {
  const projectManager = new ProjectManager();

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(MINDCRAFT_SCHEME, projectManager.fsProvider, {
      isCaseSensitive: true,
    }),
    vscode.window.registerFileDecorationProvider(projectManager.fsProvider),
    vscode.window.registerFileDecorationProvider(
      new BuildMembershipDecorationProvider(MINDCRAFT_SCHEME, projectManager.buildMembership)
    ),
    vscode.languages.registerCodeLensProvider(
      { scheme: MINDCRAFT_SCHEME, pattern: "**/mindcraft.json" },
      new MindcraftJsonCodeLensProvider(projectManager.fsProvider)
    ),
    vscode.languages.registerCodeLensProvider(
      { scheme: MINDCRAFT_SCHEME },
      new BuildMembershipCodeLensProvider(projectManager.buildMembership)
    )
  );

  const sessionsProvider = new MindcraftSessionsProvider(projectManager);
  const treeView = vscode.window.createTreeView("mindcraft.sessions", {
    treeDataProvider: sessionsProvider,
  });

  registerCommands(context, projectManager);
  createStatusBarItem(context, projectManager);

  context.subscriptions.push(
    projectManager.onDidChangeAppBound(async (bound) => {
      if (bound && !treeView.visible) {
        await setMindcraftEnabled(true);
        vscode.commands.executeCommand("mindcraft.sessions.focus");
      }
    })
  );

  projectManager.initialize(context.globalState);

  context.subscriptions.push(treeView, projectManager);
  return projectManager;
}
