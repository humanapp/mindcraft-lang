import type { Stats } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UnpackRefusal } from "@wendoo-lang/app-host";
import {
  buildUnpackedTree,
  fileContentToBytes,
  isExtensionCoordinate,
  isUnpackRefusal,
  seedProjectTargets,
  UnpackErrorCode,
  WENDOO_JSON_PATH,
} from "@wendoo-lang/app-host";
import { parseWendooProjectDocument } from "@wendoo-lang/service-api";
import { loadTargetRegistry } from "./target-registry.js";

const UNPACK_USAGE = `usage: wendoo unpack <file.wendoo> [dir] [--coordinate <owner/repo>] [--force]

Converts a .wendoo export document into a publishable project directory:
the document's embedded manifest is written as wendoo.json and every file
in its contents is written to disk. A manifest that declares no files list
gets one naming every unpacked file, including scratch files that happened to
be in the exported workspace; prune wendoo.json before publishing.

  dir                          target directory (default: the document's base
                               name, in the current directory)
  --coordinate <owner/repo>    record the project's own published identity in
                               the manifest's identity field
  --force                      unpack into a non-empty target directory
`;

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
    return "expected a .wendoo document to unpack";
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
 * Run `wendoo unpack` with the arguments following the subcommand name.
 * Returns the process exit code.
 */
export async function runUnpackCommand(args: readonly string[]): Promise<number> {
  const parsed = parseUnpackArguments(args);
  if (typeof parsed === "string") {
    process.stderr.write(`wendoo unpack: ${parsed}\n${UNPACK_USAGE}`);
    return 1;
  }

  const refuse = (refusal: UnpackRefusal): number => {
    process.stderr.write(`wendoo unpack: ${refusal.code}: ${refusal.message}\n`);
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

  const documentResult = parseWendooProjectDocument(text);
  if (!documentResult.ok) {
    const details = documentResult.errors.map((error) => `${error.code} at ${error.path}: ${error.message}`).join(" ");
    return refuse({
      code: UnpackErrorCode.DOCUMENT_INVALID,
      message: `"${parsed.file}" is not a valid .wendoo project document. ${details}`,
    });
  }

  const tree = buildUnpackedTree(documentResult.document, parsed.coordinate);
  if (isUnpackRefusal(tree)) {
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
    await writeFile(target, fileContentToBytes(file.content));
  }
  const manifestText = seedProjectTargets(tree.manifestText, loadTargetRegistry().entries);
  await writeFile(path.join(parsed.dir, WENDOO_JSON_PATH), manifestText, "utf8");

  process.stdout.write(`unpacked ${tree.files.length} project files and ${WENDOO_JSON_PATH} into ${parsed.dir}\n`);
  if (!tree.declaredFilesList && tree.files.length > 0) {
    process.stdout.write(
      "note: the manifest's files list names everything the export carried, including scratch\n" +
        "files; prune wendoo.json before publishing.\n"
    );
  }
  return 0;
}
