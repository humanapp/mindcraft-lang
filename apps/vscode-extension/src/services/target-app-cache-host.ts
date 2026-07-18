import type { ExtensionFetchFileResult, ExtensionFetchTransport } from "@mindcraft-lang/app-host";
import {
  createJsDelivrExtensionTransport,
  fetchExtensionSnapshot,
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

/** Test-installed transport replacing the live jsDelivr transport when set. */
let testTransport: (ExtensionFetchTransport & { calls: number }) | undefined;

/**
 * Test-only: install a fake transport serving the given content by path, or
 * clear the installed transport when `files` is undefined. Resets the fetch
 * call counter observed by {@link testTargetAppTransportCalls}.
 */
export function installTestTargetAppTransport(files: Record<string, string> | undefined): void {
  if (files === undefined) {
    testTransport = undefined;
    return;
  }
  const encoder = new TextEncoder();
  testTransport = {
    calls: 0,
    async fetchFile(_owner, _repo, _pin, path): Promise<ExtensionFetchFileResult> {
      this.calls++;
      const content = files[path];
      if (content === undefined) return { ok: false, kind: "not-found" };
      return { ok: true, content: encoder.encode(content) };
    },
    async resolveBranch() {
      return { ok: false, kind: "not-found" };
    },
    async listVersionTags() {
      return { ok: true, versions: [] };
    },
  };
}

/** Test-only: the installed fake transport's fetchFile call count (0 when none is installed). */
export function testTargetAppTransportCalls(): number {
  return testTransport?.calls ?? 0;
}

/** Result of {@link ensureCachedTargetApp}. */
export type EnsureCachedTargetAppUriResult =
  | {
      /** True when the app directory was resolved. */
      readonly ok: true;
      /** URI of the on-disk directory whose `index.html` the host serves. */
      readonly appDir: vscode.Uri;
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
  transport: ExtensionFetchTransport = testTransport ?? createJsDelivrExtensionTransport()
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
    return { ok: true, appDir: vscode.Uri.joinPath(cacheRoot, ...result.appDir.split("/")) };
  } finally {
    finishNotification?.();
  }
}
