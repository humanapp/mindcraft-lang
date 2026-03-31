import { logger } from "@mindcraft-lang/core";
import type { CompileDiagnostic, CompileResult } from "@mindcraft-lang/typescript";
import { compileUserTile } from "@mindcraft-lang/typescript";

export interface TileCompilationEntry {
  path: string;
  result: CompileResult;
}

type CompilationListener = (entry: TileCompilationEntry) => void;
type RemovalListener = (path: string) => void;

const cache = new Map<string, CompileResult>();
const compilationListeners = new Set<CompilationListener>();
const removalListeners = new Set<RemovalListener>();

function isUserTsFile(path: string): boolean {
  return path.endsWith(".ts") && !path.endsWith(".d.ts");
}

function compile(path: string, content: string): void {
  const result = compileUserTile(content);
  cache.set(path, result);
  logResult(path, result);
  for (const fn of compilationListeners) fn({ path, result });
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
  if (!isUserTsFile(path)) return;
  compile(path, content);
}

export function fileDeleted(path: string): void {
  if (!isUserTsFile(path)) return;
  if (cache.delete(path)) {
    logger.info(`[user-tile-compiler] ${path}: removed`);
    for (const fn of removalListeners) fn(path);
  }
}

export function fileRenamed(oldPath: string, newPath: string): void {
  if (isUserTsFile(oldPath) && cache.has(oldPath)) {
    const result = cache.get(oldPath)!;
    cache.delete(oldPath);
    if (isUserTsFile(newPath)) {
      cache.set(newPath, result);
    } else {
      for (const fn of removalListeners) fn(oldPath);
    }
  }
}

export function fullSync(files: Iterable<[string, { kind: string; content?: string }]>): void {
  const incomingPaths = new Set<string>();
  for (const [path, entry] of files) {
    if (!isUserTsFile(path) || entry.kind !== "file" || entry.content === undefined) continue;
    incomingPaths.add(path);
    const prev = cache.get(path);
    if (!prev || needsRecompile(prev, entry.content)) {
      compile(path, entry.content);
    }
  }
  for (const path of cache.keys()) {
    if (!incomingPaths.has(path)) {
      cache.delete(path);
      logger.info(`[user-tile-compiler] ${path}: removed (sync)`);
      for (const fn of removalListeners) fn(path);
    }
  }
}

function needsRecompile(_prev: CompileResult, _newContent: string): boolean {
  return true;
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
