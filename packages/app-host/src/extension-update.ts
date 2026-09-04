import type { ExtensionFetchError, ExtensionFetchTransport } from "./extension-fetch.js";
import { ExtensionFetchErrorCode } from "./extension-fetch.js";
import { parseExtensionReference } from "./project-content-manifest.js";

/** One update ready to apply to a project's extensions map. */
export interface ExtensionUpdateApplication {
  /** The dependency's `<owner>/<repo>` coordinate. */
  readonly coordinate: string;
  /**
   * The manifest reference to install: for a `@` reference, the approved pin of
   * the coordinate's catalog entry, or the newest published version's pin when
   * no catalog entry lists it; for a `#branch` reference, the reference
   * unchanged (the branch content is refetched at its new head commit).
   */
  readonly reference: string;
  /**
   * The version a pin update installs: the catalog entry's approved version, or
   * the newest published release when no catalog entry lists the coordinate.
   * Absent for a branch update.
   */
  readonly latestVersion?: string;
  /** The branch head's commit SHA for a branch update; absent for a pin update. */
  readonly resolvedSha?: string;
}

/** Result of one dependency update check. */
export type ExtensionUpdateCheck =
  | {
      /** True when the check reached the source. */
      readonly ok: true;
      /** False: the installed content is current. */
      readonly updateAvailable: false;
    }
  | {
      readonly ok: true;
      /** True: newer content is available at the source. */
      readonly updateAvailable: true;
      /** The update to apply through an install transaction. */
      readonly update: ExtensionUpdateApplication;
    }
  | {
      /** False when the check could not be answered. */
      readonly ok: false;
      /** The failure, carrying its stable code and the reference it was for. */
      readonly error: ExtensionFetchError;
    };

/** A parsed `[major, minor, patch]` release triple. */
type ReleaseTriple = readonly [number, number, number];

const RELEASE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** Parse a plain `x.y.z` release version. Returns `undefined` for prerelease or non-semver strings. */
function parseReleaseVersion(version: string): ReleaseTriple | undefined {
  const match = RELEASE_VERSION_PATTERN.exec(version);
  if (match === null) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Compare two release triples; negative when `a < b`, positive when `a > b`, zero when equal. */
function compareReleaseTriple(a: ReleaseTriple, b: ReleaseTriple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

/**
 * The highest plain `x.y.z` release among the version strings a source lists,
 * returned as the source lists it. Prerelease and non-semver strings are
 * ignored. Returns `undefined` when no listed version is a plain release.
 */
export function highestListedRelease(versions: readonly string[]): string | undefined {
  let latest: { version: string; triple: ReleaseTriple } | undefined;
  for (const version of versions) {
    const triple = parseReleaseVersion(version);
    if (triple === undefined) {
      continue;
    }
    if (latest === undefined || compareReleaseTriple(triple, latest.triple) > 0) {
      latest = { version, triple };
    }
  }
  return latest?.version;
}

function checkFailure(code: ExtensionFetchErrorCode, reference: string, message: string): ExtensionUpdateCheck {
  return { ok: false, error: { code, reference, message } };
}

/**
 * Resolves an `<owner>/<repo>` coordinate to the approved content its catalog
 * entry offers: `ref` is the entry's pinned reference and `version` is the
 * version the entry offers that pin as. Returns `undefined` for a coordinate
 * the catalog does not list.
 */
export type ApprovedCatalogEntryLookup = (coordinate: string) => { ref: string; version: string } | undefined;

/**
 * Check one installed `gh:` dependency for newer content. For a `@<pin>`
 * reference whose coordinate `approvedEntry` lists, the entry's approved
 * version is compared against the installed manifest version and, when it is
 * newer, the entry's own pinned reference is offered. Such a check never reads
 * the source. For a `@<pin>` reference on an unlisted coordinate, the
 * repository's published versions are listed and the highest plain `x.y.z`
 * release above the installed version is offered, rewriting the reference to
 * that version's pin; prerelease and non-semver version strings are ignored. A
 * `#<branch>` reference re-resolves the branch head and offers a refetch when
 * the head commit differs from the installed specifier, leaving the reference
 * text unchanged. The check changes nothing; applying the returned update is an
 * ordinary install transaction.
 *
 * @param options.reference - The dependency's manifest reference, as written.
 * @param options.installedSpecifier - The immutable specifier the installed content was fetched at.
 * @param options.installedVersion - The installed snapshot's manifest version.
 * @param options.transport - The transport the source is read through.
 * @param options.approvedEntry - Resolves a coordinate to its catalog entry's
 *   approved pin. When omitted, every coordinate is checked against its source.
 */
export async function checkExtensionReferenceUpdate(options: {
  reference: string;
  installedSpecifier: string;
  installedVersion: string;
  transport: ExtensionFetchTransport;
  approvedEntry?: ApprovedCatalogEntryLookup;
}): Promise<ExtensionUpdateCheck> {
  const { reference, transport } = options;
  const parsed = parseExtensionReference(reference);
  if (parsed === undefined || parsed.transport !== "gh") {
    return checkFailure(
      ExtensionFetchErrorCode.INVALID_REFERENCE,
      reference,
      `"${reference}" is not a checkable gh:<owner>/<repo>@<pin> or gh:<owner>/<repo>#<branch> reference.`
    );
  }
  const { owner, repo } = parsed;
  const coordinate = `${owner}/${repo}`;

  if (parsed.routing.kind === "branch") {
    const resolved = await transport.resolveBranch(owner, repo, parsed.routing.branch);
    if (!resolved.ok) {
      switch (resolved.kind) {
        case "not-found":
          return checkFailure(
            ExtensionFetchErrorCode.BRANCH_NOT_FOUND,
            reference,
            `Branch "${parsed.routing.branch}" was not found on ${coordinate}.`
          );
        case "rate-limited":
          return checkFailure(
            ExtensionFetchErrorCode.RATE_LIMITED,
            reference,
            "The source's anonymous request rate limit is exhausted; try again later."
          );
        case "http-status":
          return checkFailure(
            ExtensionFetchErrorCode.HTTP_STATUS,
            reference,
            `The source answered with HTTP status ${resolved.status}.`
          );
        case "unreachable":
          return checkFailure(
            ExtensionFetchErrorCode.UNREACHABLE,
            reference,
            `The source is unreachable: ${resolved.message}`
          );
      }
    }
    if (resolved.sha === options.installedSpecifier) {
      return { ok: true, updateAvailable: false };
    }
    return {
      ok: true,
      updateAvailable: true,
      update: { coordinate, reference, resolvedSha: resolved.sha },
    };
  }

  const installed = parseReleaseVersion(options.installedVersion) ?? ([0, 0, 0] as const);

  const approved = options.approvedEntry?.(coordinate);
  if (approved !== undefined) {
    const approvedTriple = parseReleaseVersion(approved.version);
    if (approvedTriple === undefined || compareReleaseTriple(approvedTriple, installed) <= 0) {
      return { ok: true, updateAvailable: false };
    }
    return {
      ok: true,
      updateAvailable: true,
      update: { coordinate, reference: approved.ref, latestVersion: approved.version },
    };
  }

  const listed = await transport.listVersionTags(owner, repo);
  if (!listed.ok) {
    switch (listed.kind) {
      case "not-found":
        return checkFailure(
          ExtensionFetchErrorCode.VERSIONS_NOT_FOUND,
          reference,
          `The source lists no published versions for ${coordinate}.`
        );
      case "http-status":
        return checkFailure(
          ExtensionFetchErrorCode.HTTP_STATUS,
          reference,
          `The source answered with HTTP status ${listed.status}.`
        );
      case "unreachable":
        return checkFailure(
          ExtensionFetchErrorCode.UNREACHABLE,
          reference,
          `The source is unreachable: ${listed.message}`
        );
    }
  }

  const latestVersion = highestListedRelease(listed.versions);
  if (latestVersion === undefined) {
    return { ok: true, updateAvailable: false };
  }
  const latest = parseReleaseVersion(latestVersion);
  if (latest === undefined || compareReleaseTriple(latest, installed) <= 0) {
    return { ok: true, updateAvailable: false };
  }
  return {
    ok: true,
    updateAvailable: true,
    update: {
      coordinate,
      reference: `gh:${coordinate}@${latestVersion}`,
      latestVersion,
    },
  };
}
