import type { MindcraftJson } from "./mindcraft-json.js";
import { MINDCRAFT_JSON_PATH, parseMindcraftJson, serializeMindcraftJson } from "./mindcraft-json.js";
import type { ProjectFileSystem } from "./project-file-system.js";
import type { ProjectManifest } from "./project-manifest.js";

/** Identifies the host application when writing `mindcraft.json`. */
export interface MindcraftJsonHostInfo {
  /** Host application identifier (e.g. `"sim"`). */
  name: string;
  /** Semver string of the host application. */
  version: string;
}

type SyncedManifestFields = {
  name: string;
  description: string;
  thumbnailUrl?: string;
  extensions?: Readonly<Record<string, string>>;
};

/** Treats an empty extensions map as absent. */
function normalizeExtensions(
  extensions: Readonly<Record<string, string>> | undefined
): Readonly<Record<string, string>> | undefined {
  return extensions && Object.keys(extensions).length > 0 ? extensions : undefined;
}

function extensionsEqual(
  a: Readonly<Record<string, string>> | undefined,
  b: Readonly<Record<string, string>> | undefined
): boolean {
  const normalizedA = normalizeExtensions(a);
  const normalizedB = normalizeExtensions(b);
  if (normalizedA === undefined || normalizedB === undefined) {
    return normalizedA === normalizedB;
  }
  const keysA = Object.keys(normalizedA);
  return (
    keysA.length === Object.keys(normalizedB).length && keysA.every((key) => normalizedA[key] === normalizedB[key])
  );
}

function syncedFieldsFromManifest(manifest: ProjectManifest): SyncedManifestFields {
  return {
    name: manifest.name,
    description: manifest.description,
    thumbnailUrl: manifest.thumbnailUrl,
    extensions: normalizeExtensions(manifest.extensions),
  };
}

function syncedFieldsMatch(a: SyncedManifestFields, b: SyncedManifestFields): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.thumbnailUrl === b.thumbnailUrl &&
    extensionsEqual(a.extensions, b.extensions)
  );
}

/**
 * Write the synced fields from `manifest` into the project file system's `mindcraft.json`,
 * creating the file if it does not exist. Does nothing if the file already
 * matches the manifest.
 */
export function syncManifestToMindcraftJson(
  filesystem: ProjectFileSystem,
  manifest: ProjectManifest,
  host: MindcraftJsonHostInfo
): void {
  const snapshot = filesystem.exportSnapshot();
  const existing = snapshot.get(MINDCRAFT_JSON_PATH);

  const fields = syncedFieldsFromManifest(manifest);

  if (existing && existing.kind === "file") {
    const parsed = parseMindcraftJson(existing.content);
    if (parsed) {
      if (syncedFieldsMatch(fields, parsed)) {
        return;
      }
      filesystem.applyLocalChange({
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

  filesystem.applyLocalChange({
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
  if (!extensionsEqual(parsed.extensions, manifest.extensions)) {
    patch.extensions = parsed.extensions ?? {};
    hasChanges = true;
  }

  return hasChanges ? patch : undefined;
}
