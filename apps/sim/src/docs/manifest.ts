// ---------------------------------------------------------------------------
// App-specific documentation manifest -- metadata for sim-specific tiles
// and patterns. Content strings are loaded separately per locale via Vite
// glob imports.
//
// Each entry's `contentKey` matches the filename stem under
// content/{locale}/tiles/ or content/{locale}/patterns/.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tile doc metadata
// ---------------------------------------------------------------------------

export interface AppTileDocMeta {
  tileId: string;
  tags: string[];
  category: string;
  contentKey: string;
}

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
  {
    tileId: "tile.sensor->sensor.timeout",
    tags: ["time", "delay", "timer"],
    category: "Sensors",
    contentKey: "timeout",
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

  // -- Modifiers: entity types -----------------------------------------------
  {
    tileId: "tile.modifier->modifier.actor_kind.carnivore",
    tags: ["entity type", "carnivore", "filter"],
    category: "Modifiers",
    contentKey: "modifier-carnivore",
  },
  {
    tileId: "tile.modifier->modifier.actor_kind.herbivore",
    tags: ["entity type", "herbivore", "filter"],
    category: "Modifiers",
    contentKey: "modifier-herbivore",
  },
  {
    tileId: "tile.modifier->modifier.actor_kind.plant",
    tags: ["entity type", "plant", "filter"],
    category: "Modifiers",
    contentKey: "modifier-plant",
  },

  // -- Modifiers: distance ---------------------------------------------------
  {
    tileId: "tile.modifier->modifier.distance.nearby",
    tags: ["distance", "range", "filter"],
    category: "Modifiers",
    contentKey: "modifier-nearby",
  },
  {
    tileId: "tile.modifier->modifier.distance.faraway",
    tags: ["distance", "range", "filter"],
    category: "Modifiers",
    contentKey: "modifier-faraway",
  },
] as const;

// ---------------------------------------------------------------------------
// Pattern doc metadata
// ---------------------------------------------------------------------------

export interface AppPatternDocMeta {
  id: string;
  title: string;
  tags: string[];
  category: string;
  contentKey: string;
}

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
