import type { MindcraftModuleApi } from "@mindcraft-lang/core/app";
import { TileIds } from "@/brain/tileids";
import { EcosimTypeIds } from "@/brain/type-system";
import { registerLiteralTiles } from "./literals";

export function registerTiles(api: MindcraftModuleApi) {
  api.registerParameters([{ id: TileIds.Parameter.AnonymousVector2, dataType: EcosimTypeIds.Vector2, hidden: true }]);
  registerLiteralTiles(api);
}
