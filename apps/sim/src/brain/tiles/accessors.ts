import { type BrainServices, CoreTypeIds } from "@mindcraft-lang/core/brain";
import { registerAccessorTileDef } from "@mindcraft-lang/core/brain/tiles";
import { MyTypeIds } from "../type-system";

export function registerAccessorTiles(services: BrainServices) {
  // Accessors for Vector2
  const xVisual = { label: "x", iconUrl: "/assets/brain/icons/x.svg" };
  const yVisual = { label: "y", iconUrl: "/assets/brain/icons/y.svg" };
  registerAccessorTileDef(MyTypeIds.Vector2, "x", CoreTypeIds.Number, { visual: xVisual }, services);
  registerAccessorTileDef(MyTypeIds.Vector2, "y", CoreTypeIds.Number, { visual: yVisual }, services);
  // Accessors for actorRef
  const idVisual = { label: "id" };
  const positionVisual = { label: "position" };
  const energyPctVisual = { label: "energy pct" };
  registerAccessorTileDef(MyTypeIds.ActorRef, "id", CoreTypeIds.Number, { visual: idVisual, readOnly: true }, services);
  registerAccessorTileDef(MyTypeIds.ActorRef, "position", MyTypeIds.Vector2, { visual: positionVisual }, services);
  registerAccessorTileDef(
    MyTypeIds.ActorRef,
    "energy pct",
    CoreTypeIds.Number,
    {
      visual: energyPctVisual,
      readOnly: true,
    },
    services
  );
}
