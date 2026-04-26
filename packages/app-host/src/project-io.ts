import type {
  MindcraftExportCommon,
  MindcraftExportFile,
  MindcraftExportHost,
} from "@mindcraft-lang/service-api";
import { EXAMPLES_FOLDER } from "./examples.js";
import { MINDCRAFT_JSON_PATH } from "./mindcraft-json.js";
import type { ProjectManager } from "./project-manager.js";
import { DEFAULT_PROJECT_NAME } from "./project-manager.js";
import type { ProjectManifest } from "./project-manifest.js";
import type { WorkspaceAdapter } from "./workspace-adapter.js";
import type { WorkspaceEntry } from "./workspace-snapshot.js";

export type {
  MindcraftExportCommon,
  MindcraftExportDocument,
  MindcraftExportFile,
  MindcraftExportHost,
} from "@mindcraft-lang/service-api";

export interface ImportDiagnostic {
  severity: "error" | "warning";
  message: string;
}

export interface ImportResult {
  success: boolean;
  projectId: string | undefined;
  diagnostics: ImportDiagnostic[];
}

export interface ImportAppLayerResult {
  diagnostics: ImportDiagnostic[];
  appData?: Record<string, string>;
}

export type ImportAppLayerCallback = (app: unknown, hostVersion: string) => ImportAppLayerResult;

export async function buildExportCommon(
  host: MindcraftExportHost,
  manifest: ProjectManifest,
  workspace: WorkspaceAdapter,
  loadAppData: (key: string) => Promise<string | undefined>
): Promise<MindcraftExportCommon> {
  const snapshot = workspace.exportSnapshot();
  const examplesPrefix = `${EXAMPLES_FOLDER}/`;

  const files: MindcraftExportFile[] = [];
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
    host,
    name: manifest.name,
    description: manifest.description,
    thumbnailUrl: manifest.thumbnailUrl,
    files,
    brains,
  };
}

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

function errorResult(message: string): ImportResult {
  return { success: false, projectId: undefined, diagnostics: [{ severity: "error", message }] };
}

function isValidFilePath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (path.includes("..")) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("\\")) return false;
  return true;
}

export async function importProject(
  file: File,
  hostName: string,
  hostVersion: string,
  projectManager: ProjectManager,
  options?: {
    maxFileSize?: number;
    appLayerCallback?: ImportAppLayerCallback;
  }
): Promise<ImportResult> {
  try {
    const maxSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    if (file.size > maxSize) {
      return errorResult(`File exceeds the maximum size of ${maxSize} bytes.`);
    }

    const text = await file.text();

    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return errorResult("The file is not valid JSON.");
    }

    const docHost = doc.host as Record<string, unknown> | undefined;
    if (docHost?.name !== hostName) {
      return errorResult(
        `This project was created by ${(docHost?.name as string) ?? "an unknown app"} and cannot be imported here.`
      );
    }

    const docHostVersion = docHost.version as string;
    if (typeof docHostVersion === "string" && compareSemver(docHostVersion, hostVersion) > 0) {
      return errorResult(
        `This project was exported by a newer version of ${hostName} (${docHostVersion}). Update the app before importing.`
      );
    }

    if (typeof doc.name !== "string") {
      return errorResult('Invalid export file: "name" must be a string.');
    }
    if (typeof doc.description !== "string") {
      return errorResult('Invalid export file: "description" must be a string.');
    }
    if (doc.thumbnailUrl !== undefined && typeof doc.thumbnailUrl !== "string") {
      return errorResult('Invalid export file: "thumbnailUrl" must be a string when present.');
    }
    if (!Array.isArray(doc.files)) {
      return errorResult('Invalid export file: "files" must be an array.');
    }
    if (doc.brains === null || typeof doc.brains !== "object" || Array.isArray(doc.brains)) {
      return errorResult('Invalid export file: "brains" must be an object.');
    }

    const name = typeof doc.name === "string" && doc.name.trim() ? doc.name.trim() : DEFAULT_PROJECT_NAME;
    const description = doc.description;
    const thumbnailUrl = typeof doc.thumbnailUrl === "string" ? doc.thumbnailUrl : undefined;

    const warnings: ImportDiagnostic[] = [];

    const snapshot = new Map<string, WorkspaceEntry>();
    for (const entry of doc.files as unknown[]) {
      const fileEntry = entry as Record<string, unknown>;
      if (typeof fileEntry?.path !== "string" || typeof fileEntry?.content !== "string") {
        warnings.push({ severity: "warning", message: `Skipped file entry with invalid path or content.` });
        continue;
      }
      if (!isValidFilePath(fileEntry.path)) {
        warnings.push({
          severity: "warning",
          message: `Skipped file with invalid path: "${fileEntry.path}".`,
        });
        continue;
      }
      snapshot.set(fileEntry.path, {
        kind: "file",
        content: fileEntry.content,
        etag: crypto.randomUUID(),
        isReadonly: false,
      });
    }

    let serializedBrains: string;
    try {
      serializedBrains = JSON.stringify(doc.brains);
    } catch {
      warnings.push({ severity: "warning", message: "Failed to serialize brains data. Using empty brains." });
      serializedBrains = "{}";
    }

    const callbackAppData: Record<string, string> = {};
    if (options?.appLayerCallback) {
      if (doc.app === undefined) {
        return errorResult("No app-specific data found in the export file.");
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

    const appData: Record<string, string> = { ...callbackAppData, brains: serializedBrains };

    const manifest = await projectManager.createFromSnapshot(name, description, snapshot, appData, thumbnailUrl);

    return { success: true, projectId: manifest.id, diagnostics: warnings };
  } catch (e) {
    const message = e instanceof Error ? e.message : "An unexpected error occurred during import.";
    return { success: false, projectId: undefined, diagnostics: [{ severity: "error", message }] };
  }
}
