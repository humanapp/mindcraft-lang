import { getBrainServices } from "@mindcraft-lang/core/brain";
import { BrainTileModifierDef } from "@mindcraft-lang/core/brain/tiles";
import { TileIds } from "@/brain/tileids";

export function registerModifierTiles() {
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
    iconUrl: "/assets/brain/icons/movement_avoid.svg",
  };
  const awayFromVisual = {
    label: "away from",
    iconUrl: "/assets/brain/icons/movement_away_from.svg",
  };
  const forwardVisual = {
    label: "forward",
    iconUrl: "/assets/brain/icons/movement_forward.svg",
  };
  const towardVisual = {
    label: "toward",
    iconUrl: "/assets/brain/icons/movement_toward.svg",
  };
  const wanderVisual = {
    label: "wander",
    iconUrl: "/assets/brain/icons/movement_wander.svg",
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
    iconUrl: "/assets/brain/icons/distance_nearby.svg",
  };
  const distanceFarAwayVisual = {
    label: "far away",
    iconUrl: "/assets/brain/icons/distance_far_away.svg",
  };
  const quicklyVisual = {
    label: "quickly",
    iconUrl: "/assets/brain/icons/quickly.svg",
  };
  const slowlyVisual = {
    label: "slowly",
    iconUrl: "/assets/brain/icons/slowly.svg",
  };
  const { tiles } = getBrainServices();
  tiles.registerTileDef(new BrainTileModifierDef(TileIds.Modifier.TimeMs, { visual: timeMsVisual }));
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.TimeSecs, {
      visual: timeSecsVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.MovementAvoid, {
      visual: avoidVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.MovementAwayFrom, {
      visual: awayFromVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.MovementForward, {
      visual: forwardVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.MovementToward, {
      visual: towardVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.MovementWander, {
      visual: wanderVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.ActorKindCarnivore, {
      visual: carnivoreVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.ActorKindHerbivore, {
      visual: herbivoreVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.ActorKindPlant, {
      visual: plantVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.DistanceNearby, {
      visual: distanceNearbyVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.DistanceFarAway, {
      visual: distanceFarAwayVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.Quickly, {
      visual: quicklyVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.Slowly, {
      visual: slowlyVisual,
    })
  );

  // Turn-specific modifiers
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.TurnAround, {
      visual: { label: "around", iconUrl: "/assets/brain/icons/turn_around.svg" },
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.TurnLeft, {
      visual: { label: "left", iconUrl: "/assets/brain/icons/turn_left.svg" },
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.TurnRight, {
      visual: { label: "right", iconUrl: "/assets/brain/icons/turn_right.svg" },
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.DirectionNorth, {
      visual: { label: "north", iconUrl: "/assets/brain/icons/direction_north.svg" },
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.DirectionSouth, {
      visual: { label: "south", iconUrl: "/assets/brain/icons/direction_south.svg" },
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.DirectionEast, {
      visual: { label: "east", iconUrl: "/assets/brain/icons/direction_east.svg" },
    })
  );
  tiles.registerTileDef(
    new BrainTileModifierDef(TileIds.Modifier.DirectionWest, {
      visual: { label: "west", iconUrl: "/assets/brain/icons/direction_west.svg" },
    })
  );
}
