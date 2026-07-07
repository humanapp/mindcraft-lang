import type { AmbientFile, StdlibSourceFile } from "./types.js";

/**
 * Whether a mount's files are type declarations or compilable source.
 *
 * - `declaration`: `.d.ts` type declarations. Always in scope for the
 *   type checker (a compiler root), never emitted.
 * - `source`: compilable `.ts` modules, resolvable by user import and
 *   lowered through the ordinary import pipeline only when user code
 *   imports them.
 */
export type MountKind = "declaration" | "source";

/** One read-only file a mount presents, at its workspace-visible path. */
export interface MountFile {
  /** Workspace-visible path the file appears at, both in the vfs and the compiler. */
  path: string;
  /** Full file content. */
  content: string;
}

/**
 * Read-only content presented to a project's file system and compiler by a
 * declared provider. A mount's files appear at their {@link MountFile.path}
 * in the workspace read-only and non-persisted, and are compiler-controlled:
 * the workspace never owns or edits them.
 */
export interface Mount {
  /** Whether the files are type declarations or compilable source. */
  kind: MountKind;
  /** The read-only files this mount provides. */
  files: readonly MountFile[];
}

function normalizeMountPath(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}

/**
 * A declaration mount presenting the given ambient `.d.ts` files. Its files
 * are always in scope for the type checker.
 */
export function declarationMount(files: readonly AmbientFile[]): Mount {
  return { kind: "declaration", files: files.map((file) => ({ path: file.path, content: file.content })) };
}

/**
 * A source mount presenting the given compilable `.ts` modules. Its files are
 * resolvable by user import and compiled only when imported.
 */
export function sourceMount(files: readonly StdlibSourceFile[]): Mount {
  return { kind: "source", files: files.map((file) => ({ path: file.path, content: file.content })) };
}

/** The declaration mounts among `mounts`, in order. */
export function declarationMounts(mounts: readonly Mount[]): readonly Mount[] {
  return mounts.filter((mount) => mount.kind === "declaration");
}

/** The source mounts among `mounts`, in order. */
export function sourceMounts(mounts: readonly Mount[]): readonly Mount[] {
  return mounts.filter((mount) => mount.kind === "source");
}

/** Every file provided by `mounts`, in mount order then file order. */
export function mountedFiles(mounts: readonly Mount[]): readonly MountFile[] {
  const files: MountFile[] = [];
  for (const mount of mounts) {
    files.push(...mount.files);
  }
  return files;
}

/** True when some mount in `mounts` provides `path` (path compared workspace-relative). */
export function isMountedPath(path: string, mounts: readonly Mount[]): boolean {
  const normalized = normalizeMountPath(path);
  return mounts.some((mount) => mount.files.some((file) => normalizeMountPath(file.path) === normalized));
}
