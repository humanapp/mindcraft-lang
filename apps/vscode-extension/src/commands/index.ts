import * as vscode from "vscode";
import type { ProjectManager } from "../services/project-manager";
import { setMindcraftEnabled } from "../state/context";

export function registerCommands(context: vscode.ExtensionContext, projectManager: ProjectManager): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("mindcraft.show", () => {
      setMindcraftEnabled(true);
      vscode.commands.executeCommand("mindcraft.sessions.focus");
      vscode.window.showInformationMessage("Mindcraft view enabled.");
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

    vscode.commands.registerCommand("mindcraft.hide", () => {
      setMindcraftEnabled(false);
      vscode.window.showInformationMessage("Mindcraft view hidden.");
    })
  );
}
