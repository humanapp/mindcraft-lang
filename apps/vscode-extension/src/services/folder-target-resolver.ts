import * as vscode from "vscode";
import { MINDCRAFT_JSON } from "../mindcraft-json";
import type { FolderTargetDescriptor } from "./project-skeleton";
import { ensureCachedTargetApp } from "./target-app-cache-host";

/** True when `uri` names an existing regular file. */
export async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return stat.type === vscode.FileType.File;
  } catch {
    return false;
  }
}

/** The workspace folders that contain a `mindcraft.json` manifest, in workspace order. */
export async function findProjectFolderCandidates(): Promise<vscode.WorkspaceFolder[]> {
  const candidates: vscode.WorkspaceFolder[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (await fileExists(vscode.Uri.joinPath(folder.uri, MINDCRAFT_JSON))) {
      candidates.push(folder);
    }
  }
  return candidates;
}

/**
 * The directory whose app the session hosts: the local build at `appPath`
 * when set, else the cached bundle of the pinned `appRef`. Warns and returns
 * undefined when a published bundle cannot be fetched or cached.
 */
export async function resolveTargetAppRoot(
  context: vscode.ExtensionContext,
  descriptor: FolderTargetDescriptor
): Promise<vscode.Uri | undefined> {
  if (descriptor.appPath !== undefined) {
    return vscode.Uri.file(descriptor.appPath);
  }
  if (descriptor.appRef !== undefined) {
    const result = await ensureCachedTargetApp(context, descriptor.appRef);
    if (result.ok) {
      return result.appDir;
    }
    vscode.window.showErrorMessage(
      `Could not load the target app "${descriptor.appRef}" (${result.code}): ${result.message}`
    );
    return undefined;
  }
  return undefined;
}
