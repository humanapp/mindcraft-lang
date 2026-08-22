import type {
  ExtensionFetchResult,
  ExtensionFetchTransport,
  FetchedExtensionFile,
  ProjectContentManifest,
  ProjectContentManifestParseResult,
} from "@wendoo/app-host";
import { WENDOO_JSON } from "../wendoo-json";
import { isSafeRelativePath } from "./path-confinement";

/** Path segment under which cached target apps are keyed within the cache root. */
const TARGETS_SEGMENT = "targets";

/** Maximum number of app-bundle files fetched in flight at once. */
export const APP_BUNDLE_FETCH_CONCURRENCY = 8;

/** Stable identifiers for target-app cache failures. */
export const TargetAppCacheErrorCode = {
  /** The snapshot or an app-bundle file could not be fetched from the transport. */
  FETCH_FAILED: "TARGET_APP_CACHE_FETCH_FAILED",
  /** The fetched (or cached) manifest declares no host-served app. */
  MANIFEST_HAS_NO_APP: "TARGET_APP_CACHE_MANIFEST_HAS_NO_APP",
  /** A content-declared path failed traversal validation; nothing was written. */
  SNAPSHOT_PATH_UNSAFE: "TARGET_APP_CACHE_SNAPSHOT_PATH_UNSAFE",
} as const;

/** Union of all {@link TargetAppCacheErrorCode} values. */
export type TargetAppCacheErrorCode = (typeof TargetAppCacheErrorCode)[keyof typeof TargetAppCacheErrorCode];

/**
 * File operations the cache performs against the cache root, addressing files
 * by cache-root-relative POSIX path.
 */
export interface TargetAppCacheFileAccess {
  /** Read a text file under the cache root; undefined when missing or unreadable. */
  readTextFile(relPath: string): Promise<string | undefined>;
  /** Write bytes at `relPath` under the cache root, creating missing parent directories. */
  writeFile(relPath: string, content: Uint8Array): Promise<void>;
}

/** Progress of an in-flight app-bundle download. */
export interface TargetAppCacheProgress {
  /** Display name of the target being downloaded: the manifest's `name`, or the coordinate when the name is empty. */
  readonly displayName: string;
  /** Number of bundle files fetched so far. */
  readonly completed: number;
  /** Total number of bundle files to fetch. */
  readonly total: number;
}

/** Listener invoked once when a bundle download starts and once per fetched file. */
export type TargetAppCacheProgressListener = (progress: TargetAppCacheProgress) => void;

/**
 * The extension-fetch operations the cache depends on, injected so the core
 * stays free of the app-host runtime, VS Code, and the network.
 */
export interface TargetAppSource {
  /**
   * The coordinate and immutable specifier a reference keys to offline, or
   * undefined when the reference is not an offline-keyable pinned reference (a
   * branch reference resolves its specifier only by fetching).
   */
  pinnedKey(reference: string): { readonly coordinate: string; readonly specifier: string } | undefined;
  /** Fetch the snapshot (content manifest and top-level files) for a reference. */
  fetchSnapshot(reference: string): Promise<ExtensionFetchResult>;
  /** Parse a cached manifest's JSON text. */
  parseManifest(text: string): ProjectContentManifestParseResult;
}

/** Result of {@link ensureCachedTargetAppInStore}. */
export type EnsureCachedTargetAppResult =
  | {
      /** True when the app directory was resolved. */
      readonly ok: true;
      /** Cache-root-relative path of the directory whose `index.html` the host serves. */
      readonly appDir: string;
      /** The cached target package's parsed content manifest. */
      readonly manifest: ProjectContentManifest;
    }
  | {
      readonly ok: false;
      /** Stable machine-readable failure code. */
      readonly code: TargetAppCacheErrorCode;
      /** Human-readable failure message. */
      readonly message: string;
    };

type Failure = Extract<EnsureCachedTargetAppResult, { ok: false }>;

/**
 * The cache-root-relative directory a coordinate and immutable specifier key
 * to (`targets/<coordinate>/<specifier>`), or undefined when the derived path
 * would escape the cache root.
 */
export function deriveTargetAppCacheDir(coordinate: string, specifier: string): string | undefined {
  const relPath = `${TARGETS_SEGMENT}/${coordinate}/${specifier}`;
  return isSafeRelativePath(relPath) ? relPath : undefined;
}

/** Join a cache-root-relative directory and a content-relative path with `/`. */
function joinRelative(dir: string, path: string): string {
  return `${dir}/${path}`;
}

function unsafePath(message: string): Failure {
  return { ok: false, code: TargetAppCacheErrorCode.SNAPSHOT_PATH_UNSAFE, message };
}

/**
 * Resolve the served app directory from a manifest, keyed under `cacheDir`.
 * Fails when the manifest declares no app, or when its `app.path` would escape
 * the cache root.
 */
function resolveAppDir(manifest: ProjectContentManifest, cacheDir: string): EnsureCachedTargetAppResult {
  const hostApp = manifest.hostApp;
  if (hostApp === undefined) {
    return {
      ok: false,
      code: TargetAppCacheErrorCode.MANIFEST_HAS_NO_APP,
      message: "The target package declares no host-served app.",
    };
  }
  if (!isSafeRelativePath(hostApp.path)) {
    return unsafePath(`The target app path "${hostApp.path}" escapes the cache root.`);
  }
  return { ok: true, appDir: joinRelative(cacheDir, hostApp.path), manifest };
}

/**
 * Fetch every host-app-bundle file listed by `appFiles` at the immutable
 * `specifier`, after validating each path. Files are fetched concurrently,
 * with at most {@link APP_BUNDLE_FETCH_CONCURRENCY} in flight; `onFileFetched`
 * is invoked with `(0, total)` before fetching starts and with the running
 * completed count after each fetched file. Returns a traversal failure with no
 * fetches on the first unsafe path, or a fetch failure (starting no further
 * fetches) when the transport cannot retrieve a file.
 */
async function fetchAppBundle(
  transport: ExtensionFetchTransport,
  coordinate: string,
  specifier: string,
  appFiles: readonly string[],
  onFileFetched?: (completed: number, total: number) => void
): Promise<{ ok: true; files: FetchedExtensionFile[] } | Failure> {
  const slash = coordinate.indexOf("/");
  const owner = coordinate.slice(0, slash);
  const repo = coordinate.slice(slash + 1);
  for (const path of appFiles) {
    if (!isSafeRelativePath(path)) {
      return unsafePath(`The app bundle names a file path "${path}" that escapes the cache root; nothing was written.`);
    }
  }
  if (appFiles.length === 0) {
    return { ok: true, files: [] };
  }
  onFileFetched?.(0, appFiles.length);
  const files: FetchedExtensionFile[] = [];
  let nextIndex = 0;
  let failure: Failure | undefined;
  const worker = async (): Promise<void> => {
    while (failure === undefined && nextIndex < appFiles.length) {
      const path = appFiles[nextIndex];
      nextIndex++;
      const result = await transport.fetchFile(owner, repo, specifier, path);
      if (!result.ok) {
        failure = {
          ok: false,
          code: TargetAppCacheErrorCode.FETCH_FAILED,
          message: `The app bundle file "${path}" could not be fetched at "${specifier}".`,
        };
        return;
      }
      files.push({ path, content: result.content });
      onFileFetched?.(files.length, appFiles.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(APP_BUNDLE_FETCH_CONCURRENCY, appFiles.length) }, worker));
  return failure ?? { ok: true, files };
}

/**
 * Ensure the target app named by `reference` is cached under the store, and
 * return the cache-root-relative directory whose `index.html` the host serves
 * together with the package's parsed content manifest.
 *
 * On a cache hit -- the keyed directory carries a readable manifest resolving
 * an app directory -- the app directory is resolved from that cached manifest
 * without touching `source` or `transport`. Anything less, including a
 * population interrupted before its manifest was written, is a miss: the
 * snapshot's manifest is fetched, its declared app bundle is fetched, every
 * content-declared path is validated, and the bundle is written under the
 * keyed directory with the manifest written last, completing the cache entry.
 * A snapshot naming any escaping path is rejected and nothing is written.
 *
 * @param access - File operations against the cache root.
 * @param reference - A pinned `gh:<owner>/<repo>@<pin>` (or `#branch`) reference.
 * @param source - The extension-fetch operations a cache miss resolves through.
 * @param transport - The transport the app bundle's files are fetched through.
 * @param onProgress - Invoked once when a miss starts downloading the bundle
 *   and once per fetched file. Never invoked on a hit.
 */
export async function ensureCachedTargetAppInStore(
  access: TargetAppCacheFileAccess,
  reference: string,
  source: TargetAppSource,
  transport: ExtensionFetchTransport,
  onProgress?: TargetAppCacheProgressListener
): Promise<EnsureCachedTargetAppResult> {
  const key = source.pinnedKey(reference);
  if (key !== undefined) {
    const cacheDir = deriveTargetAppCacheDir(key.coordinate, key.specifier);
    if (cacheDir === undefined) {
      return unsafePath(`The reference "${reference}" keys to a cache path that escapes the cache root.`);
    }
    const cached = await resolveCachedAppDir(access, source, cacheDir);
    if (cached !== undefined) {
      return cached;
    }
  }

  const result = await source.fetchSnapshot(reference);
  if (!result.ok) {
    return { ok: false, code: TargetAppCacheErrorCode.FETCH_FAILED, message: result.error.message };
  }
  const { coordinate, specifier, manifest, files } = result.snapshot;
  const cacheDir = deriveTargetAppCacheDir(coordinate, specifier);
  if (cacheDir === undefined) {
    return unsafePath(`The snapshot keys to a cache path that escapes the cache root; nothing was written.`);
  }
  for (const file of files) {
    if (!isSafeRelativePath(file.path)) {
      return unsafePath(
        `The snapshot names a file path "${file.path}" that escapes the cache root; nothing was written.`
      );
    }
  }
  const resolved = resolveAppDir(manifest, cacheDir);
  if (!resolved.ok) {
    return resolved;
  }
  const displayName = manifest.name.length > 0 ? manifest.name : coordinate;
  const bundle = await fetchAppBundle(
    transport,
    coordinate,
    specifier,
    manifest.hostApp?.files ?? [],
    (completed, total) => {
      onProgress?.({ displayName, completed, total });
    }
  );
  if (!bundle.ok) {
    return bundle;
  }
  for (const file of bundle.files) {
    await access.writeFile(joinRelative(cacheDir, file.path), file.content);
  }
  // The manifest is the completion marker: written last, after every bundle
  // file, so an interrupted population is never observed as a hit.
  const manifestFile = files.find((file) => file.path === WENDOO_JSON);
  if (manifestFile !== undefined) {
    await access.writeFile(joinRelative(cacheDir, WENDOO_JSON), manifestFile.content);
  }
  return resolved;
}

/**
 * Resolve the served app directory of a completely cached target from its
 * on-disk manifest, without touching any transport. Returns undefined -- a
 * cache miss -- when the manifest is missing, unreadable, unparseable, or
 * resolves no app directory.
 */
async function resolveCachedAppDir(
  access: TargetAppCacheFileAccess,
  source: TargetAppSource,
  cacheDir: string
): Promise<Extract<EnsureCachedTargetAppResult, { ok: true }> | undefined> {
  const manifestText = await access.readTextFile(joinRelative(cacheDir, WENDOO_JSON));
  if (manifestText === undefined) {
    return undefined;
  }
  const parsedManifest = source.parseManifest(manifestText);
  if (!parsedManifest.ok) {
    return undefined;
  }
  const resolved = resolveAppDir(parsedManifest.manifest, cacheDir);
  return resolved.ok ? resolved : undefined;
}
