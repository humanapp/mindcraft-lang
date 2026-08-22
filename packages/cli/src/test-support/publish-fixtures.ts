import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Absolute path of the built `wendoo` bin under test. */
export const CLI_BIN = fileURLToPath(new URL("../../dist/main.js", import.meta.url));

/**
 * Environment for every git and CLI invocation in tests: user and system git
 * configuration is disabled and a fixed commit identity is provided, so runs
 * do not depend on or touch the developer's git setup.
 */
export const GIT_TEST_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Wendoo Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Wendoo Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

/** Result of one CLI invocation. */
export interface CliRunResult {
  /** Process exit code. */
  code: number;
  /** Captured standard output. */
  stdout: string;
  /** Captured standard error. */
  stderr: string;
}

/** Run a git command in `cwd` for fixture setup and assertions. Throws on a nonzero exit. */
export function runGit(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: GIT_TEST_ENV }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args.join(" ")} failed: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

/** Run the built `wendoo` bin with `args` in `cwd` and capture its outcome. */
export function runCliBin(cwd: string, ...args: string[]): Promise<CliRunResult> {
  return runCliBinWithEnv(cwd, {}, ...args);
}

/**
 * Run the built `wendoo` bin with `args` in `cwd`, layering `env` entries
 * over the test git environment, and capture its outcome.
 */
export function runCliBinWithEnv(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_BIN, ...args],
      { cwd, env: { ...GIT_TEST_ENV, ...env } },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
        } else {
          resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
        }
      }
    );
  });
}

/**
 * Git environment entries that rewrite `https://github.com/<owner>/<repo>.git`
 * remote URLs to repositories under `root`, keyed by their `<owner>/<repo>`
 * path. Lets a publish that derives a GitHub remote from a recorded identity
 * run against a local fixture repository.
 */
export function githubRewriteEnv(root: string): NodeJS.ProcessEnv {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${pathToFileURL(root).href}/.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/",
  };
}

/** Create a fresh scratch directory under the OS temp dir. */
export function makeScratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "wendoo-cli-test-"));
}

/** Initialize a bare git repository with default branch `main` and return its path. */
export async function initBareRemote(parent: string, name = "remote.git"): Promise<string> {
  const remote = path.join(parent, name);
  await mkdir(remote, { recursive: true });
  await runGit(parent, "-c", "init.defaultBranch=main", "init", "--quiet", "--bare", remote);
  return remote;
}

/** Write a project directory: files by project-relative path, byte or text content. */
export async function writeProjectFiles(dir: string, files: Record<string, string | Uint8Array>): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    const target = path.join(dir, filePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

/**
 * Create a standalone project checkout: a git repository on branch `main`
 * containing `files`, committed and pushed to `remote` as `origin`.
 */
export async function initCheckoutProject(
  parent: string,
  remote: string,
  files: Record<string, string | Uint8Array>
): Promise<string> {
  const checkout = path.join(parent, "checkout");
  await mkdir(checkout, { recursive: true });
  await runGit(checkout, "init", "--quiet");
  await runGit(checkout, "checkout", "--quiet", "-b", "main");
  await writeProjectFiles(checkout, files);
  await runGit(checkout, "add", "--all");
  await runGit(checkout, "commit", "--quiet", "-m", "initial content");
  await runGit(checkout, "remote", "add", "origin", remote);
  await runGit(checkout, "push", "--quiet", "--set-upstream", "origin", "main");
  return checkout;
}

/** Clone `remote` at `tag` into a new directory under `parent` and return the clone's path. */
export async function cloneAtTag(parent: string, remote: string, tag: string): Promise<string> {
  const clone = path.join(parent, `clone-${tag}`);
  await runGit(parent, "clone", "--quiet", "--branch", tag, remote, clone);
  return clone;
}

/** List every file under `dir` (excluding `.git`) as sorted project-relative paths. */
export async function listProjectFiles(dir: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix))) {
    if (prefix === "" && entry === ".git") continue;
    const relative = prefix === "" ? entry : `${prefix}/${entry}`;
    const info = await stat(path.join(dir, relative));
    if (info.isDirectory()) {
      found.push(...(await listProjectFiles(dir, relative)));
    } else {
      found.push(relative);
    }
  }
  return found.sort();
}
