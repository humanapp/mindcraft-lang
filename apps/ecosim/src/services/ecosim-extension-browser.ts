import type {
  ExtensionAddInputErrorCode,
  ExtensionCatalogDocument,
  ExtensionFetchError,
  ExtensionFetchErrorCode,
  ExtensionUpdateApplication,
} from "@wendoo/app-host";
import {
  buildApprovedCatalogEntryLookup,
  parseExtensionReference,
  validateExtensionCatalogDocument,
} from "@wendoo/app-host";
import {
  type AppEnvironmentHost,
  addOfferedLibrary,
  buildExtensionCatalog,
  buildExtensionCatalogOffers,
  buildExtensionCatalogShelf,
  type EmbeddedExtension,
  type ExtensionActionResult,
  type ExtensionCatalogEntry,
  type ExtensionCatalogOffer,
  type ExtensionCatalogShelfEntry,
  type ExtensionFetchFailures,
  type ExtensionInstallReport,
  type FetchedExtensionContentMap,
  installEmbeddedExtension,
  installExtensionReference,
  type LibraryOfferToasts,
  uninstallExtension,
} from "@wendoo/bridge-app";
import type { ExtensionBrowserEntry } from "@wendoo/ui";
import { CORE_LIB_COORDINATE, ECOSIM_LIB_COORDINATE } from "./ecosim-extension-coordinates";
import ecosimLibraryCatalogDocument from "./ecosim-library-catalog.json";

/**
 * The locked platform-layer coordinates of an apps/ecosim project: the core and sim
 * layers. These are required layer libraries the user can neither install nor
 * uninstall.
 */
export const ECOSIM_LAYER_COORDINATES: ReadonlySet<string> = new Set([CORE_LIB_COORDINATE, ECOSIM_LIB_COORDINATE]);

/** The project-persistence surface the install and uninstall handlers drive. */
export type ExtensionProjectPersistence = Pick<AppEnvironmentHost, "updateProjectExtensions">;

/** The active-project surface an add-field install drives: input normalization plus the install transaction. */
export type ExtensionReferenceInstallSurface = Pick<
  AppEnvironmentHost,
  "resolveExtensionInstallInput" | "updateProjectExtensions"
>;

/**
 * The active-project surface adding a library the assistant offered drives: the
 * add-field install surface plus the installed libraries its display name is
 * read from.
 */
export type LibraryOfferInstallHost = ExtensionReferenceInstallSurface & Pick<AppEnvironmentHost, "installedLibraries">;

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
 * Build the browser entries for an apps/ecosim project: the extension catalog for
 * the project's extensions against the given embed record, the sim layer set,
 * the project's installed fetched-extension content, and the last recorded
 * fetch failures, adapted into browser view models.
 *
 * @param extensions - The project's extensions map, keyed by coordinate.
 * @param embedRecord - The bundled embedded extensions to resolve against.
 * @param installedContent - Installed fetched-extension content, keyed by reference.
 * @param fetchFailures - The last recorded fetch failure per reference.
 */
export function buildEcosimExtensionEntries(
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[],
  installedContent?: FetchedExtensionContentMap,
  fetchFailures?: ExtensionFetchFailures
): ExtensionBrowserEntry[] {
  return buildExtensionCatalog(
    extensions,
    embedRecord,
    ECOSIM_LAYER_COORDINATES,
    installedContent,
    fetchFailures,
    ecosimLibraryCatalog
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
 * The bundled library catalog offered to apps/ecosim projects: the curated set of
 * published feature libraries, each pinned to an exact `gh:` reference.
 */
export const ecosimLibraryCatalog: ExtensionCatalogDocument = loadSimLibraryCatalog(ecosimLibraryCatalogDocument);

/** The curated catalog moves the bundled sim catalog declares, keyed by source coordinate. */
export const ecosimLibraryCatalogMoves = ecosimLibraryCatalog.moves;

/** Resolves a coordinate to the approved pin the bundled sim catalog's entry for it offers. */
export const ecosimApprovedCatalogEntry = buildApprovedCatalogEntryLookup(ecosimLibraryCatalog);

/** The bundled catalog's coordinates in document order; anchors the library browser's stable list order. */
export const ecosimCatalogCoordinateOrder: readonly string[] = ecosimLibraryCatalog.entries.map(
  (entry) => entry.coordinate
);

/**
 * The namespaces an apps/ecosim session features: every coordinate the bundled
 * catalog lists.
 */
export const ecosimFeaturedNamespaces: ReadonlySet<string> = new Set(ecosimCatalogCoordinateOrder);

/**
 * Build the catalog offers for an apps/ecosim project: one offer per bundled
 * catalog entry that is compatible with the project's sim platform stack, marked
 * installed when the project's extensions map already carries the entry's
 * coordinate.
 *
 * @param extensions - The project's extensions map, keyed by coordinate.
 * @param embedRecord - The bundled embedded extensions used to derive the platform stack and read embedded offer targets.
 */
export function buildEcosimCatalogOffers(
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[]
): ExtensionCatalogOffer[] {
  return buildExtensionCatalogOffers(ecosimLibraryCatalog, extensions, embedRecord, ECOSIM_LAYER_COORDINATES);
}

/**
 * Build the library shelf for an apps/ecosim project: every bundled catalog
 * entry the project already holds, marked installed, plus every entry
 * compatible with the project's sim platform stack, marked not installed.
 *
 * @param extensions - The project's extensions map, keyed by coordinate.
 * @param embedRecord - The bundled embedded extensions used to derive the platform stack and read embedded offer targets.
 */
export function buildEcosimLibraryShelf(
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[]
): ExtensionCatalogShelfEntry[] {
  return buildExtensionCatalogShelf(ecosimLibraryCatalog, extensions, embedRecord, ECOSIM_LAYER_COORDINATES);
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
export function ecosimLibraryDisplayName(
  installedLibraries: readonly Pick<ExtensionCatalogEntry, "coordinate" | "name">[],
  coordinate: string
): string {
  const installed = installedLibraries.find((library) => library.coordinate === coordinate);
  if (installed !== undefined) {
    return installed.name;
  }
  const catalogEntry = ecosimLibraryCatalog.entries.find((entry) => entry.coordinate === coordinate);
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
export async function installEcosimExtension(
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
export async function installEcosimExtensionReference(
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
 * input flows through {@link installEcosimExtensionReference}, which normalizes and
 * installs a remote (`gh:`) reference. Returns that same outcome shape.
 *
 * @param surface - The active-project normalization and persistence surface.
 * @param extensions - The project's current extensions map.
 * @param embedRecord - The bundled embedded extensions an embedded install resolves against.
 * @param input - The catalog offer reference or pasted add-field text.
 */
export async function installEcosimReference(
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
  return installEcosimExtensionReference(surface, extensions, input);
}

/**
 * Add the library at `coordinate` to the project on behalf of an offer the
 * assistant made: the bundled catalog's approved reference for it, installed
 * and persisted through the active project, with the outcome presented through
 * `toasts`. Answers whether this attempt put the library in the project.
 *
 * @param host - The active-project normalization, persistence, and installed-library surface.
 * @param extensions - The project's current extensions map.
 * @param embedRecord - The bundled embedded extensions an embedded install resolves against.
 * @param coordinate - The `<owner>/<repo>` coordinate the offer names.
 * @param toasts - Where the outcome is presented.
 */
export function addEcosimLibrary(
  host: LibraryOfferInstallHost,
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[],
  coordinate: string,
  toasts: LibraryOfferToasts
): Promise<boolean> {
  return addOfferedLibrary(
    {
      approvedReference: (named) => ecosimApprovedCatalogEntry(named)?.ref,
      install: (reference) => installEcosimReference(host, extensions, embedRecord, reference),
      displayName: (named) => ecosimLibraryDisplayName(host.installedLibraries, named),
      toasts,
    },
    coordinate
  );
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
export async function uninstallEcosimExtension(
  persistence: ExtensionProjectPersistence,
  extensions: Readonly<Record<string, string>> | undefined,
  coordinate: string,
  embedRecord: readonly EmbeddedExtension[],
  installedContent?: FetchedExtensionContentMap
): Promise<ExtensionActionOutcome> {
  const action = uninstallExtension(extensions, coordinate, ECOSIM_LAYER_COORDINATES, embedRecord, installedContent);
  if (!action.ok) {
    return { action };
  }
  return { action, report: await persistence.updateProjectExtensions(action.extensions) };
}
