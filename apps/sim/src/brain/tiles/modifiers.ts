import type { MindcraftModuleApi } from "@mindcraft-lang/core";
import { BrainTileModifierDef } from "@mindcraft-lang/core/brain/tiles";
import { TileIds } from "@/brain/tileids";

export function registerModifierTiles(api: MindcraftModuleApi) {
  const timeMsVisual = {
    label: "millis",
    iconUrl: "/assets/brain/icons/milliseconds.svg",
  };
  const timeSecsVisual = {
    label: "seconds",
    iconUrl: "/assets/brain/icons/seconds.svg",
  };
  const avoidVisual = {
    label: "avoid",
    iconUrl: "/assets/brain/icons/avoid.svg",
  };
  const awayFromVisual = {
    label: "away from",
    iconUrl: "/assets/brain/icons/awayfrom.svg",
  };
  const forwardVisual = {
    label: "forward",
    iconUrl: "/assets/brain/icons/forward.svg",
  };
  const towardVisual = {
    label: "toward",
    iconUrl: "/assets/brain/icons/toward.svg",
  };
  const wanderVisual = {
    label: "wander",
    iconUrl: "/assets/brain/icons/wander.svg",
  };
  const carnivoreVisual = {
    label: "carnivore",
    iconUrl: "/assets/brain/icons/carnivore.svg",
  };
  const herbivoreVisual = {
    label: "herbivore",
    iconUrl: "/assets/brain/icons/herbivore.svg",
  };
  const plantVisual = {
    label: "plant",
    iconUrl: "/assets/brain/icons/plant.svg",
  };
  const distanceNearbyVisual = {
    label: "nearby",
    iconUrl: "/assets/brain/icons/nearby.svg",
  };
  const distanceFarAwayVisual = {
    label: "far away",
    iconUrl: "/assets/brain/icons/faraway.svg",
  };
  const quicklyVisual = {
    label: "quickly",
    iconUrl: "/assets/brain/icons/quickly.svg",
  };
  const slowlyVisual = {
    label: "slowly",
    iconUrl: "/assets/brain/icons/slowly.svg",
  };
  api.registerTile(new BrainTileModifierDef(TileIds.Modifier.TimeMs, { visual: timeMsVisual }));
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.TimeSecs, {
      visual: timeSecsVisual,
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.MovementAvoid, {
      visual: avoidVisual,
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.MovementAwayFrom, {
      visual: awayFromVisual,
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.MovementForward, {
      visual: forwardVisual,
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.MovementToward, {
      visual: towardVisual,
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.MovementWander, {
      visual: wanderVisual,
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.ActorKindCarnivore, {
      visual: carnivoreVisual,
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.ActorKindHerbivore, {
      visual: herbivoreVisual,
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.ActorKindPlant, {
      visual: plantVisual,
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.DistanceNearby, {
      visual: distanceNearbyVisual,
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.DistanceFarAway, {
      visual: distanceFarAwayVisual,
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.Quickly, {
      visual: quicklyVisual,
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.Slowly, {
      visual: slowlyVisual,
    })
  );

  // Turn-specific modifiers
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.TurnAround, {
      visual: { label: "around", iconUrl: "/assets/brain/icons/turn_around.svg" },
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.TurnLeft, {
      visual: { label: "left", iconUrl: "/assets/brain/icons/turn_left.svg" },
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.TurnRight, {
      visual: { label: "right", iconUrl: "/assets/brain/icons/turn_right.svg" },
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.DirectionNorth, {
      visual: { label: "north", iconUrl: "/assets/brain/icons/direction_north.svg" },
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.DirectionSouth, {
      visual: { label: "south", iconUrl: "/assets/brain/icons/direction_south.svg" },
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.DirectionEast, {
      visual: { label: "east", iconUrl: "/assets/brain/icons/direction_east.svg" },
    })
  );
  api.registerTile(
    new BrainTileModifierDef(TileIds.Modifier.DirectionWest, {
      visual: { label: "west", iconUrl: "/assets/brain/icons/direction_west.svg" },
    })
  );
}
