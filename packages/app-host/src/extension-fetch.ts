import { MINDCRAFT_JSON_PATH } from "./mindcraft-json.js";
import type { ProjectContentManifest } from "./project-content-manifest.js";
import { parseExtensionReference, parseProjectContentManifest } from "./project-content-manifest.js";

/** One file of a fetched extension snapshot, at its extension-relative path. */
export interface FetchedExtensionFile {
  /** Extension-relative path (e.g. `index.ts`). */
  readonly path: string;
  /** Exact file bytes as served by the source. */
  readonly content: Uint8Array;
}

/** Result of one transport file request. */
export type ExtensionFetchFileResult =
  | {
      /** True when the file was retrieved. */
      readonly ok: true;
      /** Exact file bytes. */
      readonly content: Uint8Array;
    }
  | {
      readonly ok: false;
      /** The file does not exist at the requested location. */
      readonly kind: "not-found";
    }
  | {
      readonly ok: false;
      /** The source answered with an unexpected HTTP status. */
      readonly kind: "http-status";
      /** The HTTP status code received. */
      readonly status: number;
    }
  | {
      readonly ok: false;
      /** The source could not be reached at all. */
      readonly kind: "unreachable";
      /** Human-readable failure detail. */
      readonly message: string;
    };

/** Result of one transport branch-resolution request. */
export type ExtensionFetchBranchResult =
  | {
      /** True when the branch resolved to a commit. */
      readonly ok: true;
      /** Commit SHA at the branch head. */
      readonly sha: string;
    }
  | {
      readonly ok: false;
      /** The branch does not exist on the repository. */
      readonly kind: "not-found";
    }
  | {
      readonly ok: false;
      /** The source refused the request because its anonymous rate limit is exhausted. */
      readonly kind: "rate-limited";
    }
  | {
      readonly ok: false;
      /** The source answered with an unexpected HTTP status. */
      readonly kind: "http-status";
      /** The HTTP status code received. */
      readonly status: number;
    }
  | {
      readonly ok: false;
      /** The source could not be reached at all. */
      readonly kind: "unreachable";
      /** Human-readable failure detail. */
      readonly message: string;
    };

/** Result of one transport version-listing request. */
export type ExtensionVersionListResult =
  | {
      /** True when the repository's published versions were listed. */
      readonly ok: true;
      /** Published version strings, as the source reports them; empty when the repository has no published versions. */
      readonly versions: readonly string[];
    }
  | {
      readonly ok: false;
      /** The source knows no versions for the repository. */
      readonly kind: "not-found";
    }
  | {
      readonly ok: false;
      /** The source answered with an unexpected HTTP status. */
      readonly kind: "http-status";
      /** The HTTP status code received. */
      readonly status: number;
    }
  | {
      readonly ok: false;
      /** The source could not be reached at all. */
      readonly kind: "unreachable";
      /** Human-readable failure detail. */
      readonly message: string;
    };

/**
 * Retrieves repository content for extension fetches. The routing specifier
 * passed to {@link fetchFile} is opaque: a tag or a full commit SHA, forwarded
 * as written.
 */
export interface ExtensionFetchTransport {
  /** Fetch the file at `path` in `<owner>/<repo>` at the immutable specifier `pin`. */
  fetchFile(owner: string, repo: string, pin: string, path: string): Promise<ExtensionFetchFileResult>;
  /** Resolve `branch` of `<owner>/<repo>` to the commit SHA at its head. */
  resolveBranch(owner: string, repo: string, branch: string): Promise<ExtensionFetchBranchResult>;
  /** List the published version strings of `<owner>/<repo>`. */
  listVersionTags(owner: string, repo: string): Promise<ExtensionVersionListResult>;
}

/** Stable identifiers for extension fetch failures. */
export const ExtensionFetchErrorCode = {
  INVALID_REFERENCE: "EXTENSION_FETCH_INVALID_REFERENCE",
  UNREACHABLE: "EXTENSION_FETCH_UNREACHABLE",
  RATE_LIMITED: "EXTENSION_FETCH_RATE_LIMITED",
  HTTP_STATUS: "EXTENSION_FETCH_HTTP_STATUS",
  BRANCH_NOT_FOUND: "EXTENSION_FETCH_BRANCH_NOT_FOUND",
  VERSIONS_NOT_FOUND: "EXTENSION_FETCH_VERSIONS_NOT_FOUND",
  MANIFEST_MISSING: "EXTENSION_FETCH_MANIFEST_MISSING",
  MANIFEST_UNPARSEABLE: "EXTENSION_FETCH_MANIFEST_UNPARSEABLE",
  LISTED_FILE_MISSING: "EXTENSION_FETCH_LISTED_FILE_MISSING",
} as const;

/** Union of all {@link ExtensionFetchErrorCode} values. */
export type ExtensionFetchErrorCode = (typeof ExtensionFetchErrorCode)[keyof typeof ExtensionFetchErrorCode];

/** A fetch failure. */
export interface ExtensionFetchError {
  /** Stable machine-readable failure code. */
  readonly code: ExtensionFetchErrorCode;
  /** The reference the fetch was for, as written. */
  readonly reference: string;
  /** Human-readable failure message. */
  readonly message: string;
}

/** A complete fetched extension snapshot. */
export interface FetchedExtensionSnapshot {
  /** The extension's `<owner>/<repo>` coordinate, from the reference. */
  readonly coordinate: string;
  /** The reference the snapshot was fetched from, as written. */
  readonly reference: string;
  /**
   * The immutable routing specifier the content was fetched at: the reference's
   * `@` pin as written, or the commit SHA a `#branch` reference resolved to.
   */
  readonly specifier: string;
  /** The snapshot's parsed content manifest. */
  readonly manifest: ProjectContentManifest;
  /** Every file of the snapshot: `mindcraft.json` first, then each manifest-listed file. */
  readonly files: readonly FetchedExtensionFile[];
}

/** Result of {@link fetchExtensionSnapshot}. */
export type ExtensionFetchResult =
  | {
      /** True when the whole snapshot was fetched. */
      readonly ok: true;
      /** The fetched snapshot. */
      readonly snapshot: FetchedExtensionSnapshot;
    }
  | {
      /** False when the fetch failed; no partial snapshot is produced. */
      readonly ok: false;
      /** The failure. */
      readonly error: ExtensionFetchError;
    };

function failure(code: ExtensionFetchErrorCode, reference: string, message: string): ExtensionFetchResult {
  return { ok: false, error: { code, reference, message } };
}

/**
 * Map a failed transport result onto a fetch failure for `reference`.
 * `notFoundCode` names the code a `not-found` answer maps to, with
 * `notFoundMessage` as its message.
 */
function transportFailure(
  result:
    | { readonly kind: "not-found" }
    | { readonly kind: "rate-limited" }
    | { readonly kind: "http-status"; readonly status: number }
    | {
        readonly kind: "unreachable";
        readonly message: string;
      },
  reference: string,
  notFoundCode: ExtensionFetchErrorCode,
  notFoundMessage: string
): ExtensionFetchResult {
  switch (result.kind) {
    case "not-found":
      return failure(notFoundCode, reference, notFoundMessage);
    case "rate-limited":
      return failure(
        ExtensionFetchErrorCode.RATE_LIMITED,
        reference,
        "The source's anonymous request rate limit is exhausted; try again later."
      );
    case "http-status":
      return failure(
        ExtensionFetchErrorCode.HTTP_STATUS,
        reference,
        `The source answered with HTTP status ${result.status}.`
      );
    case "unreachable":
      return failure(ExtensionFetchErrorCode.UNREACHABLE, reference, `The source is unreachable: ${result.message}`);
  }
}

/**
 * Fetch a complete extension snapshot for a `gh:` reference: resolve a
 * `#branch` reference to a commit SHA, fetch the snapshot's `mindcraft.json`,
 * then fetch exactly the files its `files` list names. Content is
 * byte-faithful. A failure at any step yields an {@link ExtensionFetchError}
 * and no partial snapshot.
 *
 * @param reference - A `gh:` extension reference string, as written in a
 *   manifest's extensions map.
 * @param transport - The transport content is retrieved through.
 */
export async function fetchExtensionSnapshot(
  reference: string,
  transport: ExtensionFetchTransport
): Promise<ExtensionFetchResult> {
  const parsed = parseExtensionReference(reference);
  if (parsed === undefined || parsed.transport !== "gh") {
    return failure(
      ExtensionFetchErrorCode.INVALID_REFERENCE,
      reference,
      `"${reference}" is not a fetchable gh:<owner>/<repo>@<pin> or gh:<owner>/<repo>#<branch> reference.`
    );
  }
  const { owner, repo } = parsed;
  const coordinate = `${owner}/${repo}`;

  let specifier: string;
  if (parsed.routing.kind === "branch") {
    const resolved = await transport.resolveBranch(owner, repo, parsed.routing.branch);
    if (!resolved.ok) {
      return transportFailure(
        resolved,
        reference,
        ExtensionFetchErrorCode.BRANCH_NOT_FOUND,
        `Branch "${parsed.routing.branch}" was not found on ${coordinate}.`
      );
    }
    specifier = resolved.sha;
  } else {
    specifier = parsed.routing.pin;
  }

  const manifestResult = await transport.fetchFile(owner, repo, specifier, MINDCRAFT_JSON_PATH);
  if (!manifestResult.ok) {
    return transportFailure(
      manifestResult,
      reference,
      ExtensionFetchErrorCode.MANIFEST_MISSING,
      `${coordinate} at "${specifier}" has no ${MINDCRAFT_JSON_PATH}.`
    );
  }

  const manifestText = new TextDecoder().decode(manifestResult.content);
  const parsedManifest = parseProjectContentManifest(manifestText);
  if (!parsedManifest.ok) {
    const details = parsedManifest.errors.map((error) => `${error.code} at ${error.path}: ${error.message}`).join(" ");
    return failure(
      ExtensionFetchErrorCode.MANIFEST_UNPARSEABLE,
      reference,
      `${coordinate} at "${specifier}" carries an invalid ${MINDCRAFT_JSON_PATH}. ${details}`
    );
  }

  const files: FetchedExtensionFile[] = [{ path: MINDCRAFT_JSON_PATH, content: manifestResult.content }];
  for (const path of parsedManifest.manifest.files ?? []) {
    // The manifest itself is never listed by `files`; a listing that names it
    // anyway must not duplicate the entry already fetched above.
    if (path === MINDCRAFT_JSON_PATH) continue;
    const fileResult = await transport.fetchFile(owner, repo, specifier, path);
    if (!fileResult.ok) {
      return transportFailure(
        fileResult,
        reference,
        ExtensionFetchErrorCode.LISTED_FILE_MISSING,
        `Manifest-listed file "${path}" was not found in ${coordinate} at "${specifier}".`
      );
    }
    files.push({ path, content: fileResult.content });
  }

  return {
    ok: true,
    snapshot: { coordinate, reference, specifier, manifest: parsedManifest.manifest, files },
  };
}
