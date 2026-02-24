import { BrainDef } from "@mindcraft-lang/core/brain/model";
import type { Archetype } from "./actor";
import type { MoverConfig } from "./movement";

const RADIUS = 15;

/**
 * Energy economy configuration for an archetype.
 *
 * regenRate             - energy per second passively restored (plants only).
 * decayRate             - energy per second passively lost (animals starve without eating).
 * maxEnergy             - energy cap.
 * movementCostPerForce  - energy per second drained per unit of applied force magnitude.
 *                         Higher values penalise movement more. 0 = free movement.
 * prey                  - archetypes this archetype is permitted to eat.
 */
export interface EnergyConfig {
  maxEnergy: number;
  initialEnergy: number;
  regenRate: number;
  decayRate: number;
  movementCostPerForce: number;
  prey: Archetype[];
}

export interface ArchetypePhysicsConfig {
  radius: number;
  scale: number;
  mass: number;
  frictionAir: number; // Matter's air friction (drag). 0 = no drag, 0.05 = default
  restitution: number; // Bounciness. 0 = no bounce, 1 = perfect bounce
  friction: number; // Surface friction. 0 = ice, 1 = rough
  color: number;
}

/**
 * Vision parameters for an archetype.
 *
 * range    - Max sight distance in pixels (default 600).
 * halfFOV  - Half-angle of the vision cone in radians (default PI*0.65 -> ~234 deg total).
 *            Use Math.PI for full 360-degree vision.
 */
export interface VisionConfig {
  range: number;
  halfFOV: number;
}

export interface ArchetypeConfig {
  physics: ArchetypePhysicsConfig;
  mover: Partial<MoverConfig>;
  brain: BrainDef;
  initialSpawnCount: number;
  energy: EnergyConfig;
  vision: VisionConfig;
  /** Milliseconds after death before a replacement is spawned. */
  respawnDelay: number;
}

export const ARCHETYPES: Record<string, ArchetypeConfig> = {
  carnivore: {
    physics: {
      radius: RADIUS,
      scale: 0.95,
      mass: 1,
      frictionAir: 0.08,
      restitution: 0.3,
      friction: 0.1,
      color: 0xe63946,
    },
    mover: {
      maxTurnRate: 7.0,
      thrustForce: 0.002,
      forwardWhenTurning: 0.25,
      smoothingHz: 12,
      lateralDamping: 0.92,
      maxSpeed: 2,
    },
    brain: BrainDef.emptyBrainDef("Carnivore Brain"),
    initialSpawnCount: 10,
    vision: { range: 600, halfFOV: Math.PI * 0.65 },
    energy: {
      maxEnergy: 100,
      initialEnergy: 80,
      regenRate: 0,
      decayRate: 4, // loses 2 energy/sec -- must hunt to survive
      movementCostPerForce: 500, // 0.002 thrust * 500 -> ~1 energy/sec at full throttle
      prey: ["herbivore"],
    },
    respawnDelay: 8000,
  },
  herbivore: {
    physics: {
      radius: RADIUS,
      scale: 1.0,
      mass: 5,
      frictionAir: 0.1,
      restitution: 0.2,
      friction: 0.1,
      color: 0xf4a261,
    },
    mover: {
      maxTurnRate: 5.0,
      thrustForce: 0.01,
      forwardWhenTurning: 0.45,
      smoothingHz: 12,
      lateralDamping: 0.92,
      maxSpeed: 5,
    },
    brain: BrainDef.emptyBrainDef("Herbivore Brain"),
    initialSpawnCount: 10,
    vision: { range: 600, halfFOV: Math.PI * 0.65 },
    energy: {
      maxEnergy: 100,
      initialEnergy: 80,
      regenRate: 0,
      decayRate: 1, // loses 1 energy/sec -- must graze to survive
      movementCostPerForce: 250, // 0.01 thrust * 100 -> ~1 energy/sec at full throttle
      prey: ["plant"],
    },
    respawnDelay: 6000,
  },
  plant: {
    physics: {
      radius: RADIUS,
      scale: 0.5,
      mass: 1,
      frictionAir: 0.2,
      restitution: 0.5,
      friction: 0.1,
      color: 0x52b788,
    },
    mover: {
      maxTurnRate: 0,
      thrustForce: 0,
      forwardWhenTurning: 0,
      smoothingHz: 0,
      lateralDamping: 0,
      maxSpeed: 0,
    },
    brain: BrainDef.emptyBrainDef("Plant Brain"),
    initialSpawnCount: 25,
    vision: { range: 600, halfFOV: Math.PI },
    energy: {
      maxEnergy: 100,
      initialEnergy: 60,
      regenRate: 2, // slowly photosynthesises -- no eating required
      decayRate: 0,
      movementCostPerForce: 0, // plants do not move
      prey: [],
    },
    respawnDelay: 4000,
  },
};
