import { parseExtensionReference } from "./project-content-manifest.js";

/** Stable identifiers for the reasons a dependency is not stable for consumers. */
export const UnstableDependencyCode = {
  /** The pinned version is not served by the dependency's public fetch source. */
  VERSION_UNPUBLISHED: "DEPENDENCY_VERSION_UNPUBLISHED",
  /** The reference names a branch, a mutable target that may move or vanish. */
  BRANCH_REFERENCE: "DEPENDENCY_BRANCH_REFERENCE",
} as const;

/** Union of all {@link UnstableDependencyCode} values. */
export type UnstableDependencyCode = (typeof UnstableDependencyCode)[keyof typeof UnstableDependencyCode];

/** One dependency that is not stable for consumers of the project declaring it. */
export interface UnstableDependency {
  /** The dependency's `<owner>/<repo>` coordinate: its key in the extensions map. */
  readonly coordinate: string;
  /** The dependency's manifest reference, as written. */
  readonly reference: string;
  /** Stable code naming the reason. */
  readonly code: UnstableDependencyCode;
  /** Human-readable reason. */
  readonly message: string;
}

/**
 * Reports whether the public fetch source serves `<owner>/<repo>` content at
 * the immutable pin `pin`.
 */
export type DependencyPinProbe = (owner: string, repo: string, pin: string) => Promise<boolean>;

/**
 * Collect the dependencies of an extensions map that are not stable for
 * consumers: a `gh:` branch reference (a mutable target), and a `gh:` pin the
 * fetch source does not serve (a version that has never been published).
 * Pinned references pass silently when the probe confirms them; `embedded:`
 * references are always stable.
 *
 * @param extensions - The extensions map, keyed by coordinate.
 * @param isPinPublished - Probe answering whether the fetch source serves a pin.
 */
export async function collectUnstableDependencies(
  extensions: Readonly<Record<string, string>>,
  isPinPublished: DependencyPinProbe
): Promise<readonly UnstableDependency[]> {
  const unstable: UnstableDependency[] = [];
  for (const [coordinate, reference] of Object.entries(extensions)) {
    const parsed = parseExtensionReference(reference);
    if (parsed === undefined || parsed.transport !== "gh") {
      continue;
    }
    if (parsed.routing.kind === "branch") {
      unstable.push({
        coordinate,
        reference,
        code: UnstableDependencyCode.BRANCH_REFERENCE,
        message: `"${reference}" names branch "${parsed.routing.branch}", a mutable target that may move or vanish.`,
      });
      continue;
    }
    if (!(await isPinPublished(parsed.owner, parsed.repo, parsed.routing.pin))) {
      unstable.push({
        coordinate,
        reference,
        code: UnstableDependencyCode.VERSION_UNPUBLISHED,
        message: `The fetch source serves nothing for "${reference}"; that version has never been published.`,
      });
    }
  }
  return unstable;
}
