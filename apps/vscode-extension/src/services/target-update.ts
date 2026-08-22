import {
  highestListedRelease,
  parseProjectContentManifest,
  serializeProjectContentManifest,
} from "@wendoo/app-host";

/** Stable identifiers for the outcome of one Update Target run. */
export const TargetUpdateOutcome = {
  /** No project folder or target coordinate resolves; the command does nothing. */
  NOT_APPLICABLE: "TARGET_UPDATE_NOT_APPLICABLE",
  /** The user dismissed the quick-pick or entered no reference; nothing changed. */
  CANCELLED: "TARGET_UPDATE_CANCELLED",
  /** The project manifest and hosted editor were moved to the selected version. */
  UPDATED: "TARGET_UPDATE_UPDATED",
  /** The entered specific reference could not be fetched; nothing changed. */
  FETCH_FAILED: "TARGET_UPDATE_FETCH_FAILED",
} as const;

/** Union of all {@link TargetUpdateOutcome} values. */
export type TargetUpdateOutcome = (typeof TargetUpdateOutcome)[keyof typeof TargetUpdateOutcome];

/** Result of one Update Target command run, carrying its stable outcome code. */
export interface TargetUpdateCommandResult {
  /** The run's stable outcome code. */
  readonly outcome: TargetUpdateOutcome;
  /** The updated target's coordinate, present on an {@link TargetUpdateOutcome.UPDATED} run. */
  readonly coordinate?: string;
  /** The version the project moved to, present on an {@link TargetUpdateOutcome.UPDATED} run. */
  readonly version?: string;
  /** The `appRef` override written; present on a published or specific update, absent when the override was cleared. */
  readonly appRef?: string;
}

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

/**
 * One choice the Update Target command offers. `approved` names the version the
 * bundled registry pins for the coordinate; `published` names the highest
 * published release, offered only when it is newer than the approved version;
 * `specific` opens an input box for a user-entered tag, SHA, or `#branch`.
 */
export type TargetUpdateChoice =
  | {
      readonly kind: "approved";
      /** The registry-pinned version, shown in the choice's caption. */
      readonly version: string;
    }
  | {
      readonly kind: "published";
      /** The highest published release, shown in the choice's caption. */
      readonly version: string;
    }
  | { readonly kind: "specific" };

/**
 * The Update Target choices offered for a coordinate, in display order: the
 * registry-approved version first when the coordinate is in the registry, the
 * highest published release next when it is newer than the approved version (or
 * when there is no approved version to compare against), then the always-present
 * specific-version choice.
 *
 * @param input.approvedVersion - The registry-pinned version, or undefined when
 *   the coordinate is not in the bundled registry.
 * @param input.latestPublished - The highest published release, or undefined
 *   when the version listing could not be read.
 */
export function targetUpdateChoices(input: {
  readonly approvedVersion: string | undefined;
  readonly latestPublished: string | undefined;
}): readonly TargetUpdateChoice[] {
  const choices: TargetUpdateChoice[] = [];
  if (input.approvedVersion !== undefined) {
    choices.push({ kind: "approved", version: input.approvedVersion });
  }
  if (
    input.latestPublished !== undefined &&
    (input.approvedVersion === undefined || isNewerRelease(input.latestPublished, input.approvedVersion))
  ) {
    choices.push({ kind: "published", version: input.latestPublished });
  }
  choices.push({ kind: "specific" });
  return choices;
}

/** True when `candidate` is a strictly higher plain `x.y.z` release than `baseline`. */
function isNewerRelease(candidate: string, baseline: string): boolean {
  return candidate !== baseline && highestListedRelease([baseline, candidate]) === candidate;
}

/**
 * A resolved Update Target selection: the coordinate whose target is affected,
 * the version its manifest caret range floors at, and how the `devTarget`
 * `appRef` override changes.
 */
export interface TargetUpdateAction {
  /** The target package's `<owner>/<repo>` coordinate. */
  readonly coordinate: string;
  /** The release the manifest caret range floors at, as `^<version>`. */
  readonly version: string;
  /**
   * The `devTarget` `appRef` change: `clear` removes the override so hosting
   * resolves through the registry tier; `write` pins the override to a reference.
   */
  readonly appRef: { readonly op: "clear" } | { readonly op: "write"; readonly reference: string };
}

/**
 * A user's Update Target selection, carrying the data each kind resolves from.
 * `approved` and `published` carry the coordinate and version the choice
 * offered; `specific` carries the entered reference and the version fetched from
 * the pinned content.
 */
export type TargetUpdateSelection =
  | { readonly kind: "approved"; readonly coordinate: string; readonly version: string }
  | { readonly kind: "published"; readonly coordinate: string; readonly version: string }
  | {
      readonly kind: "specific";
      readonly coordinate: string;
      /** The tag, SHA, or `#branch` the user entered, as written. */
      readonly reference: string;
      /** The manifest version of the fetched pinned content. */
      readonly version: string;
    };

/**
 * Resolve a selection into the manifest and `devTarget` change to apply. The
 * approved selection clears the `appRef` override and floors the range at the
 * approved version; the published selection writes the override pinned at the
 * published release and floors the range there; the specific selection writes
 * the override at the entered reference and floors the range at the fetched
 * content's version.
 */
export function resolveTargetUpdateAction(selection: TargetUpdateSelection): TargetUpdateAction {
  switch (selection.kind) {
    case "approved":
      return { coordinate: selection.coordinate, version: selection.version, appRef: { op: "clear" } };
    case "published":
      return {
        coordinate: selection.coordinate,
        version: selection.version,
        appRef: { op: "write", reference: `gh:${selection.coordinate}@${selection.version}` },
      };
    case "specific":
      return {
        coordinate: selection.coordinate,
        version: selection.version,
        appRef: { op: "write", reference: specificAppRef(selection.coordinate, selection.reference) },
      };
  }
}

/**
 * The `appRef` for a user-entered specific reference: a `#branch` entry is
 * appended as a branch route, any other entry (a tag or a SHA) as a pin.
 */
export function specificAppRef(coordinate: string, reference: string): string {
  return reference.startsWith("#") ? `gh:${coordinate}${reference}` : `gh:${coordinate}@${reference}`;
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
 * Set the `targets` entry for `coordinate` in a `wendoo.json` document to a
 * caret range at `latestVersion`, adding the entry when absent. The document
 * is parsed and re-serialized as a content manifest, so every other field --
 * including fields outside the manifest schema -- is preserved. Returns the
 * input text unchanged when the entry already carries the range.
 *
 * @param content - JSON text of the project's `wendoo.json`.
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
