import * as vscode from "vscode";
import { registerFolderCommands } from "./commands/folder-commands";
import { activateBridgeSession } from "./services/bridge-session";

export function activate(context: vscode.ExtensionContext) {
  // Mode is environment-keyed: the web UI runs bridge mode only, desktop runs
  // folder mode only. The context key gates command and view visibility.
  const isWebHost = vscode.env.uiKind === vscode.UIKind.Web;
  void vscode.commands.executeCommand("setContext", "mindcraft.webHost", isWebHost);
  if (isWebHost) {
    activateBridgeSession(context);
    return;
  }
  registerFolderCommands(context);
}

export function deactivate() {}
