import type { MindcraftModuleApi } from "@mindcraft-lang/core";
import { CoreTypeIds } from "@mindcraft-lang/core/brain";
import { createAccessorTileDef } from "@mindcraft-lang/core/brain/tiles";
import { MyTypeIds } from "../type-system";

export function registerAccessorTiles(api: MindcraftModuleApi) {
  const xVisual = { label: "x", iconUrl: "/assets/brain/icons/x.svg" };
  const yVisual = { label: "y", iconUrl: "/assets/brain/icons/y.svg" };
  api.registerTile(createAccessorTileDef(MyTypeIds.Vector2, "x", CoreTypeIds.Number, { visual: xVisual }));
  api.registerTile(createAccessorTileDef(MyTypeIds.Vector2, "y", CoreTypeIds.Number, { visual: yVisual }));
  const idVisual = { label: "id" };
  const positionVisual = { label: "position" };
  const energyPctVisual = { label: "energy pct" };
  api.registerTile(
    createAccessorTileDef(MyTypeIds.ActorRef, "id", CoreTypeIds.Number, { visual: idVisual, readOnly: true })
  );
  api.registerTile(
    createAccessorTileDef(MyTypeIds.ActorRef, "position", MyTypeIds.Vector2, { visual: positionVisual })
  );
  api.registerTile(
    createAccessorTileDef(MyTypeIds.ActorRef, "energy pct", CoreTypeIds.Number, {
      visual: energyPctVisual,
      readOnly: true,
    })
  );
}
