import type { WendooModuleApi } from "@wendoo-lang/core/app";
import { TileIds } from "../tileids";
import { EcosimTypeIds } from "../type-system";
import { registerLiteralTiles } from "./literals";

/**
 * Registers the module's standalone tiles: the hidden anonymous `Vector2`
 * parameter and the actor-reference literals.
 *
 * @param api - The module registration API.
 */
export function registerTiles(api: WendooModuleApi) {
  api.registerParameters([{ id: TileIds.Parameter.AnonymousVector2, dataType: EcosimTypeIds.Vector2, hidden: true }]);
  registerLiteralTiles(api);
}
