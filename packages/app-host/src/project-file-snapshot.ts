import type { FileContent } from "@wendoo/service-api";

/** A regular file entry in a project file snapshot. */
export type ProjectFileEntry = {
  kind: "file";
  /** File contents: text, or raw bytes for a file that is not UTF-8 text. */
  content: FileContent;
  /** Opaque version tag used for optimistic-concurrency checks on writes. */
  etag: string;
  /** When `true`, the host UI should prevent edits. */
  isReadonly: boolean;
};

/** A directory entry in a project file snapshot. */
export type ProjectDirectoryEntry = {
  kind: "directory";
};

/** Either a file or a directory entry in a project file snapshot. */
export type ProjectFileSystemEntry = ProjectFileEntry | ProjectDirectoryEntry;

/** Map from project-relative path to entry. */
export type ProjectFileSnapshot = Map<string, ProjectFileSystemEntry>;

/** A single mutation that can be applied to a project file system. */
export type ProjectFileChange =
  | {
      action: "write";
      path: string;
      content: FileContent;
      isReadonly?: boolean;
      newEtag: string;
      expectedEtag?: string;
    }
  | { action: "delete"; path: string; expectedEtag?: string }
  | { action: "rename"; oldPath: string; newPath: string; expectedEtag?: string }
  | { action: "mkdir"; path: string }
  | { action: "rmdir"; path: string }
  | { action: "import"; entries: Array<[string, ProjectFileSystemEntry]> };
