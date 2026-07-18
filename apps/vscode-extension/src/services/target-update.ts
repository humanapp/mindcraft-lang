import {
  ExtensionFetchErrorCode,
  parseExtensionReference,
  parseProjectContentManifest,
  serializeProjectContentManifest,
} from "@mindcraft-lang/app-host";

/** Stable identifiers for the outcome of one Update Target run. */
export const TargetUpdateOutcome = {
  /** No target coordinate resolves for the project; nothing to update. */
  NOT_UPDATABLE: "TARGET_UPDATE_NOT_UPDATABLE",
  /** The project already declares the newest published release, and no pin rewrite is needed. */
  UP_TO_DATE: "TARGET_UPDATE_UP_TO_DATE",
  /** The project updates to the newest published release and the editor rebuilds. */
  APPLY: "TARGET_UPDATE_APPLY",
  /** The reference names a branch; the editor rebuilds at the branch head. */
  REBUILD_BRANCH: "TARGET_UPDATE_REBUILD_BRANCH",
  /** The published-release check failed; nothing changed. */
  CHECK_FAILED: "TARGET_UPDATE_CHECK_FAILED",
} as const;

/** Union of all {@link TargetUpdateOutcome} values. */
export type TargetUpdateOutcome = (typeof TargetUpdateOutcome)[keyof typeof TargetUpdateOutcome];

/** Result of one pinned-reference update check. */
export type TargetUpdateCheckResult =
  | {
      /** True when the check reached the source. */
      readonly ok: true;
      /** False: the installed content is current. */
      readonly updateAvailable: false;
    }
  | {
      readonly ok: true;
      /** True: a newer release is published at the source. */
      readonly updateAvailable: true;
      /** The update to apply. */
      readonly update: {
        /** The reference rewritten to the newest published release. */
        readonly reference: string;
      };
    }
  | {
      /** False when the check could not be answered. */
      readonly ok: false;
      /** The failure, carrying its stable code. */
      readonly error: {
        /** Stable machine-readable failure code. */
        readonly code: string;
        /** Human-readable failure message. */
        readonly message: string;
      };
    };

/** Result of listing a target coordinate's newest published release. */
export type TargetReleaseListing =
  | {
      /** True when the source listed at least one plain release. */
      readonly ok: true;
      /** The highest plain `x.y.z` release the source lists. */
      readonly latestRelease: string;
    }
  | {
      /** False when the listing could not be answered. */
      readonly ok: false;
      /** The failure, carrying its stable code. */
      readonly error: {
        /** Stable machine-readable failure code. */
        readonly code: string;
        /** Human-readable failure message. */
        readonly message: string;
      };
    };

/** Plan of one Update Target run: the outcome and the data each branch acts on. */
export type TargetUpdatePlan =
  | { readonly outcome: typeof TargetUpdateOutcome.NOT_UPDATABLE }
  | {
      readonly outcome: typeof TargetUpdateOutcome.UP_TO_DATE;
      /** The resolved target coordinate. */
      readonly coordinate: string;
      /** The newest published release, already declared by the project. */
      readonly latestVersion: string;
    }
  | {
      readonly outcome: typeof TargetUpdateOutcome.APPLY;
      /** The resolved target coordinate. */
      readonly coordinate: string;
      /** The newest published release the project updates to. */
      readonly latestVersion: string;
      /** True when the project manifest's target entry needs the new caret range. */
      readonly updateManifest: boolean;
      /** The `devTarget` `appRef` to write, pinned at the newest release; absent when the set pin is already current. */
      readonly updatedAppRef?: string;
    }
  | {
      readonly outcome: typeof TargetUpdateOutcome.REBUILD_BRANCH;
      /** The branch reference, unchanged. */
      readonly appRef: string;
      /** The branch name the editor rebuilds from. */
      readonly branch: string;
      /** The resolved target coordinate. */
      readonly coordinate: string;
      /** The newest published release; absent when the listing failed. */
      readonly latestVersion?: string;
      /** True when the project manifest's target entry needs the new caret range. */
      readonly updateManifest: boolean;
    }
  | {
      readonly outcome: typeof TargetUpdateOutcome.CHECK_FAILED;
      /** The reference the failed check was for. */
      readonly reference: string;
      /** Stable machine-readable failure code. */
      readonly errorCode: string;
      /** Human-readable failure message. */
      readonly message: string;
    };

/** Inputs of one Update Target plan: the project's resolved references and declared ranges. */
export interface TargetUpdateInput {
  /** The `mindcraft.devTarget` setting's `appRef`, when set. */
  readonly appRef: string | undefined;
  /** The registry-resolved pinned reference; consulted only when `appRef` is unset. */
  readonly registryAppRef: string | undefined;
  /** The project manifest's declared target ranges, as coordinate to package-version range. */
  readonly manifestRanges: Readonly<Record<string, string>>;
}

/** Host operations one Update Target plan reads through. */
export interface TargetUpdateIo {
  /** List the newest published release of `coordinate`. */
  listLatestRelease(coordinate: string): Promise<TargetReleaseListing>;
  /** Check the pinned `reference` for a newer published release. */
  checkPinUpdate(reference: string): Promise<TargetUpdateCheckResult>;
}

/**
 * Decide what one Update Target run does. The target coordinate comes from the
 * `devTarget` `appRef` when set, else from the registry-resolved reference;
 * neither resolving plans nothing to update. The newest published release is
 * read from the coordinate's version listing, and the plan carries whether the
 * project manifest's target entry needs the new caret range and the `devTarget`
 * `appRef` to write: the set pin rewritten to the newest release, or -- when no
 * `appRef` is set -- the coordinate's reference pinned at the newest release.
 * A `#<branch>` `appRef` plans a rebuild that still updates the manifest range
 * when the listing succeeds, and falls back to a rebuild alone when it fails.
 * A listing or pin-check failure plans a failure carrying the check's stable
 * code.
 */
export async function planTargetUpdate(input: TargetUpdateInput, io: TargetUpdateIo): Promise<TargetUpdatePlan> {
  const reference = input.appRef ?? input.registryAppRef;
  if (reference === undefined) {
    return { outcome: TargetUpdateOutcome.NOT_UPDATABLE };
  }
  const parsed = parseExtensionReference(reference);
  if (parsed === undefined || parsed.transport !== "gh") {
    return {
      outcome: TargetUpdateOutcome.CHECK_FAILED,
      reference,
      errorCode: ExtensionFetchErrorCode.INVALID_REFERENCE,
      message: `"${reference}" is not a gh:<owner>/<repo>@<pin> or gh:<owner>/<repo>#<branch> reference.`,
    };
  }
  const coordinate = `${parsed.owner}/${parsed.repo}`;
  const currentRange = input.manifestRanges[coordinate];
  const listed = await io.listLatestRelease(coordinate);

  if (input.appRef !== undefined && parsed.routing.kind === "branch") {
    const branch = parsed.routing.branch;
    if (!listed.ok) {
      return {
        outcome: TargetUpdateOutcome.REBUILD_BRANCH,
        appRef: input.appRef,
        branch,
        coordinate,
        updateManifest: false,
      };
    }
    return {
      outcome: TargetUpdateOutcome.REBUILD_BRANCH,
      appRef: input.appRef,
      branch,
      coordinate,
      latestVersion: listed.latestRelease,
      updateManifest: currentRange !== `^${listed.latestRelease}`,
    };
  }
  if (!listed.ok) {
    return {
      outcome: TargetUpdateOutcome.CHECK_FAILED,
      reference,
      errorCode: listed.error.code,
      message: listed.error.message,
    };
  }
  const latestVersion = listed.latestRelease;
  const updateManifest = currentRange !== `^${latestVersion}`;

  if (input.appRef === undefined) {
    return {
      outcome: TargetUpdateOutcome.APPLY,
      coordinate,
      latestVersion,
      updateManifest,
      updatedAppRef: `gh:${coordinate}@${latestVersion}`,
    };
  }
  const check = await io.checkPinUpdate(input.appRef);
  if (!check.ok) {
    return {
      outcome: TargetUpdateOutcome.CHECK_FAILED,
      reference: input.appRef,
      errorCode: check.error.code,
      message: check.error.message,
    };
  }
  const updatedAppRef = check.updateAvailable ? check.update.reference : undefined;
  if (!updateManifest && updatedAppRef === undefined) {
    return { outcome: TargetUpdateOutcome.UP_TO_DATE, coordinate, latestVersion };
  }
  return {
    outcome: TargetUpdateOutcome.APPLY,
    coordinate,
    latestVersion,
    updateManifest,
    ...(updatedAppRef !== undefined ? { updatedAppRef } : {}),
  };
}

/** Result of {@link applyTargetRangeToManifest}. */
export type TargetRangeManifestUpdate =
  | {
      /** True when the document parsed as a content manifest. */
      readonly ok: true;
      /** The document text to store: rewritten when `changed`, the input text verbatim otherwise. */
      readonly content: string;
      /** True when the target entry's range was added or rewritten. */
      readonly changed: boolean;
    }
  | {
      /** False when the document does not parse as a content manifest. */
      readonly ok: false;
      /** Stable machine-readable error code of the first parse error. */
      readonly errorCode: string;
      /** Human-readable message of the first parse error. */
      readonly message: string;
    };

/**
 * Set the `targets` entry for `coordinate` in a `mindcraft.json` document to a
 * caret range at `latestVersion`, adding the entry when absent. The document
 * is parsed and re-serialized as a content manifest, so every other field --
 * including fields outside the manifest schema -- is preserved. Returns the
 * input text unchanged when the entry already carries the range.
 *
 * @param content - JSON text of the project's `mindcraft.json`.
 * @param coordinate - The target package's `<owner>/<repo>` coordinate.
 * @param latestVersion - The release version the caret range floors at.
 */
export function applyTargetRangeToManifest(
  content: string,
  coordinate: string,
  latestVersion: string
): TargetRangeManifestUpdate {
  const parsed = parseProjectContentManifest(content);
  if (!parsed.ok) {
    return { ok: false, errorCode: parsed.errors[0].code, message: parsed.errors[0].message };
  }
  const range = `^${latestVersion}`;
  if (parsed.manifest.targets?.[coordinate]?.packageVersion === range) {
    return { ok: true, content, changed: false };
  }
  const targets = { ...parsed.manifest.targets, [coordinate]: { packageVersion: range } };
  return { ok: true, content: serializeProjectContentManifest({ ...parsed.manifest, targets }), changed: true };
}
