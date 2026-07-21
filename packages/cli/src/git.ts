import { execFile } from "node:child_process";

/** Error thrown when a git command exits with a nonzero status. */
export class GitCommandError extends Error {
  constructor(args: readonly string[], stderr: string) {
    super(`git ${args.join(" ")} failed: ${stderr.trim()}`);
    this.name = "GitCommandError";
  }
}

/**
 * Run a git command in `cwd` and return its stdout. Throws
 * {@link GitCommandError} when git exits with a nonzero status.
 */
export function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new GitCommandError(args, stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Run a git command in `cwd` and return its stdout, or `undefined` when git
 * exits with a nonzero status.
 */
export async function tryGit(cwd: string, ...args: string[]): Promise<string | undefined> {
  try {
    return await git(cwd, ...args);
  } catch (error) {
    if (error instanceof GitCommandError) {
      return undefined;
    }
    throw error;
  }
}
