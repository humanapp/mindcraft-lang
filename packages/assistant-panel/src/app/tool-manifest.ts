import type { CatalogTile, TargetAdapter } from "@wendoo/assistant-bridge";
import {
  CatalogScope,
  catalogDigest,
  catalogTilesInScope,
  createAuthoringWorkspace,
  readCatalog,
  toolDefinitions,
} from "@wendoo/assistant-bridge";
import type { RelayToolManifest } from "@wendoo/assistant-relay";

/** Name of the empty document the environment catalog is read over. */
const catalogBrainName = "catalog";

/**
 * The tiles `adapter` installs into an authoring environment, as a session
 * states them: the environment scope of a fresh workspace's catalog.
 */
export function environmentTiles(adapter: TargetAdapter): readonly CatalogTile[] {
  const workspace = createAuthoringWorkspace(adapter, catalogBrainName);
  return catalogTilesInScope(readCatalog(workspace, {}), CatalogScope.Environment);
}

/**
 * What a host app declares it serves when it opens a relay session, all read
 * from `adapter`: the target it authors for, the bridge tools it answers, and
 * the fingerprint of the tiles the adapter installs.
 */
export function assistantToolManifest(adapter: TargetAdapter): RelayToolManifest {
  return {
    target: adapter.targetIdentity,
    tools: toolDefinitions.map((tool) => tool.name),
    morphology: false,
    catalogDigest: catalogDigest(environmentTiles(adapter)).hash,
  };
}
