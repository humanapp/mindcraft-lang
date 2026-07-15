import type {
  ExtensionAddInputErrorCode,
  ExtensionFetchError,
  ExtensionFetchErrorCode,
  ExtensionUpdateApplication,
} from "@mindcraft-lang/app-host";
import {
  type AppEnvironmentHost,
  buildExtensionCatalog,
  type EmbeddedExtension,
  type ExtensionActionResult,
  type ExtensionCatalogEntry,
  type ExtensionFetchFailures,
  type ExtensionInstallReport,
  type FetchedExtensionContentMap,
  installEmbeddedExtension,
  installExtensionReference,
  uninstallExtension,
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

/** The active-project surface an add-field install drives: input normalization plus the install transaction. */
export type ExtensionReferenceInstallSurface = Pick<
  AppEnvironmentHost,
  "resolveExtensionInstallInput" | "updateProjectExtensions"
>;

/**
 * An extension action's map-mutation result together with the install
 * transaction's report; the report is present exactly when the map changed and
 * the transaction ran.
 */
export interface ExtensionActionOutcome {
  /** The extensions-map mutation result. */
  readonly action: ExtensionActionResult;
  /** The install transaction's report; absent when the action changed nothing. */
  readonly report?: ExtensionInstallReport;
}

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
    ...(entry.updatable !== undefined ? { updatable: entry.updatable } : {}),
    ...(entry.broken !== undefined ? { broken: entry.broken } : {}),
    ...(entry.identityMismatch !== undefined ? { identityMismatch: entry.identityMismatch } : {}),
  };
}

/**
 * Build the browser entries for an apps/sim project: the extension catalog for
 * the project's extensions against the given embed record, the sim layer set,
 * the project's installed fetched-extension content, and the last recorded
 * fetch failures, adapted into browser view models.
 *
 * @param extensions - The project's extensions map, keyed by coordinate.
 * @param embedRecord - The bundled embedded extensions to resolve against.
 * @param installedContent - Installed fetched-extension content, keyed by reference.
 * @param fetchFailures - The last recorded fetch failure per reference.
 */
export function buildSimExtensionEntries(
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[],
  installedContent?: FetchedExtensionContentMap,
  fetchFailures?: ExtensionFetchFailures
): ExtensionBrowserEntry[] {
  return buildExtensionCatalog(extensions, embedRecord, SIM_LAYER_COORDINATES, installedContent, fetchFailures).map(
    toExtensionBrowserEntry
  );
}

/** The surface update checks drive. */
export type ExtensionUpdateSurface = Pick<AppEnvironmentHost, "checkExtensionUpdate">;

/** The outcome of checking several dependencies for updates. */
export interface ExtensionUpdateCheckSummary {
  /** Updates available, ready to apply as one transaction. */
  readonly updates: readonly ExtensionUpdateApplication[];
  /** Coordinates whose installed content is already current. */
  readonly current: readonly string[];
  /** Checks that could not be answered, with the failure per coordinate. */
  readonly failures: readonly { coordinate: string; error: ExtensionFetchError }[];
}

/**
 * Check the given dependencies for updates through the active project, one
 * check per coordinate, and bucket the answers. Checking changes nothing;
 * applying the returned updates is the caller's choice.
 *
 * @param surface - The active-project update surface.
 * @param coordinates - The coordinates to check.
 */
export async function checkSimExtensionUpdates(
  surface: ExtensionUpdateSurface,
  coordinates: readonly string[]
): Promise<ExtensionUpdateCheckSummary> {
  const updates: ExtensionUpdateApplication[] = [];
  const current: string[] = [];
  const failures: { coordinate: string; error: ExtensionFetchError }[] = [];
  for (const coordinate of coordinates) {
    const check = await surface.checkExtensionUpdate(coordinate);
    if (!check.ok) {
      failures.push({ coordinate, error: check.error });
    } else if (check.updateAvailable) {
      updates.push(check.update);
    } else {
      current.push(coordinate);
    }
  }
  return { updates, current, failures };
}

/**
 * Install an embedded extension and, when the extensions map changed, run the
 * install transaction through the active project. Returns the action result
 * and the transaction's report.
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
): Promise<ExtensionActionOutcome> {
  const action = installEmbeddedExtension(extensions, embedRecord, coordinate);
  if (!action.ok) {
    return { action };
  }
  return { action, report: await persistence.updateProjectExtensions(action.extensions) };
}

/** Outcome of adding a remote extension from pasted add-field input. */
export type ExtensionReferenceInstallOutcome =
  | {
      /** False: the input did not normalize to an installable reference; nothing changed. */
      readonly ok: false;
      /** Stable code of the input rejection or version-resolution failure. */
      readonly code: ExtensionAddInputErrorCode | ExtensionFetchErrorCode;
      /** Human-readable failure message. */
      readonly message: string;
    }
  | {
      /** True: the input normalized and the install action ran. */
      readonly ok: true;
      /** The normalized reference the install used. */
      readonly reference: string;
      /** The extensions-map mutation result. */
      readonly action: ExtensionActionResult;
      /** The install transaction's report; absent when the action changed nothing. */
      readonly report?: ExtensionInstallReport;
    };

/**
 * Add a remote extension from pasted add-field input -- a reference, an
 * `<owner>/<repo>` coordinate, or a GitHub repository URL. The input
 * normalizes to a reference through the active project (resolving a
 * version-less repository to its latest published version) and, when the
 * extensions map changed, the install transaction runs through the active
 * project. Returns the normalized reference with the action result and the
 * transaction's report, or the normalization failure.
 *
 * @param surface - The active-project normalization and persistence surface.
 * @param extensions - The project's current extensions map.
 * @param input - The pasted add-field text.
 */
export async function installSimExtensionReference(
  surface: ExtensionReferenceInstallSurface,
  extensions: Readonly<Record<string, string>> | undefined,
  input: string
): Promise<ExtensionReferenceInstallOutcome> {
  const normalized = await surface.resolveExtensionInstallInput(input);
  if (!normalized.ok) {
    return { ok: false, code: normalized.code, message: normalized.message };
  }
  const action = installExtensionReference(extensions, normalized.reference);
  if (!action.ok) {
    return { ok: true, reference: normalized.reference, action };
  }
  return {
    ok: true,
    reference: normalized.reference,
    action,
    report: await surface.updateProjectExtensions(action.extensions),
  };
}

/**
 * Uninstall an extension and, when the extensions map changed, run the removal
 * transaction through the active project. A locked layer library and a
 * coordinate another installed extension depends on are both rejected. Returns
 * the action result and the transaction's report.
 *
 * @param persistence - The active-project persistence surface.
 * @param extensions - The project's current extensions map.
 * @param coordinate - The coordinate to uninstall.
 * @param embedRecord - The bundled embedded extensions to resolve dependents against.
 * @param installedContent - Installed fetched-extension content, keyed by reference.
 */
export async function uninstallSimExtension(
  persistence: ExtensionProjectPersistence,
  extensions: Readonly<Record<string, string>> | undefined,
  coordinate: string,
  embedRecord: readonly EmbeddedExtension[],
  installedContent?: FetchedExtensionContentMap
): Promise<ExtensionActionOutcome> {
  const action = uninstallExtension(extensions, coordinate, SIM_LAYER_COORDINATES, embedRecord, installedContent);
  if (!action.ok) {
    return { action };
  }
  return { action, report: await persistence.updateProjectExtensions(action.extensions) };
}
