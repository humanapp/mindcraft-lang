import {
  type ExtensionCatalogDocument,
  type ExtensionTarget,
  LOWEST_CONTENT_VERSION,
  MINDCRAFT_JSON_PATH,
  parseExtensionReference,
  parseProjectContentManifest,
} from "@mindcraft-lang/app-host";
import type { EmbeddedExtension, FetchedExtensionContentMap } from "./embedded-extensions.js";
import { resolveProjectExtensions } from "./embedded-extensions.js";

/**
 * One layer of a project's platform stack: a resolved layer library's
 * `<owner>/<repo>` coordinate and the semantic version its bundled content
 * declares. Compatibility filtering matches an extension's declared targets
 * against these entries.
 */
export interface PlatformStackLayer {
  /** The layer library's `<owner>/<repo>` coordinate. */
  readonly coordinate: string;
  /** The layer library's declared semantic version, or `0.0.0` when it declares none. */
  readonly version: string;
}

/**
 * One entry of the extension catalog: an embedded extension surfaced for a
 * project, annotated with its manifest identity and its lifecycle state
 * relative to the project.
 */
export interface ExtensionCatalogEntry {
  /** The extension's `<owner>/<repo>` coordinate: its identity and manifest key. */
  readonly coordinate: string;
  /** Display name read from the extension's content manifest; the coordinate when it declares none. */
  readonly name: string;
  /** Semantic version read from the extension's content manifest, or `0.0.0` when it declares none. */
  readonly version: string;
  /** Thumbnail URL or data URI read from the extension's content manifest; absent when it declares none. */
  readonly thumbnailUrl?: string;
  /** True when the extension is in the project's resolved extension set. */
  readonly installed: boolean;
  /** GitHub repository URL `https://github.com/<coordinate>`; set only for remote (`gh:`) entries, whose coordinate is their repository. */
  readonly repoUrl?: string;
  /** True for a fetched (`gh:`) dependency with installed content, which carries an on-request update affordance. */
  readonly updatable?: boolean;
  /** Present when a declared `gh:` dependency has no installed snapshot content. */
  readonly broken?: {
    /** Stable failure code of the most recent recorded install attempt; absent when none is recorded. */
    readonly code?: string;
    /** Human-readable description of the broken state. */
    readonly message: string;
  };
  /** Present when the installed content's manifest identity differs from the coordinate its reference names. */
  readonly identityMismatch?: {
    /** The `<owner>/<repo>` identity the installed content's manifest declares. */
    readonly declaredIdentity: string;
  };
}

/** The last recorded fetch failure per reference, keyed by the reference string as written. */
export type ExtensionFetchFailures = ReadonlyMap<string, { readonly code: string; readonly message: string }>;

/** Stable identifiers for the outcome of an install or uninstall action. */
export const ExtensionActionResultCode = {
  /** The extension reference was added to the project's extensions map. */
  INSTALLED: "EXTENSION_INSTALLED",
  /** The extension was already in the project's extensions map; nothing changed. */
  ALREADY_INSTALLED: "EXTENSION_ALREADY_INSTALLED",
  /** The extension reference was removed from the project's extensions map. */
  UNINSTALLED: "EXTENSION_UNINSTALLED",
  /** The extension was not in the project's extensions map; nothing changed. */
  NOT_INSTALLED: "EXTENSION_NOT_INSTALLED",
  /** The coordinate is a required layer library and cannot be uninstalled; nothing changed. */
  LOCKED: "EXTENSION_LOCKED",
  /** The coordinate names no bundled extension in the embed record; nothing changed. */
  UNKNOWN_COORDINATE: "EXTENSION_UNKNOWN_COORDINATE",
  /** The reference string is not a well-formed remote extension reference; nothing changed. */
  INVALID_REFERENCE: "EXTENSION_INVALID_REFERENCE",
  /** Another installed extension depends on the coordinate; it cannot be uninstalled while depended upon. Nothing changed. */
  REQUIRED_BY_DEPENDENT: "EXTENSION_REQUIRED_BY_DEPENDENT",
} as const;

/** Union of all {@link ExtensionActionResultCode} values. */
export type ExtensionActionResultCode = (typeof ExtensionActionResultCode)[keyof typeof ExtensionActionResultCode];

/** Outcome of an install or uninstall action against a project's extensions map. */
export interface ExtensionActionResult {
  /** True when the action changed the extensions map. */
  readonly ok: boolean;
  /** Stable code describing what happened. */
  readonly code: ExtensionActionResultCode;
  /** The extensions map after the action; unchanged from the input when `ok` is false. */
  readonly extensions: Readonly<Record<string, string>>;
}

/** An extension's manifest identity, as read from its bundled `mindcraft.json`. */
interface EmbeddedManifest {
  name: string;
  version: string;
  thumbnailUrl?: string;
  targets?: Readonly<Record<string, ExtensionTarget>>;
  identity?: string;
}

/** Read an embedded extension's manifest identity from its bundled `mindcraft.json`. */
function readEmbeddedManifest(extension: EmbeddedExtension): EmbeddedManifest {
  const manifestFile = extension.files.find(
    (file) => file.path === MINDCRAFT_JSON_PATH || file.path === `/${MINDCRAFT_JSON_PATH}`
  );
  if (manifestFile === undefined) {
    return { name: extension.canonicalOrigin, version: LOWEST_CONTENT_VERSION };
  }
  const parsed = parseProjectContentManifest(manifestFile.content);
  if (!parsed.ok) {
    return { name: extension.canonicalOrigin, version: LOWEST_CONTENT_VERSION };
  }
  return {
    name: parsed.manifest.name,
    version: parsed.manifest.version,
    ...(parsed.manifest.thumbnailUrl !== undefined ? { thumbnailUrl: parsed.manifest.thumbnailUrl } : {}),
    ...(parsed.manifest.targets !== undefined ? { targets: parsed.manifest.targets } : {}),
  };
}

/** The `<owner>/<repo>` coordinates a project's extensions map references directly through embedded references. */
function directEmbeddedCoordinates(
  extensions: Readonly<Record<string, string>> | undefined,
  byCoordinate: ReadonlyMap<string, EmbeddedExtension>
): Set<string> {
  const direct = new Set<string>();
  for (const reference of Object.values(extensions ?? {})) {
    const parsed = parseExtensionReference(reference);
    if (parsed?.transport === "embedded" && byCoordinate.has(parsed.coordinate)) {
      direct.add(parsed.coordinate);
    }
  }
  return direct;
}

/** The coordinates of every origin in a project's resolved extension closure. */
function resolvedOrigins(
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[],
  fetched?: FetchedExtensionContentMap
): Set<string> {
  const resolved = resolveProjectExtensions(extensions, { embedded: embedRecord, fetched });
  return new Set(resolved.dependencyMounts.map((mount) => mount.namespace));
}

/** Read a fetched extension's manifest identity from its snapshot content. */
function readFetchedManifest(files: ReadonlyMap<string, string>): EmbeddedManifest | undefined {
  const manifestContent = files.get(`/${MINDCRAFT_JSON_PATH}`) ?? files.get(MINDCRAFT_JSON_PATH);
  if (manifestContent === undefined) {
    return undefined;
  }
  const parsed = parseProjectContentManifest(manifestContent);
  if (!parsed.ok) {
    return undefined;
  }
  return {
    name: parsed.manifest.name,
    version: parsed.manifest.version,
    ...(parsed.manifest.thumbnailUrl !== undefined ? { thumbnailUrl: parsed.manifest.thumbnailUrl } : {}),
    ...(parsed.manifest.targets !== undefined ? { targets: parsed.manifest.targets } : {}),
    ...(parsed.manifest.identity !== undefined ? { identity: parsed.manifest.identity } : {}),
  };
}

/**
 * Derive a project's platform stack: the resolved layer libraries the project
 * sits on, each with its declared version. The stack is the intersection of the
 * project's resolved extension closure with the declared platform-layer
 * coordinates; a microbit-sim project resolves `core`, `wodal`, and
 * `microbit-v2`, an apps/sim project resolves `core` and `sim`.
 *
 * @param extensions - The project's extensions map, keyed by coordinate.
 * @param embedRecord - The host application's bundled embedded extensions.
 * @param layerCoordinates - The coordinates the host declares as platform layers.
 */
export function deriveProjectPlatformStack(
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[],
  layerCoordinates: ReadonlySet<string>
): PlatformStackLayer[] {
  const byCoordinate = new Map(embedRecord.map((extension) => [extension.canonicalOrigin, extension]));
  const stack: PlatformStackLayer[] = [];
  for (const origin of resolvedOrigins(extensions, embedRecord)) {
    if (!layerCoordinates.has(origin)) {
      continue;
    }
    const extension = byCoordinate.get(origin);
    if (extension === undefined) {
      continue;
    }
    stack.push({ coordinate: origin, version: readEmbeddedManifest(extension).version });
  }
  return stack;
}

/**
 * Report whether an extension declaring the given compatibility targets is
 * compatible with a platform stack. Compatible when one of the extension's
 * target packages is in the stack and the stack's version for that package
 * satisfies the target's `packageVersion` semver range. An extension with no
 * targets, or an empty targets map, is compatible with no stack.
 *
 * @param targets - The extension's declared compatibility targets, keyed by target package coordinate.
 * @param stack - The project's platform stack.
 */
export function isExtensionCompatible(
  targets: Readonly<Record<string, ExtensionTarget>> | undefined,
  stack: readonly PlatformStackLayer[]
): boolean {
  if (targets === undefined) {
    return false;
  }
  for (const [coordinate, target] of Object.entries(targets)) {
    const layer = stack.find((entry) => entry.coordinate === coordinate);
    if (layer !== undefined && satisfiesRange(layer.version, target.packageVersion)) {
      return true;
    }
  }
  return false;
}

/**
 * Build the entry cards for a project's extension browser: the project's direct
 * dependencies that a user manages, across both transports. An embedded entry
 * is listed when the map references its coordinate directly through an
 * `embedded:` reference and the coordinate is not a platform layer; a remote
 * (`gh:`) entry is listed for each `gh:` reference the map names. Nothing else
 * lists: a platform layer library, a non-referenced bundled add-on, and a
 * transitively-resolved sub-dependency are not entry cards (a bundled add-on is
 * surfaced through the catalog offers instead). A remote dependency's card
 * reads its name and version from its installed snapshot content and is marked
 * `updatable`; a remote reference with no content available is listed under its
 * coordinate as `broken`, carrying the last recorded fetch failure when one is
 * known, so it can be retried or removed. A remote dependency whose installed
 * manifest declares a different identity than its coordinate carries an
 * `identityMismatch` annotation.
 *
 * @param extensions - The project's extensions map, keyed by coordinate.
 * @param embedRecord - The host application's bundled embedded extensions.
 * @param layerCoordinates - The coordinates the host declares as platform layers; these are never entry cards.
 * @param fetched - Installed fetched-extension content, keyed by reference.
 * @param fetchFailures - The last recorded fetch failure per reference.
 */
export function buildExtensionCatalog(
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[],
  layerCoordinates: ReadonlySet<string>,
  fetched?: FetchedExtensionContentMap,
  fetchFailures?: ExtensionFetchFailures
): ExtensionCatalogEntry[] {
  const byCoordinate = new Map(embedRecord.map((extension) => [extension.canonicalOrigin, extension]));
  const installed = resolvedOrigins(extensions, embedRecord, fetched);
  const direct = directEmbeddedCoordinates(extensions, byCoordinate);

  const entries: ExtensionCatalogEntry[] = [];
  for (const extension of embedRecord) {
    const coordinate = extension.canonicalOrigin;
    if (!direct.has(coordinate) || layerCoordinates.has(coordinate)) {
      continue;
    }
    const manifest = readEmbeddedManifest(extension);
    entries.push({
      coordinate,
      name: manifest.name,
      version: manifest.version,
      ...(manifest.thumbnailUrl !== undefined ? { thumbnailUrl: manifest.thumbnailUrl } : {}),
      installed: installed.has(coordinate),
    });
  }

  for (const [coordinate, reference] of Object.entries(extensions ?? {})) {
    const parsed = parseExtensionReference(reference);
    if (parsed?.transport !== "gh") {
      continue;
    }
    const content = fetched?.get(reference);
    const manifest = content !== undefined ? readFetchedManifest(content) : undefined;
    const failure = fetchFailures?.get(reference);
    const broken =
      content === undefined
        ? {
            ...(failure !== undefined ? { code: failure.code } : {}),
            message: failure?.message ?? `No content is installed for "${reference}".`,
          }
        : undefined;
    const identityMismatch =
      manifest?.identity !== undefined && manifest.identity !== coordinate
        ? { declaredIdentity: manifest.identity }
        : undefined;
    entries.push({
      coordinate,
      name: manifest?.name ?? coordinate,
      version: manifest?.version ?? LOWEST_CONTENT_VERSION,
      ...(manifest?.thumbnailUrl !== undefined ? { thumbnailUrl: manifest.thumbnailUrl } : {}),
      installed: installed.has(coordinate),
      repoUrl: `https://github.com/${coordinate}`,
      ...(content !== undefined ? { updatable: true } : {}),
      ...(broken !== undefined ? { broken } : {}),
      ...(identityMismatch !== undefined ? { identityMismatch } : {}),
    });
  }
  return entries;
}

/**
 * One catalog document entry offered to a project: the entry's display
 * metadata. Only libraries the project has not yet installed are offered.
 */
export interface ExtensionCatalogOffer {
  /** The extension's `<owner>/<repo>` coordinate. */
  readonly coordinate: string;
  /** Display name from the catalog entry. */
  readonly name: string;
  /** Published version from the catalog entry. */
  readonly version: string;
  /** Description from the catalog entry. */
  readonly description: string;
  /** Thumbnail URL or data URI from the catalog entry; absent when it declares none. */
  readonly thumbnailUrl?: string;
  /** The pinned `gh:` reference an install of this offer writes. */
  readonly ref: string;
}

/**
 * Report whether an offer's declared target coordinates place it on a platform
 * stack, ignoring version ranges. True when at least one declared target
 * coordinate is a layer in the stack. An offer with no targets is on no stack.
 * Used for embedded offers, which version with the host and so declare only the
 * target coordinate they belong to.
 *
 * @param targets - The offer's declared compatibility targets, keyed by target package coordinate.
 * @param stack - The project's platform stack.
 */
function targetsCoordinateInStack(
  targets: Readonly<Record<string, ExtensionTarget>> | undefined,
  stack: readonly PlatformStackLayer[]
): boolean {
  if (targets === undefined) {
    return false;
  }
  for (const coordinate of Object.keys(targets)) {
    if (stack.some((layer) => layer.coordinate === coordinate)) {
      return true;
    }
  }
  return false;
}

/**
 * Adapt a validated extension catalog document into per-project offers,
 * compatibility-filtered against the project's platform stack: one offer per
 * compatible entry the project has not already installed, rendered from the
 * entry's display metadata alone. An entry whose coordinate the project's
 * extensions map already carries is dropped, since it is represented instead by
 * its manageable entry card. The stack is derived from the project's
 * extensions, the embed record, and the layer coordinates.
 *
 * An offer's compatibility is judged by its reference transport. An
 * `embedded:` offer is compatible when at least one target coordinate its
 * embed-record manifest declares is a layer in the stack; its declared version
 * range is ignored, since an embedded library versions with the host. A `gh:`
 * offer is compatible when its catalog-entry targets both name a stack layer
 * and satisfy that layer's version through {@link isExtensionCompatible}; a
 * `gh:` offer that declares no targets is excluded, since it cannot be
 * verified compatible.
 *
 * @param document - The validated catalog document.
 * @param extensions - The project's extensions map, keyed by coordinate.
 * @param embedRecord - The host application's bundled embedded extensions.
 * @param layerCoordinates - The coordinates the host declares as platform layers.
 */
export function buildExtensionCatalogOffers(
  document: ExtensionCatalogDocument,
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[],
  layerCoordinates: ReadonlySet<string>
): ExtensionCatalogOffer[] {
  const current = extensions ?? {};
  const stack = deriveProjectPlatformStack(extensions, embedRecord, layerCoordinates);
  const byCoordinate = new Map(embedRecord.map((extension) => [extension.canonicalOrigin, extension]));
  const offers: ExtensionCatalogOffer[] = [];
  for (const entry of document.entries) {
    if (entry.coordinate in current) {
      continue;
    }
    const parsed = parseExtensionReference(entry.ref);
    let compatible: boolean;
    if (parsed?.transport === "embedded") {
      const embedded = byCoordinate.get(entry.coordinate);
      const targets = embedded !== undefined ? readEmbeddedManifest(embedded).targets : undefined;
      compatible = targetsCoordinateInStack(targets, stack);
    } else {
      compatible = isExtensionCompatible(entry.targets, stack);
    }
    if (!compatible) {
      continue;
    }
    offers.push({
      coordinate: entry.coordinate,
      name: entry.name,
      version: entry.version,
      description: entry.description,
      ...(entry.thumbnail !== undefined ? { thumbnailUrl: entry.thumbnail } : {}),
      ref: entry.ref,
    });
  }
  return offers;
}

/**
 * Add a remote extension to a project's extensions map from a `gh:` reference
 * string, keyed by the reference's `<owner>/<repo>` coordinate. Rejects a
 * string that is not a well-formed `gh:` reference, and reports an
 * already-present coordinate as a no-op.
 *
 * @param extensions - The project's current extensions map, keyed by coordinate.
 * @param reference - The `gh:<owner>/<repo>@<pin>` or `gh:<owner>/<repo>#<branch>` reference to add.
 */
export function installExtensionReference(
  extensions: Readonly<Record<string, string>> | undefined,
  reference: string
): ExtensionActionResult {
  const current = extensions ?? {};
  const parsed = parseExtensionReference(reference.trim());
  if (parsed?.transport !== "gh") {
    return { ok: false, code: ExtensionActionResultCode.INVALID_REFERENCE, extensions: current };
  }
  const coordinate = `${parsed.owner}/${parsed.repo}`;
  if (coordinate in current) {
    return { ok: false, code: ExtensionActionResultCode.ALREADY_INSTALLED, extensions: current };
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    next[key] = value;
  }
  next[coordinate] = reference.trim();
  return { ok: true, code: ExtensionActionResultCode.INSTALLED, extensions: next };
}

/**
 * Install an embedded extension into a project's extensions map by adding an
 * `embedded:<owner>/<repo>` reference keyed by its coordinate. The existing
 * resolution and materialization pipeline includes it thereafter. Rejects a
 * coordinate that names no bundled extension, and reports an already-present
 * coordinate as a no-op.
 *
 * @param extensions - The project's current extensions map, keyed by coordinate.
 * @param embedRecord - The host application's bundled embedded extensions.
 * @param coordinate - The `<owner>/<repo>` coordinate to install.
 */
export function installEmbeddedExtension(
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[],
  coordinate: string
): ExtensionActionResult {
  const current = extensions ?? {};
  const known = embedRecord.some((extension) => extension.canonicalOrigin === coordinate);
  if (!known) {
    return { ok: false, code: ExtensionActionResultCode.UNKNOWN_COORDINATE, extensions: current };
  }
  if (coordinate in current) {
    return { ok: false, code: ExtensionActionResultCode.ALREADY_INSTALLED, extensions: current };
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    next[key] = value;
  }
  next[coordinate] = `embedded:${coordinate}`;
  return { ok: true, code: ExtensionActionResultCode.INSTALLED, extensions: next };
}

/**
 * Uninstall an extension from a project's extensions map by removing the entry
 * keyed by its coordinate, regardless of the entry's transport. The existing
 * regenerate-on-load pipeline de-materializes it thereafter. Rejects a required
 * platform layer library, reports an absent coordinate as a no-op, and blocks
 * removing a coordinate that another still-installed extension depends on:
 * after the removal that dependent would still pull the coordinate back into
 * the resolved closure, so removing its explicit entry is refused with
 * {@link ExtensionActionResultCode.REQUIRED_BY_DEPENDENT}.
 *
 * @param extensions - The project's current extensions map, keyed by coordinate.
 * @param coordinate - The `<owner>/<repo>` coordinate to uninstall.
 * @param layerCoordinates - The coordinates the host declares as platform layers; these are not uninstallable.
 * @param embedRecord - The host application's bundled embedded extensions, used to resolve dependents.
 * @param fetched - Installed fetched-extension content, keyed by reference, used to resolve dependents.
 */
export function uninstallExtension(
  extensions: Readonly<Record<string, string>> | undefined,
  coordinate: string,
  layerCoordinates: ReadonlySet<string>,
  embedRecord: readonly EmbeddedExtension[],
  fetched?: FetchedExtensionContentMap
): ExtensionActionResult {
  const current = extensions ?? {};
  if (layerCoordinates.has(coordinate)) {
    return { ok: false, code: ExtensionActionResultCode.LOCKED, extensions: current };
  }
  if (!(coordinate in current)) {
    return { ok: false, code: ExtensionActionResultCode.NOT_INSTALLED, extensions: current };
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    if (key !== coordinate) {
      next[key] = value;
    }
  }
  if (resolvedOrigins(next, embedRecord, fetched).has(coordinate)) {
    return { ok: false, code: ExtensionActionResultCode.REQUIRED_BY_DEPENDENT, extensions: current };
  }
  return { ok: true, code: ExtensionActionResultCode.UNINSTALLED, extensions: next };
}

/**
 * Report whether a semantic version satisfies a semver range. Supports a
 * space-separated conjunction of comparators, each one of: `*`/`x` (any),
 * an exact `x.y.z` (optionally prefixed `=`), a caret range `^x.y.z`, a tilde
 * range `~x.y.z`, or a `>`, `>=`, `<`, or `<=` comparator. Prerelease and build
 * metadata are ignored in the comparison.
 *
 * @param version - A concrete semantic version.
 * @param range - The semver range to test against.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const target = parseVersionTriple(version);
  if (target === undefined) {
    return false;
  }
  const comparators = range
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (comparators.length === 0) {
    return true;
  }
  return comparators.every((comparator) => satisfiesComparator(target, comparator));
}

/** A parsed `[major, minor, patch]` version triple. */
type VersionTriple = readonly [number, number, number];

/** Parse the release triple of a version, ignoring any prerelease or build metadata. Returns `undefined` when malformed. */
function parseVersionTriple(version: string): VersionTriple | undefined {
  const release = version.split("-")[0].split("+")[0];
  const parts = release.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const triple = parts.map((part) => Number(part));
  if (triple.some((part) => !Number.isInteger(part) || part < 0)) {
    return undefined;
  }
  return [triple[0], triple[1], triple[2]];
}

/** Compare two version triples; negative when `a < b`, positive when `a > b`, zero when equal. */
function compareTriple(a: VersionTriple, b: VersionTriple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

/** Report whether a version triple satisfies a single range comparator. */
function satisfiesComparator(target: VersionTriple, comparator: string): boolean {
  if (comparator === "*" || comparator === "x" || comparator === "X") {
    return true;
  }
  const operatorMatch = comparator.match(/^(>=|<=|>|<|=|\^|~)?(.*)$/);
  if (operatorMatch === null) {
    return false;
  }
  const operator = operatorMatch[1] ?? "";
  const bound = parseVersionTriple(operatorMatch[2]);
  if (bound === undefined) {
    return false;
  }
  const order = compareTriple(target, bound);
  switch (operator) {
    case ">":
      return order > 0;
    case ">=":
      return order >= 0;
    case "<":
      return order < 0;
    case "<=":
      return order <= 0;
    case "^":
      return order >= 0 && compareTriple(target, caretUpperBound(bound)) < 0;
    case "~":
      return order >= 0 && compareTriple(target, [bound[0], bound[1] + 1, 0]) < 0;
    default:
      return order === 0;
  }
}

/** The exclusive upper bound of a caret range: the next version that changes the leftmost non-zero component. */
function caretUpperBound(bound: VersionTriple): VersionTriple {
  if (bound[0] > 0) {
    return [bound[0] + 1, 0, 0];
  }
  if (bound[1] > 0) {
    return [0, bound[1] + 1, 0];
  }
  return [0, 0, bound[2] + 1];
}
