import type { FolderTargetDescriptor } from "./project-skeleton";

/** Stable identifiers for the reasons a folder session cannot be restored. */
export const RestoreFailureReason = {
  /** No `mindcraft.devTarget` is configured, so no app can be hosted. */
  NO_DEV_TARGET: "RESTORE_NO_DEV_TARGET",
  /** No workspace folder contains a `mindcraft.json` project to host. */
  NO_PROJECT_FOLDER: "RESTORE_NO_PROJECT_FOLDER",
  /** The configured target's app directory could not be resolved (for example an uncached published bundle offline). */
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
  /** The configured dev target, or undefined when none is set. */
  readonly descriptor: FolderTargetDescriptor | undefined;
  /** Workspace folders that contain a `mindcraft.json` project, in workspace order. */
  readonly projectFolders: readonly Folder[];
  /** Resolve the target's on-disk app root; undefined when it cannot be resolved. */
  readonly resolveAppRoot: (descriptor: FolderTargetDescriptor) => Promise<AppRoot | undefined>;
}

/**
 * Resolve the project folder and app root a folder session should be rebuilt
 * against, using the same descriptor, project-folder discovery, and app-root
 * resolution as an interactive open. The first project folder is chosen without
 * prompting; a workspace with none, no configured dev target, or an
 * unresolvable app root each yields the matching stable failure reason.
 */
export async function resolveRestoreTarget<Folder, AppRoot>(
  inputs: RestoreTargetInputs<Folder, AppRoot>
): Promise<RestoreTargetResolution<Folder, AppRoot>> {
  if (inputs.descriptor === undefined) {
    return { ok: false, reason: RestoreFailureReason.NO_DEV_TARGET };
  }
  const folder = inputs.projectFolders[0];
  if (folder === undefined) {
    return { ok: false, reason: RestoreFailureReason.NO_PROJECT_FOLDER };
  }
  const appRoot = await inputs.resolveAppRoot(inputs.descriptor);
  if (appRoot === undefined) {
    return { ok: false, reason: RestoreFailureReason.APP_ROOT_UNAVAILABLE };
  }
  return { ok: true, folder, appRoot };
}
