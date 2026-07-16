import type {
  ExtensionFetchResult,
  ExtensionFetchTransport,
  FetchedExtensionFile,
  ProjectContentManifest,
  ProjectContentManifestParseResult,
} from "@mindcraft-lang/app-host";
import { MINDCRAFT_JSON } from "../mindcraft-json";
import { isSafeRelativePath } from "./path-confinement";

/** Path segment under which cached target apps are keyed within the cache root. */
const TARGETS_SEGMENT = "targets";

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
  /** True when `relPath` names an existing directory under the cache root. */
  isDirectory(relPath: string): Promise<boolean>;
  /** Read a text file under the cache root; undefined when missing or unreadable. */
  readTextFile(relPath: string): Promise<string | undefined>;
  /** Write bytes at `relPath` under the cache root, creating missing parent directories. */
  writeFile(relPath: string, content: Uint8Array): Promise<void>;
}

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
  return { ok: true, appDir: joinRelative(cacheDir, hostApp.path) };
}

/**
 * Fetch every host-app-bundle file listed by `appFiles` at the immutable
 * `specifier`, after validating each path. Returns a traversal failure with no
 * fetches on the first unsafe path, or a fetch failure when the transport
 * cannot retrieve a file.
 */
async function fetchAppBundle(
  transport: ExtensionFetchTransport,
  coordinate: string,
  specifier: string,
  appFiles: readonly string[]
): Promise<{ ok: true; files: FetchedExtensionFile[] } | Failure> {
  const slash = coordinate.indexOf("/");
  const owner = coordinate.slice(0, slash);
  const repo = coordinate.slice(slash + 1);
  for (const path of appFiles) {
    if (!isSafeRelativePath(path)) {
      return unsafePath(`The app bundle names a file path "${path}" that escapes the cache root; nothing was written.`);
    }
  }
  const files: FetchedExtensionFile[] = [];
  for (const path of appFiles) {
    const result = await transport.fetchFile(owner, repo, specifier, path);
    if (!result.ok) {
      return {
        ok: false,
        code: TargetAppCacheErrorCode.FETCH_FAILED,
        message: `The app bundle file "${path}" could not be fetched at "${specifier}".`,
      };
    }
    files.push({ path, content: result.content });
  }
  return { ok: true, files };
}

/**
 * Ensure the target app named by `reference` is cached under the store, and
 * return the cache-root-relative directory whose `index.html` the host serves.
 *
 * On a cache hit -- the keyed directory already exists -- the app directory is
 * resolved from the cached manifest without touching `source` or `transport`.
 * On a miss, the snapshot's manifest is fetched, its declared app bundle is
 * fetched, every content-declared path is validated, and the manifest plus the
 * bundle are written under the keyed directory before the app directory is
 * returned. A snapshot naming any escaping path is rejected and nothing is
 * written.
 *
 * @param access - File operations against the cache root.
 * @param reference - A pinned `gh:<owner>/<repo>@<pin>` (or `#branch`) reference.
 * @param source - The extension-fetch operations a cache miss resolves through.
 * @param transport - The transport the app bundle's files are fetched through.
 */
export async function ensureCachedTargetAppInStore(
  access: TargetAppCacheFileAccess,
  reference: string,
  source: TargetAppSource,
  transport: ExtensionFetchTransport
): Promise<EnsureCachedTargetAppResult> {
  const key = source.pinnedKey(reference);
  if (key !== undefined) {
    const cacheDir = deriveTargetAppCacheDir(key.coordinate, key.specifier);
    if (cacheDir === undefined) {
      return unsafePath(`The reference "${reference}" keys to a cache path that escapes the cache root.`);
    }
    if (await access.isDirectory(cacheDir)) {
      return resolveCachedAppDir(access, source, cacheDir);
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
  const bundle = await fetchAppBundle(transport, coordinate, specifier, manifest.hostApp?.files ?? []);
  if (!bundle.ok) {
    return bundle;
  }
  const manifestFile = files.find((file) => file.path === MINDCRAFT_JSON);
  if (manifestFile !== undefined) {
    await access.writeFile(joinRelative(cacheDir, MINDCRAFT_JSON), manifestFile.content);
  }
  for (const file of bundle.files) {
    await access.writeFile(joinRelative(cacheDir, file.path), file.content);
  }
  return resolved;
}

/**
 * Resolve the served app directory of an already-cached target from its
 * on-disk manifest, without touching any transport.
 */
async function resolveCachedAppDir(
  access: TargetAppCacheFileAccess,
  source: TargetAppSource,
  cacheDir: string
): Promise<EnsureCachedTargetAppResult> {
  const manifestText = await access.readTextFile(joinRelative(cacheDir, MINDCRAFT_JSON));
  if (manifestText !== undefined) {
    const parsedManifest = source.parseManifest(manifestText);
    if (parsedManifest.ok) {
      return resolveAppDir(parsedManifest.manifest, cacheDir);
    }
  }
  return {
    ok: false,
    code: TargetAppCacheErrorCode.MANIFEST_HAS_NO_APP,
    message: `The cached target at "${cacheDir}" carries no readable app manifest.`,
  };
}
