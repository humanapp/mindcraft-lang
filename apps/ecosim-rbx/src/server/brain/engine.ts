import { BrainDef, type IBrainDef, logger, Vector2, type WendooEnvironment } from "@wendoo/core/app";
import carnivoreBrainJson from "shared/brains/default-carnivore.json";
import herbivoreBrainJson from "shared/brains/default-herbivore.json";
import plantBrainJson from "shared/brains/default-plant.json";
import { packedToColor3 } from "../world/color";
import { spawnCreature } from "../world/creature";
import { MS_PER_SIM_STEP, pixelsToStuds, SIM_WORLD_HEIGHT, SIM_WORLD_WIDTH, simToWorld } from "../world/scale";
import { Actor, type Archetype } from "./actor";
import { ARCHETYPE_NAMES, ARCHETYPES, createArchetypeFallbackBrain } from "./archetypes";
import { BLIP_DAMAGE, BLIP_RADIUS, BLIP_SPEED, type Blip, BlipPool } from "./blip";
import { ECOSIM_RBX_NAMESPACE, MAX_SPAWNS_PER_TICK } from "./engine-constants";
import type { MoverConfig } from "./movement";
import {
  type Obstacle,
  type PrecomputedObstacle,
  precomputeObstacles,
  queryVisibleActors,
  type SightResult,
} from "./vision";

/** Height (studs) blips fly at above the arena floor. */
const BLIP_HEIGHT_STUDS = 1;

/** Distance (px) spawn positions keep from the arena walls. */
const SPAWN_MARGIN_PX = 60;

/** Packed colour of the blip projectile part. */
const BLIP_COLOR = 0xfff3b0;

/**
 * Recursively copies a plain table decoded from a JSON module. Module tables
 * are shared across requires and brain migrations mutate what they are given,
 * so every load works on its own copy.
 */
function deepCopyPlain(value: unknown): unknown {
  if (!typeIs(value, "table")) return value;
  const source = value as Map<unknown, unknown>;
  const copy = new Map<unknown, unknown>();
  for (const [key, item] of source) {
    copy.set(key, deepCopyPlain(item));
  }
  return copy;
}

/**
 * Owns the live population, the brains they run, the projectiles they fire,
 * and the per-frame ordering that ties them together.
 */
export class Engine {
  /** Every live actor, in spawn order. */
  private readonly actorList: Actor[] = [];
  private readonly actorsById = new Map<number, Actor>();
  private readonly actorsByArchetype: Record<Archetype, Actor[]> = {
    carnivore: [],
    herbivore: [],
    plant: [],
  };

  /** Per-archetype brain defs. Undefined until {@link loadBrains} runs. */
  private brains?: Record<Archetype, IBrainDef>;
  private readonly moverCfg: Record<Archetype, Partial<MoverConfig>>;

  private nextActorId = 1;

  /** Simulation elapsed time in milliseconds. */
  simTime = 0;

  /** Width of the simulation world in pixels. */
  readonly worldWidth = SIM_WORLD_WIDTH;

  /** Height of the simulation world in pixels. */
  readonly worldHeight = SIM_WORLD_HEIGHT;

  /** Static obstacle AABBs, in simulation pixels. */
  readonly obstacles: ReadonlyArray<PrecomputedObstacle>;

  private readonly precomputedObstacles: PrecomputedObstacle[];

  /**
   * Queue of pending respawns. Each entry records the archetype and the
   * simulation time (ms) after which the spawn should fire.
   */
  private pendingRespawns: Array<{ archetype: Archetype; at: number }> = [];

  /**
   * Desired population target per archetype. The engine spawns actors when
   * below these targets and suppresses respawns when at or above them. Actors
   * are never actively killed; excess populations die off naturally.
   */
  private readonly desiredCounts: Record<Archetype, number>;

  /**
   * Monotonically increasing tick counter.
   * Used by actors for phase-based round-robin vision staggering.
   */
  tickCount = 0;

  private readonly blipPool = new BlipPool();

  /**
   * @param env - Environment whose modules supply the brain ABI.
   * @param obstacles - Static obstacle rectangles in simulation pixels.
   * @param container - Instance creature and blip parts are parented to.
   */
  constructor(
    readonly env: WendooEnvironment,
    obstacles: readonly Obstacle[],
    private readonly container: Instance
  ) {
    this.precomputedObstacles = precomputeObstacles(obstacles);
    this.obstacles = this.precomputedObstacles;
    this.moverCfg = {
      carnivore: ARCHETYPES.carnivore.mover,
      herbivore: ARCHETYPES.herbivore.mover,
      plant: ARCHETYPES.plant.mover,
    };
    this.desiredCounts = {
      carnivore: ARCHETYPES.carnivore.initialSpawnCount,
      herbivore: ARCHETYPES.herbivore.initialSpawnCount,
      plant: ARCHETYPES.plant.initialSpawnCount,
    };
  }

  /**
   * Load each archetype's shipped brain asset. A brain that fails to
   * deserialize is replaced with an empty fallback so the archetype still runs.
   */
  loadBrains(): void {
    this.brains = {
      carnivore: this.loadBrainDef("carnivore", carnivoreBrainJson),
      herbivore: this.loadBrainDef("herbivore", herbivoreBrainJson),
      plant: this.loadBrainDef("plant", plantBrainJson),
    };
  }

  private loadBrainDef(archetype: Archetype, json: unknown): IBrainDef {
    try {
      const brainDef = this.env.deserializeBrainJsonFromPlain(deepCopyPlain(json), ECOSIM_RBX_NAMESPACE);
      if (brainDef.pages().size() === 0 && brainDef instanceof BrainDef) {
        brainDef.appendNewPage();
      }
      return brainDef;
    } catch (err) {
      logger.error(`Failed to load the ${archetype} brain asset; falling back to an empty brain: ${tostring(err)}`);
      return createArchetypeFallbackBrain(this.env, archetype);
    }
  }

  /**
   * Spawn each archetype up to its configured initial population in one go,
   * bypassing the per-tick spawn cap.
   */
  spawnInitialPopulation(): void {
    for (const archetype of ARCHETYPE_NAMES) {
      const desired = this.desiredCounts[archetype];
      for (let i = this.actorsByArchetype[archetype].size(); i < desired; i++) {
        this.spawn(archetype);
      }
    }
  }

  /**
   * Advance the simulation by one frame: physics components, actor gameplay,
   * deaths and respawns, energy visuals, and projectiles.
   *
   * @param time - Simulation time in ms.
   * @param dt - Elapsed simulation time in ms.
   */
  tick(time: number, dt: number) {
    // Refresh every facade from its part so the whole frame sees one snapshot
    // of positions and velocities, including any shove a player applied.
    for (const actor of this.actorList) {
      actor.sprite.sync();
    }

    this.physicsTick(time, dt);

    // Advance tick counter (used for vision phase staggering)
    this.tickCount++;

    for (const actor of this.actorList) {
      actor.tick(time, dt);
    }

    // Detect actors whose energy reached zero and schedule respawns.
    // Iterate over a snapshot so we can safely mutate the population mid-loop.
    const entities = [...this.actorList];
    for (const actor of entities) {
      if (!actor.isDying && actor.energy <= 0) {
        this.killActor(actor);
      }
    }

    // Fire any pending respawns whose delay has elapsed, but only if
    // the population is still below the desired count for that archetype.
    const now = this.simTime;
    this.pendingRespawns = this.pendingRespawns.filter((pending) => {
      if (now >= pending.at) {
        if (this.actorsByArchetype[pending.archetype].size() < this.desiredCounts[pending.archetype]) {
          this.spawn(pending.archetype);
        }
        return false;
      }
      return true;
    });

    // If any archetype is below its desired count and has no pending
    // respawns that will cover the deficit, spawn some immediately
    // (capped to avoid frame spikes).
    for (const arch of ARCHETYPE_NAMES) {
      const current = this.actorsByArchetype[arch].size();
      const desired = this.desiredCounts[arch];
      const pendingForArch = this.pendingRespawns.filter((p) => p.archetype === arch).size();
      const deficit = desired - current - pendingForArch;
      if (deficit > 0) {
        const toSpawn = math.min(deficit, MAX_SPAWNS_PER_TICK);
        for (let i = 0; i < toSpawn; i++) {
          this.spawn(arch);
        }
      }
    }

    this.simTime += dt;
    this.updateEnergyVisuals();

    // Tick blips -- move them, resolve hits, and expire old ones
    this.tickBlips(dt);
  }

  /**
   * Advance physics-owned actor state (the plant spring integrator).
   *
   * @param time - Simulation time in ms.
   * @param dt - Elapsed simulation time in ms.
   */
  physicsTick(time: number, dt: number): void {
    for (const actor of this.actorList) {
      actor.physicsTick(time, dt);
    }
  }

  /**
   * Kill an actor: remove it from the population, destroy its part and
   * internal resources, then schedule a replacement spawn after the
   * archetype's configured respawn delay.
   */
  private killActor(actor: Actor): void {
    actor.isDying = true;
    const delay = ARCHETYPES[actor.archetype].respawnDelay;
    this.pendingRespawns.push({
      archetype: actor.archetype,
      at: this.simTime + delay,
    });

    const listIndex = this.actorList.indexOf(actor);
    if (listIndex >= 0) this.actorList.remove(listIndex);
    const archetypeList = this.actorsByArchetype[actor.archetype];
    const archetypeIndex = archetypeList.indexOf(actor);
    if (archetypeIndex >= 0) archetypeList.remove(archetypeIndex);
    this.actorsById.delete(actor.actorId);

    actor.sprite.destroy();
    actor.destroy();
  }

  /**
   * Refresh every actor's energy bar from its current energy.
   */
  updateEnergyVisuals(): void {
    for (const actor of this.actorList) {
      const ratio = actor.maxEnergy > 0 ? actor.energy / actor.maxEnergy : 1;
      actor.visuals.setEnergy(ratio);
    }
  }

  /**
   * Add a live actor of `archetype`, running the archetype's current brain.
   *
   * @param archetype - Which creature kind to spawn.
   * @returns The new actor, or undefined before {@link loadBrains} has run.
   */
  spawn(archetype: Archetype): Actor | undefined {
    const brains = this.brains;
    if (!brains) return undefined;
    const actor = new Actor(this, archetype, brains[archetype], this.moverCfg[archetype]);
    actor.actorId = this.nextActorId++;

    const pos = this.randomPosition();
    const heading = math.random() * math.pi * 2;
    const spawned = spawnCreature(this.container, archetype, actor.actorId, pos.X, pos.Y, heading);
    actor.sprite = spawned.sprite;
    actor.visuals = spawned.visuals;
    if (actor.plantComp) {
      actor.plantComp.springAnchor = { x: pos.X, y: pos.Y };
    }
    actor.sprite.bindTouched((otherActorId) => this.handleActorCollision(actor.actorId, otherActorId));

    this.actorList.push(actor);
    this.actorsByArchetype[archetype].push(actor);
    this.actorsById.set(actor.actorId, actor);
    return actor;
  }

  /**
   * Record a physical contact between two actors so their `bump` sensors fire.
   *
   * @param actorIdA - One actor's id.
   * @param actorIdB - The other actor's id.
   */
  handleActorCollision(actorIdA: number, actorIdB: number) {
    const actorA = this.actorsById.get(actorIdA);
    const actorB = this.actorsById.get(actorIdB);

    if (actorA && actorB) {
      // enqueue collision event on both actors for processing in brain logic
      actorA.enqueueBump(actorB.actorId);
      actorB.enqueueBump(actorA.actorId);
    }
  }

  /** Whether the engine currently holds a brain for every archetype. */
  hasLoadedBrains(): boolean {
    return this.brains !== undefined;
  }

  /**
   * The archetype's current brain def, or undefined while {@link loadBrains}
   * has not run.
   *
   * @param archetype - The archetype to look up.
   */
  getBrainDef(archetype: Archetype): IBrainDef | undefined {
    return this.brains?.[archetype];
  }

  /**
   * Replace the archetype's brain def and push it onto every live actor of
   * that archetype. Does nothing until {@link loadBrains} has run.
   *
   * @param archetype - The archetype whose brain changes.
   * @param newBrainDef - The replacement brain.
   */
  updateBrainDef(archetype: Archetype, newBrainDef: IBrainDef) {
    if (!this.brains) return;
    this.brains[archetype] = newBrainDef;
    // Update all existing actors of this archetype with the new brain
    for (const actor of this.actorsByArchetype[archetype]) {
      actor.replaceBrain(newBrainDef);
    }
  }

  /**
   * Look up a live actor by id.
   *
   * @param actorId - The engine id to resolve.
   */
  getActorById(actorId: number): Actor | undefined {
    return this.actorsById.get(actorId);
  }

  /**
   * Every live actor of one archetype.
   *
   * @param archetype - The archetype to list.
   */
  getActorsByArchetype(archetype: Archetype): readonly Actor[] {
    return this.actorsByArchetype[archetype];
  }

  /**
   * Query which actors are visible to the given actor within a forward-facing
   * cone, accounting for obstacle occlusion. Results are written into the
   * observer's sight queue.
   *
   * @param selfActor       The observing actor
   * @param range      Maximum sight distance in pixels
   * @param halfAngle  Half-angle of the vision cone in radians
   * @returns          Visible actors, unsorted
   */
  queryVisibleActors(selfActor: Actor, range: number, halfAngle: number): SightResult[] {
    return queryVisibleActors(
      selfActor,
      this.actorList,
      range,
      halfAngle,
      this.precomputedObstacles,
      selfActor.sightQueue
    );
  }

  /** A uniformly random position inside the arena, in simulation pixels. */
  randomPosition(): Vector2 {
    return new Vector2(
      SPAWN_MARGIN_PX + math.random() * (SIM_WORLD_WIDTH - SPAWN_MARGIN_PX * 2),
      SPAWN_MARGIN_PX + math.random() * (SIM_WORLD_HEIGHT - SPAWN_MARGIN_PX * 2)
    );
  }

  // -- Blip management ------------------------------------------------

  /**
   * Create a blip projectile at the given position travelling in (dirX, dirY).
   * Called from the shoot actuator.
   *
   * @param shooterActorId - Actor id of the shooter.
   * @param x - Shooter position along simulation x, in pixels.
   * @param y - Shooter position along simulation y, in pixels.
   * @param dirX - Unit direction along simulation x.
   * @param dirY - Unit direction along simulation y.
   * @returns The blip, or undefined if the active-blip cap has been reached.
   */
  spawnBlip(shooterActorId: number, x: number, y: number, dirX: number, dirY: number): Blip | undefined {
    const blip = this.blipPool.acquire(shooterActorId, this.simTime);
    if (!blip) return undefined;

    // Offset spawn point slightly so it does not immediately overlap the shooter
    const offset = BLIP_RADIUS * 4;
    const spawnX = x + dirX * offset;
    const spawnY = y + dirY * offset;

    this.activateBlip(blip, spawnX, spawnY, dirX * BLIP_SPEED, dirY * BLIP_SPEED);
    return blip;
  }

  private activateBlip(blip: Blip, x: number, y: number, velX: number, velY: number): void {
    blip.x = x;
    blip.y = y;
    blip.vx = velX;
    blip.vy = velY;

    let part = blip.part;
    if (!part) {
      const diameter = pixelsToStuds(BLIP_RADIUS * 2);
      part = new Instance("Part");
      part.Name = "Blip";
      part.Shape = Enum.PartType.Ball;
      part.Size = new Vector3(diameter, diameter, diameter);
      part.Color = packedToColor3(BLIP_COLOR);
      part.Material = Enum.Material.Neon;
      part.Anchored = true;
      part.CanCollide = false;
      part.CanQuery = false;
      part.CanTouch = false;
      part.Parent = this.container;
      blip.part = part;
    }
    part.Transparency = 0;
    part.CFrame = new CFrame(simToWorld(x, y, BLIP_HEIGHT_STUDS));
  }

  /**
   * Handle a collision between a blip and an actor.
   * The blip is returned to the pool and the actor loses energy.
   *
   * @param blipId - The blip's id.
   * @param actorId - The actor's id.
   */
  handleBlipActorCollision(blipId: number, actorId: number): void {
    const blip = this.blipPool.activeById.get(blipId);
    if (!blip || !blip.alive) return;

    // Don't damage the shooter
    if (actorId === blip.shooterActorId) return;

    const actor = this.getActorById(actorId);
    if (!actor || actor.isDying) return;

    actor.drainEnergy(BLIP_DAMAGE);
    this.blipPool.release(blip);
  }

  /** Advance every live blip, resolve hits, and release spent ones. */
  private tickBlips(dt: number): void {
    const now = this.simTime;
    const stepScale = dt / MS_PER_SIM_STEP;

    for (const blip of this.blipPool.liveBlips()) {
      blip.x += blip.vx * stepScale;
      blip.y += blip.vy * stepScale;
      const part = blip.part;
      if (part) {
        part.CFrame = new CFrame(simToWorld(blip.x, blip.y, BLIP_HEIGHT_STUDS));
      }

      if (blip.isExpired(now)) {
        this.blipPool.release(blip);
        continue;
      }

      if (blip.x < 0 || blip.x > SIM_WORLD_WIDTH || blip.y < 0 || blip.y > SIM_WORLD_HEIGHT) {
        this.blipPool.release(blip);
        continue;
      }

      for (const actor of this.actorList) {
        if (actor.actorId === blip.shooterActorId || actor.isDying) continue;
        const physCfg = ARCHETYPES[actor.archetype].physics;
        const hitRadius = BLIP_RADIUS + physCfg.radius * physCfg.scale;
        const dx = actor.sprite.x - blip.x;
        const dy = actor.sprite.y - blip.y;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
          this.handleBlipActorCollision(blip.blipId, actor.actorId);
          break;
        }
      }
    }
  }
}
