import type { MindcraftModuleApi } from "@mindcraft-lang/core/app";
import { TileIds } from "@/brain/tileids";

export function registerModifierTiles(api: MindcraftModuleApi) {
  api.registerModifiers([
    { id: TileIds.Modifier.TimeMs, label: "millis", iconUrl: "/assets/brain/icons/milliseconds.svg" },
    { id: TileIds.Modifier.TimeSecs, label: "seconds", iconUrl: "/assets/brain/icons/seconds.svg" },
    { id: TileIds.Modifier.MovementAvoid, label: "avoid", iconUrl: "/assets/brain/icons/avoid.svg" },
    { id: TileIds.Modifier.MovementAwayFrom, label: "away from", iconUrl: "/assets/brain/icons/awayfrom.svg" },
    { id: TileIds.Modifier.MovementForward, label: "forward", iconUrl: "/assets/brain/icons/forward.svg" },
    { id: TileIds.Modifier.MovementToward, label: "toward", iconUrl: "/assets/brain/icons/toward.svg" },
    { id: TileIds.Modifier.MovementWander, label: "wander", iconUrl: "/assets/brain/icons/wander.svg" },
    { id: TileIds.Modifier.ActorKindCarnivore, label: "carnivore", iconUrl: "/assets/brain/icons/carnivore.svg" },
    { id: TileIds.Modifier.ActorKindHerbivore, label: "herbivore", iconUrl: "/assets/brain/icons/herbivore.svg" },
    { id: TileIds.Modifier.ActorKindPlant, label: "plant", iconUrl: "/assets/brain/icons/plant.svg" },
    { id: TileIds.Modifier.DistanceNearby, label: "nearby", iconUrl: "/assets/brain/icons/nearby.svg" },
    { id: TileIds.Modifier.DistanceFarAway, label: "far away", iconUrl: "/assets/brain/icons/faraway.svg" },
    { id: TileIds.Modifier.Quickly, label: "quickly", iconUrl: "/assets/brain/icons/quickly.svg" },
    { id: TileIds.Modifier.Slowly, label: "slowly", iconUrl: "/assets/brain/icons/slowly.svg" },
    { id: TileIds.Modifier.TurnAround, label: "around", iconUrl: "/assets/brain/icons/turn_around.svg" },
    { id: TileIds.Modifier.TurnLeft, label: "left", iconUrl: "/assets/brain/icons/turn_left.svg" },
    { id: TileIds.Modifier.TurnRight, label: "right", iconUrl: "/assets/brain/icons/turn_right.svg" },
    { id: TileIds.Modifier.DirectionNorth, label: "north", iconUrl: "/assets/brain/icons/direction_north.svg" },
    { id: TileIds.Modifier.DirectionSouth, label: "south", iconUrl: "/assets/brain/icons/direction_south.svg" },
    { id: TileIds.Modifier.DirectionEast, label: "east", iconUrl: "/assets/brain/icons/direction_east.svg" },
    { id: TileIds.Modifier.DirectionWest, label: "west", iconUrl: "/assets/brain/icons/direction_west.svg" },
  ]);
}
