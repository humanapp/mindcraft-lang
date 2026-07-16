import * as vscode from "vscode";

/** Settings key of the dev-override target descriptor. */
export const DEV_TARGET_SETTING = "devTarget";

/** Content version stamped on a newly created project skeleton. */
export const SKELETON_PROJECT_VERSION = "0.1.0";

/**
 * Dev-override description of the hosted target: where its built app lives
 * and what a new project of this target starts from.
 */
export interface FolderTargetDescriptor {
  /** Absolute path of the target app's built (dist) directory. */
  readonly appPath: string;
  /** Extension dependencies seeded into a new project, keyed by coordinate. */
  readonly extensions?: Readonly<Record<string, string>>;
  /** Platform-compatibility targets seeded into a new project. */
  readonly targets?: Readonly<Record<string, { readonly packageVersion: string }>>;
}

/**
 * Read the `mindcraft.devTarget` setting. Returns `undefined` when the
 * setting is absent or carries no usable `appPath`.
 */
export function readDevTargetDescriptor(): FolderTargetDescriptor | undefined {
  const raw = vscode.workspace.getConfiguration("mindcraft").get<Record<string, unknown>>(DEV_TARGET_SETTING);
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const appPath = raw.appPath;
  if (typeof appPath !== "string" || appPath.trim().length === 0) {
    return undefined;
  }
  const extensions = isStringRecord(raw.extensions) ? raw.extensions : undefined;
  const targets = isTargetsRecord(raw.targets) ? raw.targets : undefined;
  return {
    appPath: appPath.trim(),
    ...(extensions !== undefined ? { extensions } : {}),
    ...(targets !== undefined ? { targets } : {}),
  };
}

/**
 * Build the `mindcraft.json` text of a fresh project skeleton: name, initial
 * version, and the target descriptor's extension seed and compatibility
 * targets. The hosted app initializes the rest on its first boot.
 */
export function buildProjectSkeleton(
  name: string,
  descriptor: Pick<FolderTargetDescriptor, "extensions" | "targets">
): string {
  return JSON.stringify(
    {
      name,
      version: SKELETON_PROJECT_VERSION,
      ...(descriptor.extensions && Object.keys(descriptor.extensions).length > 0
        ? { extensions: descriptor.extensions }
        : {}),
      ...(descriptor.targets && Object.keys(descriptor.targets).length > 0 ? { targets: descriptor.targets } : {}),
    },
    null,
    2
  );
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isTargetsRecord(value: unknown): value is Readonly<Record<string, { readonly packageVersion: string }>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { packageVersion?: unknown }).packageVersion === "string"
    )
  );
}
