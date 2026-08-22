import * as vscode from "vscode";

let wendooEnabled = false;

export function isWendooEnabled(): boolean {
  return wendooEnabled;
}

export function setWendooEnabled(enabled: boolean): Thenable<void> {
  wendooEnabled = enabled;
  return vscode.commands.executeCommand("setContext", "wendoo.enabled", enabled);
}
