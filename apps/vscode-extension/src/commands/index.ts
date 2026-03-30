import * as vscode from "vscode";
import { MINDCRAFT_SCHEME } from "../services/mindcraft-fs-provider";
import type { ProjectManager } from "../services/project-manager";
import { isMindcraftEnabled, setMindcraftEnabled } from "../state/context";

export function registerCommands(context: vscode.ExtensionContext, projectManager: ProjectManager): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("mindcraft.show", () => {
      const wasHidden = !isMindcraftEnabled();
      setMindcraftEnabled(true);
      vscode.commands.executeCommand("mindcraft.sessions.focus");
      if (wasHidden) {
        vscode.window.showInformationMessage("Mindcraft view enabled.");
      } else if (!projectManager.project) {
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
      await createFileFromTemplate(projectManager, "MySensor", "// Sensor code goes here\n");
    }),

    vscode.commands.registerCommand("mindcraft.createActuator", async () => {
      await createFileFromTemplate(projectManager, "MyActuator", "// Actuator code goes here\n");
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
