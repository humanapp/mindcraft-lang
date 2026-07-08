import {
  type AppEnvironmentHost,
  buildExtensionCatalog,
  type EmbeddedExtension,
  type ExtensionActionResult,
  type ExtensionCatalogEntry,
  installEmbeddedExtension,
  uninstallEmbeddedExtension,
} from "@mindcraft-lang/bridge-app";
import type { ExtensionBrowserEntry } from "@mindcraft-lang/ui";
import { CORE_LIB_COORDINATE, SIM_LIB_COORDINATE } from "./sim-extension-coordinates";

/**
 * The locked platform-layer coordinates of an apps/sim project: the core and sim
 * layers. These are required layer libraries the user can neither install nor
 * uninstall.
 */
export const SIM_LAYER_COORDINATES: ReadonlySet<string> = new Set([CORE_LIB_COORDINATE, SIM_LIB_COORDINATE]);

/** The project-persistence surface the install and uninstall handlers drive. */
export type ExtensionProjectPersistence = Pick<AppEnvironmentHost, "updateProjectExtensions">;

/** The GitHub repository URL for an extension's `<owner>/<repo>` coordinate. */
export function githubDocsUrl(coordinate: string): string {
  return `https://github.com/${coordinate}`;
}

/** Adapt a host catalog entry into the platform-agnostic browser view model, deriving the docs URL from the coordinate. */
export function toExtensionBrowserEntry(entry: ExtensionCatalogEntry): ExtensionBrowserEntry {
  return {
    coordinate: entry.coordinate,
    name: entry.name,
    version: entry.version,
    ...(entry.thumbnailUrl !== undefined ? { thumbnailUrl: entry.thumbnailUrl } : {}),
    installed: entry.installed,
    locked: entry.locked,
    docsUrl: githubDocsUrl(entry.coordinate),
  };
}

/**
 * Build the browser entries for an apps/sim project: the extension catalog for
 * the project's extensions against the given embed record and the sim layer set,
 * adapted into browser view models.
 *
 * @param extensions - The project's extensions map, keyed by coordinate.
 * @param embedRecord - The bundled embedded extensions to resolve against.
 */
export function buildSimExtensionEntries(
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[]
): ExtensionBrowserEntry[] {
  return buildExtensionCatalog(extensions, embedRecord, SIM_LAYER_COORDINATES).map(toExtensionBrowserEntry);
}

/**
 * Install an embedded extension and, when the extensions map changed, persist it
 * through the active project. Returns the action result.
 *
 * @param persistence - The active-project persistence surface.
 * @param extensions - The project's current extensions map.
 * @param coordinate - The coordinate to install.
 * @param embedRecord - The bundled embedded extensions to resolve against.
 */
export async function installSimExtension(
  persistence: ExtensionProjectPersistence,
  extensions: Readonly<Record<string, string>> | undefined,
  coordinate: string,
  embedRecord: readonly EmbeddedExtension[]
): Promise<ExtensionActionResult> {
  const result = installEmbeddedExtension(extensions, embedRecord, coordinate);
  if (result.ok) {
    await persistence.updateProjectExtensions(result.extensions);
  }
  return result;
}

/**
 * Uninstall an embedded extension and, when the extensions map changed, persist
 * it through the active project. A locked layer library is rejected. Returns the
 * action result.
 *
 * @param persistence - The active-project persistence surface.
 * @param extensions - The project's current extensions map.
 * @param coordinate - The coordinate to uninstall.
 */
export async function uninstallSimExtension(
  persistence: ExtensionProjectPersistence,
  extensions: Readonly<Record<string, string>> | undefined,
  coordinate: string
): Promise<ExtensionActionResult> {
  const result = uninstallEmbeddedExtension(extensions, coordinate, SIM_LAYER_COORDINATES);
  if (result.ok) {
    await persistence.updateProjectExtensions(result.extensions);
  }
  return result;
}
