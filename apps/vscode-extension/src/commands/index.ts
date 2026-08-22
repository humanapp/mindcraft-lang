import { fileContentText } from "@wendoo/app-host";
import { addManifestFilesEntry, removeManifestFilesEntry } from "@wendoo/bridge-app/manifest-files";
import * as vscode from "vscode";
import { isBuildMembershipPath } from "../services/build-membership-tracker";
import type { ProjectManager } from "../services/project-manager";
import { ACTUATOR_SCAFFOLD, findUniqueFolderName, SENSOR_SCAFFOLD, type TileScaffold } from "../services/tile-scaffold";
import { WENDOO_SCHEME } from "../services/wendoo-fs-provider";
import { isWendooEnabled, setWendooEnabled } from "../state/context";
import { WENDOO_JSON } from "../wendoo-json";

export function registerCommands(context: vscode.ExtensionContext, projectManager: ProjectManager): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("wendoo.show", () => {
      setWendooEnabled(true);
      vscode.commands.executeCommand("wendoo.sessions.focus");
      if (!projectManager.project) {
        vscode.commands.executeCommand("wendoo.connect");
      }
    }),

    vscode.commands.registerCommand("wendoo.connect", async () => {
      const raw = await vscode.window.showInputBox({
        prompt: "Enter the join code from Wendoo",
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
        await setWendooEnabled(true);
        vscode.commands.executeCommand("wendoo.sessions.focus");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to connect: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("wendoo.disconnect", () => {
      projectManager.disconnect();
    }),

    vscode.commands.registerCommand("wendoo.confirmDisconnect", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Are you sure you want to disconnect from the Wendoo session?",
        { modal: true },
        "Disconnect"
      );
      if (choice === "Disconnect") {
        projectManager.disconnect();
      }
    }),

    vscode.commands.registerCommand("wendoo.createSensor", async () => {
      await createFileFromScaffold(projectManager, SENSOR_SCAFFOLD);
    }),

    vscode.commands.registerCommand("wendoo.createActuator", async () => {
      await createFileFromScaffold(projectManager, ACTUATOR_SCAFFOLD);
    }),

    vscode.commands.registerCommand("wendoo.sync", async () => {
      if (!projectManager.project) {
        vscode.window.showWarningMessage("Not connected to a Wendoo session.");
        return;
      }
      await projectManager.sync();
      vscode.window.showInformationMessage("Wendoo files synced.");
    }),

    vscode.commands.registerCommand("wendoo.hide", () => {
      setWendooEnabled(false);
      vscode.window.showInformationMessage("Wendoo view hidden.");
    }),

    vscode.commands.registerCommand("wendoo.unlockWendooJson", () => {
      projectManager.fsProvider.unlockWendooJson();
    }),

    vscode.commands.registerCommand("wendoo.toggleFileInBuild", (uri: vscode.Uri) => {
      toggleFileInBuild(projectManager, uri);
    })
  );
}

/**
 * Toggle `uri`'s membership in the manifest `files` list: add the file when
 * it is not listed, remove it when it is. Applies a conservative text edit to
 * wendoo.json through the project filesystem.
 */
function toggleFileInBuild(projectManager: ProjectManager, uri: vscode.Uri): void {
  const project = projectManager.project;
  if (!project) {
    vscode.window.showWarningMessage("Not connected to a Wendoo session.");
    return;
  }

  const path = uri.path.replace(/^\//, "");
  if (!isBuildMembershipPath(path)) {
    return;
  }

  let manifestText: string | undefined;
  try {
    manifestText = fileContentText(project.files.raw.read(WENDOO_JSON));
  } catch {
    manifestText = undefined;
  }
  if (manifestText === undefined) {
    vscode.window.showWarningMessage("wendoo.json could not be read.");
    return;
  }

  const tracker = projectManager.buildMembership;
  const edited = tracker.isInBuild(path)
    ? removeManifestFilesEntry(manifestText, path)
    : addManifestFilesEntry(manifestText, path);
  if (edited === undefined) {
    vscode.window.showWarningMessage(`Could not update the "files" list in wendoo.json for ${path}.`);
    return;
  }

  project.files.toRemote.write(WENDOO_JSON, edited);
  projectManager.notifyLocalWrite([WENDOO_JSON]);
}

async function createFileFromScaffold(projectManager: ProjectManager, scaffold: TileScaffold): Promise<void> {
  if (!projectManager.project) {
    vscode.window.showWarningMessage("Not connected to a Wendoo session.");
    return;
  }

  const rootUri = vscode.Uri.from({ scheme: WENDOO_SCHEME, path: "/" });
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

  const fileUri = vscode.Uri.from({ scheme: WENDOO_SCHEME, path: `/${targetFolder}/${fileName}` });
  await vscode.commands.executeCommand("vscode.open", fileUri);
}
