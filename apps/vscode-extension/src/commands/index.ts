import { addManifestFilesEntry, removeManifestFilesEntry } from "@mindcraft-lang/bridge-app/manifest-files";
import * as vscode from "vscode";
import { isBuildMembershipPath } from "../services/build-membership-tracker";
import { MINDCRAFT_JSON, MINDCRAFT_SCHEME } from "../services/mindcraft-fs-provider";
import type { ProjectManager } from "../services/project-manager";
import { ACTUATOR_SCAFFOLD, findUniqueFolderName, SENSOR_SCAFFOLD, type TileScaffold } from "../services/tile-scaffold";
import { isMindcraftEnabled, setMindcraftEnabled } from "../state/context";

export function registerCommands(context: vscode.ExtensionContext, projectManager: ProjectManager): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("mindcraft.show", () => {
      setMindcraftEnabled(true);
      vscode.commands.executeCommand("mindcraft.sessions.focus");
      if (!projectManager.project) {
        vscode.commands.executeCommand("mindcraft.connect");
      }
    }),

    vscode.commands.registerCommand("mindcraft.connect", async () => {
      const raw = await vscode.window.showInputBox({
        prompt: "Enter the join code from Mindcraft",
        placeHolder: "e.g. lumpy-space-unicorn",
      });

      if (raw === undefined) {
        return;
      }

      const code = raw.trim();
      if (code === "") {
        vscode.window.showWarningMessage("Please enter a join code to connect.");
        return;
      }

      try {
        projectManager.connect(code);
        await setMindcraftEnabled(true);
        vscode.commands.executeCommand("mindcraft.sessions.focus");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to connect: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("mindcraft.disconnect", () => {
      projectManager.disconnect();
    }),

    vscode.commands.registerCommand("mindcraft.confirmDisconnect", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Are you sure you want to disconnect from the Mindcraft session?",
        { modal: true },
        "Disconnect"
      );
      if (choice === "Disconnect") {
        projectManager.disconnect();
      }
    }),

    vscode.commands.registerCommand("mindcraft.createSensor", async () => {
      await createFileFromScaffold(projectManager, SENSOR_SCAFFOLD);
    }),

    vscode.commands.registerCommand("mindcraft.createActuator", async () => {
      await createFileFromScaffold(projectManager, ACTUATOR_SCAFFOLD);
    }),

    vscode.commands.registerCommand("mindcraft.sync", async () => {
      if (!projectManager.project) {
        vscode.window.showWarningMessage("Not connected to a Mindcraft session.");
        return;
      }
      await projectManager.sync();
      vscode.window.showInformationMessage("Mindcraft files synced.");
    }),

    vscode.commands.registerCommand("mindcraft.hide", () => {
      setMindcraftEnabled(false);
      vscode.window.showInformationMessage("Mindcraft view hidden.");
    }),

    vscode.commands.registerCommand("mindcraft.unlockMindcraftJson", () => {
      projectManager.fsProvider.unlockMindcraftJson();
    }),

    vscode.commands.registerCommand("mindcraft.toggleFileInBuild", (uri: vscode.Uri) => {
      toggleFileInBuild(projectManager, uri);
    })
  );
}

/**
 * Toggle `uri`'s membership in the manifest `files` list: add the file when
 * it is not listed, remove it when it is. Applies a conservative text edit to
 * mindcraft.json through the project filesystem.
 */
function toggleFileInBuild(projectManager: ProjectManager, uri: vscode.Uri): void {
  const project = projectManager.project;
  if (!project) {
    vscode.window.showWarningMessage("Not connected to a Mindcraft session.");
    return;
  }

  const path = uri.path.replace(/^\//, "");
  if (!isBuildMembershipPath(path)) {
    return;
  }

  let manifestText: string;
  try {
    manifestText = project.files.raw.read(MINDCRAFT_JSON);
  } catch {
    vscode.window.showWarningMessage("mindcraft.json could not be read.");
    return;
  }

  const tracker = projectManager.buildMembership;
  const edited = tracker.isInBuild(path)
    ? removeManifestFilesEntry(manifestText, path)
    : addManifestFilesEntry(manifestText, path);
  if (edited === undefined) {
    vscode.window.showWarningMessage(`Could not update the "files" list in mindcraft.json for ${path}.`);
    return;
  }

  project.files.toRemote.write(MINDCRAFT_JSON, edited);
  projectManager.notifyLocalWrite([MINDCRAFT_JSON]);
}

async function createFileFromScaffold(projectManager: ProjectManager, scaffold: TileScaffold): Promise<void> {
  if (!projectManager.project) {
    vscode.window.showWarningMessage("Not connected to a Mindcraft session.");
    return;
  }

  const rootUri = vscode.Uri.from({ scheme: MINDCRAFT_SCHEME, path: "/" });
  let existingEntries: [string, vscode.FileType][];
  try {
    existingEntries = await vscode.workspace.fs.readDirectory(rootUri);
  } catch {
    existingEntries = [];
  }

  const existingNames = new Set(existingEntries.map(([name]) => name));
  const targetFolder = findUniqueFolderName(scaffold.baseName, existingNames);
  const fileName = `${scaffold.baseName}.ts`;

  const writeFs = projectManager.project.files.toRemote;
  writeFs.mkdir(targetFolder);
  writeFs.write(`${targetFolder}/${fileName}`, scaffold.content);
  projectManager.notifyLocalCreate([targetFolder, `${targetFolder}/${fileName}`]);

  const fileUri = vscode.Uri.from({ scheme: MINDCRAFT_SCHEME, path: `/${targetFolder}/${fileName}` });
  await vscode.commands.executeCommand("vscode.open", fileUri);
}
