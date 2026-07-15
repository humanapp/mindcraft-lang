import type { Stats } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MindcraftProjectDocument, ProjectContentManifest } from "@mindcraft-lang/app-host";
import {
  isExtensionCoordinate,
  MINDCRAFT_JSON_PATH,
  parseProjectContentManifest,
  serializeProjectContentManifest,
} from "@mindcraft-lang/app-host";
import { parseMindcraftProjectDocument } from "@mindcraft-lang/service-api";

const UNPACK_USAGE = `usage: mindcraft unpack <file.mindcraft> [dir] [--coordinate <owner/repo>] [--force]

Converts a .mindcraft export document into a publishable project directory:
every document file is written to disk, and mindcraft.json is assembled from
the document's project data with everything else the document carries (brains,
app-specific target data) preserved verbatim. The assembled files list names
every unpacked file, including scratch files that happened to be in the
exported workspace; prune mindcraft.json before publishing. After this
graduation the repository is the canonical project -- re-exporting from the
app is a release ritual, not a sync.

  dir                          target directory (default: the document's base
                               name, in the current directory)
  --coordinate <owner/repo>    record the project's own published identity in
                               the manifest's identity field
  --force                      unpack into a non-empty target directory
`;

/** Stable identifiers for unpack refusals. */
export const UnpackErrorCode = {
  DOCUMENT_MISSING: "UNPACK_DOCUMENT_MISSING",
  DOCUMENT_INVALID: "UNPACK_DOCUMENT_INVALID",
  INVALID_COORDINATE: "UNPACK_INVALID_COORDINATE",
  TARGET_DIR_NOT_EMPTY: "UNPACK_TARGET_DIR_NOT_EMPTY",
} as const;

/** Union of all {@link UnpackErrorCode} values. */
export type UnpackErrorCode = (typeof UnpackErrorCode)[keyof typeof UnpackErrorCode];

interface UnpackArguments {
  file: string;
  dir: string;
  coordinate: string | undefined;
  force: boolean;
}

function parseUnpackArguments(args: readonly string[]): UnpackArguments | string {
  const positional: string[] = [];
  let coordinate: string | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force") {
      force = true;
    } else if (arg === "--coordinate") {
      const value = args[i + 1];
      if (value === undefined) {
        return `${arg} requires a value`;
      }
      i++;
      coordinate = value;
    } else if (arg.startsWith("--")) {
      return `unexpected argument "${arg}"`;
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    return "expected a .mindcraft document to unpack";
  }
  if (positional.length > 2) {
    return `unexpected argument "${positional[2]}"`;
  }

  const file = path.resolve(positional[0]);
  const dir =
    positional[1] !== undefined
      ? path.resolve(positional[1])
      : path.resolve(path.basename(positional[0], path.extname(positional[0])));
  return { file, dir, coordinate, force };
}

/** A refusal to unpack, carrying its stable code. */
interface UnpackRefusal {
  code: UnpackErrorCode;
  message: string;
}

/** Document root fields the unpack maps onto manifest schema fields or the unpacked tree. */
const MAPPED_DOCUMENT_FIELDS: ReadonlySet<string> = new Set([
  "format",
  "name",
  "version",
  "description",
  "thumbnailUrl",
  "files",
  "extensions",
  "targets",
]);

/**
 * Manifest extras key carrying the document's `targets` map (per-target
 * project data keyed by package name). The manifest's own `targets` field is
 * the platform-compatibility map, a different concept, so the document's map
 * is carried under this key.
 */
const PROJECT_TARGETS_EXTRAS_KEY = "projectTargets";

interface UnpackedTree {
  /** Serialized `mindcraft.json` of the unpacked project. */
  manifestText: string;
  /** Every non-manifest document file, in document order. */
  files: readonly { path: string; content: string }[];
  /** True when the manifest's files list came from a manifest carried inside the document. */
  preservedFilesList: boolean;
}

/**
 * Assemble the published-repo tree from a validated document: the document's
 * files, and a content manifest carrying the document's project data plus
 * every unmapped document field verbatim as extras.
 */
function buildUnpackedTree(
  document: MindcraftProjectDocument,
  raw: Readonly<Record<string, unknown>>,
  coordinate: string | undefined
): UnpackedTree | UnpackRefusal {
  const files = document.files.filter((file) => file.path !== MINDCRAFT_JSON_PATH);

  // A mindcraft.json carried inside the document is the project's own
  // manifest; when it declares a files list, that list is preserved instead
  // of synthesizing one.
  let preservedFiles: readonly string[] | undefined;
  const carriedManifest = document.files.find((file) => file.path === MINDCRAFT_JSON_PATH);
  if (carriedManifest !== undefined) {
    const parsed = parseProjectContentManifest(carriedManifest.content);
    if (parsed.ok) {
      preservedFiles = parsed.manifest.files;
    }
  }
  const filesList = preservedFiles ?? files.map((file) => file.path);

  let extras: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(raw)) {
    if (MAPPED_DOCUMENT_FIELDS.has(key)) continue;
    extras ??= {};
    extras[key] = value;
  }
  if (raw.targets !== undefined) {
    extras ??= {};
    extras[PROJECT_TARGETS_EXTRAS_KEY] = raw.targets;
  }

  const manifest: ProjectContentManifest = {
    name: document.name,
    version: document.version,
    ...(coordinate !== undefined ? { identity: coordinate } : {}),
    ...(document.description !== "" ? { description: document.description } : {}),
    ...(document.thumbnailUrl !== undefined ? { thumbnailUrl: document.thumbnailUrl } : {}),
    extensions: document.extensions ?? {},
    ...(filesList.length > 0 ? { files: filesList } : {}),
    ...(extras !== undefined ? { extras } : {}),
  };

  const manifestText = serializeProjectContentManifest(manifest);
  const validated = parseProjectContentManifest(manifestText);
  if (!validated.ok) {
    const details = validated.errors.map((error) => `${error.code} at ${error.path}: ${error.message}`).join(" ");
    return {
      code: UnpackErrorCode.DOCUMENT_INVALID,
      message: `The document's fields do not assemble into a valid content manifest. ${details}`,
    };
  }

  return { manifestText, files, preservedFilesList: preservedFiles !== undefined };
}

function isRefusal(value: UnpackedTree | UnpackRefusal): value is UnpackRefusal {
  return "code" in value;
}

/** Refuse an unusable target: an existing non-directory, or a non-empty directory without `force`. */
async function checkTargetDir(dir: string, force: boolean): Promise<UnpackRefusal | undefined> {
  let info: Stats;
  try {
    info = await stat(dir);
  } catch {
    return undefined;
  }
  if (!info.isDirectory()) {
    return {
      code: UnpackErrorCode.TARGET_DIR_NOT_EMPTY,
      message: `Target "${dir}" exists and is not a directory.`,
    };
  }
  if (!force && (await readdir(dir)).length > 0) {
    return {
      code: UnpackErrorCode.TARGET_DIR_NOT_EMPTY,
      message: `Target directory "${dir}" is not empty; pass --force to unpack into it anyway.`,
    };
  }
  return undefined;
}

/**
 * Run `mindcraft unpack` with the arguments following the subcommand name.
 * Returns the process exit code.
 */
export async function runUnpackCommand(args: readonly string[]): Promise<number> {
  const parsed = parseUnpackArguments(args);
  if (typeof parsed === "string") {
    process.stderr.write(`mindcraft unpack: ${parsed}\n${UNPACK_USAGE}`);
    return 1;
  }

  const refuse = (refusal: UnpackRefusal): number => {
    process.stderr.write(`mindcraft unpack: ${refusal.code}: ${refusal.message}\n`);
    return 1;
  };

  if (parsed.coordinate !== undefined && !isExtensionCoordinate(parsed.coordinate)) {
    return refuse({
      code: UnpackErrorCode.INVALID_COORDINATE,
      message: `--coordinate must be "<owner>/<repo>", got "${parsed.coordinate}".`,
    });
  }

  let text: string;
  try {
    text = await readFile(parsed.file, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return refuse({
      code: UnpackErrorCode.DOCUMENT_MISSING,
      message: `Cannot read "${parsed.file}": ${message}`,
    });
  }

  const documentResult = parseMindcraftProjectDocument(text);
  if (!documentResult.ok) {
    const details = documentResult.errors.map((error) => `${error.code} at ${error.path}: ${error.message}`).join(" ");
    return refuse({
      code: UnpackErrorCode.DOCUMENT_INVALID,
      message: `"${parsed.file}" is not a valid .mindcraft project document. ${details}`,
    });
  }
  const raw = JSON.parse(text) as Readonly<Record<string, unknown>>;

  const tree = buildUnpackedTree(documentResult.document, raw, parsed.coordinate);
  if (isRefusal(tree)) {
    return refuse(tree);
  }

  const targetRefusal = await checkTargetDir(parsed.dir, parsed.force);
  if (targetRefusal !== undefined) {
    return refuse(targetRefusal);
  }

  await mkdir(parsed.dir, { recursive: true });
  for (const file of tree.files) {
    const target = path.join(parsed.dir, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
  await writeFile(path.join(parsed.dir, MINDCRAFT_JSON_PATH), tree.manifestText, "utf8");

  process.stdout.write(`unpacked ${tree.files.length} project files and ${MINDCRAFT_JSON_PATH} into ${parsed.dir}\n`);
  if (!tree.preservedFilesList && tree.files.length > 0) {
    process.stdout.write(
      "note: the manifest's files list names everything the export carried, including scratch\n" +
        "files; prune mindcraft.json before publishing.\n"
    );
  }
  process.stdout.write(
    "The unpacked repository is now the canonical project; re-exporting from the app is a\n" +
      "release ritual, not a sync.\n"
  );
  return 0;
}
