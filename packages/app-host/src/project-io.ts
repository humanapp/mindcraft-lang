import type {
  MindcraftProjectDocument,
  MindcraftProjectDocumentValidationCode,
  MindcraftProjectDocumentValidationError,
  MindcraftProjectExtensions,
  MindcraftProjectFile,
  MindcraftProjectTargets,
} from "@mindcraft-lang/service-api";
import {
  MINDCRAFT_PROJECT_FORMAT,
  parseMindcraftProjectDocument,
  validateMindcraftProjectDocument,
} from "@mindcraft-lang/service-api";
import { AppHostErrorCode, appHostError } from "./app-host-error.js";
import { EXAMPLES_FOLDER } from "./examples.js";
import { MINDCRAFT_JSON_PATH } from "./mindcraft-json.js";
import type { ProjectContentManifestErrorCode } from "./project-content-manifest.js";
import { validateProjectExtensions } from "./project-content-manifest.js";
import type { ProjectFileSystemEntry } from "./project-file-snapshot.js";
import type { ProjectFileSystem } from "./project-file-system.js";
import type { ProjectManager } from "./project-manager.js";
import { DEFAULT_PROJECT_NAME } from "./project-manager.js";
import type { ProjectManifest } from "./project-manifest.js";

export type {
  MindcraftProjectDocument,
  MindcraftProjectExtensions,
  MindcraftProjectFile,
  MindcraftProjectTargets,
} from "@mindcraft-lang/service-api";

/** Stable identifiers for import diagnostics produced by app-host. */
export const ImportDiagnosticCode = {
  IMPORT_FILE_TOO_LARGE: "IMPORT_FILE_TOO_LARGE",
  IMPORT_HOST_MISMATCH: "IMPORT_HOST_MISMATCH",
  IMPORT_INVALID_BRAINS: "IMPORT_INVALID_BRAINS",
  IMPORT_INVALID_DESCRIPTION: "IMPORT_INVALID_DESCRIPTION",
  IMPORT_INVALID_FILE_ENTRY: "IMPORT_INVALID_FILE_ENTRY",
  IMPORT_INVALID_FILE_PATH: "IMPORT_INVALID_FILE_PATH",
  IMPORT_INVALID_FILES: "IMPORT_INVALID_FILES",
  IMPORT_INVALID_JSON: "IMPORT_INVALID_JSON",
  IMPORT_INVALID_NAME: "IMPORT_INVALID_NAME",
  IMPORT_INVALID_THUMBNAIL_URL: "IMPORT_INVALID_THUMBNAIL_URL",
  IMPORT_MISSING_APP_DATA: "IMPORT_MISSING_APP_DATA",
  IMPORT_NEWER_HOST_VERSION: "IMPORT_NEWER_HOST_VERSION",
  IMPORT_SERIALIZE_BRAINS_FAILED: "IMPORT_SERIALIZE_BRAINS_FAILED",
  IMPORT_SERIALIZE_TARGETS_FAILED: "IMPORT_SERIALIZE_TARGETS_FAILED",
  IMPORT_TARGET_TRANSLATION_FAILED: "IMPORT_TARGET_TRANSLATION_FAILED",
  IMPORT_UNEXPECTED_ERROR: "IMPORT_UNEXPECTED_ERROR",
} as const;

/** Union of all {@link ImportDiagnosticCode} values. */
export type ImportDiagnosticCode = (typeof ImportDiagnosticCode)[keyof typeof ImportDiagnosticCode];

/** A diagnostic produced while importing a project. */
export interface ImportDiagnostic {
  severity: "error" | "warning";
  /** Stable identifier for app-host import diagnostics. */
  code?: ImportDiagnosticCode | MindcraftProjectDocumentValidationCode | ProjectContentManifestErrorCode;
  message: string;
}

/** Result of {@link importProjectDocument}. */
export interface ImportResult {
  /** `true` when the project was created. `false` if any error diagnostics were produced. */
  success: boolean;
  /** Id of the newly created project, or `undefined` on failure. */
  projectId: string | undefined;
  /** Errors and warnings collected during import. */
  diagnostics: ImportDiagnostic[];
}

/** Result returned by an {@link ImportAppLayerCallback}. */
export interface ImportAppLayerResult {
  /** Diagnostics produced by the app layer. Any `error` aborts the import. */
  diagnostics: ImportDiagnostic[];
  /** Optional app-data entries to seed into the new project (key -> serialized value). */
  appData?: Record<string, string>;
}

/**
 * Hook invoked by {@link importProjectDocument} to validate and translate the host's
 * `app` payload into project app-data.
 *
 * @param app - The raw `app` field from the export document.
 * @param hostVersion - The semver of the host that produced the export.
 */
export type ImportAppLayerCallback = (app: unknown, hostVersion: string) => ImportAppLayerResult;

/** Result returned by an {@link ImportProjectTargetsCallback}. */
export interface ImportProjectTargetsResult {
  /** Diagnostics produced by the app target translator. Any `error` aborts the import. */
  diagnostics: ImportDiagnostic[];
  /** Optional app-data entries to seed into the new project (key -> serialized value). */
  appData?: Record<string, string>;
}

/**
 * Hook invoked by {@link importProjectDocument} to validate and translate shared
 * project `targets` payloads into app data.
 *
 * @param targets - All shared project target payloads keyed by package name.
 * @param appTarget - The target payload for `hostName`, when present.
 */
export type ImportProjectTargetsCallback = (
  targets: MindcraftProjectTargets,
  appTarget: unknown
) => ImportProjectTargetsResult;

/** App-data key used to store the shared project target map. */
export const PROJECT_TARGETS_APP_DATA_KEY = "targets";

interface ExportProjectData {
  name: string;
  description: string;
  thumbnailUrl?: string;
  files: MindcraftProjectFile[];
  brains: Record<string, unknown>;
  extensions?: MindcraftProjectExtensions;
}

/** Treats an empty extensions map as absent. */
function normalizeExtensions(
  extensions: MindcraftProjectExtensions | undefined
): MindcraftProjectExtensions | undefined {
  return extensions && Object.keys(extensions).length > 0 ? extensions : undefined;
}

/**
 * Collect the portable project data shared by legacy and shared export formats.
 */
async function buildExportProjectData(
  manifest: ProjectManifest,
  filesystem: ProjectFileSystem,
  loadAppData: (key: string) => Promise<string | undefined>
): Promise<ExportProjectData> {
  const snapshot = filesystem.exportSnapshot();
  const examplesPrefix = `${EXAMPLES_FOLDER}/`;

  const files: MindcraftProjectFile[] = [];
  for (const [path, entry] of snapshot) {
    if (entry.kind !== "file") continue;
    if (entry.isReadonly) continue;
    if (path === MINDCRAFT_JSON_PATH) continue;
    if (path.startsWith(examplesPrefix)) continue;
    files.push({ path, content: entry.content });
  }

  let brains: Record<string, unknown> = {};
  const raw = await loadAppData("brains");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        brains = parsed as Record<string, unknown>;
      }
    } catch {
      // parse failure -- use empty brains
    }
  }

  return {
    name: manifest.name,
    description: manifest.description,
    thumbnailUrl: manifest.thumbnailUrl,
    files,
    brains,
    extensions: normalizeExtensions(manifest.extensions),
  };
}

/**
 * Build a shared `.mindcraft` project document from a project snapshot.
 *
 * @param manifest - Project metadata used for document name fields.
 * @param filesystem - Project files to include in the document.
 * @param loadAppData - App-data loader used for shared brains and stored targets.
 * @param options.targets - Target payloads to write. When omitted, stored
 *   targets from app data are reused.
 */
export async function buildProjectExportDocument(
  manifest: ProjectManifest,
  filesystem: ProjectFileSystem,
  loadAppData: (key: string) => Promise<string | undefined>,
  options?: {
    targets?: MindcraftProjectTargets;
  }
): Promise<MindcraftProjectDocument> {
  const common = await buildExportProjectData(manifest, filesystem, loadAppData);
  const targets = options?.targets ?? (await loadStoredProjectTargets(loadAppData));

  return {
    format: MINDCRAFT_PROJECT_FORMAT,
    name: common.name,
    description: common.description,
    ...(common.thumbnailUrl !== undefined ? { thumbnailUrl: common.thumbnailUrl } : {}),
    files: common.files,
    brains: common.brains,
    targets,
    ...(common.extensions !== undefined ? { extensions: common.extensions } : {}),
  };
}

/**
 * Build a shared `.mindcraft` project document for the active project managed
 * by `projectManager`.
 */
export async function buildActiveProjectExportDocument(
  projectManager: ProjectManager,
  options?: {
    targets?: MindcraftProjectTargets;
  }
): Promise<MindcraftProjectDocument> {
  const active = projectManager.activeProject;
  if (!active) {
    throw appHostError(AppHostErrorCode.NO_ACTIVE_PROJECT, "No active project");
  }
  return buildProjectExportDocument(
    active.manifest,
    active.filesystem,
    (key) => projectManager.loadAppData(key),
    options
  );
}

/** Default upper bound on import file size, in bytes (5 MB). */
export const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

function errorResult(code: ImportDiagnosticCode, message: string): ImportResult {
  return { success: false, projectId: undefined, diagnostics: [{ severity: "error", code, message }] };
}

function validationErrorResult(errors: readonly MindcraftProjectDocumentValidationError[]): ImportResult {
  return {
    success: false,
    projectId: undefined,
    diagnostics: errors.map((error) => ({
      severity: "error",
      code: error.code,
      message: `${error.path}: ${error.message}`,
    })),
  };
}

function isValidFilePath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (path.includes("..")) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("\\")) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function loadStoredProjectTargets(
  loadAppData: (key: string) => Promise<string | undefined>
): Promise<MindcraftProjectTargets> {
  const raw = await loadAppData(PROJECT_TARGETS_APP_DATA_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // parse failure -- use empty targets
  }
  return {};
}

function serializeJsonRecord(
  value: Record<string, unknown>,
  fallbackCode: ImportDiagnosticCode
): {
  serialized: string;
  diagnostic?: ImportDiagnostic;
} {
  try {
    return { serialized: JSON.stringify(value) };
  } catch {
    return {
      serialized: "{}",
      diagnostic: {
        severity: "warning",
        code: fallbackCode,
        message: "Failed to serialize project data. Using an empty object.",
      },
    };
  }
}

function buildSnapshotFromFiles(files: readonly MindcraftProjectFile[]): Map<string, ProjectFileSystemEntry> {
  const snapshot = new Map<string, ProjectFileSystemEntry>();
  for (const entry of files) {
    snapshot.set(entry.path, {
      kind: "file",
      content: entry.content,
      etag: crypto.randomUUID(),
      isReadonly: false,
    });
  }
  return snapshot;
}

async function persistSharedProjectDocument(
  document: MindcraftProjectDocument,
  projectManager: ProjectManager,
  callbackAppData: Record<string, string>,
  warnings: ImportDiagnostic[]
): Promise<ImportResult> {
  const brainSerialization = serializeJsonRecord(
    document.brains as Record<string, unknown>,
    ImportDiagnosticCode.IMPORT_SERIALIZE_BRAINS_FAILED
  );
  if (brainSerialization.diagnostic) {
    warnings.push(brainSerialization.diagnostic);
  }

  const targetSerialization = serializeJsonRecord(
    document.targets as Record<string, unknown>,
    ImportDiagnosticCode.IMPORT_SERIALIZE_TARGETS_FAILED
  );
  if (targetSerialization.diagnostic) {
    warnings.push(targetSerialization.diagnostic);
  }

  const appData: Record<string, string> = {
    ...callbackAppData,
    [PROJECT_TARGETS_APP_DATA_KEY]: targetSerialization.serialized,
    brains: brainSerialization.serialized,
  };
  const name = document.name.trim() ? document.name.trim() : DEFAULT_PROJECT_NAME;
  const snapshot = buildSnapshotFromFiles(document.files);
  const manifest = await projectManager.createFromSnapshot(
    name,
    document.description,
    snapshot,
    appData,
    document.thumbnailUrl,
    normalizeExtensions(document.extensions)
  );

  return { success: true, projectId: manifest.id, diagnostics: warnings };
}

function makeLegacySharedDocument(
  doc: Record<string, unknown>,
  hostName: string,
  warnings: ImportDiagnostic[]
): MindcraftProjectDocument | ImportResult {
  if (typeof doc.name !== "string") {
    return errorResult(ImportDiagnosticCode.IMPORT_INVALID_NAME, 'Invalid export file: "name" must be a string.');
  }
  if (typeof doc.description !== "string") {
    return errorResult(
      ImportDiagnosticCode.IMPORT_INVALID_DESCRIPTION,
      'Invalid export file: "description" must be a string.'
    );
  }
  if (doc.thumbnailUrl !== undefined && typeof doc.thumbnailUrl !== "string") {
    return errorResult(
      ImportDiagnosticCode.IMPORT_INVALID_THUMBNAIL_URL,
      'Invalid export file: "thumbnailUrl" must be a string when present.'
    );
  }
  if (!Array.isArray(doc.files)) {
    return errorResult(ImportDiagnosticCode.IMPORT_INVALID_FILES, 'Invalid export file: "files" must be an array.');
  }
  if (doc.brains === null || typeof doc.brains !== "object" || Array.isArray(doc.brains)) {
    return errorResult(ImportDiagnosticCode.IMPORT_INVALID_BRAINS, 'Invalid export file: "brains" must be an object.');
  }

  const files: MindcraftProjectFile[] = [];
  for (const entry of doc.files) {
    const fileEntry = entry as Record<string, unknown>;
    if (typeof fileEntry?.path !== "string" || typeof fileEntry?.content !== "string") {
      warnings.push({
        severity: "warning",
        code: ImportDiagnosticCode.IMPORT_INVALID_FILE_ENTRY,
        message: "Skipped file entry with invalid path or content.",
      });
      continue;
    }
    if (!isValidFilePath(fileEntry.path)) {
      warnings.push({
        severity: "warning",
        code: ImportDiagnosticCode.IMPORT_INVALID_FILE_PATH,
        message: `Skipped file with invalid path: "${fileEntry.path}".`,
      });
      continue;
    }
    files.push({ path: fileEntry.path, content: fileEntry.content });
  }

  return {
    format: MINDCRAFT_PROJECT_FORMAT,
    name: doc.name,
    description: doc.description,
    ...(typeof doc.thumbnailUrl === "string" ? { thumbnailUrl: doc.thumbnailUrl } : {}),
    files,
    brains: doc.brains as Record<string, unknown>,
    targets: doc.app === undefined ? {} : { [hostName]: doc.app },
  };
}

function mapTargetCallbackDiagnostics(diagnostics: readonly ImportDiagnostic[]): ImportDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    if (diagnostic.severity === "error" && diagnostic.code === undefined) {
      return { ...diagnostic, code: ImportDiagnosticCode.IMPORT_TARGET_TRANSLATION_FAILED };
    }
    return diagnostic;
  });
}

/**
 * Import a project from a `.mindcraft` document. Shared project documents are
 * parsed by service-api; legacy `host`/`app` documents are normalized before
 * project data is persisted.
 *
 * @param file - The user-selected export file.
 * @param hostName - Expected host application identifier; imports from other
 *   hosts are rejected.
 * @param hostVersion - Current host semver; imports from newer hosts are
 *   rejected.
 * @param projectManager - Manager used to create the new project.
 * @param options.maxFileSize - Override the {@link DEFAULT_MAX_FILE_SIZE} cap.
 * @param options.appLayerCallback - Hook to validate/translate the export's
 *   `app` payload. If provided, the export must include an `app` field.
 */
export async function importProjectDocument(
  file: File,
  hostName: string,
  hostVersion: string,
  projectManager: ProjectManager,
  options?: {
    maxFileSize?: number;
    appLayerCallback?: ImportAppLayerCallback;
    targetsCallback?: ImportProjectTargetsCallback;
  }
): Promise<ImportResult> {
  try {
    const maxSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    if (file.size > maxSize) {
      return errorResult(
        ImportDiagnosticCode.IMPORT_FILE_TOO_LARGE,
        `File exceeds the maximum size of ${maxSize} bytes.`
      );
    }

    const text = await file.text();

    let doc: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text);
      if (!isRecord(parsed)) {
        return errorResult(ImportDiagnosticCode.IMPORT_INVALID_JSON, "The file is not a JSON object.");
      }
      doc = parsed;
    } catch {
      return errorResult(ImportDiagnosticCode.IMPORT_INVALID_JSON, "The file is not valid JSON.");
    }

    if ("format" in doc) {
      const parsed = parseMindcraftProjectDocument(text);
      if (!parsed.ok) {
        return validationErrorResult(parsed.errors);
      }

      if (parsed.document.extensions) {
        const extensionErrors = validateProjectExtensions(parsed.document.extensions);
        if (extensionErrors.length > 0) {
          return {
            success: false,
            projectId: undefined,
            diagnostics: extensionErrors.map((error) => ({
              severity: "error",
              code: error.code,
              message: `${error.path}: ${error.message}`,
            })),
          };
        }
      }

      const appResult = options?.targetsCallback?.(parsed.document.targets, parsed.document.targets[hostName]);
      const appDiagnostics = appResult ? mapTargetCallbackDiagnostics(appResult.diagnostics) : [];
      const errors = appDiagnostics.filter((diagnostic) => diagnostic.severity === "error");
      if (errors.length > 0) {
        return { success: false, projectId: undefined, diagnostics: appDiagnostics };
      }

      return await persistSharedProjectDocument(
        parsed.document,
        projectManager,
        appResult?.appData ?? {},
        appDiagnostics
      );
    }

    const docHost = doc.host as Record<string, unknown> | undefined;
    if (docHost?.name !== hostName) {
      return errorResult(
        ImportDiagnosticCode.IMPORT_HOST_MISMATCH,
        `This project was created by ${(docHost?.name as string) ?? "an unknown app"} and cannot be imported here.`
      );
    }

    const docHostVersion = docHost.version as string;
    if (typeof docHostVersion === "string" && compareSemver(docHostVersion, hostVersion) > 0) {
      return errorResult(
        ImportDiagnosticCode.IMPORT_NEWER_HOST_VERSION,
        `This project was exported by a newer version of ${hostName} (${docHostVersion}). Update the app before importing.`
      );
    }

    const warnings: ImportDiagnostic[] = [];
    const document = makeLegacySharedDocument(doc, hostName, warnings);
    if ("success" in document) {
      return document;
    }

    const callbackAppData: Record<string, string> = {};
    if (options?.appLayerCallback) {
      if (doc.app === undefined) {
        return errorResult(
          ImportDiagnosticCode.IMPORT_MISSING_APP_DATA,
          "No app-specific data found in the export file."
        );
      }
      const appResult = options.appLayerCallback(doc.app, docHostVersion);
      const errors = appResult.diagnostics.filter((d) => d.severity === "error");
      if (errors.length > 0) {
        return { success: false, projectId: undefined, diagnostics: appResult.diagnostics };
      }
      warnings.push(...appResult.diagnostics);
      if (appResult.appData) {
        for (const [key, value] of Object.entries(appResult.appData)) {
          callbackAppData[key] = value;
        }
      }
    }

    const validation = validateMindcraftProjectDocument(document);
    if (!validation.ok) {
      return validationErrorResult(validation.errors);
    }

    return await persistSharedProjectDocument(validation.document, projectManager, callbackAppData, warnings);
  } catch (e) {
    const message = e instanceof Error ? e.message : "An unexpected error occurred during import.";
    return {
      success: false,
      projectId: undefined,
      diagnostics: [{ severity: "error", code: ImportDiagnosticCode.IMPORT_UNEXPECTED_ERROR, message }],
    };
  }
}
