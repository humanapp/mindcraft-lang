import { MINDCRAFT_JSON_PATH } from "./mindcraft-json.js";
import {
  parseExtensionReference,
  parseProjectContentManifest,
  readExplicitContentManifestVersion,
  serializeProjectContentManifest,
} from "./project-content-manifest.js";

/** Version component a publish increments. */
export type PublishVersionBump = "patch" | "minor" | "major";

/** One file of a published project tree. */
export interface PublishFile {
  /** Project-relative path of the file. */
  readonly path: string;
  /** File content bytes. */
  readonly content: Uint8Array;
}

/** Reads the content of the project being published. */
export interface ExtensionPublishSource {
  /**
   * Text of the project's `mindcraft.json`, or `undefined` when the project
   * has none.
   */
  readManifest(): Promise<string | undefined>;
  /**
   * Bytes of the project file at a manifest-listed project-relative path, or
   * `undefined` when no such file exists.
   */
  readFile(path: string): Promise<Uint8Array | undefined>;
}

/** The content and tag one publish records on the target repository. */
export interface ExtensionPublishCommit {
  /** Manifest version being published. */
  readonly version: string;
  /** Tag naming the published version (`v<version>`). */
  readonly tag: string;
  /**
   * The published tree: the bumped `mindcraft.json` first, followed by each
   * manifest-listed file.
   */
  readonly files: readonly PublishFile[];
}

/** Performs repository operations for a publish. */
export interface ExtensionPublishBackend {
  /** Resolves `true` when the target repository has no uncommitted changes. */
  isClean(): Promise<boolean>;
  /** Resolves `true` when `tag` already exists on the target repository. */
  tagExists(tag: string): Promise<boolean>;
  /**
   * Text of `mindcraft.json` at the target repository's current head, or
   * `undefined` when the repository is empty or its head carries none.
   */
  readHeadManifest(): Promise<string | undefined>;
  /** Records the publish: commits the files, creates the tag, and pushes both. */
  apply(commit: ExtensionPublishCommit): Promise<void>;
}

/** Stable identifiers for publish refusals. */
export const ExtensionPublishErrorCode = {
  MANIFEST_MISSING: "PUBLISH_MANIFEST_MISSING",
  MANIFEST_INVALID: "PUBLISH_MANIFEST_INVALID",
  LOCAL_DEPENDENCIES_UNCONFIRMED: "PUBLISH_LOCAL_DEPENDENCIES_UNCONFIRMED",
  UNCOMMITTED_CHANGES: "PUBLISH_UNCOMMITTED_CHANGES",
  VERSION_ALREADY_PUBLISHED: "PUBLISH_VERSION_ALREADY_PUBLISHED",
  TAG_EXISTS: "PUBLISH_TAG_EXISTS",
  LISTED_FILE_MISSING: "PUBLISH_LISTED_FILE_MISSING",
} as const;

/** Union of all {@link ExtensionPublishErrorCode} values. */
export type ExtensionPublishErrorCode = (typeof ExtensionPublishErrorCode)[keyof typeof ExtensionPublishErrorCode];

/** A publish refusal. */
export interface ExtensionPublishError {
  /** Stable machine-readable refusal code. */
  readonly code: ExtensionPublishErrorCode;
  /** Human-readable refusal message. */
  readonly message: string;
}

/** Result of {@link publishExtensionVersion}. */
export type ExtensionPublishResult =
  | {
      /** True when the publish was applied. */
      readonly ok: true;
      /** Manifest version that was published. */
      readonly version: string;
      /** Tag recording the published version. */
      readonly tag: string;
    }
  | {
      /** False when the publish was refused before being applied. */
      readonly ok: false;
      /** The refusal. */
      readonly error: ExtensionPublishError;
    };

/** Options for {@link publishExtensionVersion}. */
export interface ExtensionPublishOptions {
  /** Version component to increment. */
  readonly bump: PublishVersionBump;
  /**
   * Confirms publishing a project whose extensions map contains `local:`
   * references. Without this confirmation such a publish is refused.
   */
  readonly allowLocalDependencies?: boolean;
  /** Content of the project being published. */
  readonly source: ExtensionPublishSource;
  /** Repository the publish is recorded on. */
  readonly backend: ExtensionPublishBackend;
}

function refusal(code: ExtensionPublishErrorCode, message: string): ExtensionPublishResult {
  return { ok: false, error: { code, message } };
}

function bumpVersion(version: string, bump: PublishVersionBump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  const major = match ? Number(match[1]) : 0;
  const minor = match ? Number(match[2]) : 0;
  const patch = match ? Number(match[3]) : 0;
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * Publish the next version of a project: reads the project's manifest, bumps
 * its `version` by `bump`, and records the published tree -- the bumped
 * `mindcraft.json` plus every manifest-listed file -- on the target repository
 * as a commit tagged `v<version>`.
 *
 * Refuses without applying anything when the manifest is missing or invalid,
 * the project has unconfirmed `local:` dependencies, the repository has
 * uncommitted changes, the bumped version is already the repository head's
 * manifest version, the tag already exists, or a manifest-listed file is
 * absent. Each refusal carries its {@link ExtensionPublishErrorCode}.
 */
export async function publishExtensionVersion(options: ExtensionPublishOptions): Promise<ExtensionPublishResult> {
  const { source, backend } = options;

  const manifestText = await source.readManifest();
  if (manifestText === undefined) {
    return refusal(ExtensionPublishErrorCode.MANIFEST_MISSING, `The project has no ${MINDCRAFT_JSON_PATH} manifest.`);
  }

  const parsed = parseProjectContentManifest(manifestText);
  if (!parsed.ok) {
    const details = parsed.errors.map((error) => `${error.code} at ${error.path}: ${error.message}`).join(" ");
    return refusal(
      ExtensionPublishErrorCode.MANIFEST_INVALID,
      `${MINDCRAFT_JSON_PATH} is not a valid content manifest. ${details}`
    );
  }
  const manifest = parsed.manifest;

  if (options.allowLocalDependencies !== true) {
    const localCoordinates = Object.entries(manifest.extensions)
      .filter(([, reference]) => parseExtensionReference(reference)?.transport === "local")
      .map(([coordinate]) => coordinate);
    if (localCoordinates.length > 0) {
      return refusal(
        ExtensionPublishErrorCode.LOCAL_DEPENDENCIES_UNCONFIRMED,
        `The project depends on local extensions (${localCoordinates.join(", ")}) and is not self-contained; ` +
          "publishing it requires explicit confirmation."
      );
    }
  }

  const version = bumpVersion(manifest.version, options.bump);
  const tag = `v${version}`;

  if (!(await backend.isClean())) {
    return refusal(ExtensionPublishErrorCode.UNCOMMITTED_CHANGES, "The repository has uncommitted changes.");
  }

  const headManifestText = await backend.readHeadManifest();
  if (headManifestText !== undefined && readExplicitContentManifestVersion(headManifestText) === version) {
    return refusal(
      ExtensionPublishErrorCode.VERSION_ALREADY_PUBLISHED,
      `Version ${version} is already the manifest version at the repository head; ` +
        "update the project's manifest version before publishing."
    );
  }

  if (await backend.tagExists(tag)) {
    return refusal(ExtensionPublishErrorCode.TAG_EXISTS, `Tag ${tag} already exists on the repository.`);
  }

  const bumpedManifest = serializeProjectContentManifest({ ...manifest, version });
  const files: PublishFile[] = [{ path: MINDCRAFT_JSON_PATH, content: new TextEncoder().encode(bumpedManifest) }];
  for (const path of manifest.files ?? []) {
    // The bumped manifest serialized above is the published manifest; a files
    // entry naming it must not overwrite it with the pre-bump bytes.
    if (path === MINDCRAFT_JSON_PATH) continue;
    const content = await source.readFile(path);
    if (content === undefined) {
      return refusal(
        ExtensionPublishErrorCode.LISTED_FILE_MISSING,
        `Manifest-listed file "${path}" was not found in the project.`
      );
    }
    files.push({ path, content });
  }

  await backend.apply({ version, tag, files });
  return { ok: true, version, tag };
}
