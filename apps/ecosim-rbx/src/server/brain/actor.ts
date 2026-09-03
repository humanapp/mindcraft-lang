import {
  type CreateBrainOptions,
  type IBrainDef,
  type IBrainPageDef,
  type IBrainRuleDef,
  type IBrainTileSet,
  logger,
  type Vector2,
  type WendooBrain,
} from "@wendoo/core/app";
import type { CreatureSprite } from "../world/sprite";
import type { CreatureVisuals } from "../world/visuals";
import { SAY_DEFAULT_DURATION_SECONDS } from "./actions/utils";
import { ARCHETYPES } from "./archetypes";
import type { Engine } from "./engine";
import { VISION_PHASES } from "./engine-constants";
import { Mover, type MoverConfig, type Steering, steerAvoidObstacles } from "./movement";
import { TileCapabilityBits } from "./tileids";
import type { SightResult } from "./vision";

/** The three kinds of creature the simulation supports. */
export type Archetype = "carnivore" | "herbivore" | "plant";

/** Default seconds a speech bubble stays up when `say` gives no duration. */

/** True when any tile in the tile set carries the given capability bit. */
function tileSetHasCapability(tileSet: IBrainTileSet, bit: number): boolean {
  const tiles = tileSet.tiles();
  for (let i = 0; i < tiles.size(); i++) {
    if (tiles.get(i).capabilities().get(bit) !== 0) return true;
  }
  return false;
}

/** True when the rule or any of its descendant rules uses a tile with the given capability bit. */
function ruleHasCapability(rule: IBrainRuleDef, bit: number): boolean {
  if (tileSetHasCapability(rule.when(), bit) || tileSetHasCapability(rule.do(), bit)) return true;
  const children = rule.children();
  for (let i = 0; i < children.size(); i++) {
    if (ruleHasCapability(children.get(i), bit)) return true;
  }
  return false;
}

/** True when any rule on the page uses a tile that carries the given capability bit. */
function pageHasCapability(page: IBrainPageDef, bit: number): boolean {
  const rules = page.children();
  for (let i = 0; i < rules.size(); i++) {
    if (ruleHasCapability(rules.get(i), bit)) return true;
  }
  return false;
}

/** Locomotion component owned by carnivores and herbivores. */
export class AnimalComp {
  /** Steering requests gathered from actuators during the current brain tick. */
  steeringQueue: Steering[] = [];

  /**
   * @param actor - The actor this component belongs to.
   */
  constructor(public actor: Actor) {}

  /**
   * Animals do nothing on the physics phase; their motion is applied during
   * {@link gameplayTick}.
   */
  physicsTick(_time: number, _dt: number): void {}

  /**
   * Applies the blended steering and drains energy in proportion to the
   * thrust that was applied.
   *
   * @param time - Simulation time in ms.
   * @param dt - Elapsed simulation time in ms.
   */
  gameplayTick(time: number, dt: number): void {
    const dtSec = dt / 1000;
    const forceMag = this.actor.mover.step(this.actor.sprite, dtSec, this.steeringQueue);

    // Drain energy proportional to thrust force applied this frame.
    const costPerForce = ARCHETYPES[this.actor.archetype].energy.movementCostPerForce;
    if (costPerForce > 0 && forceMag > 0) {
      this.actor.drainEnergy(forceMag * costPerForce * dtSec);
    }
  }
}

/** Spring component owned by plants, which sway back to a fixed anchor. */
export class PlantComp {
  /** Simulation position (px) the plant springs back toward. */
  springAnchor?: { x: number; y: number };

  // Self-tracked velocity (px/sec) for a damped harmonic oscillator.
  // Kept independent of the part's velocity so the spring behaves
  // identically at any frame rate.
  private springVelX = 0;
  private springVelY = 0;

  /**
   * @param actor - The actor this component belongs to.
   */
  constructor(public actor: Actor) {}

  /** Plants do nothing on the gameplay phase. */
  gameplayTick(_time: number, _dt: number): void {}

  /**
   * Integrates the spring and writes the resulting position, leaving the
   * part's vertical motion to gravity.
   *
   * @param time - Simulation time in ms.
   * @param dt - Elapsed simulation time in ms.
   */
  physicsTick(time: number, dt: number) {
    if (this.springAnchor && this.actor.sprite.body) {
      const dtSec = dt / 1000;
      if (dtSec <= 0) return;

      // Damped harmonic oscillator: a = -k * x - c * v
      // k=200, c=12 -> omega0 ~ 14.1 rad/s, period ~ 0.44s
      // zeta = c / (2 * sqrt(k)) ~ 0.42 (underdamped -- visible bounce)
      const k = 200;
      const c = 12;

      // Sub-step the integration so a large frame dt cannot cause a single
      // Euler step to overshoot.
      const maxStep = 0.004; // 4ms ceiling per sub-step
      const steps = math.ceil(dtSec / maxStep);
      const h = dtSec / steps;

      // Cap spring velocity to bound energy injected by collision bombardment.
      // 300 px/s -> max oscillation amplitude ~ 300/omega0 ~ 21px
      const maxVel = 300;

      for (let i = 0; i < steps; i++) {
        const dispX = this.actor.sprite.x - this.springAnchor.x;
        const dispY = this.actor.sprite.y - this.springAnchor.y;

        const ax = -k * dispX - c * this.springVelX;
        const ay = -k * dispY - c * this.springVelY;

        // Semi-implicit Euler: velocity first, then position
        this.springVelX += ax * h;
        this.springVelY += ay * h;

        // Clamp velocity magnitude
        const velSq = this.springVelX * this.springVelX + this.springVelY * this.springVelY;
        if (velSq > maxVel * maxVel) {
          const s = maxVel / math.sqrt(velSq);
          this.springVelX *= s;
          this.springVelY *= s;
        }

        this.actor.sprite.setPosition(
          this.actor.sprite.x + this.springVelX * h,
          this.actor.sprite.y + this.springVelY * h
        );
      }

      // Zero horizontal velocity so the physics engine does not redundantly
      // integrate. Collision impulses still appear as position corrections
      // that feed back into the displacement reading next frame.
      this.actor.sprite.setVelocity(0, 0);
    }
  }

  /**
   * Inject a velocity impulse into the spring integrator.
   * Use this instead of setVelocity() on the part -- physicsTick() zeros
   * horizontal velocity every frame, so part impulses are discarded immediately.
   *
   * @param vx - Impulse along simulation x, in px/sec.
   * @param vy - Impulse along simulation y, in px/sec.
   */
  applyImpulse(vx: number, vy: number): void {
    this.springVelX += vx;
    this.springVelY += vy;
  }
}

/**
 * One brain-driven creature. Owns its brain, its steering or spring component,
 * its energy budget, and the sprite facade over its Roblox part.
 */
export class Actor {
  engine: Engine;
  actorId: number;
  archetype: Archetype;
  brainDef: IBrainDef;
  brain: WendooBrain;
  mover: Mover;
  /** Assigned by {@link Engine.spawn} immediately after construction. */
  sprite: CreatureSprite = undefined!;
  /** Assigned by {@link Engine.spawn} immediately after construction. */
  visuals: CreatureVisuals = undefined!;
  readonly bumpQueue = new Set<number>(); // IDs of actors this one has bumped into
  sightQueue: SightResult[] = []; // Visible actors from the last vision check
  private speechText?: string;
  private speechExpiresAt = 0;
  readonly animalComp?: AnimalComp;
  readonly plantComp?: PlantComp;
  bornAt: number = 0;
  /** Current energy level (0-maxEnergy). Reaching 0 triggers death. */
  energy: number;
  maxEnergy: number;
  /**
   * Set to true once the actor has been marked for removal so the engine
   * does not double-process a death within the same tick.
   */
  isDying = false;
  hasVision = false;
  visionRange: number;
  visionFOV: number;
  readonly debugTargetPositions = new Map<number, Vector2>(); // target actor id -> position, populated each tick by sensors

  /** Milliseconds of simulation time since this actor spawned. */
  age(): number {
    return this.engine.simTime - this.bornAt;
  }

  /**
   * @param engine - The engine that owns this actor.
   * @param archetype - Which creature kind to build.
   * @param brainDef - The brain this actor runs.
   * @param moverCfg - Overrides for the archetype's mover configuration.
   */
  constructor(engine: Engine, archetype: Archetype, brainDef: IBrainDef, moverCfg?: Partial<MoverConfig>) {
    this.engine = engine;
    this.actorId = 0; // to be assigned later
    this.archetype = archetype;
    this.brainDef = brainDef;
    this.brain = this.createBrain();
    this.mover = new Mover(moverCfg);
    this.bornAt = this.engine.simTime;

    const energyCfg = ARCHETYPES[archetype].energy;
    this.maxEnergy = energyCfg.maxEnergy;
    this.energy = energyCfg.initialEnergy;

    const visionCfg = ARCHETYPES[archetype].vision;
    this.visionRange = visionCfg.range;
    this.visionFOV = visionCfg.halfFOV;

    if (archetype === "plant") {
      this.plantComp = new PlantComp(this);
    } else {
      this.animalComp = new AnimalComp(this);
    }

    this.brain.events().on("page_activated", this.pageActivated);
    this.brain.events().on("page_deactivated", this.pageDeactivated);
    this.brain.startup();
  }

  /**
   * Create this actor's brain from its current def. When the def references an
   * action the active bundle does not provide, the returned brain is tracked
   * and invalidated by the environment; the per-tick rebuild revives it once
   * the action becomes available.
   */
  private createBrain(): WendooBrain {
    const env = this.engine.env;
    const brainOptions: CreateBrainOptions = {
      context: this,
      vmEvents: {
        onFiberFault: ({ fiberId, err }) => {
          logger.error(
            `[Actor] Brain fiber fault actorId=${this.actorId} archetype=${this.archetype} fiberId=${fiberId} code=${err.code}: ${err.message}`
          );
        },
      },
    };
    return env.createBrain(this.brainDef, brainOptions);
  }

  /**
   * Swap in a new brain def, disposing the current brain and starting the
   * replacement.
   *
   * @param brainDef - The new def; defaults to re-instantiating the current one.
   */
  replaceBrain(brainDef: IBrainDef = this.brainDef) {
    this.brainDef = brainDef;
    this.brain.events().removeAllListeners();
    this.brain.dispose();
    this.brain = this.createBrain();
    this.brain.events().on("page_activated", this.pageActivated);
    this.brain.events().on("page_deactivated", this.pageDeactivated);
    this.brain.startup();
  }

  pageActivated = ({ pageIndex }: { pageIndex: number }) => {
    const page = this.brainDef.pages().at(pageIndex);
    this.hasVision = page !== undefined && pageHasCapability(page, TileCapabilityBits.Vision);
  };

  pageDeactivated = (_: { pageIndex: number }) => {
    this.debugTargetPositions.clear();
  };

  /**
   * Advances physics-owned state. Runs before {@link tick} each frame.
   *
   * @param time - Simulation time in ms.
   * @param dt - Elapsed simulation time in ms.
   */
  physicsTick(time: number, dt: number): void {
    this.plantComp?.physicsTick(time, dt);
    this.animalComp?.physicsTick(time, dt);
  }

  /**
   * Runs one gameplay frame: passive energy, vision, the brain, obstacle
   * avoidance, and component motion.
   *
   * @param time - Simulation time in ms.
   * @param dt - Elapsed simulation time in ms.
   */
  tick(time: number, dt: number) {
    // Update passive energy regen / decay
    const dtSec = dt / 1000;
    const energyCfg = ARCHETYPES[this.archetype].energy;
    if (energyCfg.regenRate > 0 && this.energy > 0) {
      this.energy = math.min(this.maxEnergy, this.energy + energyCfg.regenRate * dtSec);
    }
    if (energyCfg.decayRate > 0) {
      this.energy = math.max(0, this.energy - energyCfg.decayRate * dtSec);
    }

    // Run vision check on this actor's phase only (round-robin stagger). On
    // off-phase ticks the sightQueue retains its previous results so the brain
    // still has (slightly stale) data to work with. A new page with sight
    // sensors could have a short initial delay before sight works while waiting
    // for the next on-phase tick.
    if (this.hasVision) {
      const phase = this.actorId % VISION_PHASES;
      if (this.engine.tickCount % VISION_PHASES === phase) {
        this.engine.queryVisibleActors(this, this.visionRange, this.visionFOV);
      }
    } else {
      this.sightQueue.clear();
    }

    // Run brain logic (pass sim time so ctx.time / ctx.dt honor time scale)
    this.debugTargetPositions.clear();
    this.brain.think(this.engine.simTime);

    // Inject obstacle/wall avoidance steering for animals
    if (this.animalComp) {
      const avoidance = steerAvoidObstacles(
        this,
        this.engine.obstacles,
        this.engine.worldWidth,
        this.engine.worldHeight
      );
      if (avoidance.weight > 0) {
        this.animalComp.steeringQueue.push(avoidance);
      }
    }

    // Apply component logic
    this.plantComp?.gameplayTick(time, dt);
    this.animalComp?.gameplayTick(time, dt);

    // Expire the speech bubble on sim time so it honors time scaling
    if (this.speechText !== undefined && this.engine.simTime >= this.speechExpiresAt) {
      this.clearDisplayString();
    }

    // Clear event queues (sightQueue is cleared at start of next
    // queryVisibleActors call. Due to phase staggering, we want to keep stale
    // sight data)
    this.bumpQueue.clear();

    // Clear movement
    this.animalComp?.steeringQueue.clear();
  }

  /**
   * Remove energy from this actor (e.g. when being eaten).
   * Does not kill the actor directly -- the engine detects zero energy next tick.
   *
   * @param amount - Energy to remove.
   * @returns The actual amount drained (capped to available energy).
   */
  drainEnergy(amount: number): number {
    const actual = math.min(this.energy, amount);
    this.energy -= actual;
    return actual;
  }

  /**
   * Add energy to this actor (e.g. after a successful eat action).
   * Capped at maxEnergy.
   *
   * @param amount - Energy to add.
   */
  gainEnergy(amount: number): void {
    this.energy = math.min(this.maxEnergy, this.energy + amount);
  }

  /** A random position inside the arena, in simulation pixels. */
  randomPosition(): Vector2 {
    return this.engine.randomPosition();
  }

  /**
   * Record that this actor touched another one this frame.
   *
   * @param otherActorId - The other actor's id.
   */
  enqueueBump(otherActorId: number) {
    this.bumpQueue.add(otherActorId);
  }

  /**
   * Display a speech bubble with the given text above the actor.
   * The bubble auto-dismisses after the given duration (default 5 seconds),
   * or is replaced if displayString is called again before the timer expires.
   * Repeating the same text only resets the timer.
   *
   * @param text - The text to display, or undefined to dismiss the bubble.
   * @param durationSecs - Duration in seconds before auto-dismiss. Defaults to 5.
   */
  displayString(text?: string, durationSecs?: number) {
    const dismissMs = (durationSecs ?? SAY_DEFAULT_DURATION_SECONDS) * 1000;

    // If the same text is already displayed, just reset the timer
    if (this.speechText !== undefined && this.speechText === text) {
      this.speechExpiresAt = this.engine.simTime + dismissMs;
      return;
    }

    // Clear any existing bubble
    this.clearDisplayString();

    if (text === undefined) {
      return;
    }

    this.speechText = text;
    this.speechExpiresAt = this.engine.simTime + dismissMs;
    this.visuals.setSpeech(text);
  }

  /** Remove the current speech bubble, if any. */
  clearDisplayString() {
    if (this.speechText !== undefined) {
      this.visuals.setSpeech(undefined);
    }
    this.speechText = undefined;
    this.speechExpiresAt = 0;
  }

  /** Clean up all owned resources (visuals, brain). */
  destroy() {
    this.clearDisplayString();
    this.visuals.destroy();
    this.brain.events().removeAllListeners();
    this.brain.dispose();
  }
}
