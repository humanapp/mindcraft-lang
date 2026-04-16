import * as vscode from "vscode";
import { MINDCRAFT_EXAMPLE_SCHEME } from "../services/mindcraft-example-fs-provider";
import { EXAMPLES_FOLDER, MINDCRAFT_SCHEME } from "../services/mindcraft-fs-provider";
import type { ProjectManager } from "../services/project-manager";
import { isMindcraftEnabled, setMindcraftEnabled } from "../state/context";

const SENSOR_TEMPLATE = `import { Sensor } from "mindcraft";

export default Sensor({
  name: "my sensor",
  output: "boolean",
  // icon: "./my-sensor.svg",
  // docs: "./my-sensor.md",
  onExecute(ctx, params) {
    return false;
  },
});
`;

const ACTUATOR_TEMPLATE = `import { Actuator } from "mindcraft";

export default Actuator({
  name: "my actuator",
  // icon: "./my-actuator.svg",
  // docs: "./my-actuator.md",
  onExecute(ctx, params) {
  },
});
`;

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
      await createFileFromTemplate(projectManager, "my-sensor", SENSOR_TEMPLATE);
    }),

    vscode.commands.registerCommand("mindcraft.createActuator", async () => {
      await createFileFromTemplate(projectManager, "my-actuator", ACTUATOR_TEMPLATE);
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

    vscode.commands.registerCommand("mindcraft.openSettings", () => {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:mindcraft-lang.mindcraft-lang-vscode-extension"
      );
    }),

    vscode.commands.registerCommand("mindcraft.copyExampleToWorkspace", async (arg?: string | vscode.Uri) => {
      await copyExampleToWorkspace(projectManager, arg);
    })
  );
}

async function createFileFromTemplate(
  projectManager: ProjectManager,
  baseName: string,
  content: string
): Promise<void> {
  if (!projectManager.project) {
    vscode.window.showWarningMessage("Not connected to a Mindcraft session.");
    return;
  }

  const rootUri = vscode.Uri.from({ scheme: MINDCRAFT_SCHEME, path: "/" });
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(rootUri);
  } catch {
    entries = [];
  }

  const existingNames = new Set(entries.map(([name]) => name));
  const fileName = findUniqueName(baseName, existingNames);
  const fileUri = vscode.Uri.from({ scheme: MINDCRAFT_SCHEME, path: `/${fileName}` });

  await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));
  await vscode.commands.executeCommand("vscode.open", fileUri);
}

function findUniqueName(baseName: string, existing: Set<string>): string {
  const candidate = `${baseName}.ts`;
  if (!existing.has(candidate)) return candidate;

  for (let i = 2; ; i++) {
    const numbered = `${baseName} (${i}).ts`;
    if (!existing.has(numbered)) return numbered;
  }
}

async function resolveExampleFolder(
  projectManager: ProjectManager,
  arg?: string | vscode.Uri
): Promise<string | undefined> {
  if (typeof arg === "string") {
    return arg;
  }

  if (arg instanceof vscode.Uri) {
    const segments = arg.path.replace(/^\//, "").split("/");
    if (segments.length > 0 && segments[0]) {
      return segments[0];
    }
  }

  const fs = projectManager.project?.files.raw;
  if (!fs) return undefined;

  try {
    const entries = fs.list(EXAMPLES_FOLDER);
    const folders = entries
      .filter((e) => e.kind === "directory")
      .map((e) => e.name)
      .sort();

    if (folders.length === 0) {
      vscode.window.showInformationMessage("No examples available.");
      return undefined;
    }

    return vscode.window.showQuickPick(folders, {
      placeHolder: "Select an example to copy to your workspace",
    });
  } catch {
    return undefined;
  }
}

function findUniqueFolderName(baseName: string, existing: Set<string>): string {
  if (!existing.has(baseName)) return baseName;

  for (let i = 2; ; i++) {
    const candidate = `${baseName}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
}

async function copyExampleToWorkspace(projectManager: ProjectManager, arg?: string | vscode.Uri): Promise<void> {
  if (!projectManager.project) {
    vscode.window.showWarningMessage("Not connected to a Mindcraft session.");
    return;
  }

  const folder = await resolveExampleFolder(projectManager, arg);
  if (!folder) return;

  const fs = projectManager.project.files.raw;
  const examplePath = `${EXAMPLES_FOLDER}/${folder}`;

  let fileEntries: { name: string; content: string }[];
  try {
    const entries = fs.list(examplePath);
    fileEntries = entries
      .filter((e) => e.kind === "file")
      .map((e) => ({
        name: e.name,
        content: fs.read(`${examplePath}/${e.name}`),
      }));
  } catch {
    vscode.window.showErrorMessage(`Example '${folder}' not found.`);
    return;
  }

  if (fileEntries.length === 0) {
    vscode.window.showErrorMessage(`Example '${folder}' contains no files.`);
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
  const targetFolder = findUniqueFolderName(folder, existingNames);

  const writeFs = projectManager.project.files.toRemote;
  writeFs.mkdir(targetFolder);
  for (const file of fileEntries) {
    writeFs.write(`${targetFolder}/${file.name}`, file.content);
  }

  vscode.window.showInformationMessage(`Copied example '${folder}' to workspace as '${targetFolder}'.`);

  const mainTsName = `${folder.toLowerCase()}.ts`;
  const mainFile = fileEntries.find((f) => f.name.toLowerCase() === mainTsName);
  if (mainFile) {
    const fileUri = vscode.Uri.from({ scheme: MINDCRAFT_SCHEME, path: `/${targetFolder}/${mainFile.name}` });
    await vscode.commands.executeCommand("vscode.open", fileUri);
  }
}
