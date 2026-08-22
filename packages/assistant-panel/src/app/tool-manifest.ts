import type { AuthoringWorkspace, CatalogTile, TargetAdapter } from "@wendoo/assistant-bridge";
import { catalogDigest, createAuthoringWorkspace, readCatalog, toolDefinitions } from "@wendoo/assistant-bridge";
import type { RelayToolManifest } from "@wendoo/assistant-relay";
import { List } from "@wendoo/core/app";
import type { ITileCatalog } from "@wendoo/core/brain";

/** Name of the empty document the installed catalog is read over. */
const catalogBrainName = "catalog";

/**
 * The tiles `adapter` installs into an authoring environment, as a session
 * states them, without the tiles any one document mints for itself.
 */
export function installedTiles(adapter: TargetAdapter): readonly CatalogTile[] {
  const workspace = createAuthoringWorkspace(adapter, catalogBrainName);
  const installed: AuthoringWorkspace = {
    ...workspace,
    catalogs: List.from<ITileCatalog>([...workspace.environment.tileCatalogs()]),
  };
  return readCatalog(installed, {}).tiles;
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
    catalogDigest: catalogDigest(installedTiles(adapter)).hash,
  };
}
