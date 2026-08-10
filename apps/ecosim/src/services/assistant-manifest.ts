import type { AuthoringWorkspace, CatalogTile, TargetAdapter } from "@mindcraft-lang/assistant-bridge";
import {
  catalogDigest,
  createAuthoringWorkspace,
  readCatalog,
  toolDefinitions,
} from "@mindcraft-lang/assistant-bridge";
import type { RelayToolManifest } from "@mindcraft-lang/assistant-relay";
import { List } from "@mindcraft-lang/core/app";
import type { ITileCatalog } from "@mindcraft-lang/core/brain";

/** Name of the empty document the installed catalog is read over. */
const catalogBrainName = "catalog";

/**
 * The tiles `adapter` installs into an authoring environment, without the tiles
 * any one document mints for itself.
 */
function installedTiles(adapter: TargetAdapter): readonly CatalogTile[] {
  const workspace = createAuthoringWorkspace(adapter, catalogBrainName);
  const installed: AuthoringWorkspace = {
    ...workspace,
    catalogs: List.from<ITileCatalog>([...workspace.environment.tileCatalogs()]),
  };
  return readCatalog(installed, {}).tiles;
}

/**
 * What this app declares it serves when it opens a relay session, all read from
 * `adapter`: the target it authors for, the bridge tools it answers, and the
 * fingerprint of the tiles the adapter installs.
 */
export function assistantToolManifest(adapter: TargetAdapter): RelayToolManifest {
  return {
    target: adapter.targetIdentity,
    tools: toolDefinitions.map((tool) => tool.name),
    morphology: false,
    catalogDigest: catalogDigest(installedTiles(adapter)).hash,
  };
}
