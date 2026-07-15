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
import {
  deriveCoordinateFromRemoteUrl,
  ExtensionPublishErrorCode,
  MINDCRAFT_JSON_PATH,
  parseProjectContentManifest,
  publishExtensionVersion,
  serializeProjectContentManifest,
} from "@mindcraft-lang/app-host";
import { GitCommandError, git, tryGit } from "./git.js";

const PUBLISH_USAGE = `usage: mindcraft publish [patch|minor|major] [--dir <path>] [--remote <url>] [--yes]

Publishes a version of the Mindcraft project in --dir (default: the current
directory). With a version bump, the manifest version is incremented; without
one, the manifest's current version is published as-is, which is valid only as
a first publish to a repository that has no tags. Every publish stamps the
published manifest's identity field with the <owner>/<repo> coordinate derived
from the publish remote (origin without --remote); a warning is printed when
the stamp changes a previously recorded identity. Without --remote, the
directory must be a git checkout whose repository is the project: the publish
is committed, tagged v<version>, and the branch and tag are pushed to origin.
With --remote, the project's published tree (mindcraft.json plus its
manifest-listed files) is committed to that remote's default branch and tagged
v<version>, and the published version and identity are written back to the
project directory's mindcraft.json.

  --dir <path>     project directory (default: current directory)
  --remote <url>   git remote to publish the project tree to
  --yes            confirm publishing a project with local: dependencies
`;

/** Stable identifiers for publish command failures beyond the engine's refusals. */
export const PublishCommandErrorCode = {
  WRITE_BACK_FAILED: "PUBLISH_WRITE_BACK_FAILED",
} as const;

/** Union of all {@link PublishCommandErrorCode} values. */
export type PublishCommandErrorCode = (typeof PublishCommandErrorCode)[keyof typeof PublishCommandErrorCode];

const VERSION_BUMPS: readonly PublishVersionBump[] = ["patch", "minor", "major"];

interface PublishArguments {
  /** Version component to increment; absent for an as-is first publish. */
  bump: PublishVersionBump | undefined;
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
    hasAnyTags: async () => {
      if ((await git(dir, "tag", "--list")).trim() !== "") {
        return true;
      }
      return (await git(dir, "ls-remote", "--tags", "origin")).trim() !== "";
    },
    readHeadManifest: () => tryGit(dir, "show", `HEAD:${MINDCRAFT_JSON_PATH}`),
    apply: async ({ tag, files }) => {
      await writePublishFiles(dir, files);
      await git(dir, "add", "--", ...files.map((file) => file.path));
      // An as-is publish can leave the tree identical to head; the tag alone
      // records the publish then.
      if ((await tryGit(dir, "diff", "--cached", "--quiet")) === undefined) {
        await git(dir, "commit", "-m", tag);
      }
      await git(dir, "tag", tag);
      await git(dir, "push", "origin", "HEAD", `refs/tags/${tag}`);
    },
  };
}

/**
 * Publish the checkout at `dir` in place: bump, commit, tag, and push on the
 * repository the directory itself is a checkout of. The stamped identity
 * coordinate derives from the checkout's `origin` remote URL.
 */
async function publishInCheckout(options: PublishArguments): Promise<ExtensionPublishResult> {
  const originUrl = (await tryGit(options.dir, "remote", "get-url", "origin"))?.trim();
  return publishExtensionVersion({
    bump: options.bump,
    coordinate: originUrl === undefined ? undefined : deriveCoordinateFromRemoteUrl(originUrl),
    allowLocalDependencies: options.yes,
    source: directoryContentSource(options.dir),
    backend: checkoutPublishBackend(options.dir),
  });
}

/**
 * Publish the project directory's manifest-described tree to `remote` through
 * a temporary clone: the clone's working tree is replaced with the publish
 * files, committed to the remote's default branch, tagged, and pushed. The
 * stamped identity coordinate derives from the `remote` URL.
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
      hasAnyTags: async () => (await git(clone, "tag", "--list")).trim() !== "",
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
      coordinate: deriveCoordinateFromRemoteUrl(remote),
      allowLocalDependencies: options.yes,
      source: directoryContentSource(options.dir),
      backend,
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Write a successful publish's version and stamped identity into the source
 * directory's `mindcraft.json` through the manifest serializer, leaving every
 * other field as parsed. Throws when the manifest cannot be read, parsed, or
 * written.
 */
async function writeBackPublishedManifest(dir: string, version: string, identity: string): Promise<void> {
  const manifestPath = path.join(dir, MINDCRAFT_JSON_PATH);
  const parsed = parseProjectContentManifest(await readFile(manifestPath, "utf8"));
  if (!parsed.ok) {
    throw new Error(`${manifestPath} is no longer a valid content manifest`);
  }
  await writeFile(manifestPath, serializeProjectContentManifest({ ...parsed.manifest, version, identity }));
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
    if (result.previousIdentity !== undefined) {
      process.stderr.write(`warning: identity changed: ${result.previousIdentity} -> ${result.identity}\n`);
    }
    if (parsed.remote !== undefined) {
      try {
        await writeBackPublishedManifest(parsed.dir, result.version, result.identity);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `mindcraft publish: ${PublishCommandErrorCode.WRITE_BACK_FAILED}: version ${result.version} was ` +
            `published (tag ${result.tag}), but writing it back to ${path.join(parsed.dir, MINDCRAFT_JSON_PATH)} ` +
            `failed: ${message}\n`
        );
        return 1;
      }
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
