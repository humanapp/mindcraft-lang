import * as vscode from "vscode";

export function createStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  item.text = "$(symbol-misc) Mindcraft";
  item.command = "mindcraft.show";
  item.show();

  context.subscriptions.push(item);
  return item;
}
