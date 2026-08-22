import { existsSync, readFileSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { parseProjectContentManifest, WENDOO_JSON_PATH } from "@wendoo-lang/app-host";
import type { EmbeddedExtension, EmbeddedExtensionFile } from "./embedded-extensions.js";
import { findMissingListedFiles } from "./manifest-files.js";

/**
 * Map a manifest `files` entry to the extension-relative path it occupies in the
 * assembled bundle. An entry that stays within the extension directory keeps its
 * directory-relative path; an entry the manifest pulls in from outside that
 * directory (a generated artifact reached through `..`) is placed at the
 * extension root under its base name.
 */
function bundlePathFor(dir: string, entry: string): string {
  const rel = relative(dir, resolve(dir, entry));
  return rel.startsWith("..") ? basename(entry) : rel.split(sep).join("/");
}

/**
 * Read and parse the `files` list an extension declares in its own
 * `wendoo.json`. An extension must declare content `files` or a `hostApp`
 * bundle: a library names its content files, and a target (a `hostApp`) carries
 * no library content, so it resolves to an empty file list. A manifest that
 * declares neither is rejected.
 */
function readManifestFiles(dir: string): { manifestText: string; files: readonly string[] } {
  const manifestPath = resolve(dir, WENDOO_JSON_PATH);
  if (!existsSync(manifestPath)) {
    throw new Error(`Embedded extension at ${dir} has no ${WENDOO_JSON_PATH}.`);
  }
  const manifestText = readFileSync(manifestPath, "utf8");
  const parsed = parseProjectContentManifest(manifestText);
  if (!parsed.ok) {
    throw new Error(
      `Embedded extension manifest at ${manifestPath} is invalid: ` +
        parsed.errors.map((e) => `${e.path} ${e.message}`).join("; ")
    );
  }
  if (parsed.manifest.files === undefined) {
    if (parsed.manifest.hostApp !== undefined) {
      return { manifestText, files: [] };
    }
    throw new Error(
      `Embedded extension manifest at ${manifestPath} must declare a "files" list naming its content, or a "hostApp" bundle.`
    );
  }
  return { manifestText, files: parsed.manifest.files };
}

/**
 * Return the declared `files` entries an extension names but that do not exist on
 * disk, resolved relative to the extension's manifest directory. An empty result
 * means every listed file is present. Files present on disk but absent from the
 * list are valid content exclusions and are never reported: this checks only the
 * error direction, a listed file the build cannot assemble.
 *
 * @param dir - Directory holding the extension's `wendoo.json`.
 */
export function findMissingExtensionFiles(dir: string): readonly string[] {
  const { files } = readManifestFiles(dir);
  return findMissingListedFiles(files, (entry) => existsSync(resolve(dir, entry)));
}

/**
 * Absolute paths of every on-disk file that backs an embedded extension: its
 * `wendoo.json` plus each file its `files` list names. A build-time provider
 * watches these so editing extension source refreshes the assembled bundle.
 *
 * @param dir - Directory holding the extension's `wendoo.json`.
 */
export function extensionSourceFiles(dir: string): readonly string[] {
  const { files } = readManifestFiles(dir);
  return [resolve(dir, WENDOO_JSON_PATH), ...files.map((entry) => resolve(dir, entry))];
}

/**
 * Assemble an embedded extension by reading its `wendoo.json` from `dir`,
 * loading exactly the files its `files` list names, and returning the bundle
 * keyed by `canonicalOrigin`. The manifest is included at the extension root as
 * `wendoo.json` and is never listed by `files`. Each listed entry is resolved
 * relative to `dir` and bundled at its extension-relative path.
 *
 * @param dir - Directory holding the extension's `wendoo.json`.
 * @param canonicalOrigin - The `<owner>/<repo>` coordinate the bundle is keyed under.
 * @throws {Error} when the manifest is missing, invalid, declares neither
 *   `files` nor a `hostApp` bundle, or names a file absent from disk.
 */
export function buildEmbeddedExtensionFromDir(dir: string, canonicalOrigin: string): EmbeddedExtension {
  const { manifestText, files: declared } = readManifestFiles(dir);

  const missing = findMissingExtensionFiles(dir);
  if (missing.length > 0) {
    throw new Error(
      `Embedded extension "${canonicalOrigin}" at ${dir} declares files absent from disk: ${missing.join(", ")}.`
    );
  }

  const files: EmbeddedExtensionFile[] = declared.map((entry) => ({
    path: bundlePathFor(dir, entry),
    content: readFileSync(resolve(dir, entry), "utf8"),
  }));
  files.push({ path: WENDOO_JSON_PATH, content: manifestText });

  return { canonicalOrigin, files };
}
