import { BitSet } from "@mindcraft-lang/core";

export const TileIds = {
  Modifier: {
    TimeMs: "modifier.time.ms",
    TimeSecs: "modifier.time.secs",
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
    AnonymousActorRef: "anon.actorRef",
    DelayMs: "parameter.delay.ms",
    Duration: "parameter.duration",
    Priority: "parameter.priority",
    Rate: "parameter.rate",
  } as const,
  Sensor: {
    Timeout: "sensor.timeout",
    Bump: "sensor.bump",
    See: "sensor.see",
  } as const,
  Operator: {} as const,
  Actuator: {
    Move: "actuator.move",
    Say: "actuator.say",
    Eat: "actuator.eat",
    Turn: "actuator.turn",
    Shoot: "actuator.shoot",
  } as const,
} as const;

export const TileCapabilityBits = {
  TargetActor: 1,
} as const;

export const TargetActorCapabilityBitSet = new BitSet().set(TileCapabilityBits.TargetActor);
