import type { CompiledActionBundle, MindcraftEnvironment } from "@mindcraft-lang/core";
import { buildAmbientDeclarations } from "./compiler/ambient.js";
import type { ProjectCompileResult } from "./compiler/compile.js";
import { UserTileProject } from "./compiler/project.js";
import type { CompileDiagnostic, DiagnosticSeverity } from "./compiler/types.js";
import { buildCompiledActionBundle } from "./runtime/action-bundle.js";

/** A file in a {@link WorkspaceSnapshot}: `content` plus the `etag` used for optimistic concurrency. */
export type WorkspaceFileEntry = {
  kind: "file";
  content: string;
  etag: string;
  isReadonly: boolean;
};

/** A directory entry in a {@link WorkspaceSnapshot}. */
export type WorkspaceDirectoryEntry = {
  kind: "directory";
};

/** Tagged union of file and directory entries that may appear in a {@link WorkspaceSnapshot}. */
export type WorkspaceSnapshotEntry = WorkspaceFileEntry | WorkspaceDirectoryEntry;

/** Read-only snapshot of every file and directory in the workspace, keyed by path. */
export type WorkspaceSnapshot = ReadonlyMap<string, WorkspaceSnapshotEntry>;

/**
 * Tagged-union of incremental edits accepted by
 * {@link WorkspaceCompiler.applyWorkspaceChange}.
 */
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

/** Source range for a workspace diagnostic. Lines and columns are 1-based. */
export interface WorkspaceDiagnosticRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** A single diagnostic for a workspace file. `code` is the namespaced compiler diagnostic code (e.g. `MC1004`). */
export interface WorkspaceDiagnosticEntry {
  severity: DiagnosticSeverity;
  message: string;
  code: string;
  range: WorkspaceDiagnosticRange;
}

/** Result of a {@link WorkspaceCompiler.compile} call. */
export interface WorkspaceCompileResult {
  /** Diagnostics keyed by workspace path. Files with no diagnostics are absent. */
  files: ReadonlyMap<string, readonly WorkspaceDiagnosticEntry[]>;
  projectResult: ProjectCompileResult;
  /** Compiled action bundle. Absent when the project has blocking diagnostics. */
  bundle?: CompiledActionBundle;
}

/** Options for {@link createWorkspaceCompiler}. */
export interface CreateWorkspaceCompilerOptions {
  environment: MindcraftEnvironment;
  /** Override the ambient declarations source. When omitted, declarations are generated from the environment's type registry. */
  ambientSource?: string;
}

/** Driver for incremental workspace compilation. Receives snapshot/change inputs and emits diagnostics and a bundle. */
export interface WorkspaceCompiler {
  replaceWorkspace(snapshot: WorkspaceSnapshot): void;
  applyWorkspaceChange(change: WorkspaceChange): void;
  compile(): WorkspaceCompileResult;
  /** Subscribe to compile results. Returns a disposer. */
  onDidCompile(listener: (result: WorkspaceCompileResult) => void): () => void;
  /**
   * Files synthesized by the compiler (e.g. `mindcraft.d.ts`, `tsconfig.json`).
   * The host should keep these in sync with the workspace.
   */
  getCompilerControlledFiles(): ReadonlyMap<string, string>;
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
      services: options.environment.brainServices,
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
    const projectResult = this.project.compileAll();
    const files = buildDiagnosticSnapshot(projectResult);
    const bundle = buildCompiledActionBundle(projectResult, {
      services: this.options.environment.brainServices,
    });

    const result: WorkspaceCompileResult = {
      files,
      projectResult,
      bundle,
    };

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

  getCompilerControlledFiles(): ReadonlyMap<string, string> {
    const files = new Map<string, string>();
    const ambient =
      this.options.ambientSource ?? buildAmbientDeclarations(this.options.environment.brainServices.types);
    files.set("mindcraft.d.ts", ambient);
    files.set("tsconfig.json", TSCONFIG_CONTENT);
    return files;
  }
}

const TSCONFIG_CONTENT = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2016",
      module: "ES2020",
      moduleResolution: "Bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
  },
  undefined,
  2
);

/** Construct a {@link WorkspaceCompiler} bound to the given environment and (optional) ambient declarations. */
export function createWorkspaceCompiler(options: CreateWorkspaceCompilerOptions): WorkspaceCompiler {
  return new WorkspaceCompilerController(options);
}
