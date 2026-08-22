import { APP_CAPABILITY_BIT_OFFSET, BitSet } from "@wendoo/core/app";

export const TileIds = {
  Modifier: {
    MovementForward: "modifier.movement.forward",
    MovementAvoid: "modifier.movement.avoid",
    MovementToward: "modifier.movement.toward",
    MovementAwayFrom: "modifier.movement.awayfrom",
    MovementWander: "modifier.movement.wander",
    TurnAround: "modifier.turn.around",
    TurnLeft: "modifier.turn.left",
    TurnRight: "modifier.turn.right",
    DirectionNorth: "modifier.direction.north",
    DirectionSouth: "modifier.direction.south",
    DirectionEast: "modifier.direction.east",
    DirectionWest: "modifier.direction.west",
    DistanceNearby: "modifier.distance.nearby",
    DistanceFarAway: "modifier.distance.faraway",
    ActorKindCarnivore: "modifier.actor_kind.carnivore",
    ActorKindHerbivore: "modifier.actor_kind.herbivore",
    ActorKindPlant: "modifier.actor_kind.plant",
    Quickly: "modifier.quickly",
    Slowly: "modifier.slowly",
  } as const,
  Parameter: {
    AnonymousActorRef: "anon.ActorRef",
    AnonymousVector2: "anon.Vector2",
    Duration: "parameter.duration",
    Priority: "parameter.priority",
    Rate: "parameter.rate",
  } as const,
  Operator: {} as const,
} as const;

export const TileCapabilityBits = {
  TargetActor: APP_CAPABILITY_BIT_OFFSET + 0,
  Vision: APP_CAPABILITY_BIT_OFFSET + 1,
} as const;

export const TargetActorCapabilityBitSet = new BitSet().set(TileCapabilityBits.TargetActor);

/** The `see` sensor provides a target actor and is the vision sensor. */
export const SeeSensorCapabilityBitSet = new BitSet()
  .set(TileCapabilityBits.TargetActor)
  .set(TileCapabilityBits.Vision);
