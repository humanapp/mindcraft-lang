import * as vscode from "vscode";
import { registerFolderCommands } from "./commands/folder-commands";
import { activateBridgeSession } from "./services/bridge-session";
import {
  folderSessionVolumeWriteForTest,
  hasFolderSessionHandshakeCompleted,
  isFolderSessionEditorOpen,
} from "./services/folder-session";
import type { RemovableVolumeRoot } from "./services/removable-volume";
import { setMindcraftEnabled } from "./state/context";
import { ProjectActionsProvider } from "./views/projectActionsProvider";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("mindcraft.openSettings", () => {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:mindcraft-lang.mindcraft-lang-vscode-extension"
      );
    })
  );
  // Mode is environment-keyed: the web UI runs bridge mode only, desktop runs
  // folder mode only. The context key gates command and view visibility.
  const isWebHost = vscode.env.uiKind === vscode.UIKind.Web;
  void vscode.commands.executeCommand("setContext", "mindcraft.webHost", isWebHost);
  if (isWebHost) {
    activateBridgeSession(context);
    return;
  }
  registerFolderCommands(context);
  const projectActionsProvider = new ProjectActionsProvider();
  const projectActionsView = vscode.window.createTreeView("mindcraft.projectActions", {
    treeDataProvider: projectActionsProvider,
  });
  context.subscriptions.push(projectActionsView);
  // The reveal needs the view's when-clause satisfied, so enable first.
  void setMindcraftEnabled(true).then(() =>
    expandProjectActionsViewOnFirstRender(context, projectActionsProvider, projectActionsView)
  );
  // Test-only hooks for integration harnesses.
  context.subscriptions.push(
    vscode.commands.registerCommand("mindcraft.testHooks.folderSessionHandshakeCompleted", () =>
      hasFolderSessionHandshakeCompleted()
    ),
    vscode.commands.registerCommand("mindcraft.testHooks.folderEditorOpen", () => isFolderSessionEditorOpen()),
    vscode.commands.registerCommand(
      "mindcraft.testHooks.folderVolumeWrite",
      (payload: unknown, mountRoots?: readonly RemovableVolumeRoot[]) =>
        folderSessionVolumeWriteForTest(payload, mountRoots)
    )
  );
}

export function deactivate() {}

const PROJECT_ACTIONS_VIEW_EXPANDED_KEY = "mindcraft.projectActionsViewExpanded";

/**
 * Expands the project actions view the first time it renders in a workspace.
 * The Explorer container starts contributed views collapsed regardless of the
 * declarative view visibility; a one-time reveal opens the view, after which
 * VS Code's persisted workspace view state carries the user's choice.
 */
async function expandProjectActionsViewOnFirstRender(
  context: vscode.ExtensionContext,
  provider: ProjectActionsProvider,
  view: vscode.TreeView<vscode.TreeItem>
): Promise<void> {
  if (context.workspaceState.get(PROJECT_ACTIONS_VIEW_EXPANDED_KEY)) {
    return;
  }
  await context.workspaceState.update(PROJECT_ACTIONS_VIEW_EXPANDED_KEY, true);
  await view.reveal(provider.getChildren()[0], { select: false, focus: false });
}
