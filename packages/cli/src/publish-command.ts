import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ExtensionPublishBackend,
  ExtensionPublishResult,
  ExtensionPublishSource,
  PublishFile,
  PublishVersionBump,
} from "@mindcraft-lang/app-host";
import { ExtensionPublishErrorCode, MINDCRAFT_JSON_PATH, publishExtensionVersion } from "@mindcraft-lang/app-host";
import { GitCommandError, git, tryGit } from "./git.js";

const PUBLISH_USAGE = `usage: mindcraft publish <patch|minor|major> [--dir <path>] [--remote <url>] [--yes]

Publishes the next version of the Mindcraft project in --dir (default: the
current directory). Without --remote, the directory must be a git checkout
whose repository is the project: the manifest version is bumped, committed,
tagged v<version>, and the branch and tag are pushed to origin. With --remote,
the project's published tree (mindcraft.json plus its manifest-listed files)
is committed to that remote's default branch and tagged v<version>.

  --dir <path>     project directory (default: current directory)
  --remote <url>   git remote to publish the project tree to
  --yes            confirm publishing a project with local: dependencies
`;

const VERSION_BUMPS: readonly PublishVersionBump[] = ["patch", "minor", "major"];

interface PublishArguments {
  bump: PublishVersionBump;
  dir: string;
  remote: string | undefined;
  yes: boolean;
}

function isVersionBump(value: string): value is PublishVersionBump {
  return (VERSION_BUMPS as readonly string[]).includes(value);
}

function parsePublishArguments(args: readonly string[]): PublishArguments | string {
  let bump: PublishVersionBump | undefined;
  let dir = process.cwd();
  let remote: string | undefined;
  let yes = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--yes") {
      yes = true;
    } else if (arg === "--dir" || arg === "--remote") {
      const value = args[i + 1];
      if (value === undefined) {
        return `${arg} requires a value`;
      }
      i++;
      if (arg === "--dir") {
        dir = path.resolve(value);
      } else {
        remote = value;
      }
    } else if (isVersionBump(arg)) {
      if (bump !== undefined) {
        return `unexpected argument "${arg}"`;
      }
      bump = arg;
    } else {
      return `unexpected argument "${arg}"`;
    }
  }

  if (bump === undefined) {
    return "expected a version bump: patch, minor, or major";
  }
  return { bump, dir, remote, yes };
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * A publish content source over a project directory: the manifest is
 * `<dir>/mindcraft.json`, and listed files resolve relative to `dir`. Paths
 * that resolve outside `dir` read as absent.
 */
function directoryContentSource(dir: string): ExtensionPublishSource {
  const root = path.resolve(dir);
  return {
    readManifest: async () => {
      try {
        return await readFile(path.join(root, MINDCRAFT_JSON_PATH), "utf8");
      } catch (error) {
        if (isFileNotFound(error)) return undefined;
        throw error;
      }
    },
    readFile: async (filePath) => {
      const resolved = path.resolve(root, filePath);
      const relative = path.relative(root, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return undefined;
      }
      try {
        return new Uint8Array(await readFile(resolved));
      } catch (error) {
        if (isFileNotFound(error)) return undefined;
        throw error;
      }
    },
  };
}

async function writePublishFiles(root: string, files: readonly PublishFile[]): Promise<void> {
  for (const file of files) {
    const target = path.join(root, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

/**
 * A publish backend over a git checkout whose repository root is `dir`: the
 * repository's own history defines the published content. Applying a publish
 * writes the publish files into the checkout, commits them, tags, and pushes
 * the current branch and the tag to `origin`.
 */
function checkoutPublishBackend(dir: string): ExtensionPublishBackend {
  return {
    isClean: async () => (await git(dir, "status", "--porcelain")).trim() === "",
    tagExists: async (tag) => {
      if ((await tryGit(dir, "rev-parse", "--verify", `refs/tags/${tag}`)) !== undefined) {
        return true;
      }
      const remoteTag = await git(dir, "ls-remote", "--tags", "origin", `refs/tags/${tag}`);
      return remoteTag.trim() !== "";
    },
    readHeadManifest: () => tryGit(dir, "show", `HEAD:${MINDCRAFT_JSON_PATH}`),
    apply: async ({ tag, files }) => {
      await writePublishFiles(dir, files);
      await git(dir, "add", "--", ...files.map((file) => file.path));
      await git(dir, "commit", "-m", tag);
      await git(dir, "tag", tag);
      await git(dir, "push", "origin", "HEAD", `refs/tags/${tag}`);
    },
  };
}

/**
 * Publish the checkout at `dir` in place: bump, commit, tag, and push on the
 * repository the directory itself is a checkout of.
 */
async function publishInCheckout(options: PublishArguments): Promise<ExtensionPublishResult> {
  return publishExtensionVersion({
    bump: options.bump,
    allowLocalDependencies: options.yes,
    source: directoryContentSource(options.dir),
    backend: checkoutPublishBackend(options.dir),
  });
}

/**
 * Publish the project directory's manifest-described tree to `remote` through
 * a temporary clone: the clone's working tree is replaced with the publish
 * files, committed to the remote's default branch, tagged, and pushed.
 */
async function publishToRemote(options: PublishArguments, remote: string): Promise<ExtensionPublishResult> {
  const scratch = await mkdtemp(path.join(tmpdir(), "mindcraft-publish-"));
  try {
    const clone = path.join(scratch, "repo");
    await git(scratch, "clone", "--quiet", remote, clone);
    const branch = (await git(clone, "symbolic-ref", "--short", "HEAD")).trim();

    const backend: ExtensionPublishBackend = {
      isClean: async () => true,
      tagExists: async (tag) => (await tryGit(clone, "rev-parse", "--verify", `refs/tags/${tag}`)) !== undefined,
      readHeadManifest: async () => {
        try {
          return await readFile(path.join(clone, MINDCRAFT_JSON_PATH), "utf8");
        } catch (error) {
          if (isFileNotFound(error)) return undefined;
          throw error;
        }
      },
      apply: async ({ tag, files }) => {
        for (const entry of await readdir(clone)) {
          if (entry === ".git") continue;
          await rm(path.join(clone, entry), { recursive: true, force: true });
        }
        await writePublishFiles(clone, files);
        await git(clone, "add", "--all");
        await git(clone, "commit", "-m", tag);
        await git(clone, "tag", tag);
        await git(clone, "push", "--quiet", "origin", branch, `refs/tags/${tag}`);
      },
    };

    return await publishExtensionVersion({
      bump: options.bump,
      allowLocalDependencies: options.yes,
      source: directoryContentSource(options.dir),
      backend,
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Run `mindcraft publish` with the arguments following the subcommand name.
 * Returns the process exit code.
 */
export async function runPublishCommand(args: readonly string[]): Promise<number> {
  const parsed = parsePublishArguments(args);
  if (typeof parsed === "string") {
    process.stderr.write(`mindcraft publish: ${parsed}\n${PUBLISH_USAGE}`);
    return 1;
  }

  try {
    const result =
      parsed.remote !== undefined ? await publishToRemote(parsed, parsed.remote) : await publishInCheckout(parsed);
    if (!result.ok) {
      process.stderr.write(`mindcraft publish: ${result.error.code}: ${result.error.message}\n`);
      if (result.error.code === ExtensionPublishErrorCode.LOCAL_DEPENDENCIES_UNCONFIRMED) {
        process.stderr.write("Pass --yes to publish anyway.\n");
      }
      return 1;
    }
    process.stdout.write(`published ${result.version} (tag ${result.tag})\n`);
    return 0;
  } catch (error) {
    if (error instanceof GitCommandError) {
      process.stderr.write(`mindcraft publish: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
