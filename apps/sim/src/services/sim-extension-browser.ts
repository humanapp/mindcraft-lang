import type {
  ExtensionAddInputErrorCode,
  ExtensionCatalogDocument,
  ExtensionFetchError,
  ExtensionFetchErrorCode,
  ExtensionUpdateApplication,
} from "@mindcraft-lang/app-host";
import { parseExtensionReference, validateExtensionCatalogDocument } from "@mindcraft-lang/app-host";
import {
  type AppEnvironmentHost,
  buildExtensionCatalog,
  buildExtensionCatalogOffers,
  type EmbeddedExtension,
  type ExtensionActionResult,
  type ExtensionCatalogEntry,
  type ExtensionCatalogOffer,
  type ExtensionFetchFailures,
  type ExtensionInstallReport,
  type FetchedExtensionContentMap,
  installEmbeddedExtension,
  installExtensionReference,
  uninstallExtension,
} from "@mindcraft-lang/bridge-app";
import type { ExtensionBrowserEntry } from "@mindcraft-lang/ui";
import { CORE_LIB_COORDINATE, SIM_LIB_COORDINATE } from "./sim-extension-coordinates";
import simLibraryCatalogDocument from "./sim-library-catalog.json";

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

/** Adapt a host catalog entry into the platform-agnostic browser view model, carrying the repository URL when present. */
export function toExtensionBrowserEntry(entry: ExtensionCatalogEntry): ExtensionBrowserEntry {
  return {
    coordinate: entry.coordinate,
    name: entry.name,
    version: entry.version,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.thumbnailUrl !== undefined ? { thumbnailUrl: entry.thumbnailUrl } : {}),
    installed: entry.installed,
    ...(entry.repoUrl !== undefined ? { repoUrl: entry.repoUrl } : {}),
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
  return buildExtensionCatalog(
    extensions,
    embedRecord,
    SIM_LAYER_COORDINATES,
    installedContent,
    fetchFailures,
    simLibraryCatalog
  ).map(toExtensionBrowserEntry);
}

/**
 * Validate a bundled catalog document, throwing with the stable error codes
 * when it is malformed. Runs once at catalog module initialization; a fatal
 * surfaces immediately on the dev server.
 *
 * @param document - The imported catalog JSON module value.
 */
export function loadSimLibraryCatalog(document: unknown): ExtensionCatalogDocument {
  const result = validateExtensionCatalogDocument(document);
  if (!result.ok) {
    throw new Error(`Bundled sim library catalog is invalid: ${result.errors.map((error) => error.code).join(", ")}`);
  }
  return result.document;
}

/**
 * The bundled library catalog offered to apps/sim projects: the curated set of
 * published feature libraries, each pinned to an exact `gh:` reference.
 */
export const simLibraryCatalog: ExtensionCatalogDocument = loadSimLibraryCatalog(simLibraryCatalogDocument);

/** The curated catalog moves the bundled sim catalog declares, keyed by source coordinate. */
export const simLibraryCatalogMoves = simLibraryCatalog.moves;

/** The bundled catalog's coordinates in document order; anchors the library browser's stable list order. */
export const simCatalogCoordinateOrder: readonly string[] = simLibraryCatalog.entries.map((entry) => entry.coordinate);

/**
 * Build the catalog offers for an apps/sim project: one offer per bundled
 * catalog entry that is compatible with the project's sim platform stack, marked
 * installed when the project's extensions map already carries the entry's
 * coordinate.
 *
 * @param extensions - The project's extensions map, keyed by coordinate.
 * @param embedRecord - The bundled embedded extensions used to derive the platform stack and read embedded offer targets.
 */
export function buildSimCatalogOffers(
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[]
): ExtensionCatalogOffer[] {
  return buildExtensionCatalogOffers(simLibraryCatalog, extensions, embedRecord, SIM_LAYER_COORDINATES);
}

/**
 * The display name of the library at `coordinate`: the installed content's
 * manifest name when the library is in the resolved closure, the bundled
 * catalog entry's name otherwise, and the coordinate itself as the last
 * fallback.
 *
 * @param installedLibraries - The active project's installed libraries, each with its manifest display name.
 * @param coordinate - The library's `<owner>/<repo>` coordinate.
 */
export function simLibraryDisplayName(
  installedLibraries: readonly Pick<ExtensionCatalogEntry, "coordinate" | "name">[],
  coordinate: string
): string {
  const installed = installedLibraries.find((library) => library.coordinate === coordinate);
  if (installed !== undefined) {
    return installed.name;
  }
  const catalogEntry = simLibraryCatalog.entries.find((entry) => entry.coordinate === coordinate);
  return catalogEntry?.name ?? coordinate;
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
 * Install a catalog offer or pasted add-field input, routing by the reference's
 * transport. An `embedded:<coordinate>` reference installs the host-bundled
 * library by writing that embedded reference to the manifest map; any other
 * input flows through {@link installSimExtensionReference}, which normalizes and
 * installs a remote (`gh:`) reference. Returns that same outcome shape.
 *
 * @param surface - The active-project normalization and persistence surface.
 * @param extensions - The project's current extensions map.
 * @param embedRecord - The bundled embedded extensions an embedded install resolves against.
 * @param input - The catalog offer reference or pasted add-field text.
 */
export async function installSimReference(
  surface: ExtensionReferenceInstallSurface,
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[],
  input: string
): Promise<ExtensionReferenceInstallOutcome> {
  const trimmed = input.trim();
  const parsed = parseExtensionReference(trimmed);
  if (parsed?.transport === "embedded") {
    const action = installEmbeddedExtension(extensions, embedRecord, parsed.coordinate);
    if (!action.ok) {
      return { ok: true, reference: trimmed, action };
    }
    return { ok: true, reference: trimmed, action, report: await surface.updateProjectExtensions(action.extensions) };
  }
  return installSimExtensionReference(surface, extensions, input);
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
