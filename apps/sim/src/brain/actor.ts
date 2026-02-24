import type { Vector2 } from "@mindcraft-lang/core";
import { type IBrain, type IBrainDef, mkSensorTileId } from "@mindcraft-lang/core/brain";
import { ARCHETYPES } from "./archetypes";
import { Engine } from "./engine";
import { Mover, type MoverConfig, type Steering, steerAvoidObstacles } from "./movement";
import { TileIds } from "./tileids";
import type { SightResult } from "./vision";

export type Archetype = "carnivore" | "herbivore" | "plant";

export class AnimalComp {
  steeringQueue: Steering[] = [];
  constructor(public actor: Actor) {}
  tick(time: number, dt: number) {
    const dtSec = dt / 1000;
    const forceMag = this.actor.mover.step(this.actor.sprite, dtSec, this.steeringQueue);

    // Drain energy proportional to thrust force applied this frame.
    const costPerForce = ARCHETYPES[this.actor.archetype].energy.movementCostPerForce;
    if (costPerForce > 0 && forceMag > 0) {
      this.actor.drainEnergy(forceMag * costPerForce * dtSec);
    }
  }
}

export class PlantComp {
  // Spring anchor for plants
  springAnchor?: { x: number; y: number };

  // Self-tracked velocity (px/sec) for a damped harmonic oscillator.
  // Kept independent of Matter body velocity so the spring behaves
  // identically at any timeScale.
  private springVelX = 0;
  private springVelY = 0;

  constructor(public actor: Actor) {}
  tick(time: number, dt: number) {
    if (this.springAnchor && this.actor.sprite.body) {
      const dtSec = dt / 1000;
      if (dtSec <= 0) return;

      // Damped harmonic oscillator: a = -k * x - c * v
      // k=200, c=12 -> omega0 ~ 14.1 rad/s, period ~ 0.44s
      // zeta = c / (2 * sqrt(k)) ~ 0.42 (underdamped -- visible bounce)
      const k = 200;
      const c = 12;

      // Sub-step the integration so large frame dt (from high timeScale or
      // frame drops) cannot cause a single Euler step to overshoot.
      const maxStep = 0.004; // 4ms ceiling per sub-step
      const steps = Math.ceil(dtSec / maxStep);
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
          const s = maxVel / Math.sqrt(velSq);
          this.springVelX *= s;
          this.springVelY *= s;
        }

        this.actor.sprite.setPosition(
          this.actor.sprite.x + this.springVelX * h,
          this.actor.sprite.y + this.springVelY * h
        );
      }

      // Zero Matter velocity so the engine does not redundantly integrate.
      // Collision impulses from Matter still appear as position corrections
      // that feed back into the displacement reading next frame.
      this.actor.sprite.setVelocity(0, 0);
    }
  }
}

export class Actor {
  engine: Engine;
  actorId: number;
  archetype: Archetype;
  brain: IBrain;
  mover: Mover;
  sprite: Phaser.Physics.Matter.Sprite;
  debugGraphics?: Phaser.GameObjects.Graphics; // For debug visualization
  healthBarGfx?: Phaser.GameObjects.Graphics; // Energy health bar drawn above the sprite
  pupils?: [Phaser.GameObjects.Arc, Phaser.GameObjects.Arc]; // Dynamic pupil circles
  smoothedGaze = 0; // Smoothed gaze turn value for pupil animation
  readonly bumpQueue = new Set<number>(); // IDs of actors this one has bumped into
  sightQueue: SightResult[] = []; // Visible actors from the last vision check
  private chatBubble?: Phaser.GameObjects.Container;
  private chatBubbleTimer?: Phaser.Time.TimerEvent;
  private chatBubbleText?: string;
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
  lastIntent?: { turn: number; throttle: number; speedMultiplier: number }; // Last computed movement intent for debug visualization

  get age(): number {
    return this.engine.clock.now - this.bornAt;
  }

  constructor(engine: Engine, archetype: Archetype, brainDef: IBrainDef, moverCfg?: Partial<MoverConfig>) {
    this.engine = engine;
    this.actorId = 0; // to be assigned later
    this.archetype = archetype;
    this.brain = brainDef.compile();
    this.mover = new Mover(moverCfg);
    this.sprite = null!; // to be assigned later
    this.bornAt = this.engine.clock.now;

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

    this.brain.initialize(this);
    this.brain.events().on("page_activated", this.pageActivated);
    this.brain.events().on("page_deactivated", this.pageDeactivated);
    this.brain.startup();
  }

  replaceBrain(brainDef: IBrainDef) {
    this.brain.shutdown();
    this.brain.events().removeAllListeners();
    this.brain = brainDef.compile();
    this.brain.initialize(this);
    this.brain.events().on("page_activated", this.pageActivated);
    this.brain.events().on("page_deactivated", this.pageDeactivated);
    this.brain.startup();
  }

  pageActivated = ({ pageIndex }: { pageIndex: number }) => {
    const program = this.brain.getProgram();
    if (!program) return;
    const pageMeta = program.pages.get(pageIndex);
    if (!pageMeta) return;
    const sensors = pageMeta.sensors;
    if (sensors.has(mkSensorTileId(TileIds.Sensor.See))) {
      this.hasVision = true;
    } else {
      this.hasVision = false;
    }
  };

  pageDeactivated = ({ pageIndex }: { pageIndex: number }) => {
    // console.log(`Actor ${this.actorId} page deactivated: ${pageIndex}`);
  };

  tick(time: number, dt: number) {
    // Update passive energy regen / decay
    const dtSec = dt / 1000;
    const energyCfg = ARCHETYPES[this.archetype].energy;
    if (energyCfg.regenRate > 0 && this.energy > 0) {
      this.energy = Math.min(this.maxEnergy, this.energy + energyCfg.regenRate * dtSec);
    }
    if (energyCfg.decayRate > 0) {
      this.energy = Math.max(0, this.energy - energyCfg.decayRate * dtSec);
    }

    // Run vision check on this actor's phase only (round-robin stagger). On
    // off-phase ticks the sightQueue retains its previous results so the brain
    // still has (slightly stale) data to work with. A new page with sight
    // sensors could have a short initial delay before sight works while waiting
    // for the next on-phase tick. Will revisit if this becomes an issue.
    if (this.hasVision) {
      const phase = this.actorId % Engine.VISION_PHASES;
      if (this.engine.tickCount % Engine.VISION_PHASES === phase) {
        this.engine.queryVisibleActors(this, this.visionRange, this.visionFOV);
      }
    } else {
      this.sightQueue.length = 0;
    }

    // Run brain logic (pass sim time so ctx.time / ctx.dt honor time scale)
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
    if (this.plantComp) {
      this.plantComp.tick(time, dt);
    }
    if (this.animalComp) {
      this.animalComp.tick(time, dt);
    }

    // Update chat bubble position to follow sprite
    if (this.chatBubble) {
      this.chatBubble.setPosition(this.sprite.x, this.sprite.y - 20);
    }

    // Clear event queues (sightQueue is cleared at start of next
    // queryVisibleActors call. Due to phase staggering, we want to keep stale
    // sight data)
    this.bumpQueue.clear();

    // Save last movement intent for debug visualization before clearing
    if (this.animalComp && this.animalComp.steeringQueue.length > 0) {
      this.lastIntent = this.mover.buildIntent(this.animalComp.steeringQueue);
    } else {
      this.lastIntent = undefined;
    }

    // Clear movement
    this.animalComp?.steeringQueue.splice(0);
  }

  /**
   * Remove energy from this actor (e.g. when being eaten).
   * Returns the actual amount drained (capped to available energy).
   * Does not kill the actor directly -- the engine detects zero energy next tick.
   */
  drainEnergy(amount: number): number {
    const actual = Math.min(this.energy, amount);
    this.energy -= actual;
    return actual;
  }

  /**
   * Add energy to this actor (e.g. after a successful eat action).
   * Capped at maxEnergy.
   */
  gainEnergy(amount: number): void {
    this.energy = Math.min(this.maxEnergy, this.energy + amount);
  }

  randomPosition(): Vector2 {
    return this.engine.randomPosition();
  }

  enqueueBump(otherActorId: number) {
    this.bumpQueue.add(otherActorId);
  }

  /**
   * Display a chat bubble with the given text above the actor.
   * The bubble auto-dismisses after the given duration (default 5 seconds),
   * or is replaced if displayString is called again before the timer expires.
   *
   * @param text - The text to display in the bubble.
   * @param durationSecs - Duration in seconds before auto-dismiss. Defaults to 5.
   */
  displayString(text?: string, durationSecs?: number) {
    // If the same text is already displayed, just reset the timer
    if (this.chatBubble && this.chatBubbleText === text) {
      if (this.chatBubbleTimer) {
        this.chatBubbleTimer.elapsed = 0;
      }
      return;
    }

    // Clear any existing chat bubble
    this.clearDisplayString();

    if (!text) {
      return;
    }

    const scene = this.sprite.scene;

    // Create text object
    const textObj = scene.add.text(0, 0, text, {
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
      color: "#000000",
      wordWrap: { width: 140 },
      align: "center",
    });
    textObj.setOrigin(0.5, 1);

    // Measure text bounds
    const padding = 6;
    const pointerHeight = 6;
    const textWidth = textObj.width;
    const textHeight = textObj.height;
    const bgWidth = textWidth + padding * 2;
    const bgHeight = textHeight + padding * 2;

    // Position text centered in the bubble
    textObj.setPosition(0, -(pointerHeight + padding));

    // Create bubble background
    const bg = scene.add.graphics();

    // Shadow
    bg.fillStyle(0x000000, 0.12);
    bg.fillRoundedRect(-bgWidth / 2 + 1, -(bgHeight + pointerHeight) + 1, bgWidth, bgHeight, 6);

    // White fill
    bg.fillStyle(0xffffff, 0.95);
    bg.fillRoundedRect(-bgWidth / 2, -(bgHeight + pointerHeight), bgWidth, bgHeight, 6);

    // Border
    bg.lineStyle(1.5, 0x333333, 0.8);
    bg.strokeRoundedRect(-bgWidth / 2, -(bgHeight + pointerHeight), bgWidth, bgHeight, 6);

    // Pointer triangle
    bg.fillStyle(0xffffff, 0.95);
    bg.fillTriangle(-5, -pointerHeight, 5, -pointerHeight, 0, 0);
    // Pointer border lines (left and right edges only)
    bg.lineStyle(1.5, 0x333333, 0.8);
    bg.lineBetween(-5, -pointerHeight, 0, 0);
    bg.lineBetween(0, 0, 5, -pointerHeight);

    // Assemble container, positioned above the sprite
    const container = scene.add.container(this.sprite.x, this.sprite.y - 20, [bg, textObj]);
    container.setDepth(100);

    this.chatBubble = container;
    this.chatBubbleText = text;

    const dismissMs = (durationSecs ?? 5) * 1000;
    this.chatBubbleTimer = scene.time.delayedCall(dismissMs, () => {
      this.clearDisplayString();
    });
  }

  /** Remove the current chat bubble, if any. */
  clearDisplayString() {
    if (this.chatBubble) {
      this.chatBubble.destroy();
      this.chatBubble = undefined;
    }
    this.chatBubbleText = undefined;
    if (this.chatBubbleTimer) {
      this.chatBubbleTimer.remove(false);
      this.chatBubbleTimer = undefined;
    }
  }

  /** Clean up all owned resources (timers, graphics, bubbles, pupils). */
  destroy() {
    this.clearDisplayString();
    if (this.debugGraphics) {
      this.debugGraphics.destroy();
      this.debugGraphics = undefined;
    }
    if (this.healthBarGfx) {
      this.healthBarGfx.destroy();
      this.healthBarGfx = undefined;
    }
    if (this.pupils) {
      this.pupils[0].destroy();
      this.pupils[1].destroy();
      this.pupils = undefined;
    }
    this.brain.shutdown();
    this.brain.events().removeAllListeners();
  }
}
