import type { FileContent } from "@wendoo-lang/app-host";
import { fileContentText } from "@wendoo-lang/app-host";
import { renameBrainNamespaces } from "@wendoo-lang/core/app";
import { EXTENSION_IMPORT_PREFIX } from "@wendoo-lang/ts-compiler";
import type { EmbeddedExtension, FetchedExtensionContentMap } from "./embedded-extensions.js";
import { resolveProjectExtensions } from "./embedded-extensions.js";

/** A saved brain checked by the uninstall guard: its display name and persisted brain JSON. */
export interface UninstallGuardBrain {
  /** The brain's display name, as listed to the user. */
  readonly name: string;
  /** The brain's persisted JSON (the plain object form of its stored bytes). */
  readonly json: unknown;
}

/**
 * What uninstalling one library takes away from a project: the namespaces
 * leaving the resolved closure, the saved brains referencing them, and the
 * user content files importing them.
 */
export interface LibraryUninstallImpact {
  /**
   * The `<owner>/<repo>` namespaces that leave the resolved closure when the
   * coordinate is removed: the coordinate itself plus every transitive
   * dependency no remaining dependent still pulls in.
   */
  readonly leavingNamespaces: ReadonlySet<string>;
  /** Display names of saved brains referencing a leaving namespace, in input order. */
  readonly brainNames: readonly string[];
  /** Paths of user content files importing a leaving namespace through `@lib/`, in input order. */
  readonly filePaths: readonly string[];
}

/** Collect every library namespace a persisted brain references. */
function collectBrainNamespaces(json: unknown): Set<string> {
  const namespaces = new Set<string>();
  renameBrainNamespaces(json, (namespace) => {
    namespaces.add(namespace);
    return namespace;
  });
  return namespaces;
}

/** The `<owner>/<repo>` coordinates a file's `@lib/` import specifiers name. */
function collectFileImportCoordinates(content: string): Set<string> {
  const coordinates = new Set<string>();
  const pattern = new RegExp(`["']${EXTENSION_IMPORT_PREFIX}([^"'\\s]+)["']`, "g");
  for (const match of content.matchAll(pattern)) {
    const segments = match[1].split("/");
    if (segments.length >= 2 && segments[0].length > 0 && segments[1].length > 0) {
      coordinates.add(`${segments[0]}/${segments[1]}`);
    }
  }
  return coordinates;
}

/** The set of origin namespaces in the resolved closure of an extensions map. */
function resolvedNamespaces(
  extensions: Readonly<Record<string, string>> | undefined,
  embedded: readonly EmbeddedExtension[],
  fetched: FetchedExtensionContentMap | undefined
): Set<string> {
  const resolved = resolveProjectExtensions(extensions, { embedded, fetched });
  return new Set(resolved.dependencyMounts.map((mount) => mount.namespace));
}

/**
 * Compute what uninstalling `coordinate` takes away from a project. The
 * leaving set is the closure delta: the origins resolved today that are no
 * longer resolved once the coordinate's manifest entry is removed, so a
 * transitive dependency kept alive by another dependent does not count. A
 * brain counts as affected when any of its referenced namespaces is leaving;
 * a file counts when any of its `@lib/` import coordinates is leaving.
 *
 * @param options.extensions - The project's current extensions map, keyed by coordinate.
 * @param options.coordinate - The `<owner>/<repo>` coordinate being uninstalled.
 * @param options.embedded - The host application's bundled embedded extensions.
 * @param options.fetched - Installed fetched-extension content, keyed by reference.
 * @param options.brains - The project's saved brains, each with its display name and persisted JSON.
 * @param options.files - User content files by path; omit for a host with no user content files.
 */
export function collectLibraryUninstallImpact(options: {
  extensions: Readonly<Record<string, string>> | undefined;
  coordinate: string;
  embedded: readonly EmbeddedExtension[];
  fetched?: FetchedExtensionContentMap;
  brains: readonly UninstallGuardBrain[];
  files?: ReadonlyMap<string, FileContent>;
}): LibraryUninstallImpact {
  const current = options.extensions ?? {};
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    if (key !== options.coordinate) {
      next[key] = value;
    }
  }
  const remaining = resolvedNamespaces(next, options.embedded, options.fetched);
  const leavingNamespaces = new Set<string>();
  for (const namespace of resolvedNamespaces(current, options.embedded, options.fetched)) {
    if (!remaining.has(namespace)) {
      leavingNamespaces.add(namespace);
    }
  }

  const brainNames: string[] = [];
  for (const brain of options.brains) {
    const referenced = collectBrainNamespaces(brain.json);
    for (const namespace of leavingNamespaces) {
      if (referenced.has(namespace)) {
        brainNames.push(brain.name);
        break;
      }
    }
  }

  const filePaths: string[] = [];
  for (const [path, content] of options.files ?? []) {
    const text = fileContentText(content);
    if (text === undefined) {
      continue;
    }
    const imported = collectFileImportCoordinates(text);
    for (const namespace of leavingNamespaces) {
      if (imported.has(namespace)) {
        filePaths.push(path);
        break;
      }
    }
  }

  return { leavingNamespaces, brainNames, filePaths };
}

/** Outcome of a guarded uninstall run. */
export type LibraryUninstallGuardOutcome = "removed" | "cancelled";

/**
 * Run an uninstall behind the in-use guard. An empty impact uninstalls
 * immediately; a non-empty impact asks `confirmRemoval` first and uninstalls
 * only on an affirmative answer.
 *
 * @param options.impact - The computed uninstall impact.
 * @param options.confirmRemoval - Asks the user to confirm removing an in-use library.
 * @param options.uninstall - Performs the uninstall.
 */
export async function runGuardedLibraryUninstall(options: {
  impact: Pick<LibraryUninstallImpact, "brainNames" | "filePaths">;
  confirmRemoval: () => boolean | Promise<boolean>;
  uninstall: () => void | Promise<void>;
}): Promise<LibraryUninstallGuardOutcome> {
  const inUse = options.impact.brainNames.length > 0 || options.impact.filePaths.length > 0;
  if (inUse && !(await options.confirmRemoval())) {
    return "cancelled";
  }
  await options.uninstall();
  return "removed";
}
