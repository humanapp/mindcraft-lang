import type { UserTileMetadata } from "@mindcraft-lang/bridge-app";
import {
  applyCompiledUserTiles as applyCompiledUserTilesCore,
  hydrateUserTilesFromCache,
} from "@mindcraft-lang/bridge-app";
import { mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/app";
import type { DocsTileEntry } from "@mindcraft-lang/docs";
import type { WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";
import type { SimEnvironmentStore } from "./sim-environment-store";

const USER_TILE_STORAGE_KEY = "sim:user-tile-metadata";

function buildDocEntries(metadata: readonly UserTileMetadata[]): DocsTileEntry[] {
  const entries: DocsTileEntry[] = [];
  for (const entry of metadata) {
    const tileId = entry.kind === "sensor" ? mkSensorTileId(entry.key) : mkActuatorTileId(entry.key);
    entries.push({
      tileId,
      tags: entry.tags ? [...entry.tags] : [],
      category: entry.kind === "sensor" ? "Sensors" : "Actuators",
      content: entry.docsMarkdown ?? "",
    });
  }
  return entries;
}

export function hydrateUserTilesAtStartup(store: SimEnvironmentStore): void {
  const metadata = hydrateUserTilesFromCache(store.env, { storageKey: USER_TILE_STORAGE_KEY });
  if (metadata) {
    store.userTileDocEntries = buildDocEntries(metadata);
  }
}

export function applyCompiledUserTiles(store: SimEnvironmentStore, result: WorkspaceCompileResult): void {
  const applyResult = applyCompiledUserTilesCore(store.env, result, { storageKey: USER_TILE_STORAGE_KEY });
  if (applyResult) {
    store.userTileDocEntries = buildDocEntries(applyResult.metadata);
    store.bumpDocRevision();
  }
}
