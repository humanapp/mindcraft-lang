import type { MindcraftJson } from "./mindcraft-json.js";
import { MINDCRAFT_JSON_PATH, parseMindcraftJson, serializeMindcraftJson } from "./mindcraft-json.js";
import type { ProjectManifest } from "./project-manifest.js";
import type { WorkspaceAdapter } from "./workspace-adapter.js";

/** Identifies the host application when writing `mindcraft.json`. */
export interface MindcraftJsonHostInfo {
  /** Host application identifier (e.g. `"sim"`). */
  name: string;
  /** Semver string of the host application. */
  version: string;
}

type SyncedManifestFields = { name: string; description: string; thumbnailUrl?: string };

function syncedFieldsFromManifest(manifest: ProjectManifest): SyncedManifestFields {
  return { name: manifest.name, description: manifest.description, thumbnailUrl: manifest.thumbnailUrl };
}

function syncedFieldsMatch(a: SyncedManifestFields, b: SyncedManifestFields): boolean {
  return a.name === b.name && a.description === b.description && a.thumbnailUrl === b.thumbnailUrl;
}

/**
 * Write the synced fields from `manifest` into the workspace's `mindcraft.json`,
 * creating the file if it does not exist. Does nothing if the file already
 * matches the manifest.
 */
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

/**
 * Compute the patch needed to bring `manifest` into agreement with the synced
 * fields of a `mindcraft.json` document. Returns `undefined` if the document
 * is unparseable or no fields differ.
 */
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
  if (parsed.thumbnailUrl !== manifest.thumbnailUrl) {
    patch.thumbnailUrl = parsed.thumbnailUrl;
    hasChanges = true;
  }

  return hasChanges ? patch : undefined;
}
