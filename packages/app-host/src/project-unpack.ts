import type { FileContent, MindcraftProjectDocument } from "@mindcraft-lang/service-api";
import { fileContentFromWire } from "@mindcraft-lang/service-api";
import { MINDCRAFT_JSON_PATH } from "./mindcraft-json.js";
import type { ProjectContentManifest } from "./project-content-manifest.js";
import { serializeProjectContentManifest, validateProjectContentManifest } from "./project-content-manifest.js";

/** Stable identifiers for unpack refusals. */
export const UnpackErrorCode = {
  DOCUMENT_MISSING: "UNPACK_DOCUMENT_MISSING",
  DOCUMENT_INVALID: "UNPACK_DOCUMENT_INVALID",
  INVALID_COORDINATE: "UNPACK_INVALID_COORDINATE",
  TARGET_DIR_NOT_EMPTY: "UNPACK_TARGET_DIR_NOT_EMPTY",
} as const;

/** Union of all {@link UnpackErrorCode} values. */
export type UnpackErrorCode = (typeof UnpackErrorCode)[keyof typeof UnpackErrorCode];

/** A refusal to unpack, carrying its stable code. */
export interface UnpackRefusal {
  /** Stable identifier for the refusal. */
  code: UnpackErrorCode;
  /** Human-readable explanation of the refusal. */
  message: string;
}

/** The publishable-repo tree {@link buildUnpackedTree} assembles from a project document. */
export interface UnpackedTree {
  /** Serialized `mindcraft.json` of the unpacked project. */
  manifestText: string;
  /** Every non-manifest document file, in document order. */
  files: readonly { path: string; content: FileContent }[];
  /** True when the files list came from the embedded manifest's own declaration. */
  declaredFilesList: boolean;
}

/**
 * Assemble the publishable-repo tree from a project document: the document's
 * contents plus its embedded manifest, with the identity recorded when a
 * coordinate is given and a files list synthesized from the contents when the
 * manifest declares none. Returns an {@link UnpackRefusal} carrying
 * {@link UnpackErrorCode.DOCUMENT_INVALID} when the embedded manifest is not a
 * valid content manifest. Pure: it reads no filesystem and writes nothing.
 *
 * @param document - Parsed `.mindcraft` document to unpack.
 * @param coordinate - `<owner>/<repo>` recorded in the manifest's `identity`
 *   field, or `undefined` to leave the identity unset.
 */
export function buildUnpackedTree(
  document: MindcraftProjectDocument,
  coordinate: string | undefined
): UnpackedTree | UnpackRefusal {
  const validated = validateProjectContentManifest(document.manifest);
  if (!validated.ok) {
    const details = validated.errors.map((error) => `${error.code} at ${error.path}: ${error.message}`).join(" ");
    return {
      code: UnpackErrorCode.DOCUMENT_INVALID,
      message: `The document's embedded manifest is not a valid content manifest. ${details}`,
    };
  }

  const files = Object.entries(document.contents)
    .filter(([filePath]) => filePath !== MINDCRAFT_JSON_PATH)
    .map(([filePath, content]) => ({
      path: filePath,
      content: typeof content === "string" ? content : fileContentFromWire(content),
    }));

  const declaredFilesList = validated.manifest.files !== undefined;
  const manifest: ProjectContentManifest = {
    ...validated.manifest,
    ...(coordinate !== undefined ? { identity: coordinate } : {}),
    ...(declaredFilesList ? {} : { files: files.map((file) => file.path) }),
  };

  return { manifestText: serializeProjectContentManifest(manifest), files, declaredFilesList };
}

/** Type guard: true when {@link buildUnpackedTree} yielded a refusal. */
export function isUnpackRefusal(value: UnpackedTree | UnpackRefusal): value is UnpackRefusal {
  return "code" in value;
}
