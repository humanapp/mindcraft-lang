import type { FetchedExtensionSnapshot } from "@mindcraft-lang/app-host";
import type { FetchedExtensionContentMap } from "./embedded-extensions.js";

/** App-data key holding a project's installed fetched-extension snapshots. */
export const INSTALLED_EXTENSIONS_APP_DATA_KEY = "installed-extensions";

/**
 * One installed fetched dependency's persisted snapshot: the content of the
 * dependency together with the reference and resolved routing specifier it
 * was fetched at. The project store carries these records so `.extensions/`
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

/** Encode bytes as base64 text. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Decode base64 text into bytes. */
export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Build the persisted snapshot record for a fetched extension snapshot. */
export function installedSnapshotFromFetched(snapshot: FetchedExtensionSnapshot): InstalledExtensionSnapshot {
  const files: Record<string, string> = {};
  for (const file of snapshot.files) {
    files[file.path] = bytesToBase64(file.content);
  }
  return { reference: snapshot.reference, specifier: snapshot.specifier, files };
}

/** Decode a stored snapshot's files into the origin-relative text map resolution consumes (leading-slash paths). */
export function decodeInstalledSnapshotFiles(snapshot: InstalledExtensionSnapshot): Map<string, string> {
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  for (const [path, data] of Object.entries(snapshot.files)) {
    files.set(path.startsWith("/") ? path : `/${path}`, decoder.decode(base64ToBytes(data)));
  }
  return files;
}

/**
 * Build the fetched-content map resolution consumes from a project's stored
 * snapshot records, keyed by each record's reference.
 */
export function fetchedContentFromSnapshots(snapshots: InstalledExtensionSnapshots): FetchedExtensionContentMap {
  const content = new Map<string, ReadonlyMap<string, string>>();
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
