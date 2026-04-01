import { logger } from "@mindcraft-lang/core";
import type { CompileResult } from "@mindcraft-lang/typescript";
import { UserTileProject } from "@mindcraft-lang/typescript";

export interface TileCompilationEntry {
  path: string;
  result: CompileResult;
}

type CompilationListener = (entry: TileCompilationEntry) => void;
type RemovalListener = (path: string) => void;

let project: UserTileProject | undefined;
function getProject(): UserTileProject {
  if (!project) project = new UserTileProject();
  return project;
}

const cache = new Map<string, CompileResult>();
const compilationListeners = new Set<CompilationListener>();
const removalListeners = new Set<RemovalListener>();

function isUserTsFile(path: string): boolean {
  return path.endsWith(".ts") && !path.endsWith(".d.ts");
}

function isDtsFile(path: string): boolean {
  return path.endsWith(".d.ts");
}

function recompileAll(): void {
  const result = getProject().compileAll();

  for (const [path, tsErrs] of result.tsErrors) {
    logger.warn(`[user-tile-compiler] ${path}: ${tsErrs.length} TypeScript error(s)`);
    for (const d of tsErrs) {
      const loc = d.line !== undefined ? `:${d.line}:${d.column}` : "";
      logger.warn(`  ${path}${loc} - ${d.message}`);
    }
  }

  const currentPaths = new Set(cache.keys());
  const newPaths = new Set(result.results.keys());

  for (const path of currentPaths) {
    if (!newPaths.has(path)) {
      cache.delete(path);
      logger.info(`[user-tile-compiler] ${path}: removed`);
      for (const fn of removalListeners) fn(path);
    }
  }

  for (const [path, compileResult] of result.results) {
    cache.set(path, compileResult);
    logResult(path, compileResult);
    for (const fn of compilationListeners) fn({ path, result: compileResult });
  }
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

export function fileWritten(path: string, content: string): void {
  if (!isUserTsFile(path) && !isDtsFile(path)) return;
  getProject().updateFile(path, content);
  recompileAll();
}

export function fileDeleted(path: string): void {
  if (!isUserTsFile(path) && !isDtsFile(path)) return;
  getProject().deleteFile(path);
  recompileAll();
}

export function fileRenamed(oldPath: string, newPath: string): void {
  if (!isUserTsFile(oldPath) && !isDtsFile(oldPath)) return;
  getProject().renameFile(oldPath, newPath);
  recompileAll();
}

export function fullSync(files: Iterable<[string, { kind: string; content?: string }]>): void {
  const allFiles = new Map<string, string>();
  for (const [path, entry] of files) {
    if (entry.kind !== "file" || entry.content === undefined) continue;
    if (!isUserTsFile(path) && !isDtsFile(path)) continue;
    allFiles.set(path, entry.content);
  }
  getProject().setFiles(allFiles);
  recompileAll();
}

export function getCompileResult(path: string): CompileResult | undefined {
  return cache.get(path);
}

export function getAllCompileResults(): ReadonlyMap<string, CompileResult> {
  return cache;
}

export function onCompilation(fn: CompilationListener): () => void {
  compilationListeners.add(fn);
  return () => {
    compilationListeners.delete(fn);
  };
}

export function onRemoval(fn: RemovalListener): () => void {
  removalListeners.add(fn);
  return () => {
    removalListeners.delete(fn);
  };
}
