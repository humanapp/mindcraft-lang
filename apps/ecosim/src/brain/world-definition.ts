import { Vector2 } from "@wendoo/core/app";
import type { Archetype } from "./actor";
import { ARCHETYPE_NAMES, ARCHETYPES, type ArchetypePhysicsConfig } from "./archetypes";

/** Width of the world in pixels. */
export const WORLD_WIDTH = 1024;

/** Height of the world in pixels. */
export const WORLD_HEIGHT = 768;

/** Frames per second the world advances at. */
export const WORLD_FPS = 60;

/** Thickness in pixels of each of the four walls that enclose the world. */
export const WALL_THICKNESS = 32;

/**
 * Gravity every dynamic body is subject to: `x` and `y` in Matter acceleration
 * units, and `scale` the factor Matter multiplies them by on each step.
 */
export const WORLD_GRAVITY = { x: 0, y: 0, scale: 0.001 } as const;

/** Matter collision categories, as bitmask flags. */
export const CollisionCategory = {
  /** Boundary walls and static obstacles. */
  Wall: 0x0001,
  /** Actor bodies. */
  Actor: 0x0002,
  /** Blip sensor bodies. */
  Blip: 0x0004,
} as const;

/** Static obstacles a world without a persisted obstacle set is generated with. */
const OBSTACLE_COUNT = 4;

/** Shortest edge, in pixels, a generated obstacle may have. */
const OBSTACLE_MIN_SIZE = 30;

/** Longest edge, in pixels, a generated obstacle may have. */
const OBSTACLE_MAX_SIZE = 120;

/** Pixels from each world edge within which no generated obstacle is centred. */
const OBSTACLE_MARGIN = 100;

/** Pixels from each world edge within which nothing is spawned. */
const SPAWN_INSET = 40;

/** Placements tried before a spawn position is accepted without clearing obstacles. */
const SPAWN_ATTEMPTS = 100;

/** Obstacle clearance in pixels demanded of a spawn position when the caller names none. */
const DEFAULT_SPAWN_CLEARANCE = 20;

/** Mass of a blip's sensor body. */
const BLIP_BODY_MASS = 0.01;

/**
 * The random draws building a world takes. Supply a seeded source to reproduce
 * a world exactly; every draw the world's construction makes comes from here.
 */
export interface WorldRandom {
  /** An integer in the inclusive range [min, max]. */
  int(min: number, max: number): number;
  /** A float in [0, 1). */
  unit(): number;
}

/** A body carrying a Matter-style axis-aligned bounding box, in world pixels. */
interface BoundedBody {
  readonly bounds: { min: { x: number; y: number }; max: { x: number; y: number } };
}

/** A Matter collision filter: a body's own category, the categories it collides with, and its group. */
interface CollisionFilter {
  category: number;
  mask: number;
  group: number;
}

/** One boundary wall, as its top-left corner and its size in pixels. */
interface WallRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One static obstacle: its centre and size in pixels, and its rotation in radians. */
export interface ObstaclePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** Matter body options an actor's circular body is created with. */
interface ActorBodyOptions {
  collisionFilter: CollisionFilter;
  mass: number;
  frictionAir: number;
  restitution: number;
  friction: number;
  sleepThreshold: number;
}

/** Matter body options a blip's sensor body is created with. */
interface BlipBodyOptions {
  collisionFilter: CollisionFilter;
  mass: number;
  frictionAir: number;
  restitution: number;
  friction: number;
  isSensor: boolean;
  sleepThreshold: number;
}

/** Matter body options a static obstacle's rectangular body is created with. */
interface ObstacleBodyOptions {
  angle: number;
  collisionFilter: CollisionFilter;
}

/** The four walls enclosing the world, in left, right, top, bottom order. */
export function boundaryWalls(): WallRect[] {
  return [
    { x: -WALL_THICKNESS, y: -WALL_THICKNESS, width: WALL_THICKNESS, height: WORLD_HEIGHT + WALL_THICKNESS * 2 },
    { x: WORLD_WIDTH, y: -WALL_THICKNESS, width: WALL_THICKNESS, height: WORLD_HEIGHT + WALL_THICKNESS * 2 },
    { x: 0, y: -WALL_THICKNESS, width: WORLD_WIDTH, height: WALL_THICKNESS },
    { x: 0, y: WORLD_HEIGHT, width: WORLD_WIDTH, height: WALL_THICKNESS },
  ];
}

/** A facing in radians, drawn from `random`. */
export function randomFacing(random: WorldRandom): number {
  return random.unit() * Math.PI * 2;
}

/** The obstacle set a world without a persisted one is generated with, drawn from `random`. */
export function generateObstacles(random: WorldRandom): ObstaclePlacement[] {
  const obstacles: ObstaclePlacement[] = [];
  for (let i = 0; i < OBSTACLE_COUNT; i++) {
    const width = random.int(OBSTACLE_MIN_SIZE, OBSTACLE_MAX_SIZE);
    const height = random.int(OBSTACLE_MIN_SIZE, OBSTACLE_MAX_SIZE);
    const x = random.int(OBSTACLE_MARGIN, WORLD_WIDTH - OBSTACLE_MARGIN);
    const y = random.int(OBSTACLE_MARGIN, WORLD_HEIGHT - OBSTACLE_MARGIN);
    obstacles.push({ x, y, width, height, rotation: randomFacing(random) });
  }
  return obstacles;
}

/** Whether a circle of `clearance` radius at (x, y) reaches into any of `obstacles`. */
function overlapsAnyObstacle(x: number, y: number, clearance: number, obstacles: readonly BoundedBody[]): boolean {
  for (const obstacle of obstacles) {
    const bounds = obstacle.bounds;
    const closestX = Math.max(bounds.min.x, Math.min(x, bounds.max.x));
    const closestY = Math.max(bounds.min.y, Math.min(y, bounds.max.y));
    const dx = x - closestX;
    const dy = y - closestY;
    if (dx * dx + dy * dy < clearance * clearance) return true;
  }
  return false;
}

/**
 * A position inside the world's spawn inset that clears every obstacle by
 * `clearance` pixels, drawn from `random`. Returns an unchecked position once
 * the attempt budget is spent, so it always yields a position.
 *
 * @param obstacles Live obstacle bodies, read for their current world bounds.
 * @param clearance Pixels of obstacle clearance the position must have.
 */
export function randomSpawnPosition(
  random: WorldRandom,
  obstacles: readonly BoundedBody[],
  clearance: number = DEFAULT_SPAWN_CLEARANCE
): Vector2 {
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const x = random.int(SPAWN_INSET, WORLD_WIDTH - SPAWN_INSET);
    const y = random.int(SPAWN_INSET, WORLD_HEIGHT - SPAWN_INSET);
    if (!overlapsAnyObstacle(x, y, clearance, obstacles)) return new Vector2(x, y);
  }
  return new Vector2(
    random.int(SPAWN_INSET, WORLD_WIDTH - SPAWN_INSET),
    random.int(SPAWN_INSET, WORLD_HEIGHT - SPAWN_INSET)
  );
}

/**
 * The Matter circle radius an actor body built from `physics` is created at.
 * Apply `physics.scale` to the created body to bring it to the radius the actor
 * is drawn at, `physics.radius * physics.scale`.
 */
export function actorBodyRadiusBeforeScale(physics: ArchetypePhysicsConfig): number {
  return physics.radius;
}

/** Matter body options for an actor body built from `physics`. */
export function actorBodyOptions(physics: ArchetypePhysicsConfig): ActorBodyOptions {
  return {
    collisionFilter: {
      category: CollisionCategory.Actor,
      mask: CollisionCategory.Wall | CollisionCategory.Actor | CollisionCategory.Blip,
      group: 0,
    },
    mass: physics.mass,
    frictionAir: physics.frictionAir,
    restitution: physics.restitution,
    friction: physics.friction,
    sleepThreshold: Number.POSITIVE_INFINITY,
  };
}

/** The collision filter a blip carries while it is in flight. */
export function blipCollisionFilter(): CollisionFilter {
  return {
    category: CollisionCategory.Blip,
    mask: CollisionCategory.Wall | CollisionCategory.Actor,
    group: 0,
  };
}

/** Matter body options for a blip's sensor body. */
export function blipBodyOptions(): BlipBodyOptions {
  return {
    collisionFilter: blipCollisionFilter(),
    mass: BLIP_BODY_MASS,
    frictionAir: 0,
    restitution: 0,
    friction: 0,
    isSensor: true,
    sleepThreshold: Number.POSITIVE_INFINITY,
  };
}

/** Matter body options for a static obstacle turned `rotation` radians. */
export function obstacleBodyOptions(rotation: number): ObstacleBodyOptions {
  return {
    angle: rotation,
    collisionFilter: {
      category: CollisionCategory.Wall,
      mask: CollisionCategory.Wall | CollisionCategory.Actor | CollisionCategory.Blip,
      group: 0,
    },
  };
}

/** The population each archetype is kept at in a world with no saved counts. */
export function defaultDesiredCounts(): Record<Archetype, number> {
  const counts = {} as Record<Archetype, number>;
  for (const archetype of ARCHETYPE_NAMES) {
    counts[archetype] = ARCHETYPES[archetype].initialSpawnCount;
  }
  return counts;
}
