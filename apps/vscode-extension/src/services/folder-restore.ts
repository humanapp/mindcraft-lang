import type { FolderTargetDescriptor } from "./project-skeleton";

/** Stable identifiers for the reasons a folder session cannot be restored. */
export const RestoreFailureReason = {
  /** No workspace folder contains a `mindcraft.json` project to host. */
  NO_PROJECT_FOLDER: "RESTORE_NO_PROJECT_FOLDER",
  /** Neither the devTarget override nor the project's declared targets resolve a hostable target. */
  NO_REGISTRY_MATCH: "RESTORE_NO_REGISTRY_MATCH",
  /** The resolved target's app directory could not be resolved (for example an uncached published bundle offline). */
  APP_ROOT_UNAVAILABLE: "RESTORE_APP_ROOT_UNAVAILABLE",
} as const;

/** Union of all {@link RestoreFailureReason} values. */
export type RestoreFailureReason = (typeof RestoreFailureReason)[keyof typeof RestoreFailureReason];

/**
 * Outcome of {@link resolveRestoreTarget}: the project folder and app root to
 * rebuild a session against, or a stable reason the session cannot be restored.
 */
export type RestoreTargetResolution<Folder, AppRoot> =
  | { readonly ok: true; readonly folder: Folder; readonly appRoot: AppRoot }
  | { readonly ok: false; readonly reason: RestoreFailureReason };

/** Inputs {@link resolveRestoreTarget} composes into a restore outcome. */
export interface RestoreTargetInputs<Folder, AppRoot> {
  /** Workspace folders that contain a `mindcraft.json` project, in workspace order. */
  readonly projectFolders: readonly Folder[];
  /**
   * Resolve the target descriptor the folder opens with: the devTarget
   * override when set, else the folder manifest's registry-listed target.
   * Undefined when neither resolves one.
   */
  readonly resolveDescriptor: (folder: Folder) => Promise<FolderTargetDescriptor | undefined>;
  /** Resolve the target's on-disk app root; undefined when it cannot be resolved. */
  readonly resolveAppRoot: (descriptor: FolderTargetDescriptor) => Promise<AppRoot | undefined>;
}

/**
 * Resolve the project folder and app root a folder session should be rebuilt
 * against, using the same project-folder discovery, target resolution, and
 * app-root resolution as an interactive open. The first project folder is
 * chosen without prompting; a workspace with no project folder, a project
 * resolving no target, or an unresolvable app root each yields the matching
 * stable failure reason.
 */
export async function resolveRestoreTarget<Folder, AppRoot>(
  inputs: RestoreTargetInputs<Folder, AppRoot>
): Promise<RestoreTargetResolution<Folder, AppRoot>> {
  const folder = inputs.projectFolders[0];
  if (folder === undefined) {
    return { ok: false, reason: RestoreFailureReason.NO_PROJECT_FOLDER };
  }
  const descriptor = await inputs.resolveDescriptor(folder);
  if (descriptor === undefined) {
    return { ok: false, reason: RestoreFailureReason.NO_REGISTRY_MATCH };
  }
  const appRoot = await inputs.resolveAppRoot(descriptor);
  if (appRoot === undefined) {
    return { ok: false, reason: RestoreFailureReason.APP_ROOT_UNAVAILABLE };
  }
  return { ok: true, folder, appRoot };
}
