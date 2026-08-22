import type { ExtensionCatalogDocumentEntry } from "@wendoo-lang/app-host";
import { registryTargetEntry, validateExtensionCatalogDocument } from "@wendoo-lang/app-host";
import bundledTargetsRegistry from "../../../../packages/cli/targets.json";
import type { FolderTargetDescriptor } from "./project-skeleton";

let cachedEntries: readonly ExtensionCatalogDocumentEntry[] | undefined;

/**
 * The entries of the bundled targets registry: the curated targets a new
 * project can be created from. Validated once on first use; throws when the
 * bundled document is invalid.
 */
export function targetRegistryEntries(): readonly ExtensionCatalogDocumentEntry[] {
  if (cachedEntries === undefined) {
    const result = validateExtensionCatalogDocument(bundledTargetsRegistry);
    if (!result.ok) {
      const details = result.errors.map((error) => `${error.code} at ${error.path}`).join(", ");
      throw new Error(`The bundled targets registry is invalid: ${details}`);
    }
    cachedEntries = result.document.entries;
  }
  return cachedEntries;
}

/** The registry entry with the given `<owner>/<repo>` coordinate, or undefined. */
export function findTargetRegistryEntry(coordinate: string): ExtensionCatalogDocumentEntry | undefined {
  return targetRegistryEntries().find((entry) => entry.coordinate === coordinate);
}

/** Stable identifiers for the reasons a project resolves no hostable target. */
export const TargetResolutionErrorCode = {
  /** No declared target coordinate is listed in the targets registry. */
  NO_REGISTRY_MATCH: "TARGET_RESOLUTION_NO_REGISTRY_MATCH",
  /** More than one declared target coordinate is listed in the targets registry. */
  AMBIGUOUS_REGISTRY_MATCH: "TARGET_RESOLUTION_AMBIGUOUS_REGISTRY_MATCH",
} as const;

/** Union of all {@link TargetResolutionErrorCode} values. */
export type TargetResolutionErrorCode = (typeof TargetResolutionErrorCode)[keyof typeof TargetResolutionErrorCode];

/** Outcome of {@link resolveProjectTargetDescriptor}. */
export type ProjectTargetResolution =
  | {
      readonly ok: true;
      /** The descriptor whose app the session hosts. */
      readonly descriptor: FolderTargetDescriptor;
    }
  | {
      readonly ok: false;
      /** Stable machine-readable failure code. */
      readonly code: TargetResolutionErrorCode;
      /** The target coordinates the project's manifest declares, in manifest order. */
      readonly declaredCoordinates: readonly string[];
    };

/**
 * Resolve the target descriptor a project opens with. The `wendoo.devTarget`
 * override wins when set; otherwise the project's declared target coordinates
 * are matched against the registry entries by membership, and the single listed
 * coordinate's pinned ref becomes the hosted app. Fails with a stable code when
 * no declared coordinate -- or more than one -- is listed in the registry.
 */
export function resolveProjectTargetDescriptor(
  devTarget: FolderTargetDescriptor | undefined,
  declaredCoordinates: readonly string[],
  entries: readonly ExtensionCatalogDocumentEntry[]
): ProjectTargetResolution {
  if (devTarget !== undefined) {
    return { ok: true, descriptor: devTarget };
  }
  const matches = entries.filter((entry) => declaredCoordinates.includes(entry.coordinate));
  const matched = matches.length === 1 ? matches[0] : undefined;
  if (matched === undefined) {
    return {
      ok: false,
      code:
        matches.length === 0
          ? TargetResolutionErrorCode.NO_REGISTRY_MATCH
          : TargetResolutionErrorCode.AMBIGUOUS_REGISTRY_MATCH,
      declaredCoordinates,
    };
  }
  return { ok: true, descriptor: { appRef: matched.ref } };
}

/** One target choice offered by the New Project target picker. */
export interface TargetRegistryPickItem {
  /** Display name shown as the pick's label. */
  readonly label: string;
  /** Description shown as the pick's detail line. */
  readonly detail: string;
  /** The registry entry the pick stands for. */
  readonly entry: ExtensionCatalogDocumentEntry;
}

/** Map registry entries to the New Project target picker's items, in registry order. */
export function targetRegistryPickItems(
  entries: readonly ExtensionCatalogDocumentEntry[]
): readonly TargetRegistryPickItem[] {
  return entries.map((entry) => ({ label: entry.name, detail: entry.description, entry }));
}

/**
 * The skeleton seed of a project created from a registry target: the target's
 * coordinate as an app-embedded library dependency, and as a
 * platform-compatibility target at a caret range of the fetched package's
 * manifest version.
 */
export function registryProjectSeed(
  coordinate: string,
  packageVersion: string
): Pick<FolderTargetDescriptor, "extensions" | "targets"> {
  return {
    extensions: { [coordinate]: `embedded:${coordinate}` },
    targets: { [coordinate]: registryTargetEntry(packageVersion) },
  };
}
