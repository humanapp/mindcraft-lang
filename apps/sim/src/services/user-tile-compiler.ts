import type { CompilationProvider, CompilationResult } from "@mindcraft-lang/bridge-app";
import { logger } from "@mindcraft-lang/core";
import type { CompileDiagnostic, CompileResult, ProjectCompileResult } from "@mindcraft-lang/ts-compiler";
import { UserTileProject } from "@mindcraft-lang/ts-compiler";

export interface TileCompilationEntry {
  path: string;
  result: CompileResult;
}

let project: UserTileProject | undefined;
function getProject(): UserTileProject {
  if (!project) project = new UserTileProject();
  return project;
}

const cache = new Map<string, CompileResult>();

function isUserTsFile(path: string): boolean {
  return path.endsWith(".ts") && !path.endsWith(".d.ts");
}

function isDtsFile(path: string): boolean {
  return path.endsWith(".d.ts");
}

type DiagnosticEntry =
  CompilationResult["files"] extends Map<string, infer E> ? (E extends Array<infer T> ? T : never) : never;

function mapDiagnostic(d: CompileDiagnostic): DiagnosticEntry {
  return {
    severity: d.severity,
    message: d.message,
    code: `MC${d.code}`,
    range: {
      startLine: d.line ?? 1,
      startColumn: d.column ?? 1,
      endLine: d.endLine ?? d.line ?? 1,
      endColumn: d.endColumn ?? d.column ?? 1,
    },
  };
}

function mapProjectResult(result: ProjectCompileResult): CompilationResult {
  const files = new Map<string, DiagnosticEntry[]>();

  for (const [path, tsErrs] of result.tsErrors) {
    const entries = tsErrs.map(mapDiagnostic);
    const existing = files.get(path);
    files.set(path, existing ? existing.concat(entries) : entries);
  }

  for (const [path, compileResult] of result.results) {
    const entries = compileResult.diagnostics.map(mapDiagnostic);
    const existing = files.get(path);
    files.set(path, existing ? existing.concat(entries) : entries);
  }

  return { files };
}

function logResult(path: string, result: CompileResult): void {
  if (result.diagnostics.length > 0) {
    logger.warn(`[user-tile-compiler] ${path}: ${result.diagnostics.length} diagnostic(s)`);
    for (const d of result.diagnostics) {
      const loc = d.line !== undefined ? `:${d.line}:${d.column}` : "";
      logger.warn(`  ${path}${loc} - ${d.message}`);
    }
  } else if (result.program) {
    logger.info(`[user-tile-compiler] ${path}: compiled ${result.program.kind} "${result.program.name}"`);
  }
}

function logTsErrors(result: ProjectCompileResult): void {
  for (const [path, tsErrs] of result.tsErrors) {
    logger.warn(`[user-tile-compiler] ${path}: ${tsErrs.length} TypeScript error(s)`);
    for (const d of tsErrs) {
      const loc = d.line !== undefined ? `:${d.line}:${d.column}` : "";
      logger.warn(`  ${path}${loc} - ${d.message}`);
    }
  }
}

export function handleCompilationResult(result: CompilationResult): void {
  const rawResult = lastRawResult;
  if (!rawResult) return;

  const currentPaths = new Set(cache.keys());
  const newPaths = new Set(rawResult.results.keys());

  for (const path of currentPaths) {
    if (!newPaths.has(path)) {
      cache.delete(path);
      logger.info(`[user-tile-compiler] ${path}: removed`);
    }
  }

  for (const [path, compileResult] of rawResult.results) {
    cache.set(path, compileResult);
    logResult(path, compileResult);
  }

  logTsErrors(rawResult);
}

let lastRawResult: ProjectCompileResult | undefined;

export function lastCompilationHadTsErrors(): boolean {
  return lastRawResult !== undefined && lastRawResult.tsErrors.size > 0;
}

export function createCompilationProvider(): CompilationProvider {
  return {
    fileWritten(path: string, content: string): void {
      if (!isUserTsFile(path) && !isDtsFile(path)) return;
      getProject().updateFile(path, content);
    },
    fileDeleted(path: string): void {
      if (!isUserTsFile(path) && !isDtsFile(path)) return;
      getProject().deleteFile(path);
    },
    fileRenamed(oldPath: string, newPath: string): void {
      if (!isUserTsFile(oldPath) && !isDtsFile(oldPath)) return;
      getProject().renameFile(oldPath, newPath);
    },
    fullSync(files: Iterable<[string, { kind: string; content?: string }]>): void {
      const allFiles = new Map<string, string>();
      for (const [path, entry] of files) {
        if (entry.kind !== "file" || entry.content === undefined) continue;
        if (!isUserTsFile(path) && !isDtsFile(path)) continue;
        allFiles.set(path, entry.content);
      }
      getProject().setFiles(allFiles);
    },
    compileAll(): CompilationResult {
      const raw = getProject().compileAll();
      lastRawResult = raw;
      return mapProjectResult(raw);
    },
  };
}

export function getCompileResult(path: string): CompileResult | undefined {
  return cache.get(path);
}

export function getAllCompileResults(): ReadonlyMap<string, CompileResult> {
  return cache;
}
