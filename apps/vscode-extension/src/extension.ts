import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { ExampleCodeLensProvider } from "./providers/example-codelens-provider";
import { ExampleDecorationProvider } from "./providers/example-decoration-provider";
import { MindcraftJsonCodeLensProvider } from "./providers/mindcraft-json-codelens-provider";
import { MINDCRAFT_EXAMPLE_SCHEME } from "./services/mindcraft-example-fs-provider";
import { MINDCRAFT_SCHEME } from "./services/mindcraft-fs-provider";
import { ProjectManager } from "./services/project-manager";
import { setMindcraftEnabled } from "./state/context";
import { createStatusBarItem } from "./ui/statusBar";
import { MindcraftSessionsProvider } from "./views/mindcraftSessionsProvider";

export function activate(context: vscode.ExtensionContext) {
  const projectManager = new ProjectManager();

  const exampleDecorationProvider = new ExampleDecorationProvider();

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(MINDCRAFT_SCHEME, projectManager.fsProvider, {
      isCaseSensitive: true,
    }),
    vscode.workspace.registerFileSystemProvider(MINDCRAFT_EXAMPLE_SCHEME, projectManager.exampleFsProvider, {
      isCaseSensitive: true,
      isReadonly: true,
    }),
    vscode.window.registerFileDecorationProvider(projectManager.fsProvider),
    vscode.window.registerFileDecorationProvider(exampleDecorationProvider),
    vscode.languages.registerCodeLensProvider({ scheme: MINDCRAFT_EXAMPLE_SCHEME }, new ExampleCodeLensProvider()),
    vscode.languages.registerCodeLensProvider(
      { scheme: MINDCRAFT_SCHEME, pattern: "**/mindcraft.json" },
      new MindcraftJsonCodeLensProvider(projectManager.fsProvider)
    ),
    exampleDecorationProvider
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
}

export function deactivate() {}
