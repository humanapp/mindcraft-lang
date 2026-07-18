import { parseProjectContentManifest } from "@mindcraft-lang/app-host";
import * as vscode from "vscode";
import { MINDCRAFT_JSON } from "../mindcraft-json";
import { type FolderTargetDescriptor, readDevTargetDescriptor } from "./project-skeleton";
import { ensureCachedTargetApp } from "./target-app-cache-host";
import { type ProjectTargetResolution, resolveProjectTargetDescriptor, targetRegistryEntries } from "./target-registry";

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
 * The target entries declared by the `targets` map of the project manifest in
 * `folderUri`, as coordinate to declared package-version range, in manifest
 * order. Returns an empty map when the manifest is missing, unreadable, or
 * invalid.
 */
export async function readDeclaredTargetRanges(folderUri: vscode.Uri): Promise<Readonly<Record<string, string>>> {
  let text: string;
  try {
    text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folderUri, MINDCRAFT_JSON)));
  } catch {
    return {};
  }
  const parsed = parseProjectContentManifest(text);
  if (!parsed.ok) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parsed.manifest.targets ?? {}).map(([coordinate, target]) => [coordinate, target.packageVersion])
  );
}

/**
 * Resolve the target descriptor the project folder at `folderUri` opens with:
 * the `mindcraft.devTarget` override when set, else the registry-listed target
 * declared by the folder's own project manifest.
 */
export async function resolveFolderTargetDescriptor(folderUri: vscode.Uri): Promise<ProjectTargetResolution> {
  return resolveProjectTargetDescriptor(
    readDevTargetDescriptor(),
    Object.keys(await readDeclaredTargetRanges(folderUri)),
    targetRegistryEntries()
  );
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
