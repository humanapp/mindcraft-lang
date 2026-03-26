import * as vscode from "vscode";

export function setMindcraftEnabled(enabled: boolean): Thenable<void> {
  return vscode.commands.executeCommand("setContext", "mindcraft.enabled", enabled);
}
