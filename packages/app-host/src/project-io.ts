import type {
  MindcraftProjectDocument,
  MindcraftProjectDocumentValidationCode,
  MindcraftProjectDocumentValidationError,
  MindcraftProjectExtensions,
} from "@mindcraft-lang/service-api";
import { MINDCRAFT_PROJECT_FORMAT, parseMindcraftProjectDocument } from "@mindcraft-lang/service-api";
import { AppHostErrorCode, appHostError } from "./app-host-error.js";
import { MINDCRAFT_JSON_PATH } from "./mindcraft-json.js";
import { contentManifestFromManifest } from "./mindcraft-json-sync.js";
import type { ProjectContentManifest, ProjectContentManifestErrorCode } from "./project-content-manifest.js";
import { projectContentManifestToJson, validateProjectContentManifest } from "./project-content-manifest.js";
import type { ProjectFileSystemEntry } from "./project-file-snapshot.js";
import type { ProjectFileSystem } from "./project-file-system.js";
import type { ProjectManager } from "./project-manager.js";
import { DEFAULT_PROJECT_NAME } from "./project-manager.js";
import type { ProjectManifest } from "./project-manifest.js";

export type { MindcraftProjectDocument, MindcraftProjectExtensions } from "@mindcraft-lang/service-api";

/** App-data key holding the project's serialized brains, keyed by brain key. */
const BRAINS_APP_DATA_KEY = "brains";

/** App-data key holding the per-app session chunks, keyed by app name. */
const APP_CHUNKS_APP_DATA_KEY = "app";

/** Stable identifiers for import diagnostics produced by app-host. */
export const ImportDiagnosticCode = {
  IMPORT_FILE_TOO_LARGE: "IMPORT_FILE_TOO_LARGE",
  IMPORT_INVALID_BRAINS: "IMPORT_INVALID_BRAINS",
  IMPORT_INVALID_APP_CHUNKS: "IMPORT_INVALID_APP_CHUNKS",
  IMPORT_APP_TRANSLATION_FAILED: "IMPORT_APP_TRANSLATION_FAILED",
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

/** Result returned by an {@link ImportAppChunkCallback}. */
export interface ImportAppChunkResult {
  /** Diagnostics produced by the app translator. Any `error` aborts the import. */
  diagnostics: ImportDiagnostic[];
  /** Optional app-data entries to seed into the new project (key -> serialized value). */
  appData?: Record<string, string>;
}

/**
 * Hook invoked by {@link importProjectDocument} to validate and translate the
 * importing app's session chunk into project app-data.
 *
 * @param appChunk - The importing app's entry in the manifest's `app` chunk
 *   map, or `undefined` when the document carries none.
 */
export type ImportAppChunkCallback = (appChunk: unknown) => ImportAppChunkResult;

/** An app's session chunk to embed in an export document's manifest. */
export interface ExportAppChunk {
  /** App name the chunk is keyed under in the manifest's `app` map. */
  name: string;
  /** JSON-serializable session state owned by the app. */
  chunk: unknown;
}

/** Treats an empty extensions map as absent. */
function normalizeExtensions(
  extensions: MindcraftProjectExtensions | undefined
): MindcraftProjectExtensions | undefined {
  return extensions && Object.keys(extensions).length > 0 ? extensions : undefined;
}

async function loadAppDataRecord(
  loadAppData: (key: string) => Promise<string | undefined>,
  key: string
): Promise<Record<string, unknown>> {
  const raw = await loadAppData(key);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // parse failure -- use an empty record
  }
  return {};
}

/**
 * Build a shared `.mindcraft` project document from a project snapshot: the
 * project's content manifest embedded verbatim (carrying its brains and
 * per-app session chunks) plus the contents of its files.
 *
 * @param manifest - Project metadata the embedded manifest is projected from.
 * @param filesystem - Project files to include in the document.
 * @param loadAppData - App-data loader used for brains and stored app chunks.
 * @param options.appChunk - The exporting app's session chunk, keyed into the
 *   manifest's `app` map alongside any stored chunks from other apps.
 */
export async function buildProjectExportDocument(
  manifest: ProjectManifest,
  filesystem: ProjectFileSystem,
  loadAppData: (key: string) => Promise<string | undefined>,
  options?: {
    appChunk?: ExportAppChunk;
  }
): Promise<MindcraftProjectDocument> {
  const snapshot = filesystem.exportSnapshot();
  const contents: Record<string, string> = {};
  for (const [path, entry] of snapshot) {
    if (entry.kind !== "file") continue;
    if (entry.isReadonly) continue;
    if (path === MINDCRAFT_JSON_PATH) continue;
    contents[path] = entry.content;
  }

  const brains = await loadAppDataRecord(loadAppData, BRAINS_APP_DATA_KEY);
  const appChunks = await loadAppDataRecord(loadAppData, APP_CHUNKS_APP_DATA_KEY);
  if (options?.appChunk) {
    appChunks[options.appChunk.name] = options.appChunk.chunk;
  }

  const extras: Record<string, unknown> = {
    ...(Object.keys(brains).length > 0 ? { brains } : {}),
    ...(Object.keys(appChunks).length > 0 ? { app: appChunks } : {}),
  };
  const contentManifest: ProjectContentManifest = {
    ...contentManifestFromManifest(manifest),
    ...(Object.keys(extras).length > 0 ? { extras } : {}),
  };

  return {
    format: MINDCRAFT_PROJECT_FORMAT,
    manifest: projectContentManifestToJson(contentManifest),
    contents,
  };
}

/**
 * Build a shared `.mindcraft` project document for the active project managed
 * by `projectManager`.
 */
export async function buildActiveProjectExportDocument(
  projectManager: ProjectManager,
  options?: {
    appChunk?: ExportAppChunk;
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

function errorResult(code: ImportDiagnosticCode, message: string): ImportResult {
  return { success: false, projectId: undefined, diagnostics: [{ severity: "error", code, message }] };
}

function validationErrorResult(
  errors: readonly (
    | MindcraftProjectDocumentValidationError
    | { code: ProjectContentManifestErrorCode; path: string; message: string }
  )[]
): ImportResult {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildSnapshotFromContents(contents: Readonly<Record<string, string>>): Map<string, ProjectFileSystemEntry> {
  const snapshot = new Map<string, ProjectFileSystemEntry>();
  for (const [path, content] of Object.entries(contents)) {
    if (path === MINDCRAFT_JSON_PATH) continue;
    snapshot.set(path, {
      kind: "file",
      content,
      etag: crypto.randomUUID(),
      isReadonly: false,
    });
  }
  return snapshot;
}

function mapAppChunkDiagnostics(diagnostics: readonly ImportDiagnostic[]): ImportDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    if (diagnostic.severity === "error" && diagnostic.code === undefined) {
      return { ...diagnostic, code: ImportDiagnosticCode.IMPORT_APP_TRANSLATION_FAILED };
    }
    return diagnostic;
  });
}

/**
 * Import a project from a `.mindcraft` document: the embedded content manifest
 * is validated and extracted, its brains and app chunks are seeded into the
 * new project's app data, and the document's contents become the project's
 * files. The new project gets a freshly minted store id.
 *
 * @param file - The user-selected export file.
 * @param hostName - Importing app's identifier; selects its entry in the
 *   manifest's `app` chunk map.
 * @param projectManager - Manager used to create the new project.
 * @param options.maxFileSize - Override the {@link DEFAULT_MAX_FILE_SIZE} cap.
 * @param options.appChunkCallback - Hook to validate/translate the importing
 *   app's session chunk into app data.
 */
export async function importProjectDocument(
  file: File,
  hostName: string,
  projectManager: ProjectManager,
  options?: {
    maxFileSize?: number;
    appChunkCallback?: ImportAppChunkCallback;
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

    const parsed = parseMindcraftProjectDocument(await file.text());
    if (!parsed.ok) {
      return validationErrorResult(parsed.errors);
    }

    const manifestResult = validateProjectContentManifest(parsed.document.manifest);
    if (!manifestResult.ok) {
      return validationErrorResult(manifestResult.errors);
    }
    const manifest = manifestResult.manifest;

    const rawBrains = manifest.extras?.brains;
    if (rawBrains !== undefined && !isRecord(rawBrains)) {
      return errorResult(
        ImportDiagnosticCode.IMPORT_INVALID_BRAINS,
        'The manifest\'s "brains" chunk must be an object keyed by brain key.'
      );
    }
    const brains = (rawBrains as Record<string, unknown> | undefined) ?? {};

    const rawAppChunks = manifest.extras?.app;
    if (rawAppChunks !== undefined && !isRecord(rawAppChunks)) {
      return errorResult(
        ImportDiagnosticCode.IMPORT_INVALID_APP_CHUNKS,
        'The manifest\'s "app" chunk must be an object keyed by app name.'
      );
    }
    const appChunks = (rawAppChunks as Record<string, unknown> | undefined) ?? {};

    const appResult = options?.appChunkCallback?.(appChunks[hostName]);
    const appDiagnostics = appResult ? mapAppChunkDiagnostics(appResult.diagnostics) : [];
    const errors = appDiagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0) {
      return { success: false, projectId: undefined, diagnostics: appDiagnostics };
    }

    const appData: Record<string, string> = {
      ...appResult?.appData,
      ...(Object.keys(appChunks).length > 0 ? { [APP_CHUNKS_APP_DATA_KEY]: JSON.stringify(appChunks) } : {}),
      ...(Object.keys(brains).length > 0 ? { [BRAINS_APP_DATA_KEY]: JSON.stringify(brains) } : {}),
    };

    const name = manifest.name.trim() ? manifest.name.trim() : DEFAULT_PROJECT_NAME;
    const snapshot = buildSnapshotFromContents(parsed.document.contents);
    const created = await projectManager.createFromSnapshot(
      name,
      manifest.description ?? "",
      snapshot,
      appData,
      manifest.thumbnailUrl,
      normalizeExtensions(manifest.extensions),
      manifest.version
    );

    return { success: true, projectId: created.id, diagnostics: appDiagnostics };
  } catch (e) {
    const message = e instanceof Error ? e.message : "An unexpected error occurred during import.";
    return {
      success: false,
      projectId: undefined,
      diagnostics: [{ severity: "error", code: ImportDiagnosticCode.IMPORT_UNEXPECTED_ERROR, message }],
    };
  }
}
