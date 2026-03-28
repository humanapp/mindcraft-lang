import * as vscode from "vscode";
import { setMindcraftEnabled } from "../state/context";
import type { MindcraftSessionsProvider } from "../views/mindcraftSessionsProvider";

export function registerCommands(context: vscode.ExtensionContext, sessionsProvider: MindcraftSessionsProvider): void {
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

      vscode.window.showInformationMessage(`Connecting to Mindcraft session "${code}" (not implemented yet).`);
    }),

    vscode.commands.registerCommand("mindcraft.hide", () => {
      setMindcraftEnabled(false);
      vscode.window.showInformationMessage("Mindcraft view hidden.");
    })
  );
}
