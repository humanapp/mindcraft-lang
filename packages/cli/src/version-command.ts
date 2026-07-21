import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PublishVersionBump } from "@mindcraft-lang/app-host";
import {
  bumpVersion,
  MINDCRAFT_JSON_PATH,
  parseProjectContentManifest,
  serializeProjectContentManifest,
} from "@mindcraft-lang/app-host";

const VERSION_USAGE = `usage: mindcraft version <patch|minor|major> [--dir <path>]

Increments the version of the Mindcraft project in --dir (default: the current
directory) by the named component and writes it back to the project's
mindcraft.json. Run this before packaging a target so the built bundle is baked
at the new version; the target is then published verbatim, without a bump.

  --dir <path>     project directory (default: current directory)
`;

/** Stable identifiers for version command failures. */
export const VersionCommandErrorCode = {
  MANIFEST_MISSING: "VERSION_MANIFEST_MISSING",
  MANIFEST_INVALID: "VERSION_MANIFEST_INVALID",
} as const;

/** Union of all {@link VersionCommandErrorCode} values. */
export type VersionCommandErrorCode = (typeof VersionCommandErrorCode)[keyof typeof VersionCommandErrorCode];

const VERSION_BUMPS: readonly PublishVersionBump[] = ["patch", "minor", "major"];

interface VersionArguments {
  /** Version component to increment. */
  bump: PublishVersionBump;
  dir: string;
}

function isVersionBump(value: string): value is PublishVersionBump {
  return (VERSION_BUMPS as readonly string[]).includes(value);
}

function parseVersionArguments(args: readonly string[]): VersionArguments | string {
  let bump: PublishVersionBump | undefined;
  let dir = process.cwd();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dir") {
      const value = args[i + 1];
      if (value === undefined) {
        return `${arg} requires a value`;
      }
      i++;
      dir = path.resolve(value);
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
    return "a version component (patch, minor, or major) is required";
  }
  return { bump, dir };
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Run `mindcraft version` with the arguments following the subcommand name:
 * read the project's `mindcraft.json`, increment its version by the named
 * component through the shared bump engine, and write it back. Returns the
 * process exit code.
 */
export async function runVersionCommand(args: readonly string[]): Promise<number> {
  const parsed = parseVersionArguments(args);
  if (typeof parsed === "string") {
    process.stderr.write(`mindcraft version: ${parsed}\n${VERSION_USAGE}`);
    return 1;
  }

  const manifestPath = path.join(parsed.dir, MINDCRAFT_JSON_PATH);
  let manifestText: string;
  try {
    manifestText = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) {
      process.stderr.write(
        `mindcraft version: ${VersionCommandErrorCode.MANIFEST_MISSING}: ${manifestPath} does not exist.\n`
      );
      return 1;
    }
    throw error;
  }

  const parseResult = parseProjectContentManifest(manifestText);
  if (!parseResult.ok) {
    const details = parseResult.errors.map((error) => `${error.code} at ${error.path}: ${error.message}`).join(" ");
    process.stderr.write(
      `mindcraft version: ${VersionCommandErrorCode.MANIFEST_INVALID}: ${manifestPath} is not a valid ` +
        `content manifest. ${details}\n`
    );
    return 1;
  }

  const next = bumpVersion(parseResult.manifest.version, parsed.bump);
  await writeFile(manifestPath, serializeProjectContentManifest({ ...parseResult.manifest, version: next }));
  process.stdout.write(`version ${next}\n`);
  return 0;
}
