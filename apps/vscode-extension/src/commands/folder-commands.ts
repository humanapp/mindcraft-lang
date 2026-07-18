import type { ExtensionCatalogDocumentEntry } from "@mindcraft-lang/app-host";
import * as vscode from "vscode";
import { MINDCRAFT_JSON } from "../mindcraft-json";
import {
  activeFolderSessionFolder,
  openFolderProjectSession,
  revealFolderSessionEditor,
} from "../services/folder-session";
import {
  fileExists,
  findProjectFolderCandidates,
  resolveFolderTargetDescriptor,
  resolveTargetAppRoot,
} from "../services/folder-target-resolver";
import { buildProjectSkeleton, readDevTargetDescriptor } from "../services/project-skeleton";
import { ensureCachedTargetApp } from "../services/target-app-cache-host";
import {
  findTargetRegistryEntry,
  type ProjectTargetResolution,
  registryProjectSeed,
  TargetResolutionErrorCode,
  targetRegistryEntries,
  targetRegistryPickItems,
} from "../services/target-registry";
import { ACTUATOR_SCAFFOLD, findUniqueFolderName, SENSOR_SCAFFOLD, type TileScaffold } from "../services/tile-scaffold";

/** Register the desktop project-folder commands. */
export function registerFolderCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("mindcraft.openProjectFolder", async () => {
      await openProjectFolder(context);
    }),
    vscode.commands.registerCommand("mindcraft.newProject", async (name?: string) => {
      await newProject(context, name);
    }),
    vscode.commands.registerCommand("mindcraft.openEditor", async () => {
      if (revealFolderSessionEditor()) {
        return;
      }
      await openProjectFolder(context);
    }),
    vscode.commands.registerCommand("mindcraft.createSensor", async () => {
      await createTileFile(SENSOR_SCAFFOLD);
    }),
    vscode.commands.registerCommand("mindcraft.createActuator", async () => {
      await createTileFile(ACTUATOR_SCAFFOLD);
    })
  );
}

/**
 * Write a tile scaffold into the project folder -- a fresh `<base>/<base>.ts`
 * under a uniquely named folder -- and open the created file in the editor.
 * Targets the running session's folder, or a workspace folder containing
 * `mindcraft.json` when no session is running.
 */
async function createTileFile(scaffold: TileScaffold): Promise<void> {
  const folderUri = await resolveProjectFolder();
  if (!folderUri) {
    return;
  }
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(folderUri);
  } catch {
    entries = [];
  }
  const existingNames = new Set(entries.map(([name]) => name));
  const targetFolder = findUniqueFolderName(scaffold.baseName, existingNames);
  const fileUri = vscode.Uri.joinPath(folderUri, targetFolder, `${scaffold.baseName}.ts`);
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folderUri, targetFolder));
  await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(scaffold.content));
  await vscode.commands.executeCommand("vscode.open", fileUri);
}

async function openProjectFolder(context: vscode.ExtensionContext): Promise<void> {
  const candidates = await findProjectFolderCandidates();
  if (candidates.length === 0) {
    vscode.window.showErrorMessage(`Open a workspace folder containing ${MINDCRAFT_JSON} first.`);
    return;
  }
  const folder = await pickFolder(candidates);
  if (!folder) {
    return;
  }
  const resolution = await resolveFolderTargetDescriptor(folder.uri);
  if (!resolution.ok) {
    vscode.window.showErrorMessage(targetResolutionFailureMessage(resolution));
    return;
  }
  const appRoot = await resolveTargetAppRoot(context, resolution.descriptor);
  if (!appRoot) {
    return;
  }
  openFolderProjectSession(context, folder, appRoot);
}

/** The error message shown when a project folder resolves no hostable target. */
function targetResolutionFailureMessage(failure: Extract<ProjectTargetResolution, { ok: false }>): string {
  const declared = failure.declaredCoordinates;
  if (failure.code === TargetResolutionErrorCode.AMBIGUOUS_REGISTRY_MATCH) {
    return (
      `The project declares more than one known target (${declared.join(", ")}) (${failure.code}). ` +
      `Keep one target in ${MINDCRAFT_JSON}, or set the "mindcraft.devTarget" setting to override the hosted app.`
    );
  }
  return declared.length === 0
    ? `The project declares no target in ${MINDCRAFT_JSON} (${failure.code}). ` +
        'Create the project with New Project, or set the "mindcraft.devTarget" setting to override the hosted app.'
    : `The project declares no known target (declared: ${declared.join(", ")}) (${failure.code}). ` +
        `Declare a known target in ${MINDCRAFT_JSON}, or set the "mindcraft.devTarget" setting to override the hosted app.`;
}

async function newProject(context: vscode.ExtensionContext, nameArgument?: string): Promise<void> {
  const descriptor = readDevTargetDescriptor();
  const registryEntry = descriptor ? undefined : await pickRegistryTarget();
  if (!descriptor && !registryEntry) {
    return;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showErrorMessage("Open the folder to create the Mindcraft project in first.");
    return;
  }
  const folder = await pickFolder(folders);
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
  let appRoot: vscode.Uri;
  let skeleton: string;
  if (descriptor) {
    const resolved = await resolveTargetAppRoot(context, descriptor);
    if (!resolved) {
      return;
    }
    appRoot = resolved;
    skeleton = buildProjectSkeleton(name, descriptor);
  } else if (registryEntry) {
    const result = await ensureCachedTargetApp(context, registryEntry.ref);
    if (!result.ok) {
      vscode.window.showErrorMessage(
        `Could not load the target app "${registryEntry.ref}" (${result.code}): ${result.message}`
      );
      return;
    }
    appRoot = result.appDir;
    skeleton = buildProjectSkeleton(name, registryProjectSeed(registryEntry.coordinate, result.manifest.version));
  } else {
    return;
  }
  await vscode.workspace.fs.writeFile(manifestUri, new TextEncoder().encode(skeleton));
  openFolderProjectSession(context, folder, appRoot);
}

let testTargetPickCoordinate: string | undefined;

/**
 * Test-only: preselect the registry target the New Project picker returns, by
 * coordinate, or clear the preselection when `coordinate` is undefined.
 */
export function installTestTargetPick(coordinate: string | undefined): void {
  testTargetPickCoordinate = coordinate;
}

/**
 * Pick one target from the bundled targets registry. Always shows the
 * quick-pick, even for a single entry; returns undefined when dismissed.
 */
async function pickRegistryTarget(): Promise<ExtensionCatalogDocumentEntry | undefined> {
  if (testTargetPickCoordinate !== undefined) {
    return findTargetRegistryEntry(testTargetPickCoordinate);
  }
  const picked = await vscode.window.showQuickPick([...targetRegistryPickItems(targetRegistryEntries())], {
    placeHolder: "Select the new project's target",
  });
  return picked?.entry;
}

/**
 * The project folder the tile create commands target: the running session's
 * folder when a session exists, else a workspace folder containing
 * `mindcraft.json` (quick-picked when more than one qualifies). Warns and
 * returns undefined when no workspace folder contains `mindcraft.json`;
 * returns undefined silently when the quick-pick is dismissed.
 */
async function resolveProjectFolder(): Promise<vscode.Uri | undefined> {
  const sessionFolder = activeFolderSessionFolder();
  if (sessionFolder) {
    return sessionFolder;
  }
  const candidates = await findProjectFolderCandidates();
  if (candidates.length === 0) {
    vscode.window.showWarningMessage(`Open a workspace folder containing ${MINDCRAFT_JSON} first.`);
    return undefined;
  }
  return (await pickFolder(candidates))?.uri;
}

/**
 * Pick one folder from `folders`: the sole entry when only one is given,
 * else the user's quick-pick choice (undefined when dismissed).
 */
async function pickFolder(folders: readonly vscode.WorkspaceFolder[]): Promise<vscode.WorkspaceFolder | undefined> {
  if (folders.length === 1) {
    return folders[0];
  }
  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { placeHolder: "Select the project folder" }
  );
  return picked?.folder;
}
