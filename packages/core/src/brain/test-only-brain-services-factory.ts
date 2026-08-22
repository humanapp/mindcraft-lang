import type { ProfileNumerics } from "../runtime/profile-numerics";
import type { IRngServices } from "../runtime/services";
import { installCoreBrainComponents } from ".";
import type { IBrainTileDef, IBrainTileSet } from "./interfaces";
import type { BrainServices } from "./services";
import { createAppServices, createBrainServices } from "./services-factory";

/**
 * TEST-ONLY. Creates a fresh BrainServices with all core components registered.
 *
 * Production code must use createWendooEnvironment() instead.
 * This exists solely so spec files can get a lightweight BrainServices
 * without standing up a full WendooEnvironment.
 *
 * @param options - Optional app-tier overrides; `numerics` selects the
 *   profile numerics captured by the registered core components (defaults
 *   to f64), and `rng` supplies the random stream document ids are minted
 *   from (defaults to an unseeded one).
 */
export function __test__createBrainServices(options?: {
  numerics?: ProfileNumerics;
  rng?: IRngServices;
}): BrainServices {
  return installCoreBrainComponents(createBrainServices(createAppServices(options?.rng, options?.numerics)));
}

/**
 * TEST-ONLY. Registers `tileDef` in the catalog of the brain holding `tileSet`
 * when the tile is document-scoped, then appends it to `tileSet`.
 */
export function __test__appendTile(tileSet: IBrainTileSet, tileDef: IBrainTileDef): void {
  if (tileDef.persist) {
    tileSet.rule()?.page()?.brain()?.catalog().registerTileDef(tileDef);
  }
  tileSet.appendTile(tileDef);
}
