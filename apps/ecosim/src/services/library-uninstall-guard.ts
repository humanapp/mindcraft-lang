import type {
  EmbeddedExtension,
  FetchedExtensionContentMap,
  LibraryUninstallImpact,
  UninstallGuardBrain,
} from "@wendoo-lang/bridge-app";
import { collectLibraryUninstallImpact } from "@wendoo-lang/bridge-app";

/** The slice of a cached brain the guard reads. */
export interface GuardedBrain {
  name(): string;
}

/** The host surface the uninstall guard reads: the cached archetype brains. */
export interface UninstallGuardHost {
  getCachedBrainKeys(): readonly string[];
  getCachedBrain(key: string): GuardedBrain | undefined;
  serializeBrainForStorage(brainDef: GuardedBrain): unknown;
}

/**
 * Compute what uninstalling `coordinate` takes away from the active sim
 * project: the archetype brains referencing a leaving library namespace. The
 * sim has no user content files, so the impact's file list is always empty.
 *
 * @param host - The host surface holding the cached archetype brains.
 * @param extensions - The project's current extensions map, keyed by coordinate.
 * @param coordinate - The `<owner>/<repo>` coordinate being uninstalled.
 * @param embedRecord - The bundled embedded extensions to resolve against.
 * @param installedContent - Installed fetched-extension content, keyed by reference.
 * @param brainDisplayName - Maps a brain key (an archetype) to its display name.
 */
export function collectSimLibraryUninstallImpact(
  host: UninstallGuardHost,
  extensions: Readonly<Record<string, string>> | undefined,
  coordinate: string,
  embedRecord: readonly EmbeddedExtension[],
  installedContent: FetchedExtensionContentMap | undefined,
  brainDisplayName: (key: string) => string
): LibraryUninstallImpact {
  const brains: UninstallGuardBrain[] = [];
  for (const key of host.getCachedBrainKeys()) {
    const brain = host.getCachedBrain(key);
    if (brain) {
      brains.push({ name: brainDisplayName(key), json: host.serializeBrainForStorage(brain) });
    }
  }
  return collectLibraryUninstallImpact({
    extensions,
    coordinate,
    embedded: embedRecord,
    ...(installedContent !== undefined ? { fetched: installedContent } : {}),
    brains,
  });
}
