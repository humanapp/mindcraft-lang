import type { CompiledActionBundle, MindcraftEnvironment } from "@mindcraft-lang/core";
import { withMindcraftEnvironmentServices } from "@mindcraft-lang/core";
import type { ProjectCompileResult } from "./compiler/compile.js";
import { UserTileProject } from "./compiler/project.js";
import type { CompileDiagnostic, DiagnosticSeverity } from "./compiler/types.js";
import { buildCompiledActionBundle } from "./runtime/action-bundle.js";

export type WorkspaceFileEntry = {
  kind: "file";
  content: string;
  etag: string;
  isReadonly: boolean;
};

export type WorkspaceDirectoryEntry = {
  kind: "directory";
};

export type WorkspaceSnapshotEntry = WorkspaceFileEntry | WorkspaceDirectoryEntry;

export type WorkspaceSnapshot = ReadonlyMap<string, WorkspaceSnapshotEntry>;

export type WorkspaceChange =
  | {
      action: "write";
      path: string;
      content: string;
      isReadonly?: boolean;
      newEtag: string;
      expectedEtag?: string;
    }
  | {
      action: "delete";
      path: string;
      expectedEtag?: string;
    }
  | {
      action: "rename";
      oldPath: string;
      newPath: string;
      expectedEtag?: string;
    }
  | {
      action: "mkdir";
      path: string;
    }
  | {
      action: "rmdir";
      path: string;
    }
  | {
      action: "import";
      entries: Iterable<[string, WorkspaceSnapshotEntry]>;
    };

export interface WorkspaceDiagnosticRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface WorkspaceDiagnosticEntry {
  severity: DiagnosticSeverity;
  message: string;
  code: string;
  range: WorkspaceDiagnosticRange;
}

export interface WorkspaceCompileResult {
  files: ReadonlyMap<string, readonly WorkspaceDiagnosticEntry[]>;
  projectResult: ProjectCompileResult;
  bundle?: CompiledActionBundle;
}

export interface CreateWorkspaceCompilerOptions {
  environment: MindcraftEnvironment;
  ambientSource?: string;
}

export interface WorkspaceCompiler {
  replaceWorkspace(snapshot: WorkspaceSnapshot): void;
  applyWorkspaceChange(change: WorkspaceChange): void;
  compile(): WorkspaceCompileResult;
  onDidCompile(listener: (result: WorkspaceCompileResult) => void): () => void;
}

function mapDiagnostic(diagnostic: CompileDiagnostic): WorkspaceDiagnosticEntry {
  return {
    severity: diagnostic.severity,
    message: diagnostic.message,
    code: `MC${diagnostic.code}`,
    range: {
      startLine: diagnostic.line ?? 1,
      startColumn: diagnostic.column ?? 1,
      endLine: diagnostic.endLine ?? diagnostic.line ?? 1,
      endColumn: diagnostic.endColumn ?? diagnostic.column ?? 1,
    },
  };
}

function buildDiagnosticSnapshot(projectResult: ProjectCompileResult): WorkspaceCompileResult["files"] {
  const files = new Map<string, readonly WorkspaceDiagnosticEntry[]>();

  for (const [path, diagnostics] of projectResult.tsErrors) {
    const entries = diagnostics.map(mapDiagnostic);
    const existing = files.get(path);
    files.set(path, existing ? existing.concat(entries) : entries);
  }

  for (const [path, compileResult] of projectResult.results) {
    const entries = compileResult.diagnostics.map(mapDiagnostic);
    const existing = files.get(path);
    files.set(path, existing ? existing.concat(entries) : entries);
  }

  return files;
}

function snapshotToProjectFiles(snapshot: WorkspaceSnapshot): Map<string, string> {
  const files = new Map<string, string>();

  for (const [path, entry] of snapshot) {
    if (entry.kind === "file") {
      files.set(path, entry.content);
    }
  }

  return files;
}

class WorkspaceCompilerController implements WorkspaceCompiler {
  private readonly project: UserTileProject;
  private readonly compileListeners = new Set<(result: WorkspaceCompileResult) => void>();

  constructor(private readonly options: CreateWorkspaceCompilerOptions) {
    this.project = new UserTileProject({
      ambientSource: options.ambientSource,
    });
  }

  replaceWorkspace(snapshot: WorkspaceSnapshot): void {
    this.project.setFiles(snapshotToProjectFiles(snapshot));
  }

  applyWorkspaceChange(change: WorkspaceChange): void {
    switch (change.action) {
      case "write":
        this.project.updateFile(change.path, change.content);
        break;
      case "delete":
        this.project.deleteFile(change.path);
        break;
      case "rename":
        this.project.renameFile(change.oldPath, change.newPath);
        break;
      case "import":
        this.project.setFiles(snapshotToProjectFiles(new Map(change.entries)));
        break;
      case "mkdir":
      case "rmdir":
        break;
    }
  }

  compile(): WorkspaceCompileResult {
    const result = withMindcraftEnvironmentServices(this.options.environment, () => {
      const projectResult = this.project.compileAll();
      const files = buildDiagnosticSnapshot(projectResult);
      const bundle = buildCompiledActionBundle(projectResult);

      return {
        files,
        projectResult,
        bundle,
      };
    });

    for (const listener of this.compileListeners) {
      listener(result);
    }

    return result;
  }

  onDidCompile(listener: (result: WorkspaceCompileResult) => void): () => void {
    this.compileListeners.add(listener);
    return () => {
      this.compileListeners.delete(listener);
    };
  }
}

export function createWorkspaceCompiler(options: CreateWorkspaceCompilerOptions): WorkspaceCompiler {
  return new WorkspaceCompilerController(options);
}
