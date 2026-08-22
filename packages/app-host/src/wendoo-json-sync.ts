import { fileContentText } from "@wendoo-lang/service-api";
import type { ExtensionTarget, ProjectContentManifest } from "./project-content-manifest.js";
import {
  parseProjectContentManifest,
  readExplicitContentManifestVersion,
  serializeProjectContentManifest,
} from "./project-content-manifest.js";
import type { ProjectFileSystem } from "./project-file-system.js";
import type { ProjectManifest } from "./project-manifest.js";
import { WENDOO_JSON_PATH } from "./wendoo-json.js";

/** Manifest fields that flow bidirectionally between the store and `wendoo.json`. */
type SyncedManifestFields = {
  name: string;
  version: string;
  description: string;
  thumbnailUrl?: string;
  extensions?: Readonly<Record<string, string>>;
  targets?: Readonly<Record<string, ExtensionTarget>>;
};

/** Treats an empty map as absent. */
function normalizeMap<T>(map: Readonly<Record<string, T>> | undefined): Readonly<Record<string, T>> | undefined {
  return map && Object.keys(map).length > 0 ? map : undefined;
}

function extensionsEqual(
  a: Readonly<Record<string, string>> | undefined,
  b: Readonly<Record<string, string>> | undefined
): boolean {
  const normalizedA = normalizeMap(a);
  const normalizedB = normalizeMap(b);
  if (normalizedA === undefined || normalizedB === undefined) {
    return normalizedA === normalizedB;
  }
  const keysA = Object.keys(normalizedA);
  return (
    keysA.length === Object.keys(normalizedB).length && keysA.every((key) => normalizedA[key] === normalizedB[key])
  );
}

function targetsEqual(
  a: Readonly<Record<string, ExtensionTarget>> | undefined,
  b: Readonly<Record<string, ExtensionTarget>> | undefined
): boolean {
  const normalizedA = normalizeMap(a);
  const normalizedB = normalizeMap(b);
  if (normalizedA === undefined || normalizedB === undefined) {
    return normalizedA === normalizedB;
  }
  const keysA = Object.keys(normalizedA);
  return (
    keysA.length === Object.keys(normalizedB).length &&
    keysA.every((key) => normalizedA[key]?.packageVersion === normalizedB[key]?.packageVersion)
  );
}

/** Project the store manifest onto the on-disk content manifest schema. */
export function contentManifestFromManifest(manifest: ProjectManifest): ProjectContentManifest {
  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    ...(manifest.thumbnailUrl !== undefined ? { thumbnailUrl: manifest.thumbnailUrl } : {}),
    extensions: manifest.extensions ?? {},
    ...(normalizeMap(manifest.targets) !== undefined ? { targets: manifest.targets } : {}),
  };
}

function contentManifestsEqual(a: ProjectContentManifest, b: ProjectContentManifest): boolean {
  return (
    a.name === b.name &&
    a.version === b.version &&
    (a.description ?? "") === (b.description ?? "") &&
    a.thumbnailUrl === b.thumbnailUrl &&
    extensionsEqual(a.extensions, b.extensions) &&
    targetsEqual(a.targets, b.targets)
  );
}

/**
 * Write the content manifest derived from `manifest` into the project file
 * system's `wendoo.json`, creating the file if it does not exist. Does
 * nothing if the file already matches the manifest.
 */
export function syncManifestToWendooJson(filesystem: ProjectFileSystem, manifest: ProjectManifest): void {
  const desired = contentManifestFromManifest(manifest);

  const snapshot = filesystem.exportSnapshot();
  const existing = snapshot.get(WENDOO_JSON_PATH);
  const existingText = existing?.kind === "file" ? fileContentText(existing.content) : undefined;
  if (existingText !== undefined) {
    const parsed = parseProjectContentManifest(existingText);
    if (parsed.ok && contentManifestsEqual(desired, parsed.manifest)) {
      return;
    }
  }

  filesystem.applyLocalChange({
    action: "write",
    path: WENDOO_JSON_PATH,
    content: serializeProjectContentManifest(desired),
    newEtag: `sync-${Date.now()}`,
  });
}

/**
 * Compute the patch needed to bring `manifest` into agreement with the synced
 * fields of a `wendoo.json` document. Returns `undefined` if the document
 * is unparseable or no fields differ.
 */
export function diffWendooJsonToManifest(
  content: string,
  manifest: ProjectManifest
): Partial<SyncedManifestFields> | undefined {
  const parsed = parseProjectContentManifest(content);
  if (!parsed.ok) {
    return undefined;
  }
  const incoming = parsed.manifest;

  const patch: Partial<SyncedManifestFields> = {};
  let hasChanges = false;

  if (incoming.name !== manifest.name && incoming.name.trim()) {
    patch.name = incoming.name;
    hasChanges = true;
  }
  const explicitVersion = readExplicitContentManifestVersion(content);
  if (explicitVersion !== undefined && explicitVersion !== manifest.version) {
    patch.version = explicitVersion;
    hasChanges = true;
  }
  if (incoming.description !== undefined && incoming.description !== manifest.description) {
    patch.description = incoming.description;
    hasChanges = true;
  }
  if (incoming.thumbnailUrl !== manifest.thumbnailUrl) {
    patch.thumbnailUrl = incoming.thumbnailUrl;
    hasChanges = true;
  }
  if (!extensionsEqual(incoming.extensions, manifest.extensions)) {
    patch.extensions = incoming.extensions ?? {};
    hasChanges = true;
  }
  if (!targetsEqual(incoming.targets, manifest.targets)) {
    patch.targets = incoming.targets ?? {};
    hasChanges = true;
  }

  return hasChanges ? patch : undefined;
}
