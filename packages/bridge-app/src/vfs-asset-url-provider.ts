import { fileContentToBytes } from "@wendoo-lang/app-host";
import type { ProjectFileSnapshot, ProjectFileSystem } from "./app-bridge.js";

const VFS_PREFIX = "/vfs/";

const MIME_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function mimeForPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME_TYPES[path.slice(dot)] ?? "application/octet-stream";
}

/** Options for {@link createVfsAssetUrlProvider}. */
export interface VfsAssetUrlProviderOptions {
  /** Returns the project file system whose snapshot carries the served assets. */
  getProjectFileSystem: () => ProjectFileSystem;
  /** Returns the current VFS revision. Advancing it invalidates minted URLs. */
  getVfsRevision: () => number;
}

/** Resolves compiler-minted `/vfs/<path>` asset references to loadable URLs. */
export interface VfsAssetUrlProvider {
  /**
   * Resolve `url` to an object URL for the file at `<path>` in the current
   * snapshot of the project file system. URLs are cached per (path, revision);
   * the first resolution after the revision advances re-reads the snapshot and
   * revokes the superseded generation's URLs. Returns `url` unchanged when it
   * does not start with `/vfs/` or names no file in the snapshot.
   */
  resolveAssetUrl(url: string): string;
}

/** Create a {@link VfsAssetUrlProvider} over a project file system and a VFS revision source. */
export function createVfsAssetUrlProvider(options: VfsAssetUrlProviderOptions): VfsAssetUrlProvider {
  let generationRevision: number | undefined;
  let snapshot: ProjectFileSnapshot | undefined;
  let urlsByPath = new Map<string, string>();

  return {
    resolveAssetUrl(url: string): string {
      if (!url.startsWith(VFS_PREFIX)) {
        return url;
      }

      const revision = options.getVfsRevision();
      if (revision !== generationRevision) {
        for (const minted of urlsByPath.values()) {
          URL.revokeObjectURL(minted);
        }
        urlsByPath = new Map();
        snapshot = undefined;
        generationRevision = revision;
      }

      const path = url.slice(VFS_PREFIX.length);
      const cached = urlsByPath.get(path);
      if (cached !== undefined) {
        return cached;
      }

      snapshot ??= options.getProjectFileSystem().exportSnapshot();
      const entry = snapshot.get(path);
      if (!entry || entry.kind !== "file") {
        return url;
      }

      const bytes = new Uint8Array(fileContentToBytes(entry.content));
      const minted = URL.createObjectURL(new Blob([bytes], { type: mimeForPath(path) }));
      urlsByPath.set(path, minted);
      return minted;
    },
  };
}
