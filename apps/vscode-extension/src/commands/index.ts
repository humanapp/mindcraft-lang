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

    vscode.commands.registerCommand("mindcraft.connect", () => {
      vscode.window.showInformationMessage("Mindcraft: connect not yet implemented.");
    }),

    vscode.commands.registerCommand("mindcraft.hide", () => {
      setMindcraftEnabled(false);
      vscode.window.showInformationMessage("Mindcraft view hidden.");
    })
  );
}
