import {
  buildUnpackedTree,
  DEFAULT_MAX_FILE_SIZE,
  type ExtensionCatalogDocumentEntry,
  isUnpackRefusal,
  parseExtensionReference,
  seedProjectTargets,
} from "@mindcraft-lang/app-host";
import type { MindcraftProjectDocumentValidationError } from "@mindcraft-lang/service-api";
import { parseMindcraftProjectDocument } from "@mindcraft-lang/service-api";
import * as vscode from "vscode";
import { MINDCRAFT_JSON } from "../mindcraft-json";
import {
  activeFolderSessionFolder,
  disposeActiveFolderSession,
  openFolderProjectSession,
  revealFolderSessionEditor,
} from "../services/folder-session";
import {
  fileExists,
  findProjectFolderCandidates,
  readDeclaredTargetRanges,
  resolveFolderTargetDescriptor,
  resolveTargetAppRoot,
} from "../services/folder-target-resolver";
import { isSafeRelativePath } from "../services/path-confinement";
import { buildProjectSkeleton, DEV_TARGET_SETTING, readDevTargetDescriptor } from "../services/project-skeleton";
import { ensureCachedTargetApp, listLatestTargetRelease } from "../services/target-app-cache-host";
import {
  findTargetRegistryEntry,
  type ProjectTargetResolution,
  registryProjectSeed,
  resolveProjectTargetDescriptor,
  TargetResolutionErrorCode,
  targetRegistryEntries,
  targetRegistryPickItems,
} from "../services/target-registry";
import {
  applyTargetRangeToManifest,
  resolveTargetUpdateAction,
  specificAppRef,
  type TargetUpdateChoice,
  type TargetUpdateCommandResult,
  TargetUpdateOutcome,
  targetUpdateChoices,
} from "../services/target-update";
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
    vscode.commands.registerCommand("mindcraft.importProject", async () => {
      await importProject(context);
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
    }),
    vscode.commands.registerCommand("mindcraft.updateTarget", async () => updateTarget(context))
  );
}

/**
 * Update the project and its hosted editor to a chosen version of the project's
 * target. Resolves the target coordinate (the `mindcraft.devTarget` setting's
 * `appRef` when set, else the project manifest's registry-listed target), then
 * offers a quick-pick built from the bundled registry and the published version
 * listing: the registry-approved version, the highest published release when it
 * is newer, and a specific tag/SHA/`#branch`. The selection sets the manifest's
 * target range and either clears the `appRef` override (approved) or writes it
 * pinned at the chosen version (published or specific), then reopens the editor.
 * Resolves with the run's stable outcome code.
 */
async function updateTarget(context: vscode.ExtensionContext): Promise<TargetUpdateCommandResult> {
  const candidates = await findProjectFolderCandidates();
  if (candidates.length === 0) {
    vscode.window.showInformationMessage(`Open a workspace folder containing ${MINDCRAFT_JSON} first.`);
    return { outcome: TargetUpdateOutcome.NOT_APPLICABLE };
  }
  const folder = await pickFolder(candidates);
  if (!folder) {
    return { outcome: TargetUpdateOutcome.CANCELLED };
  }
  const coordinate = await resolveUpdateTargetCoordinate(folder.uri);
  if (coordinate === undefined) {
    vscode.window.showInformationMessage("This project resolves no target to update.");
    return { outcome: TargetUpdateOutcome.NOT_APPLICABLE };
  }
  const approvedVersion = findTargetRegistryEntry(coordinate)?.version;
  const listed = await listLatestTargetRelease(coordinate);
  const latestPublished = listed.ok ? listed.latestRelease : undefined;
  const choice = await pickUpdateChoice(targetUpdateChoices({ approvedVersion, latestPublished }));
  if (choice === undefined) {
    return { outcome: TargetUpdateOutcome.CANCELLED };
  }

  let action: ReturnType<typeof resolveTargetUpdateAction>;
  if (choice.kind === "approved") {
    action = resolveTargetUpdateAction({ kind: "approved", coordinate, version: choice.version });
  } else if (choice.kind === "published") {
    action = resolveTargetUpdateAction({ kind: "published", coordinate, version: choice.version });
  } else {
    const entered = (await promptSpecificReference())?.trim();
    if (!entered) {
      return { outcome: TargetUpdateOutcome.CANCELLED };
    }
    const appRef = specificAppRef(coordinate, entered);
    const ensured = await ensureCachedTargetApp(context, appRef);
    if (!ensured.ok) {
      vscode.window.showErrorMessage(`Could not fetch the target "${appRef}" (${ensured.code}): ${ensured.message}`);
      return { outcome: TargetUpdateOutcome.FETCH_FAILED };
    }
    action = resolveTargetUpdateAction({
      kind: "specific",
      coordinate,
      reference: entered,
      version: ensured.manifest.version,
    });
  }

  disposeActiveFolderSession();
  await writeTargetRange(folder.uri, action.coordinate, action.version);
  if (action.appRef.op === "clear") {
    await clearDevTargetAppRef();
  } else {
    await rewriteDevTargetAppRef(action.appRef.reference);
  }
  await openProjectFolder(context);
  vscode.window.showInformationMessage(`Updated ${action.coordinate} to ${action.version}.`);
  return {
    outcome: TargetUpdateOutcome.UPDATED,
    coordinate: action.coordinate,
    version: action.version,
    ...(action.appRef.op === "write" ? { appRef: action.appRef.reference } : {}),
  };
}

/**
 * The target coordinate the Update Target command acts on: the
 * `mindcraft.devTarget` setting's `appRef` coordinate when set, else the
 * project manifest's registry-membership match. Returns undefined when neither
 * yields a `gh:` coordinate.
 */
async function resolveUpdateTargetCoordinate(folderUri: vscode.Uri): Promise<string | undefined> {
  const appRef = readDevTargetDescriptor()?.appRef;
  if (appRef !== undefined) {
    return referenceCoordinate(appRef);
  }
  const declaredCoordinates = Object.keys(await readDeclaredTargetRanges(folderUri));
  const resolution = resolveProjectTargetDescriptor(undefined, declaredCoordinates, targetRegistryEntries());
  return resolution.ok && resolution.descriptor.appRef !== undefined
    ? referenceCoordinate(resolution.descriptor.appRef)
    : undefined;
}

/** The `<owner>/<repo>` coordinate of a `gh:` reference, or undefined for any other reference. */
function referenceCoordinate(reference: string): string | undefined {
  const parsed = parseExtensionReference(reference);
  return parsed?.transport === "gh" ? `${parsed.owner}/${parsed.repo}` : undefined;
}

let testUpdateChoiceKind: TargetUpdateChoice["kind"] | undefined;
let testUpdateSpecificInput: string | undefined;

/**
 * Test-only: preselect the Update Target quick-pick choice by kind
 * (`"approved"`, `"published"`, or `"specific"`), or clear the preselection
 * when `kind` is undefined.
 */
export function installTestTargetUpdatePick(kind: TargetUpdateChoice["kind"] | undefined): void {
  testUpdateChoiceKind = kind;
}

/**
 * Test-only: preseed the specific-version input box's value, or clear it when
 * `value` is undefined so the input box is shown.
 */
export function installTestTargetUpdateSpecificInput(value: string | undefined): void {
  testUpdateSpecificInput = value;
}

/**
 * Quick-pick one Update Target choice. Returns the choice matching the
 * test-installed kind when one is set; otherwise shows the quick-pick and
 * returns the picked choice, or undefined when dismissed.
 */
async function pickUpdateChoice(choices: readonly TargetUpdateChoice[]): Promise<TargetUpdateChoice | undefined> {
  if (testUpdateChoiceKind !== undefined) {
    return choices.find((choice) => choice.kind === testUpdateChoiceKind);
  }
  const picked = await vscode.window.showQuickPick(
    choices.map((choice) => ({ label: updateChoiceLabel(choice), choice })),
    { placeHolder: "Update the project's target" }
  );
  return picked?.choice;
}

/** The quick-pick caption for an Update Target choice. */
function updateChoiceLabel(choice: TargetUpdateChoice): string {
  switch (choice.kind) {
    case "approved":
      return `Latest stable (${choice.version})`;
    case "published":
      return `Latest development (${choice.version})`;
    case "specific":
      return "Specific version...";
  }
}

/**
 * Prompt for a specific target reference. Returns the test-installed value when
 * one is set; otherwise shows the input box and returns the entered text, or
 * undefined when dismissed.
 */
async function promptSpecificReference(): Promise<string | undefined> {
  if (testUpdateSpecificInput !== undefined) {
    return testUpdateSpecificInput;
  }
  return vscode.window.showInputBox({
    prompt: "Enter a version tag, commit SHA, or #branch",
    placeHolder: "v1.2.3",
  });
}

/**
 * Read-modify-write the project manifest in `folderUri`: set its target entry
 * for `coordinate` to a caret range at `latestVersion` through the content
 * manifest parse/serialize round trip, preserving every other field of the
 * document. Shows an error message and writes nothing when the document
 * cannot be read or does not parse as a content manifest.
 */
async function writeTargetRange(folderUri: vscode.Uri, coordinate: string, latestVersion: string): Promise<void> {
  const manifestUri = vscode.Uri.joinPath(folderUri, MINDCRAFT_JSON);
  let content: string;
  try {
    content = new TextDecoder().decode(await vscode.workspace.fs.readFile(manifestUri));
  } catch {
    vscode.window.showErrorMessage(`Could not read ${MINDCRAFT_JSON} to update its target entry.`);
    return;
  }
  const updated = applyTargetRangeToManifest(content, coordinate, latestVersion);
  if (!updated.ok) {
    vscode.window.showErrorMessage(`Could not update ${MINDCRAFT_JSON} (${updated.errorCode}): ${updated.message}`);
    return;
  }
  if (updated.changed) {
    await vscode.workspace.fs.writeFile(manifestUri, new TextEncoder().encode(updated.content));
  }
}

/**
 * Write the `mindcraft.devTarget` setting's `appRef` as `updatedAppRef`,
 * preserving the setting object's other fields. Writes at the configuration
 * scope where the setting is defined (workspace when a workspace value
 * exists, else user); when the setting is not defined at either scope, a
 * fresh workspace-scoped setting is written.
 */
async function rewriteDevTargetAppRef(updatedAppRef: string): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("mindcraft");
  const inspected = configuration.inspect<Record<string, unknown>>(DEV_TARGET_SETTING);
  const workspaceValue = inspected?.workspaceValue;
  const globalValue = inspected?.globalValue;
  const current = workspaceValue ?? globalValue ?? {};
  const target =
    workspaceValue === undefined && globalValue !== undefined
      ? vscode.ConfigurationTarget.Global
      : vscode.ConfigurationTarget.Workspace;
  await configuration.update(DEV_TARGET_SETTING, { ...current, appRef: updatedAppRef }, target);
}

/**
 * Remove the `mindcraft.devTarget` setting's `appRef` at the configuration
 * scope where the setting is defined, preserving the setting object's other
 * fields (for example `appPath`). Clears the whole setting when `appRef` was
 * its only field. Does nothing when no `appRef` is defined at either scope.
 */
async function clearDevTargetAppRef(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("mindcraft");
  const inspected = configuration.inspect<Record<string, unknown>>(DEV_TARGET_SETTING);
  const workspaceValue = inspected?.workspaceValue;
  const globalValue = inspected?.globalValue;
  const defined = workspaceValue ?? globalValue;
  if (defined === undefined || defined.appRef === undefined) {
    return;
  }
  const target =
    workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  const rest: Record<string, unknown> = { ...defined };
  delete rest.appRef;
  await configuration.update(DEV_TARGET_SETTING, Object.keys(rest).length > 0 ? rest : undefined, target);
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
  await hostProjectFolder(context, folder);
}

/**
 * Resolve `folder`'s declared target to its hosted app and open the folder's
 * editor session. Shows the target-resolution error message and opens nothing
 * when the folder declares no hostable target or its app cannot be loaded.
 */
async function hostProjectFolder(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): Promise<void> {
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

/**
 * Seed an empty workspace folder from a `.mindcraft` export and open its hosted
 * editor: prompt for the file, pick the target workspace folder, refuse a folder
 * that already holds a project, then unpack the document's embedded manifest to
 * `mindcraft.json` and its contents to the folder before hosting it. Surfaces a
 * stable error code for an unreadable, oversized, invalid, or unsafe document
 * and writes nothing in those cases.
 */
async function importProject(context: vscode.ExtensionContext): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { "Mindcraft Project": ["mindcraft"] },
  });
  const fileUri = picked?.[0];
  if (!fileUri) {
    return;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showErrorMessage("Open the folder to import the Mindcraft project into first.");
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

  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(fileUri);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Could not read ${fileUri.fsPath}: ${message}`);
    return;
  }
  if (bytes.byteLength > DEFAULT_MAX_FILE_SIZE) {
    vscode.window.showErrorMessage(`The project file exceeds the maximum size of ${DEFAULT_MAX_FILE_SIZE} bytes.`);
    return;
  }

  const parsed = parseMindcraftProjectDocument(new TextDecoder().decode(bytes));
  if (!parsed.ok) {
    vscode.window.showErrorMessage(importDocumentFailureMessage(parsed.errors));
    return;
  }
  const tree = buildUnpackedTree(parsed.document, undefined);
  if (isUnpackRefusal(tree)) {
    vscode.window.showErrorMessage(`${tree.code}: ${tree.message}`);
    return;
  }
  const unsafe = tree.files.find((file) => !isSafeRelativePath(file.path));
  if (unsafe !== undefined) {
    vscode.window.showErrorMessage(`The project file names an unsafe path "${unsafe.path}"; nothing was written.`);
    return;
  }

  for (const file of tree.files) {
    const slash = file.path.lastIndexOf("/");
    if (slash > 0) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, file.path.slice(0, slash)));
    }
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(folder.uri, file.path),
      new TextEncoder().encode(file.content)
    );
  }
  const manifestText = seedProjectTargets(tree.manifestText, targetRegistryEntries());
  await vscode.workspace.fs.writeFile(manifestUri, new TextEncoder().encode(manifestText));
  await hostProjectFolder(context, folder);
}

/** The user-facing message naming the stable codes of a rejected project document. */
function importDocumentFailureMessage(errors: readonly MindcraftProjectDocumentValidationError[]): string {
  const details = errors.map((error) => `${error.code} at ${error.path}: ${error.message}`).join(" ");
  return `The selected file is not a valid Mindcraft project document. ${details}`;
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
