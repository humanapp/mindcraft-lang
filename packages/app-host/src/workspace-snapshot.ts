/** A regular file entry in a workspace snapshot. */
export type WorkspaceFileEntry = {
  kind: "file";
  /** UTF-8 file contents. */
  content: string;
  /** Opaque version tag used for optimistic-concurrency checks on writes. */
  etag: string;
  /** When `true`, the host UI should prevent edits. */
  isReadonly: boolean;
};

/** A directory entry in a workspace snapshot. */
export type WorkspaceDirectoryEntry = {
  kind: "directory";
};

/** Either a file or a directory entry in a workspace snapshot. */
export type WorkspaceEntry = WorkspaceFileEntry | WorkspaceDirectoryEntry;

/** Map from workspace path to entry. */
export type WorkspaceSnapshot = Map<string, WorkspaceEntry>;

/** A single mutation that can be applied to a workspace. */
export type WorkspaceChange =
  | { action: "write"; path: string; content: string; isReadonly?: boolean; newEtag: string; expectedEtag?: string }
  | { action: "delete"; path: string; expectedEtag?: string }
  | { action: "rename"; oldPath: string; newPath: string; expectedEtag?: string }
  | { action: "mkdir"; path: string }
  | { action: "rmdir"; path: string }
  | { action: "import"; entries: Array<[string, WorkspaceEntry]> };
