import type { MindcraftJson } from "./mindcraft-json.js";
import { MINDCRAFT_JSON_PATH, parseMindcraftJson, serializeMindcraftJson } from "./mindcraft-json.js";
import type { ProjectManifest } from "./project-manifest.js";
import type { WorkspaceAdapter } from "./workspace-adapter.js";

export interface MindcraftJsonHostInfo {
  name: string;
  version: string;
}

type SyncedManifestFields = { name: string; description: string };

function syncedFieldsFromManifest(manifest: ProjectManifest): SyncedManifestFields {
  return { name: manifest.name, description: manifest.description };
}

function syncedFieldsMatch(a: SyncedManifestFields, b: SyncedManifestFields): boolean {
  return a.name === b.name && a.description === b.description;
}

export function syncManifestToMindcraftJson(
  workspace: WorkspaceAdapter,
  manifest: ProjectManifest,
  host: MindcraftJsonHostInfo
): void {
  const snapshot = workspace.exportSnapshot();
  const existing = snapshot.get(MINDCRAFT_JSON_PATH);

  const fields = syncedFieldsFromManifest(manifest);

  if (existing && existing.kind === "file") {
    const parsed = parseMindcraftJson(existing.content);
    if (parsed) {
      if (syncedFieldsMatch(fields, parsed)) {
        return;
      }
      workspace.applyLocalChange({
        action: "write",
        path: MINDCRAFT_JSON_PATH,
        content: serializeMindcraftJson({ ...parsed, ...fields }),
        newEtag: `sync-${Date.now()}`,
      });
      return;
    }
  }

  const json: MindcraftJson = {
    ...fields,
    host,
    version: "0.0.1",
  };

  workspace.applyLocalChange({
    action: "write",
    path: MINDCRAFT_JSON_PATH,
    content: serializeMindcraftJson(json),
    newEtag: `sync-${Date.now()}`,
  });
}

export function diffMindcraftJsonToManifest(
  content: string,
  manifest: ProjectManifest
): Partial<SyncedManifestFields> | undefined {
  const parsed = parseMindcraftJson(content);
  if (!parsed) {
    return undefined;
  }

  const patch: Partial<SyncedManifestFields> = {};
  let hasChanges = false;

  if (parsed.name !== manifest.name && parsed.name.trim()) {
    patch.name = parsed.name;
    hasChanges = true;
  }
  if (parsed.description !== manifest.description) {
    patch.description = parsed.description;
    hasChanges = true;
  }

  return hasChanges ? patch : undefined;
}
