import type * as vscode from "vscode";

/**
 * A running project session: the extension-side owner of one project's
 * editing surfaces. Bridge mode (vscode-web, websocket relay) and folder mode
 * (desktop, workspace folder plus embedded app) each provide one.
 */
export type ProjectSession = vscode.Disposable;
