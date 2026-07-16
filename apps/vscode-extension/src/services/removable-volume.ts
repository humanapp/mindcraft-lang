import type { FolderSessionErrorCode as FolderSessionErrorCodeType } from "@mindcraft-lang/bridge-protocol";
import { FolderSessionErrorCode } from "@mindcraft-lang/bridge-protocol";

/** A directory under which mounted removable volumes appear. */
export interface RemovableVolumeRoot {
  /** Absolute path of the mount root. */
  path: string;
  /** True when volumes are nested one level deeper, under per-user directories. */
  perUser: boolean;
}

/** The platform-standard mount roots removable volumes are discovered under. */
export const DEFAULT_REMOVABLE_VOLUME_ROOTS: readonly RemovableVolumeRoot[] = [
  { path: "/Volumes", perUser: false },
  { path: "/media", perUser: true },
  { path: "/run/media", perUser: true },
];

/** File operations volume discovery and writing perform on the host machine. */
export interface RemovableVolumeFileAccess {
  /** True when `path` names an existing directory. */
  isDirectory(path: string): Promise<boolean>;
  /** Names of the immediate subdirectories of `path`; empty when it is missing or unreadable. */
  listSubdirectories(path: string): Promise<string[]>;
  /** Write a text file at `path`, replacing any existing content. */
  writeTextFile(path: string, contents: string): Promise<void>;
}

/** Outcome of one removable-volume write. */
export type RemovableVolumeWriteOutcome =
  | { ok: true }
  | { ok: false; code: FolderSessionErrorCodeType; message: string };

/**
 * Write `contents` as `filename` at the root of the mounted removable volume
 * named `volumeName`, searching the mount roots in order. Returns
 * `REMOVABLE_VOLUME_NOT_FOUND` when no mounted volume carries the name, or
 * `WRITE_FAILED` when the write fails.
 */
export async function writeFileToRemovableVolume(
  volumeName: string,
  filename: string,
  contents: string,
  access: RemovableVolumeFileAccess,
  mountRoots: readonly RemovableVolumeRoot[] = DEFAULT_REMOVABLE_VOLUME_ROOTS
): Promise<RemovableVolumeWriteOutcome> {
  const volume = await findVolumeDirectory(volumeName, access, mountRoots);
  if (volume === undefined) {
    return {
      ok: false,
      code: FolderSessionErrorCode.REMOVABLE_VOLUME_NOT_FOUND,
      message: `No mounted removable volume is named "${volumeName}"`,
    };
  }
  try {
    await access.writeTextFile(`${volume}/${filename}`, contents);
  } catch (error) {
    return {
      ok: false,
      code: FolderSessionErrorCode.WRITE_FAILED,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: true };
}

/** The directory of the named volume under the first mount root carrying it, or undefined. */
async function findVolumeDirectory(
  volumeName: string,
  access: RemovableVolumeFileAccess,
  mountRoots: readonly RemovableVolumeRoot[]
): Promise<string | undefined> {
  for (const root of mountRoots) {
    const candidates = root.perUser
      ? (await access.listSubdirectories(root.path)).map((user) => `${root.path}/${user}/${volumeName}`)
      : [`${root.path}/${volumeName}`];
    for (const candidate of candidates) {
      if (await access.isDirectory(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}
