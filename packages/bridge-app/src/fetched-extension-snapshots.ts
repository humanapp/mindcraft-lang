import type { FetchedExtensionSnapshot, FileContent } from "@mindcraft-lang/app-host";
import { base64ToBytes, bytesToBase64, fileContentFromBytes, fileContentToBytes } from "@mindcraft-lang/app-host";
import type { FolderInstalledExtensionMetadata } from "@mindcraft-lang/bridge-protocol";
import { EXTENSIONS_TREE_PATH } from "@mindcraft-lang/bridge-protocol";
import type { FetchedExtensionContentMap } from "./embedded-extensions.js";

/** App-data key holding a project's installed fetched-extension snapshots. */
export const INSTALLED_EXTENSIONS_APP_DATA_KEY = "installed-extensions";

/**
 * One installed fetched dependency's persisted snapshot: the content of the
 * dependency together with the reference and resolved routing specifier it
 * was fetched at. The project store carries these records so `.libraries/`
 * regenerates on load without reaching the network.
 */
export interface InstalledExtensionSnapshot {
  /** The manifest reference the snapshot was installed from, as written. */
  readonly reference: string;
  /**
   * The immutable routing specifier the content was fetched at: the
   * reference's `@` pin as written, or the commit SHA a `#branch` reference
   * resolved to.
   */
  readonly specifier: string;
  /** Extension-relative path (no leading slash) mapped to base64 content bytes. */
  readonly files: Readonly<Record<string, string>>;
}

/** A project's installed fetched-extension snapshots, keyed by `<owner>/<repo>` coordinate. */
export type InstalledExtensionSnapshots = Readonly<Record<string, InstalledExtensionSnapshot>>;

/** Build the persisted snapshot record for a fetched extension snapshot. */
export function installedSnapshotFromFetched(snapshot: FetchedExtensionSnapshot): InstalledExtensionSnapshot {
  const files: Record<string, string> = {};
  for (const file of snapshot.files) {
    files[file.path] = bytesToBase64(file.content);
  }
  return { reference: snapshot.reference, specifier: snapshot.specifier, files };
}

/** Decode a stored snapshot's files into the origin-relative content map resolution consumes (leading-slash paths). */
export function decodeInstalledSnapshotFiles(snapshot: InstalledExtensionSnapshot): Map<string, FileContent> {
  const files = new Map<string, FileContent>();
  for (const [path, data] of Object.entries(snapshot.files)) {
    files.set(path.startsWith("/") ? path : `/${path}`, fileContentFromBytes(base64ToBytes(data)));
  }
  return files;
}

/**
 * Build the fetched-content map resolution consumes from a project's stored
 * snapshot records, keyed by each record's reference.
 */
export function fetchedContentFromSnapshots(snapshots: InstalledExtensionSnapshots): FetchedExtensionContentMap {
  const content = new Map<string, ReadonlyMap<string, FileContent>>();
  for (const snapshot of Object.values(snapshots)) {
    content.set(snapshot.reference, decodeInstalledSnapshotFiles(snapshot));
  }
  return content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInstalledExtensionSnapshot(value: unknown): value is InstalledExtensionSnapshot {
  if (!isRecord(value)) return false;
  if (typeof value.reference !== "string" || typeof value.specifier !== "string") return false;
  if (!isRecord(value.files)) return false;
  return Object.values(value.files).every((entry) => typeof entry === "string");
}

/**
 * Parse a project's stored snapshot records from their app-data text. Returns
 * an empty record when the text is absent or malformed; individual malformed
 * entries are dropped.
 */
export function parseInstalledExtensionSnapshots(raw: string | undefined): InstalledExtensionSnapshots {
  if (raw === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const snapshots: Record<string, InstalledExtensionSnapshot> = {};
  for (const [coordinate, entry] of Object.entries(parsed)) {
    if (isInstalledExtensionSnapshot(entry)) {
      snapshots[coordinate] = entry;
    }
  }
  return snapshots;
}

/** Serialize a project's snapshot records to their app-data text. */
export function serializeInstalledExtensionSnapshots(snapshots: InstalledExtensionSnapshots): string {
  return JSON.stringify(snapshots);
}

/**
 * Extract each snapshot record's install provenance, keyed by `<owner>/<repo>`
 * origin.
 */
export function installedExtensionMetadataFromSnapshots(
  snapshots: InstalledExtensionSnapshots
): Record<string, FolderInstalledExtensionMetadata> {
  const metadata: Record<string, FolderInstalledExtensionMetadata> = {};
  for (const [origin, snapshot] of Object.entries(snapshots)) {
    metadata[origin] = { reference: snapshot.reference, specifier: snapshot.specifier };
  }
  return metadata;
}

/**
 * Parse an installed-extensions metadata record from its JSON text. Returns an
 * empty record when the text is absent or malformed; individual malformed
 * entries are dropped.
 */
export function parseInstalledExtensionMetadata(
  raw: string | undefined
): Record<string, FolderInstalledExtensionMetadata> {
  if (raw === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const metadata: Record<string, FolderInstalledExtensionMetadata> = {};
  for (const [origin, entry] of Object.entries(parsed)) {
    if (isRecord(entry) && typeof entry.reference === "string" && typeof entry.specifier === "string") {
      metadata[origin] = { reference: entry.reference, specifier: entry.specifier };
    }
  }
  return metadata;
}

/**
 * Rebuild a project's installed snapshot records from a materialized
 * installed-extensions tree and its recorded install provenance. For each
 * origin in `metadata`, the tree's files under
 * `.libraries/<owner>/<repo>/` become the record's content at the recorded
 * reference and specifier; an origin with no files in the tree yields no
 * record.
 *
 * @param metadata - Install provenance per origin, as recorded beside the tree.
 * @param treeFiles - Project-relative path/content pairs of the tree's files.
 */
export function reconstructInstalledSnapshotsFromTree(
  metadata: Readonly<Record<string, FolderInstalledExtensionMetadata>>,
  treeFiles: ReadonlyArray<[string, FileContent]>
): InstalledExtensionSnapshots {
  const snapshots: Record<string, InstalledExtensionSnapshot> = {};
  for (const [origin, provenance] of Object.entries(metadata)) {
    const prefix = `${EXTENSIONS_TREE_PATH}/${origin}/`;
    const files: Record<string, string> = {};
    let hasFiles = false;
    for (const [path, content] of treeFiles) {
      if (!path.startsWith(prefix)) continue;
      files[path.slice(prefix.length)] = bytesToBase64(fileContentToBytes(content));
      hasFiles = true;
    }
    if (!hasFiles) continue;
    snapshots[origin] = { reference: provenance.reference, specifier: provenance.specifier, files };
  }
  return snapshots;
}
