import type { BrainDef } from "@mindcraft-lang/core/brain/model";
import * as ECS from "miniplex";
import type { Playground } from "@/game/scenes/Playground";
import { Actor, type Archetype } from "./actor";
import { ARCHETYPES } from "./archetypes";
import { BLIP_DAMAGE, BLIP_RADIUS, BLIP_SPEED, type Blip, BlipPool } from "./blip";
import type { MoverConfig } from "./movement";

// Eye layout constants (must match texture generation in Playground.ts)
const EYE_OFFSET_X = 7.8; // Eye center X offset from sprite center (along facing direction)
const EYE_OFFSET_Y = 4.5; // Eye center Y offset from sprite center (perpendicular)
const PUPIL_ORBIT_RADIUS = 2.4; // Distance from eye center that the pupil orbits at
const PUPIL_REST_ANGLE = 0.39; // Resting angle in radians (~22 deg, slightly inward from pure forward)
const PUPIL_MAX_ANGLE = 0.75; // Max gaze rotation in radians (~43 deg) from rest
const GAZE_SMOOTHING = 0.08; // Lerp factor per frame (lower = smoother)

import type { Vector2 } from "@mindcraft-lang/core";
import { heatColor } from "@/lib/color";
import { getDefaultBrain, loadBrainFromLocalStorage } from "../services/brain-persistence";
import { drawMovementIntent } from "./movement";
import { type ScoreSnapshot, ScoreTracker } from "./score";
import { SpatialGrid } from "./spatial-grid";
import {
  type Obstacle,
  type PrecomputedObstacle,
  precomputeObstacles,
  queryVisibleActors,
  type SightResult,
} from "./vision";

export class Engine {
  private world: ECS.World<Actor>;
  private actors: { [key in Archetype]: ECS.Query<Actor> };
  private brains: { [key in Archetype]: BrainDef };
  private moverCfg: { [key in Archetype]: Partial<MoverConfig> };

  get clock(): Phaser.Time.Clock {
    return this.scene.time;
  }

  get worldWidth(): number {
    return this.scene.scale.width;
  }

  get worldHeight(): number {
    return this.scene.scale.height;
  }

  /** Spatial grid rebuilt each tick for fast proximity queries */
  private grid: SpatialGrid;

  /** Tracks per-archetype stats and computes the ecosystem score. */
  private scoreTracker = new ScoreTracker();

  /** Simulation elapsed time in milliseconds (accounts for time-scaling). */
  private _elapsedMs = 0;

  /** Simulation elapsed time in ms, accounting for time-scaling. */
  get simTime(): number {
    return this._elapsedMs;
  }

  /** Precomputed obstacle bounds for fast LOS checks */
  private precomputedObstacles: PrecomputedObstacle[] = [];

  /** Persistent graphics object for the spatial-grid debug overlay */
  private gridDebugGfx?: Phaser.GameObjects.Graphics;

  /**
   * Queue of pending respawns. Each entry records the archetype and the
   * engine clock time (ms) after which the spawn should fire.
   */
  private pendingRespawns: Array<{ archetype: Archetype; at: number }> = [];

  /**
   * Desired population target per archetype set by the UI sliders.
   * The engine spawns actors when below these targets and suppresses
   * respawns when at or above them. Actors are never actively killed;
   * excess populations die off naturally.
   */
  private desiredCounts: Record<Archetype, number> = {
    carnivore: ARCHETYPES.carnivore.initialSpawnCount,
    herbivore: ARCHETYPES.herbivore.initialSpawnCount,
    plant: ARCHETYPES.plant.initialSpawnCount,
  };

  /** Max actors to spawn per archetype per tick to avoid frame spikes. */
  private static readonly MAX_SPAWNS_PER_TICK = 3;

  /**
   * Monotonically increasing tick counter.
   * Used by actors for phase-based round-robin vision staggering.
   */
  tickCount = 0;

  /** Active blip projectiles. */
  private blipPool!: BlipPool;

  /**
   * Number of vision phases. Actors are assigned phase = actorId % VISION_PHASES.
   * Only actors whose phase matches the current tick run a vision query.
   * Higher = more amortization but staler sight data.
   * 3 phases at 60fps = each actor refreshes vision every ~50ms.
   */
  static readonly VISION_PHASES = 3;

  constructor(
    private scene: Playground,
    readonly obstacles: ReadonlyArray<Obstacle> = []
  ) {
    this.world = new ECS.World<Actor>();
    this.actors = {
      carnivore: this.world.where((actor) => actor.archetype === "carnivore"),
      herbivore: this.world.where((actor) => actor.archetype === "herbivore"),
      plant: this.world.where((actor) => actor.archetype === "plant"),
    };

    // Initialize brains: localStorage -> pre-loaded default .brain asset -> empty brain
    const loadBrain = (archetype: Archetype): BrainDef => {
      const fromStorage = loadBrainFromLocalStorage(archetype);
      if (fromStorage) return fromStorage;

      const fromAsset = getDefaultBrain(archetype)?.clone();
      if (fromAsset) return fromAsset;

      return ARCHETYPES[archetype].brain.clone();
    };

    this.brains = {
      carnivore: loadBrain("carnivore"),
      herbivore: loadBrain("herbivore"),
      plant: loadBrain("plant"),
    };

    // Log brain source for each archetype
    for (const archetype of ["carnivore", "herbivore", "plant"] as const) {
      const fromStorage = localStorage.getItem(`brain-archetype-${archetype}`);
      const fromAsset = getDefaultBrain(archetype);
      const source = fromStorage ? "localStorage" : fromAsset ? "default asset" : "empty";
      console.log(`Brain initialization - ${archetype}: ${source}`);
    }

    this.moverCfg = {
      carnivore: ARCHETYPES.carnivore.mover,
      herbivore: ARCHETYPES.herbivore.mover,
      plant: ARCHETYPES.plant.mover,
    };
  }

  start() {
    // Create the spatial grid after the scene is ready so dimensions are known.
    // Cell size 150px balances grid granularity vs. overhead for typical vision ranges (600px).
    this.grid = new SpatialGrid(this.worldWidth, this.worldHeight, 150);
    // Precompute obstacle bounds once (obstacles are static).
    this.precomputedObstacles = precomputeObstacles(this.obstacles);
    // Create a persistent graphics layer for the grid debug overlay.
    this.gridDebugGfx = this.scene.add.graphics();
    this.gridDebugGfx.setDepth(-2); // Below actors and their debug graphics
    this.blipPool = new BlipPool(this);
    this.spawnInitialActors();
  }

  private spawnInitialActors() {
    Object.entries(ARCHETYPES).forEach(([archetype, config]) => {
      for (let i = 0; i < config.initialSpawnCount; i++) {
        this.spawn(archetype as Archetype);
      }
    });
  }

  shutdown() {
    // Clean up blips
    this.blipPool.destroyAll();

    // Clean up each actor's resources (timers, graphics, etc.)
    for (const actor of this.world.entities) {
      actor.destroy();
    }
    this.world.clear();
  }

  tick(time: number, dt: number) {
    // Rebuild spatial grid once per tick -- O(N) and avoids incremental bookkeeping
    this.grid.rebuild(this.world.entities);

    // Advance tick counter (used for vision phase staggering)
    this.tickCount++;

    for (const actor of this.world.entities) {
      actor.tick(time, dt);
    }

    // Detect actors whose energy reached zero and schedule respawns.
    // Iterate over a snapshot so we can safely mutate the world mid-loop.
    const entities = [...this.world.entities];
    for (const actor of entities) {
      if (!actor.isDying && actor.energy <= 0) {
        this.killActor(actor);
      }
    }

    // Fire any pending respawns whose delay has elapsed, but only if
    // the population is still below the desired count for that archetype.
    const now = this.clock.now;
    this.pendingRespawns = this.pendingRespawns.filter((pending) => {
      if (now >= pending.at) {
        if (this.actors[pending.archetype].entities.length < this.desiredCounts[pending.archetype]) {
          this.spawn(pending.archetype);
        }
        return false;
      }
      return true;
    });

    // If any archetype is below its desired count and has no pending
    // respawns that will cover the deficit, spawn some immediately
    // (capped to avoid frame spikes).
    for (const arch of ["carnivore", "herbivore", "plant"] as const) {
      const current = this.actors[arch].entities.length;
      const desired = this.desiredCounts[arch];
      const pendingForArch = this.pendingRespawns.filter((p) => p.archetype === arch).length;
      const deficit = desired - current - pendingForArch;
      if (deficit > 0) {
        const toSpawn = Math.min(deficit, Engine.MAX_SPAWNS_PER_TICK);
        for (let i = 0; i < toSpawn; i++) {
          this.spawn(arch);
        }
      }
    }

    // Update score tracker with live population data
    this._elapsedMs += dt;
    const aliveCounts = { carnivore: 0, herbivore: 0, plant: 0 };
    const energySums = { carnivore: 0, herbivore: 0, plant: 0 };
    for (const actor of this.world.entities) {
      aliveCounts[actor.archetype]++;
      energySums[actor.archetype] += actor.energy;
    }
    this.scoreTracker.update(aliveCounts, energySums, this._elapsedMs, dt);

    // Tick blips -- expire old ones and handle out-of-bounds
    this.tickBlips();
  }

  /**
   * Kill an actor: remove it from the ECS world, destroy its sprite and
   * internal resources, then schedule a replacement spawn after the
   * archetype's configured respawn delay.
   */
  private killActor(actor: Actor): void {
    actor.isDying = true;
    const lifespanMs = this.clock.now - actor.bornAt;
    this.scoreTracker.recordDeath(actor.archetype, lifespanMs);
    const delay = ARCHETYPES[actor.archetype].respawnDelay;
    this.pendingRespawns.push({
      archetype: actor.archetype,
      at: this.clock.now + delay,
    });
    this.world.remove(actor);
    actor.sprite.destroy();
    actor.destroy();
  }

  /**
   * Redraw every actor's floating health bar to reflect current energy.
   * The bar is drawn above the sprite center:
   *   full energy -> green, half -> yellow, empty -> red.
   * Should be called once per rendered frame from the scene's update().
   */
  updateEnergyVisuals(): void {
    const BAR_WIDTH = 26;
    const BAR_HEIGHT = 4;
    const BG_COLOR = 0x222222;
    const BG_ALPHA = 0.75;

    for (const actor of this.world.entities) {
      const gfx = actor.healthBarGfx;
      if (!gfx) continue;

      gfx.clear();

      const ratio = actor.maxEnergy > 0 ? actor.energy / actor.maxEnergy : 1;
      const physCfg = ARCHETYPES[actor.archetype].physics;
      const visualRadius = physCfg.radius * physCfg.scale;

      const cx = actor.sprite.x;
      const barBottom = actor.sprite.y - visualRadius - 5;
      const barTop = barBottom - BAR_HEIGHT;
      const barLeft = cx - BAR_WIDTH / 2;

      // Background track
      gfx.fillStyle(BG_COLOR, BG_ALPHA);
      gfx.fillRect(barLeft, barTop, BAR_WIDTH, BAR_HEIGHT);

      // Filled portion -- heatColor(0) = green, heatColor(1) = red
      const fillColor = heatColor(1 - ratio);
      const fillWidth = Math.round(BAR_WIDTH * ratio);
      if (fillWidth > 0) {
        gfx.fillStyle(fillColor, 1);
        gfx.fillRect(barLeft, barTop, fillWidth, BAR_HEIGHT);
      }
    }
  }

  spawn(archetype: Archetype) {
    const actor = new Actor(this, archetype, this.brains[archetype], this.moverCfg[archetype]);
    this.world.add(actor);
    actor.actorId = this.world.id(actor)!;
    actor.sprite = this.scene.spawn(actor);
    return actor;
  }

  handleActorCollision(actorIdA: number, actorIdB: number) {
    const actorA = this.world.entity(actorIdA);
    const actorB = this.world.entity(actorIdB);

    if (actorA && actorB) {
      //console.log(`Collision detected between Actor ${actorA.actorId} and Actor ${actorB.actorId}`);

      // enqueue collision event on both actors for processing in brain logic
      actorA.enqueueBump(actorB.actorId);
      actorB.enqueueBump(actorA.actorId);
    }
  }

  getBrainDef(archetype: Archetype): BrainDef {
    return this.brains[archetype];
  }

  updateBrainDef(archetype: Archetype, newBrainDef: BrainDef) {
    this.brains[archetype] = newBrainDef;
    // Update all existing actors of this archetype with the new brain
    const actorsQuery = this.actors[archetype];
    for (const actor of actorsQuery.entities) {
      actor.replaceBrain(newBrainDef);
    }
  }

  getActorById(actorId: number): Actor | undefined {
    return this.world.entity(actorId) || undefined;
  }

  /** Set the desired population target for an archetype (0-100). */
  setDesiredCount(archetype: Archetype, count: number): void {
    this.desiredCounts[archetype] = Math.max(0, Math.min(100, Math.round(count)));
  }

  /** Get the current desired population target for an archetype. */
  getDesiredCount(archetype: Archetype): number {
    return this.desiredCounts[archetype];
  }

  /** Return a snapshot of the current simulation scores. */
  getScoreSnapshot(): ScoreSnapshot {
    return this.scoreTracker.getSnapshot();
  }

  /**
   * Query which actors are visible to the given actor within a forward-facing cone,
   * accounting for obstacle occlusion.
   *
   * @param self       The observing actor
   * @param range      Maximum sight distance in pixels
   * @param halfAngle  Half-angle of the vision cone in radians
   * @returns          Visible actors sorted nearest-first
   */
  queryVisibleActors(self: Actor, range: number, halfAngle: number): SightResult[] {
    return queryVisibleActors(self, this.grid, range, halfAngle, this.precomputedObstacles, self.sightQueue);
  }

  /**
   * Draw debug visualization for all actors with vision enabled.
   * Should be called every frame - automatically clears when debug mode is off.
   */
  drawDebugVisionCones(): void {
    const debugEnabled = this.scene.matter.world.drawDebug;

    // Draw / clear the spatial grid overlay
    this.drawDebugGrid(debugEnabled);

    for (const actor of this.world.entities) {
      if (debugEnabled && actor.debugGraphics) {
        // Clear graphics for this frame
        actor.debugGraphics.clear();

        // Draw vision cone if actor has vision
        if (actor.hasVision) {
          //drawVisionCone(actor.debugGraphics, actor, actor.visionRange, actor.visionFOV / 2);
        }

        // Draw movement intent if actor has a saved intent from last tick
        if (actor.lastIntent) {
          drawMovementIntent(actor.debugGraphics, actor, actor.lastIntent);
        }
      } else if (actor.debugGraphics) {
        // Clear graphics if debug is off
        actor.debugGraphics.clear();
      }
    }
  }

  /**
   * Draw (or clear) the spatial-grid debug overlay.
   *
   * When enabled, renders:
   * - A **heat-map fill** per cell coloured by actor density
   *   (transparent -> green -> yellow -> red as count increases).
   * - Thin grid lines showing cell boundaries.
   */
  private drawDebugGrid(enabled: boolean): void {
    const gfx = this.gridDebugGfx;
    if (!gfx) return;
    gfx.clear();
    if (!enabled || !this.grid) return;

    const { cells, numCols, numRows, cellSize } = this.grid;

    // Find max occupancy for heat-map normalisation
    let maxCount = 1;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].length > maxCount) maxCount = cells[i].length;
    }

    // Draw cell heat-map fills
    for (let row = 0; row < numRows; row++) {
      const y = row * cellSize;
      const rowOff = row * numCols;
      for (let col = 0; col < numCols; col++) {
        const count = cells[col + rowOff].length;
        if (count === 0) continue;

        const color = heatColor(count / maxCount);

        const x = col * cellSize;
        gfx.fillStyle(color, 0.15);
        gfx.fillRect(x, y, cellSize, cellSize);
      }
    }

    // Draw grid lines
    gfx.lineStyle(1, 0xffffff, 0.12);
    for (let col = 0; col <= numCols; col++) {
      const x = col * cellSize;
      gfx.lineBetween(x, 0, x, numRows * cellSize);
    }
    for (let row = 0; row <= numRows; row++) {
      const y = row * cellSize;
      gfx.lineBetween(0, y, numCols * cellSize, y);
    }
  }

  /**
   * Update dynamic pupil positions for all animal actors.
   * Pupils are positioned relative to the actor sprite, offset by
   * the smoothed movement intent turn value for a subtle gaze effect.
   */
  updatePupils(): void {
    for (const actor of this.world.entities) {
      if (!actor.pupils) continue;

      const sprite = actor.sprite;
      const rot = sprite.rotation;
      const scale = sprite.scale;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);

      // Smooth the gaze toward the current intent turn value
      const targetGaze = actor.lastIntent ? actor.lastIntent.turn : 0;
      actor.smoothedGaze += (targetGaze - actor.smoothedGaze) * GAZE_SMOOTHING;

      // Perpendicular shift from gaze (positive turn = clockwise = shift pupils "right" in local space)
      const gazeAngle = actor.smoothedGaze * PUPIL_MAX_ANGLE;

      // Two eyes: index 0 = "top" eye (negative Y offset), index 1 = "bottom" eye (positive Y offset)
      const eyeYSigns = [-1, 1];

      for (let i = 0; i < 2; i++) {
        const eyeY = eyeYSigns[i] * EYE_OFFSET_Y;

        // Pupil orbits around eye center; rest angle points slightly inward per eye
        // Top eye (eyeYSign=-1) needs positive angle to point inward; bottom eye needs negative
        const restAngle = -eyeYSigns[i] * PUPIL_REST_ANGLE;
        const angle = restAngle + gazeAngle;

        // Local-space pupil position: eye center + orbital offset
        const localX = EYE_OFFSET_X + Math.cos(angle) * PUPIL_ORBIT_RADIUS;
        const localY = eyeY + Math.sin(angle) * PUPIL_ORBIT_RADIUS;

        // Rotate local offset to world space and apply scale
        const worldX = sprite.x + (localX * cos - localY * sin) * scale;
        const worldY = sprite.y + (localX * sin + localY * cos) * scale;

        actor.pupils[i].setPosition(worldX, worldY);
        actor.pupils[i].setScale(scale);
      }
    }
  }

  randomPosition(): Vector2 {
    return this.scene.randomPositionWithinBounds();
  }

  // -- Blip management ------------------------------------------------

  /**
   * Create a blip projectile at the given position travelling in (dirX, dirY).
   * Called from the shoot actuator. Returns the Blip or undefined if the cap
   * has been reached.
   */
  spawnBlip(shooterActorId: number, x: number, y: number, dirX: number, dirY: number): Blip | undefined {
    const now = this.clock.now;
    const blip = this.blipPool.acquire(shooterActorId, now);
    if (!blip) return undefined;

    // Offset spawn point slightly so it does not immediately overlap the shooter
    const offset = BLIP_RADIUS * 4;
    const spawnX = x + dirX * offset;
    const spawnY = y + dirY * offset;

    this.scene.activateBlip(blip, spawnX, spawnY, dirX * BLIP_SPEED, dirY * BLIP_SPEED);
    return blip;
  }

  /**
   * Handle a collision between a blip and an actor.
   * The blip is returned to the pool and the actor loses energy.
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

  /** Handle a blip hitting a wall (return it to the pool). */
  handleBlipWallCollision(blipId: number): void {
    const blip = this.blipPool.activeById.get(blipId);
    if (!blip || !blip.alive) return;
    this.blipPool.release(blip);
  }

  /** Return expired blips to the pool. */
  private tickBlips(): void {
    const now = this.clock.now;
    for (const blip of this.blipPool.activeById.values()) {
      if (blip.isExpired(now)) {
        this.blipPool.release(blip);
      }
    }
  }
}
