import type {
  ExtensionFetchFileResult,
  ExtensionFetchTransport,
  ProjectContentManifest,
} from "@mindcraft-lang/app-host";
import {
  checkExtensionReferenceUpdate,
  createJsDelivrExtensionTransport,
  ExtensionFetchErrorCode,
  fetchExtensionSnapshot,
  highestListedRelease,
  parseExtensionReference,
  parseProjectContentManifest,
} from "@mindcraft-lang/app-host";
import * as vscode from "vscode";
import type {
  TargetAppCacheErrorCode,
  TargetAppCacheFileAccess,
  TargetAppCacheProgress,
  TargetAppSource,
} from "./target-app-cache";
import { ensureCachedTargetAppInStore } from "./target-app-cache";
import type { TargetReleaseListing, TargetUpdateCheckResult } from "./target-update";

/** Test-installed transport replacing the live jsDelivr transport when set. */
let testTransport: (ExtensionFetchTransport & { calls: number }) | undefined;

/**
 * Test-only: install a fake transport serving the given content by path, or
 * clear the installed transport when `files` is undefined. A string entry is
 * served as its UTF-8 bytes; a `{ file }` entry is served by reading the named
 * on-disk file. `versions` is the published-version listing the transport
 * reports (empty when omitted). Resets the fetch call counter observed by
 * {@link testTargetAppTransportCalls}.
 */
export function installTestTargetAppTransport(
  files: Record<string, string | { readonly file: string }> | undefined,
  versions?: readonly string[]
): void {
  if (files === undefined) {
    testTransport = undefined;
    return;
  }
  const encoder = new TextEncoder();
  testTransport = {
    calls: 0,
    async fetchFile(_owner, _repo, _pin, path): Promise<ExtensionFetchFileResult> {
      this.calls++;
      const entry = files[path];
      if (entry === undefined) return { ok: false, kind: "not-found" };
      if (typeof entry === "string") return { ok: true, content: encoder.encode(entry) };
      try {
        return { ok: true, content: await vscode.workspace.fs.readFile(vscode.Uri.file(entry.file)) };
      } catch {
        return { ok: false, kind: "not-found" };
      }
    },
    async resolveBranch() {
      return { ok: false, kind: "not-found" };
    },
    async listVersionTags() {
      return { ok: true, versions: versions ?? [] };
    },
  };
}

/** Test-only: the installed fake transport's fetchFile call count (0 when none is installed). */
export function testTargetAppTransportCalls(): number {
  return testTransport?.calls ?? 0;
}

/**
 * The transport target-app operations fetch through: the test-installed
 * transport when one is set, else the live jsDelivr transport. When
 * `fetchTimeoutMs` is given, each live network request is aborted after that
 * many milliseconds and surfaces as an unreachable transport result; the
 * test-installed transport is never bounded.
 */
export function activeTargetAppTransport(fetchTimeoutMs?: number): ExtensionFetchTransport {
  if (testTransport !== undefined) {
    return testTransport;
  }
  if (fetchTimeoutMs === undefined) {
    return createJsDelivrExtensionTransport();
  }
  return createJsDelivrExtensionTransport({
    fetchImpl: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(fetchTimeoutMs) }),
  });
}

/** Result of {@link ensureCachedTargetApp}. */
export type EnsureCachedTargetAppUriResult =
  | {
      /** True when the app directory was resolved. */
      readonly ok: true;
      /** URI of the on-disk directory whose `index.html` the host serves. */
      readonly appDir: vscode.Uri;
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

/** The directory portion of a POSIX relative path, or undefined for a root-level path. */
function parentDirectory(relPath: string): string | undefined {
  const index = relPath.lastIndexOf("/");
  return index > 0 ? relPath.slice(0, index) : undefined;
}

/**
 * The cache's file operations over the workbench file system, rooted at the
 * extension's global storage directory.
 */
function createCacheFileAccess(cacheRoot: vscode.Uri): TargetAppCacheFileAccess {
  const toUri = (relPath: string): vscode.Uri => vscode.Uri.joinPath(cacheRoot, ...relPath.split("/"));
  return {
    async readTextFile(relPath: string): Promise<string | undefined> {
      try {
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(toUri(relPath)));
      } catch {
        return undefined;
      }
    },
    async writeFile(relPath: string, content: Uint8Array): Promise<void> {
      const parent = parentDirectory(relPath);
      if (parent) {
        await vscode.workspace.fs.createDirectory(toUri(parent));
      }
      await vscode.workspace.fs.writeFile(toUri(relPath), content);
    },
  };
}

/**
 * Ensure the target app named by `reference` is cached on disk under the
 * extension's global storage, and return the on-disk directory whose
 * `index.html` the host serves. A cache hit returns without touching the
 * transport; a miss fetches the snapshot, validates every content path, and
 * writes the bundle to disk while a progress notification counts the
 * downloaded files.
 *
 * @param context - The extension context supplying the global storage root.
 * @param reference - A pinned `gh:<owner>/<repo>@<pin>` (or `#branch`) reference.
 * @param transport - The transport a cache miss fetches through. Defaults to a
 *   test-installed transport when one is set, otherwise the jsDelivr transport
 *   over public GitHub content.
 */
export async function ensureCachedTargetApp(
  context: vscode.ExtensionContext,
  reference: string,
  transport: ExtensionFetchTransport = activeTargetAppTransport()
): Promise<EnsureCachedTargetAppUriResult> {
  const cacheRoot = context.globalStorageUri;
  const access = createCacheFileAccess(cacheRoot);
  const source: TargetAppSource = {
    pinnedKey(ref: string): { readonly coordinate: string; readonly specifier: string } | undefined {
      const parsed = parseExtensionReference(ref);
      if (parsed !== undefined && parsed.transport === "gh" && parsed.routing.kind === "pin") {
        return { coordinate: `${parsed.owner}/${parsed.repo}`, specifier: parsed.routing.pin };
      }
      return undefined;
    },
    fetchSnapshot: (ref: string) => fetchExtensionSnapshot(ref, transport),
    parseManifest: parseProjectContentManifest,
  };
  let reporter: vscode.Progress<{ message?: string }> | undefined;
  let finishNotification: (() => void) | undefined;
  const onProgress = (progress: TargetAppCacheProgress): void => {
    const message = `Downloading ${progress.displayName} (${progress.completed}/${progress.total})...`;
    if (reporter !== undefined) {
      reporter.report({ message });
      return;
    }
    // The first progress event opens the notification, which stays up until
    // the ensure call settles.
    void vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, cancellable: false },
      (report) =>
        new Promise<void>((resolve) => {
          reporter = report;
          finishNotification = resolve;
          report.report({ message });
        })
    );
  };
  try {
    const result = await ensureCachedTargetAppInStore(access, reference, source, transport, onProgress);
    if (!result.ok) {
      return result;
    }
    return { ok: true, appDir: vscode.Uri.joinPath(cacheRoot, ...result.appDir.split("/")), manifest: result.manifest };
  } finally {
    finishNotification?.();
  }
}

/** Timeout in milliseconds bounding each live network request of a pin update check. */
const UPDATE_CHECK_FETCH_TIMEOUT_MS = 15000;

/**
 * Check the pinned target-app `reference` for a newer published release: the
 * installed version is read from the cached bundle's manifest (fetching and
 * caching the bundle first when it is not cached yet), then compared against
 * the source's published version listing. Every live network request is
 * bounded by a per-request timeout, so the check always settles. Returns the
 * newer reference to install, an up-to-date result, or a failure carrying a
 * stable code.
 */
export async function checkTargetAppPinUpdate(
  context: vscode.ExtensionContext,
  reference: string
): Promise<TargetUpdateCheckResult> {
  const transport = activeTargetAppTransport(UPDATE_CHECK_FETCH_TIMEOUT_MS);
  const ensured = await ensureCachedTargetApp(context, reference, transport);
  if (!ensured.ok) {
    return { ok: false, error: { code: ensured.code, message: ensured.message } };
  }
  const parsed = parseExtensionReference(reference);
  const installedSpecifier = parsed?.transport === "gh" && parsed.routing.kind === "pin" ? parsed.routing.pin : "";
  return checkExtensionReferenceUpdate({
    reference,
    installedSpecifier,
    installedVersion: ensured.manifest.version,
    transport,
  });
}

/**
 * List the newest published plain `x.y.z` release of the target package at
 * `coordinate` (`<owner>/<repo>`). Every live network request is bounded by a
 * per-request timeout, so the listing always settles. Returns the highest
 * listed release, or a failure carrying a stable code when the source cannot
 * be read or lists no plain release.
 */
export async function listLatestTargetRelease(coordinate: string): Promise<TargetReleaseListing> {
  const transport = activeTargetAppTransport(UPDATE_CHECK_FETCH_TIMEOUT_MS);
  const slash = coordinate.indexOf("/");
  const owner = coordinate.slice(0, slash);
  const repo = coordinate.slice(slash + 1);
  const listed = await transport.listVersionTags(owner, repo);
  if (!listed.ok) {
    switch (listed.kind) {
      case "not-found":
        return {
          ok: false,
          error: {
            code: ExtensionFetchErrorCode.VERSIONS_NOT_FOUND,
            message: `The source lists no published versions for ${coordinate}.`,
          },
        };
      case "http-status":
        return {
          ok: false,
          error: {
            code: ExtensionFetchErrorCode.HTTP_STATUS,
            message: `The source answered with HTTP status ${listed.status}.`,
          },
        };
      case "unreachable":
        return {
          ok: false,
          error: {
            code: ExtensionFetchErrorCode.UNREACHABLE,
            message: `The source is unreachable: ${listed.message}`,
          },
        };
    }
  }
  const latestRelease = highestListedRelease(listed.versions);
  if (latestRelease === undefined) {
    return {
      ok: false,
      error: {
        code: ExtensionFetchErrorCode.VERSIONS_NOT_FOUND,
        message: `The source lists no plain x.y.z release for ${coordinate}.`,
      },
    };
  }
  return { ok: true, latestRelease };
}
