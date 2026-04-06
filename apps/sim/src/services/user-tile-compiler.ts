import { logger } from "@mindcraft-lang/core";
import {
  createWorkspaceCompiler,
  type WorkspaceCompileResult,
  type WorkspaceCompiler,
  type WorkspaceSnapshot,
} from "@mindcraft-lang/ts-compiler";
import { getMindcraftEnvironment } from "./mindcraft-environment";
import { applyCompiledUserTiles } from "./user-tile-registration";

let compiler: WorkspaceCompiler | undefined;

function logWorkspaceCompile(result: WorkspaceCompileResult): void {
  const resultsByPath = result.projectResult.results;

  for (const [path, diagnostics] of result.files) {
    if (diagnostics.length > 0) {
      logger.warn(`[user-tile-compiler] ${path}: ${diagnostics.length} diagnostic(s)`);
      for (const diagnostic of diagnostics) {
        const range = diagnostic.range;
        logger.warn(`  ${path}:${range.startLine}:${range.startColumn} - ${diagnostic.message}`);
      }
      continue;
    }

    const program = resultsByPath.get(path)?.program;
    if (program) {
      logger.info(`[user-tile-compiler] ${path}: compiled ${program.kind} "${program.name}"`);
    }
  }
}

function createCompiler(): WorkspaceCompiler {
  const nextCompiler = createWorkspaceCompiler({
    environment: getMindcraftEnvironment(),
  });

  nextCompiler.onDidCompile((result) => {
    logWorkspaceCompile(result);
    applyCompiledUserTiles(result);
  });

  return nextCompiler;
}

export function initUserTileCompiler(snapshot: WorkspaceSnapshot): WorkspaceCompileResult {
  if (!compiler) {
    compiler = createCompiler();
  }

  compiler.replaceWorkspace(snapshot);
  return compiler.compile();
}

export function getWorkspaceCompiler(): WorkspaceCompiler {
  if (!compiler) {
    throw new Error("Workspace compiler not initialized");
  }

  return compiler;
}
