import * as vscode from "vscode";

let mindcraftEnabled = false;

export function isMindcraftEnabled(): boolean {
  return mindcraftEnabled;
}

export function setMindcraftEnabled(enabled: boolean): Thenable<void> {
  mindcraftEnabled = enabled;
  return vscode.commands.executeCommand("setContext", "mindcraft.enabled", enabled);
}
