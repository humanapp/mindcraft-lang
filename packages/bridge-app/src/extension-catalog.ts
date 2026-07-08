import {
  type ExtensionTarget,
  LOWEST_CONTENT_VERSION,
  MINDCRAFT_JSON_PATH,
  parseExtensionReference,
  parseProjectContentManifest,
} from "@mindcraft-lang/app-host";
import type { EmbeddedExtension } from "./embedded-extensions.js";
import { resolveEmbeddedExtensions } from "./embedded-extensions.js";

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
  /** True when the extension is a required platform layer library the user cannot install or uninstall. */
  readonly locked: boolean;
}

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
  embedRecord: readonly EmbeddedExtension[]
): Set<string> {
  const resolved = resolveEmbeddedExtensions(extensions, embedRecord);
  return new Set(resolved.dependencyMounts.map((mount) => mount.namespace));
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
 * Build the extension catalog for a project: the flat list of top-level
 * embedded extensions directly compatible with the project's platform. It
 * includes each directly-referenced platform layer library (locked) and every
 * bundled add-on whose declared targets match the project's stack; transitive
 * sub-dependencies of a layer library are not listed, and add-ons incompatible
 * with the stack are excluded.
 *
 * @param extensions - The project's extensions map, keyed by coordinate.
 * @param embedRecord - The host application's bundled embedded extensions.
 * @param layerCoordinates - The coordinates the host declares as platform layers.
 */
export function buildExtensionCatalog(
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[],
  layerCoordinates: ReadonlySet<string>
): ExtensionCatalogEntry[] {
  const byCoordinate = new Map(embedRecord.map((extension) => [extension.canonicalOrigin, extension]));
  const installed = resolvedOrigins(extensions, embedRecord);
  const direct = directEmbeddedCoordinates(extensions, byCoordinate);
  const stack = deriveProjectPlatformStack(extensions, embedRecord, layerCoordinates);

  const entries: ExtensionCatalogEntry[] = [];
  for (const extension of embedRecord) {
    const coordinate = extension.canonicalOrigin;
    const locked = layerCoordinates.has(coordinate);
    const manifest = readEmbeddedManifest(extension);
    if (locked) {
      // Only the project's directly-referenced target library is top-level;
      // a layer library reached only transitively is a sub-dependency, not a card.
      if (!direct.has(coordinate)) {
        continue;
      }
    } else if (!isExtensionCompatible(manifest.targets, stack)) {
      continue;
    }
    entries.push({
      coordinate,
      name: manifest.name,
      version: manifest.version,
      ...(manifest.thumbnailUrl !== undefined ? { thumbnailUrl: manifest.thumbnailUrl } : {}),
      installed: installed.has(coordinate),
      locked,
    });
  }
  return entries;
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
 * Uninstall an embedded extension from a project's extensions map by removing
 * the entry keyed by its coordinate. The existing regenerate-on-load pipeline
 * de-materializes it thereafter. Rejects a required platform layer library and
 * reports an absent coordinate as a no-op.
 *
 * @param extensions - The project's current extensions map, keyed by coordinate.
 * @param coordinate - The `<owner>/<repo>` coordinate to uninstall.
 * @param layerCoordinates - The coordinates the host declares as platform layers; these are not uninstallable.
 */
export function uninstallEmbeddedExtension(
  extensions: Readonly<Record<string, string>> | undefined,
  coordinate: string,
  layerCoordinates: ReadonlySet<string>
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
