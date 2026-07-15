import type { ExtensionFetchTransport } from "./extension-fetch.js";
import { ExtensionFetchErrorCode } from "./extension-fetch.js";
import { deriveCoordinateFromRemoteUrl } from "./extension-publish.js";
import { highestListedRelease } from "./extension-update.js";
import { isExtensionCoordinate, parseExtensionReference } from "./project-content-manifest.js";

/** Stable identifiers for rejected add-by-reference input. */
export const ExtensionAddInputErrorCode = {
  UNRECOGNIZED: "EXTENSION_ADD_INPUT_UNRECOGNIZED",
} as const;

/** Union of all {@link ExtensionAddInputErrorCode} values. */
export type ExtensionAddInputErrorCode = (typeof ExtensionAddInputErrorCode)[keyof typeof ExtensionAddInputErrorCode];

/**
 * Classification of text pasted into an add-by-reference affordance: a
 * complete extension reference, an `<owner>/<repo>` coordinate that still
 * needs a version resolved, or unrecognized input.
 */
export type ExtensionAddInput =
  | {
      /** The input names a complete extension reference. */
      readonly kind: "reference";
      /** The reference string, ready to install. */
      readonly reference: string;
    }
  | {
      /** The input names a repository without a version. */
      readonly kind: "coordinate";
      /** The `<owner>/<repo>` coordinate the input names. */
      readonly coordinate: string;
    }
  | {
      /** The input is not a recognized way of naming an extension. */
      readonly kind: "invalid";
      /** Stable rejection code. */
      readonly code: ExtensionAddInputErrorCode;
      /** Human-readable rejection message. */
      readonly message: string;
    };

const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

const SCP_GITHUB_REMOTE_PATTERN = /^[^/@\s]+@github\.com:/i;

/** A release name of the form `x.y.z` with an optional leading `v`. */
const VERSION_SHAPED_PATTERN = /^v?\d+\.\d+\.\d+$/;

const COMMIT_HEX_PATTERN = /^[0-9a-f]+$/i;

function unrecognized(input: string): ExtensionAddInput {
  return {
    kind: "invalid",
    code: ExtensionAddInputErrorCode.UNRECOGNIZED,
    message: `"${input}" is not an extension reference, an <owner>/<repo> coordinate, or a GitHub repository URL.`,
  };
}

/**
 * The path after the `github.com` authority of a repository URL, accepted with
 * or without a scheme. Returns `undefined` when the input is not a
 * `github.com` URL with a path.
 */
function githubUrlPath(input: string): string | undefined {
  const scheme = SCHEME_PATTERN.exec(input);
  const rest = scheme === null ? input : input.slice(scheme[0].length);
  const slash = rest.indexOf("/");
  if (slash === -1) {
    return undefined;
  }
  if (rest.slice(0, slash).toLowerCase() !== "github.com") {
    return undefined;
  }
  return rest.slice(slash + 1);
}

/**
 * The reference a GitHub URL's revision name maps to: a version-shaped name
 * (optional leading `v` plus dotted numeric `x.y.z`) becomes an `@` pin; any
 * other name is a branch.
 */
function referenceForRevision(coordinate: string, name: string, input: string): ExtensionAddInput {
  const reference = VERSION_SHAPED_PATTERN.test(name) ? `gh:${coordinate}@${name}` : `gh:${coordinate}#${name}`;
  return parseExtensionReference(reference) !== undefined ? { kind: "reference", reference } : unrecognized(input);
}

/** Classification of a `github.com` URL's path: the repository, or a revision within it. */
function classifyGithubUrlPath(path: string, input: string): ExtensionAddInput {
  const segments = path.replace(/\/+$/, "").split("/");
  if (segments.length < 2) {
    return unrecognized(input);
  }
  const owner = segments[0];
  const repo =
    segments.length === 2 && segments[1].endsWith(".git") ? segments[1].slice(0, -".git".length) : segments[1];
  const coordinate = `${owner}/${repo}`;
  if (!isExtensionCoordinate(coordinate)) {
    return unrecognized(input);
  }
  if (segments.length === 2) {
    return { kind: "coordinate", coordinate };
  }
  if (segments[2] === "tree" && segments.length >= 4) {
    // A branch name may contain "/": the revision is the whole remaining path.
    return referenceForRevision(coordinate, segments.slice(3).join("/"), input);
  }
  if (segments[2] === "releases" && segments[3] === "tag" && segments.length >= 5) {
    return referenceForRevision(coordinate, segments.slice(4).join("/"), input);
  }
  if (segments[2] === "commit" && segments.length === 4 && COMMIT_HEX_PATTERN.test(segments[3])) {
    return { kind: "reference", reference: `gh:${coordinate}@${segments[3]}` };
  }
  return unrecognized(input);
}

/**
 * Classify text pasted into an add-by-reference affordance. Recognized shapes:
 *
 * - A complete reference (`gh:<owner>/<repo>@<pin>`, `gh:<owner>/<repo>#<branch>`,
 *   `embedded:<owner>/<repo>`) passes through unchanged.
 * - A bare `<owner>/<repo>` coordinate, or `gh:<owner>/<repo>` without a
 *   specifier, names a repository whose version must still be resolved.
 * - A `github.com` repository URL, with or without a scheme, trailing `/`, or
 *   `.git`: the plain repository URL names a coordinate; a `/tree/<name>` or
 *   `/releases/tag/<name>` URL pins a version-shaped name with `@` and treats
 *   any other name as a `#` branch; a `/commit/<sha>` URL pins the commit.
 * - An scp-like git remote (`git@github.com:<owner>/<repo>.git`) names a
 *   coordinate.
 *
 * Anything else is invalid with a stable {@link ExtensionAddInputErrorCode}.
 */
export function parseExtensionAddInput(text: string): ExtensionAddInput {
  const input = text.trim();
  if (parseExtensionReference(input) !== undefined) {
    return { kind: "reference", reference: input };
  }
  if (input.startsWith("gh:") && isExtensionCoordinate(input.slice("gh:".length))) {
    return { kind: "coordinate", coordinate: input.slice("gh:".length) };
  }
  if (isExtensionCoordinate(input)) {
    return { kind: "coordinate", coordinate: input };
  }
  if (SCP_GITHUB_REMOTE_PATTERN.test(input)) {
    const coordinate = deriveCoordinateFromRemoteUrl(input);
    return coordinate !== undefined ? { kind: "coordinate", coordinate } : unrecognized(input);
  }
  const path = githubUrlPath(input);
  if (path !== undefined) {
    return classifyGithubUrlPath(path, input);
  }
  return unrecognized(input);
}

/** Result of normalizing add-by-reference input to an installable reference. */
export type ExtensionAddInputResolution =
  | {
      /** True when the input normalized to an installable reference. */
      readonly ok: true;
      /** The reference to install. */
      readonly reference: string;
    }
  | {
      /** False when the input was rejected or its version could not be resolved. */
      readonly ok: false;
      /** Stable code of the rejection or resolution failure. */
      readonly code: ExtensionAddInputErrorCode | ExtensionFetchErrorCode;
      /** Human-readable failure message. */
      readonly message: string;
    };

function noPublishedVersions(coordinate: string): ExtensionAddInputResolution {
  return {
    ok: false,
    code: ExtensionFetchErrorCode.VERSIONS_NOT_FOUND,
    message: `${coordinate} has no published versions; a branch installs with "gh:${coordinate}#<branch>".`,
  };
}

/**
 * Normalize add-by-reference input to an installable extension reference. A
 * complete reference passes through unchanged without touching the transport.
 * Input naming a repository without a version lists the repository's published
 * versions through the transport and pins the highest plain `x.y.z` release as
 * the source lists it (`gh:<owner>/<repo>@<version>`). Fails with a stable
 * code when the input is unrecognized, the repository has no published release
 * version, or the version listing fails.
 *
 * @param text - The pasted input.
 * @param transport - The transport published versions are listed through.
 */
export async function resolveExtensionAddInput(
  text: string,
  transport: ExtensionFetchTransport
): Promise<ExtensionAddInputResolution> {
  const parsed = parseExtensionAddInput(text);
  if (parsed.kind === "invalid") {
    return { ok: false, code: parsed.code, message: parsed.message };
  }
  if (parsed.kind === "reference") {
    return { ok: true, reference: parsed.reference };
  }
  const [owner, repo] = parsed.coordinate.split("/");
  const listed = await transport.listVersionTags(owner, repo);
  if (!listed.ok) {
    switch (listed.kind) {
      case "not-found":
        return noPublishedVersions(parsed.coordinate);
      case "http-status":
        return {
          ok: false,
          code: ExtensionFetchErrorCode.HTTP_STATUS,
          message: `The source answered with HTTP status ${listed.status}.`,
        };
      case "unreachable":
        return {
          ok: false,
          code: ExtensionFetchErrorCode.UNREACHABLE,
          message: `The source is unreachable: ${listed.message}`,
        };
    }
  }
  const latest = highestListedRelease(listed.versions);
  if (latest === undefined) {
    return noPublishedVersions(parsed.coordinate);
  }
  return { ok: true, reference: `gh:${parsed.coordinate}@${latest}` };
}
