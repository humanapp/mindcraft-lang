// ---------------------------------------------------------------------------
// App-specific documentation manifest -- metadata for sim-specific tiles
// and patterns. Content strings are loaded separately per locale via Vite
// glob imports.
//
// Each entry's `contentKey` matches the filename stem under
// content/{locale}/tiles/ or content/{locale}/patterns/.
// ---------------------------------------------------------------------------

import type { AppPatternDocMeta, AppTileDocMeta } from "@mindcraft-lang/docs";

// ---------------------------------------------------------------------------
// Tile doc metadata
// ---------------------------------------------------------------------------

export const appTileDocs: readonly AppTileDocMeta[] = [
  // -- Sensors ---------------------------------------------------------------
  {
    tileId: "tile.sensor->sensor.see",
    tags: ["vision", "detection", "perception"],
    category: "Sensors",
    contentKey: "see",
  },
  {
    tileId: "tile.sensor->sensor.bump",
    tags: ["contact", "collision", "perception"],
    category: "Sensors",
    contentKey: "bump",
  },

  // -- Actuators -------------------------------------------------------------
  {
    tileId: "tile.actuator->actuator.move",
    tags: ["movement", "locomotion", "action"],
    category: "Actuators",
    contentKey: "move",
  },
  {
    tileId: "tile.actuator->actuator.eat",
    tags: ["feeding", "consumption", "action"],
    category: "Actuators",
    contentKey: "eat",
  },
  {
    tileId: "tile.actuator->actuator.turn",
    tags: ["rotation", "direction", "action"],
    category: "Actuators",
    contentKey: "turn",
  },
  {
    tileId: "tile.actuator->actuator.say",
    tags: ["speech", "display", "action"],
    category: "Actuators",
    contentKey: "say",
  },
  {
    tileId: "tile.actuator->actuator.shoot",
    tags: ["projectile", "attack", "action"],
    category: "Actuators",
    contentKey: "shoot",
  },

  // -- Parameters & Modifiers: entity type modifiers -------------------------
  {
    tileId: "tile.modifier->modifier.actor_kind.carnivore",
    tags: ["entity type", "carnivore", "filter"],
    category: "Parameters & Modifiers",
    contentKey: "modifier-carnivore",
  },
  {
    tileId: "tile.modifier->modifier.actor_kind.herbivore",
    tags: ["entity type", "herbivore", "filter"],
    category: "Parameters & Modifiers",
    contentKey: "modifier-herbivore",
  },
  {
    tileId: "tile.modifier->modifier.actor_kind.plant",
    tags: ["entity type", "plant", "filter"],
    category: "Parameters & Modifiers",
    contentKey: "modifier-plant",
  },

  // -- Parameters & Modifiers: distance modifiers ----------------------------
  {
    tileId: "tile.modifier->modifier.distance.nearby",
    tags: ["distance", "range", "filter"],
    category: "Parameters & Modifiers",
    contentKey: "modifier-nearby",
  },
  {
    tileId: "tile.modifier->modifier.distance.faraway",
    tags: ["distance", "range", "filter"],
    category: "Parameters & Modifiers",
    contentKey: "modifier-faraway",
  },

  // -- Parameters & Modifiers: parameters ------------------------------------
  {
    tileId: "tile.parameter->parameter.duration",
    tags: ["time", "duration", "parameter"],
    category: "Parameters & Modifiers",
    contentKey: "parameter-duration",
  },
  {
    tileId: "tile.parameter->parameter.priority",
    tags: ["priority", "rules", "parameter"],
    category: "Parameters & Modifiers",
    contentKey: "parameter-priority",
  },
  {
    tileId: "tile.parameter->parameter.rate",
    tags: ["rate", "frequency", "parameter"],
    category: "Parameters & Modifiers",
    contentKey: "parameter-rate",
  },

  // -- Variables: app-type variable factories --------------------------------
  {
    tileId: "tile.var.factory->struct:<Vector2>",
    tags: ["variables", "vector2", "position", "factory"],
    category: "Variables",
    contentKey: "var-factory-vector2",
  },
  {
    tileId: "tile.var.factory->struct:<ActorRef>",
    tags: ["variables", "actor", "reference", "factory"],
    category: "Variables",
    contentKey: "var-factory-actorRef",
  },

  // -- Accessors: Vector2 fields ---------------------------------------------
  {
    tileId: "tile.accessor->struct:<Vector2>->x",
    tags: ["accessor", "vector2", "x", "position"],
    category: "Accessors",
    contentKey: "accessor-vector2-x",
  },
  {
    tileId: "tile.accessor->struct:<Vector2>->y",
    tags: ["accessor", "vector2", "y", "position"],
    category: "Accessors",
    contentKey: "accessor-vector2-y",
  },

  // -- Accessors: ActorRef fields --------------------------------------------
  {
    tileId: "tile.accessor->struct:<ActorRef>->id",
    tags: ["accessor", "actor", "id", "identity"],
    category: "Accessors",
    contentKey: "accessor-actorRef-id",
  },
  {
    tileId: "tile.accessor->struct:<ActorRef>->position",
    tags: ["accessor", "actor", "position", "location"],
    category: "Accessors",
    contentKey: "accessor-actorRef-position",
  },
  {
    tileId: "tile.accessor->struct:<ActorRef>->energy pct",
    tags: ["accessor", "actor", "energy", "health"],
    category: "Accessors",
    contentKey: "accessor-actorRef-energy-pct",
  },

  // -- Literals: actor references --------------------------------------------
  {
    tileId: "tile.literal->struct:<ActorRef>->me",
    tags: ["literal", "actor", "self", "reference"],
    category: "Literals",
    contentKey: "literal-me",
  },
  {
    tileId: "tile.literal->struct:<ActorRef>->it",
    tags: ["literal", "actor", "target", "reference"],
    category: "Literals",
    contentKey: "literal-it",
  },
] as const;

// ---------------------------------------------------------------------------
// Pattern doc metadata
// ---------------------------------------------------------------------------

export const appPatternDocs: readonly AppPatternDocMeta[] = [
  {
    id: "flee-predator",
    title: "Flee from Predators",
    tags: ["movement", "survival", "avoidance"],
    category: "Survival",
    contentKey: "flee-predator",
  },
  {
    id: "hunt-and-eat",
    title: "Hunt and Eat",
    tags: ["movement", "feeding", "hunting"],
    category: "Hunting",
    contentKey: "hunt-and-eat",
  },
  {
    id: "wander-default",
    title: "Default Wandering",
    tags: ["movement", "idle", "default"],
    category: "Movement",
    contentKey: "wander-default",
  },
] as const;
