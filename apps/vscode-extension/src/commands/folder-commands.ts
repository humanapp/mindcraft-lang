import * as vscode from "vscode";
import { openFolderProjectSession } from "../services/folder-session";
import { buildProjectSkeleton, readDevTargetDescriptor } from "../services/project-skeleton";

const MINDCRAFT_JSON = "mindcraft.json";

/** Register the desktop folder-mode commands. */
export function registerFolderCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("mindcraft.openProjectFolder", async () => {
      await openProjectFolder(context);
    }),
    vscode.commands.registerCommand("mindcraft.newProject", async (name?: string) => {
      await newProject(context, name);
    })
  );
}

async function openProjectFolder(context: vscode.ExtensionContext): Promise<void> {
  const descriptor = requireDevTarget();
  if (!descriptor) {
    return;
  }
  const candidates: vscode.WorkspaceFolder[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (await fileExists(vscode.Uri.joinPath(folder.uri, MINDCRAFT_JSON))) {
      candidates.push(folder);
    }
  }
  if (candidates.length === 0) {
    vscode.window.showErrorMessage(`Open a workspace folder containing ${MINDCRAFT_JSON} first.`);
    return;
  }
  const folder = candidates.length === 1 ? candidates[0] : await pickFolder(candidates);
  if (!folder) {
    return;
  }
  openFolderProjectSession(context, folder, vscode.Uri.file(descriptor.appPath));
}

async function newProject(context: vscode.ExtensionContext, nameArgument?: string): Promise<void> {
  const descriptor = requireDevTarget();
  if (!descriptor) {
    return;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showErrorMessage("Open the folder to create the Mindcraft project in first.");
    return;
  }
  const folder = folders.length === 1 ? folders[0] : await pickFolder(folders);
  if (!folder) {
    return;
  }
  const manifestUri = vscode.Uri.joinPath(folder.uri, MINDCRAFT_JSON);
  if (await fileExists(manifestUri)) {
    vscode.window.showErrorMessage(`${folder.name} already contains ${MINDCRAFT_JSON}. Use Open Project Folder.`);
    return;
  }
  const name =
    nameArgument?.trim() ||
    (
      await vscode.window.showInputBox({
        prompt: "Project name",
        value: folder.name,
      })
    )?.trim();
  if (!name) {
    return;
  }
  await vscode.workspace.fs.writeFile(manifestUri, new TextEncoder().encode(buildProjectSkeleton(name, descriptor)));
  openFolderProjectSession(context, folder, vscode.Uri.file(descriptor.appPath));
}

function requireDevTarget(): ReturnType<typeof readDevTargetDescriptor> {
  const descriptor = readDevTargetDescriptor();
  if (!descriptor) {
    vscode.window.showErrorMessage(
      'Set the "mindcraft.devTarget" setting ({ "appPath": "<built app directory>" }) to host a target app.'
    );
    return undefined;
  }
  return descriptor;
}

async function pickFolder(folders: readonly vscode.WorkspaceFolder[]): Promise<vscode.WorkspaceFolder | undefined> {
  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { placeHolder: "Select the project folder" }
  );
  return picked?.folder;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return stat.type === vscode.FileType.File;
  } catch {
    return false;
  }
}
