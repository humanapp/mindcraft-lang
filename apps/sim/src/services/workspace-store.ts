import type { WorkspaceAdapter } from "@mindcraft-lang/bridge-app";
import { createLocalStorageWorkspace } from "@mindcraft-lang/bridge-app";
import { isCompilerControlledPath } from "@mindcraft-lang/ts-compiler";

let workspaceStore: WorkspaceAdapter | undefined;

export function initWorkspaceStore(): WorkspaceAdapter {
  if (!workspaceStore) {
    workspaceStore = createLocalStorageWorkspace({
      storageKey: "sim:vscode-bridge:filesystem",
      shouldExclude: isCompilerControlledPath,
    });
  }

  return workspaceStore;
}

export function getWorkspaceStore(): WorkspaceAdapter {
  return workspaceStore ?? initWorkspaceStore();
}
