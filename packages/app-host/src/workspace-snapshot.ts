export type WorkspaceFileEntry = {
  kind: "file";
  content: string;
  etag: string;
  isReadonly: boolean;
};

export type WorkspaceDirectoryEntry = {
  kind: "directory";
};

export type WorkspaceEntry = WorkspaceFileEntry | WorkspaceDirectoryEntry;

export type WorkspaceSnapshot = Map<string, WorkspaceEntry>;

export type WorkspaceChange =
  | { action: "write"; path: string; content: string; isReadonly?: boolean; newEtag: string; expectedEtag?: string }
  | { action: "delete"; path: string; expectedEtag?: string }
  | { action: "rename"; oldPath: string; newPath: string; expectedEtag?: string }
  | { action: "mkdir"; path: string }
  | { action: "rmdir"; path: string }
  | { action: "import"; entries: Array<[string, WorkspaceEntry]> };
