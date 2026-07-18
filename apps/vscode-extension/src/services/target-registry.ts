import type { ExtensionCatalogDocumentEntry } from "@mindcraft-lang/app-host";
import { validateExtensionCatalogDocument } from "@mindcraft-lang/app-host";
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
    targets: { [coordinate]: { packageVersion: `^${packageVersion}` } },
  };
}
