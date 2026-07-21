import * as vscode from "vscode";
import {
  installTestTargetPick,
  installTestTargetUpdatePick,
  installTestTargetUpdateSpecificInput,
  registerFolderCommands,
} from "./commands/folder-commands";
import { activateBridgeSession } from "./services/bridge-session";
import {
  autoOpenFolderSessionOnActivation,
  disposeActiveFolderSession,
  folderSessionVolumeWriteForTest,
  hasFolderSessionHandshakeCompleted,
  isFolderSessionEditorOpen,
  registerFolderSessionSerializer,
  restoreFolderSessionForTest,
} from "./services/folder-session";
import type { RemovableVolumeRoot } from "./services/removable-volume";
import { installTestTargetAppTransport, testTargetAppTransportCalls } from "./services/target-app-cache-host";
import { targetRegistryEntries } from "./services/target-registry";
import { isMindcraftEnabled, setMindcraftEnabled } from "./state/context";
import { ProjectActionsProvider } from "./views/projectActionsProvider";

export async function activate(context: vscode.ExtensionContext) {
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
  // Apply the context the desktop view's when-clause reads before the view is
  // created, so the view is present the moment it registers on every activation
  // path -- including the onWebviewPanel restore path, where context keys reset
  // on window reload and the extension activates early to restore the app tab.
  // Awaiting removes the race where the Explorer evaluates the when-clause while
  // the context set is still in flight; view presence never depends on reveal.
  await setMindcraftEnabled(true);
  const projectActionsProvider = new ProjectActionsProvider();
  const projectActionsView = vscode.window.createTreeView("mindcraft.projectActions", {
    treeDataProvider: projectActionsProvider,
  });
  context.subscriptions.push(projectActionsView);
  context.subscriptions.push(registerFolderSessionSerializer(context));
  // Expansion is a one-time convenience; view presence follows the when-clause.
  void expandProjectActionsViewOnFirstRender(context, projectActionsProvider, projectActionsView);
  // Test-only hooks for integration harnesses.
  context.subscriptions.push(
    vscode.commands.registerCommand("mindcraft.testHooks.folderSessionHandshakeCompleted", () =>
      hasFolderSessionHandshakeCompleted()
    ),
    vscode.commands.registerCommand("mindcraft.testHooks.desktopViewState", () => ({
      enabled: isMindcraftEnabled(),
      viewVisible: projectActionsView.visible,
    })),
    vscode.commands.registerCommand("mindcraft.testHooks.folderEditorOpen", () => isFolderSessionEditorOpen()),
    vscode.commands.registerCommand(
      "mindcraft.testHooks.folderVolumeWrite",
      (payload: unknown, mountRoots?: readonly RemovableVolumeRoot[]) =>
        folderSessionVolumeWriteForTest(payload, mountRoots)
    ),
    vscode.commands.registerCommand(
      "mindcraft.testHooks.installTargetAppTransport",
      (files?: Record<string, string | { readonly file: string }>, versions?: readonly string[]) =>
        installTestTargetAppTransport(files, versions)
    ),
    vscode.commands.registerCommand("mindcraft.testHooks.installTargetPick", (coordinate?: string) =>
      installTestTargetPick(coordinate)
    ),
    vscode.commands.registerCommand("mindcraft.testHooks.installTargetUpdatePick", (kind?: string) =>
      installTestTargetUpdatePick(kind as "approved" | "published" | "specific" | undefined)
    ),
    vscode.commands.registerCommand("mindcraft.testHooks.installTargetUpdateSpecificInput", (value?: string) =>
      installTestTargetUpdateSpecificInput(value)
    ),
    vscode.commands.registerCommand("mindcraft.testHooks.targetRegistryEntries", () => targetRegistryEntries()),
    vscode.commands.registerCommand("mindcraft.testHooks.targetAppTransportCalls", () => testTargetAppTransportCalls()),
    vscode.commands.registerCommand("mindcraft.testHooks.disposeFolderSession", () => disposeActiveFolderSession()),
    vscode.commands.registerCommand("mindcraft.testHooks.restoreFolderSession", () =>
      restoreFolderSessionForTest(context)
    ),
    vscode.commands.registerCommand("mindcraft.testHooks.autoOpenFolderSession", () =>
      autoOpenFolderSessionOnActivation(context)
    )
  );
  // Auto-open the hosted editor for a single-project workspace. Runs after the
  // serializer registration so a restored tab from the previous window wins.
  void autoOpenFolderSessionOnActivation(context);
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
