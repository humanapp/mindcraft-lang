import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { constants } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The `package.json` name a directory must declare to count as a local CLI checkout. */
const LOCAL_CLI_PACKAGE_NAME = "mindcraft-cli";

/**
 * Subdirectories, relative to an ancestor directory, where a local
 * `mindcraft-cli` package may live: a direct mindcraft-lang checkout keeps it at
 * `packages/cli`, and a repository embedding the reference checkout keeps it at
 * `external/mindcraft-lang/packages/cli`.
 */
const CLI_SUBPATHS: readonly string[] = [
  path.join("packages", "cli"),
  path.join("external", "mindcraft-lang", "packages", "cli"),
];

/** Environment variable set on a re-exec'd child to break the redirect loop. */
const LOCAL_MARKER_ENV = "MINDCRAFT_CLI_LOCAL";
/** Environment variable a developer sets to disable the local-build redirect entirely. */
const NO_REDIRECT_ENV = "MINDCRAFT_CLI_NO_REDIRECT";
/** Environment variable that, when set, prints a one-line note naming the local build path. */
const DEBUG_ENV = "MINDCRAFT_CLI_DEBUG";

/** Inspection of one candidate `.../packages/cli` directory. */
interface CliCandidate {
  /** The candidate's declared `package.json` name, or undefined when unreadable or malformed. */
  name: string | undefined;
  /** Whether the candidate has a built `dist/main.js`. */
  hasBuild: boolean;
}

/**
 * Read a candidate CLI directory's declared name and build presence. Never
 * throws: a missing or malformed `package.json` yields an undefined name.
 */
function inspectCliCandidate(cliDir: string): CliCandidate {
  const hasBuild = existsSync(path.join(cliDir, "dist", "main.js"));
  const packageJsonPath = path.join(cliDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return { name: undefined, hasBuild };
  }
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown };
    return { name: typeof parsed.name === "string" ? parsed.name : undefined, hasBuild };
  } catch {
    return { name: undefined, hasBuild };
  }
}

/**
 * Yield every candidate `.../packages/cli` directory found by walking from
 * `startDir` up to the filesystem root, testing both known layouts at each
 * ancestor.
 */
function* ancestorCliDirs(startDir: string): Generator<string> {
  let current = path.resolve(startDir);
  while (true) {
    for (const subpath of CLI_SUBPATHS) {
      yield path.join(current, subpath);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}

/**
 * Locate the built entry point of a local `mindcraft-cli` working copy by
 * walking up from `startDir`. At each ancestor directory it tests both known
 * layouts; a candidate qualifies when its `package.json` declares
 * `name === "mindcraft-cli"` and a `dist/main.js` exists beside it.
 *
 * @param startDir - Directory to begin the upward walk from.
 * @returns Absolute path to the first qualifying candidate's `dist/main.js`, or
 * undefined when no qualifying candidate exists up to the filesystem root.
 */
export function findLocalCliMain(startDir: string): string | undefined {
  for (const cliDir of ancestorCliDirs(startDir)) {
    const candidate = inspectCliCandidate(cliDir);
    if (candidate.name === LOCAL_CLI_PACKAGE_NAME && candidate.hasBuild) {
      return path.join(cliDir, "dist", "main.js");
    }
  }
  return undefined;
}

/**
 * Report whether a local `mindcraft-cli` checkout exists in the ancestry of
 * `startDir` but has not been built (no `dist/main.js`).
 */
function hasUnbuiltLocalCli(startDir: string): boolean {
  for (const cliDir of ancestorCliDirs(startDir)) {
    const candidate = inspectCliCandidate(cliDir);
    if (candidate.name === LOCAL_CLI_PACKAGE_NAME && !candidate.hasBuild) {
      return true;
    }
  }
  return false;
}

/** Inputs to {@link shouldRedirect}. */
export interface ShouldRedirectInput {
  /** Path to a discovered local build's `dist/main.js`, or undefined when none was found. */
  localMain: string | undefined;
  /** Path to the entry point of the build currently executing. */
  runningMain: string;
  /** Environment to read the redirect escape hatch and loop-guard from. */
  env: NodeJS.ProcessEnv;
}

/**
 * Decide whether the running CLI should re-execute a discovered local build.
 * Returns false when there is no local build, when the redirect is disabled via
 * {@link NO_REDIRECT_ENV}, when this process is itself a re-exec'd local build
 * (loop guard via {@link LOCAL_MARKER_ENV}), or when the local build and the
 * running build are the same file. Both paths are resolved through
 * `realpathSync` before comparison, so a symlinked global bin still matches the
 * local build it points at.
 */
export function shouldRedirect({ localMain, runningMain, env }: ShouldRedirectInput): boolean {
  if (localMain === undefined) {
    return false;
  }
  if (env[NO_REDIRECT_ENV] !== undefined || env[LOCAL_MARKER_ENV] !== undefined) {
    return false;
  }
  return realpathSync(localMain) !== realpathSync(runningMain);
}

/**
 * Report whether the build at `runningMainPath` is a working-copy build. A
 * working copy keeps `src/` beside `dist/`; a published install ships only
 * `dist` and `targets.json`, so it has no `src/`. The package root is
 * `dirname(dirname(runningMainPath))`, i.e. the `.../packages/cli` directory
 * holding both `dist/` and, in a working copy, `src/`.
 */
export function isLocalBuild(runningMainPath: string): boolean {
  const packageRoot = path.dirname(path.dirname(runningMainPath));
  return existsSync(path.join(packageRoot, "src"));
}

/** Map a terminating signal name to the conventional `128 + signal number` exit code. */
function signalExitCode(signal: NodeJS.Signals): number {
  const signalNumber = constants.signals[signal] ?? 0;
  return 128 + signalNumber;
}

/**
 * Re-execute `localMain` as a child of the current Node binary, forwarding
 * `args` verbatim and inheriting standard streams so pipes and interactive
 * prompts pass through. The child is marked with {@link LOCAL_MARKER_ENV} to
 * prevent it from redirecting again.
 *
 * @param localMain - Absolute path to the local build's `dist/main.js`.
 * @param args - Arguments to forward after the program name.
 * @param baseEnv - Environment to layer the local marker over.
 * @returns The child's exit code, or `128 + signal number` when it was killed by
 * a signal.
 */
export function runLocalBuild(localMain: string, args: readonly string[], baseEnv: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [localMain, ...args], {
      stdio: "inherit",
      env: { ...baseEnv, [LOCAL_MARKER_ENV]: "1" },
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve(signal !== null ? signalExitCode(signal) : (code ?? 0));
    });
  });
}

/**
 * When the CLI is invoked from within a `mindcraft-lang` checkout (or a repo
 * embedding it at `external/mindcraft-lang`), transparently re-execute the local
 * working-copy build in place of the installed one, so a developer exercises
 * local code by calling `mindcraft` exactly as a user would. Discovery is
 * anchored at `process.cwd()`.
 *
 * This runs local repository code, like `npx` or a project-local `.bin`; the
 * `name === "mindcraft-cli"` check guards against accidental collision with an
 * unrelated monorepo that also has a `packages/cli`, and is not a security
 * boundary against a hostile repository.
 *
 * @returns True when a local build was re-executed (in which case
 * `process.exitCode` has been set from the child); false when the caller should
 * proceed to run the installed build normally.
 */
export async function maybeRedirectToLocalBuild(): Promise<boolean> {
  const runningMain = realpathSync(fileURLToPath(new URL("main.js", import.meta.url)));
  const startDir = process.cwd();
  const localMain = findLocalCliMain(startDir);

  if (localMain === undefined || !shouldRedirect({ localMain, runningMain, env: process.env })) {
    if (localMain === undefined && hasUnbuiltLocalCli(startDir)) {
      process.stderr.write("mindcraft: local mindcraft-cli found but not built; run npm run build to use it\n");
    }
    return false;
  }

  if (process.env[DEBUG_ENV] !== undefined) {
    process.stderr.write(`mindcraft: redirecting to local build at ${localMain}\n`);
  }
  process.exitCode = await runLocalBuild(localMain, process.argv.slice(2), process.env);
  return true;
}
