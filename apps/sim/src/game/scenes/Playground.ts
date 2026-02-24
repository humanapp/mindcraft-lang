import { Vector2 } from "@mindcraft-lang/core";
import type { BrainDef } from "@mindcraft-lang/core/brain/model";
import { Scene } from "phaser";
import type { Actor, Archetype } from "@/brain/actor";
import { ARCHETYPES, type ArchetypePhysicsConfig } from "@/brain/archetypes";
import type { Blip } from "@/brain/blip";
import { BLIP_RADIUS } from "@/brain/blip";
import { Engine } from "@/brain/engine";
import type { ScoreSnapshot } from "@/brain/score";
import { SCENE_READY_KEY } from "../main";

// Collision categories for Matter.js (bitmask)
const CATEGORY_WALL = 0x0001;
const CATEGORY_ACTOR = 0x0002;
const CATEGORY_BLIP = 0x0004;

export class Playground extends Scene {
  private wallBodies: MatterJS.BodyType[] = [];
  private engine: Engine;
  private timeSpeed: number = 1;
  private obstacles: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];

  constructor() {
    super("Playground");
  }

  create() {
    // Set physics world bounds (creates boundary walls)
    this.matter.world.setBounds(0, 0, this.scale.width, this.scale.height, 32, true, true, true, true);

    // Create Actor textures
    const createActorTexture = (archetype: Archetype, config: ArchetypePhysicsConfig) => {
      const graphics = this.add.graphics();
      graphics.fillStyle(config.color, 1);
      graphics.fillCircle(config.radius, config.radius, config.radius);
      if (archetype !== "plant") {
        // eyes near the front to indicate orientation
        graphics.fillStyle(0xffffff, 1);
        graphics.fillCircle(2 * config.radius - 7.2, config.radius - 4.5, 5);
        graphics.fillCircle(2 * config.radius - 7.2, config.radius + 4.5, 5);
        // Pupils (static for now; see updatePupils() for dynamic gaze WIP)
        graphics.fillStyle(0x000000, 1);
        graphics.fillCircle(2 * config.radius - 5, config.radius - 3.6, 1.5);
        graphics.fillCircle(2 * config.radius - 5, config.radius + 3.6, 1.5);
      }
      graphics.generateTexture(`tex_${archetype}`, config.radius * 2, config.radius * 2);
      graphics.destroy();
    };

    // Create textures for all archetypes using their configs
    Object.entries(ARCHETYPES).forEach(([archetype, config]) => {
      createActorTexture(archetype as Archetype, config.physics);
    });

    // Create blip (projectile) texture -- small white circle
    {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(BLIP_RADIUS, BLIP_RADIUS, BLIP_RADIUS);
      g.generateTexture("tex_blip", BLIP_RADIUS * 2, BLIP_RADIUS * 2);
      g.destroy();
    }

    // Create static obstacles with random sizes and positions
    const brownColor = 0x6c757d;
    const obstacleCount = 4;
    const minWidth = 30;
    const maxWidth = 120;
    const minHeight = 30;
    const maxHeight = 120;
    const margin = 100; // Keep obstacles away from edges

    for (let i = 0; i < obstacleCount; i++) {
      const width = Phaser.Math.Between(minWidth, maxWidth);
      const height = Phaser.Math.Between(minHeight, maxHeight);
      const x = Phaser.Math.Between(margin, this.scale.width - margin);
      const y = Phaser.Math.Between(margin, this.scale.height - margin);

      // Create a visual rectangle
      this.add.rectangle(x, y, width, height, brownColor, 0.8);

      // Create a static Matter body for the obstacle
      const obstacleBody = this.matter.add.rectangle(x, y, width, height, {
        isStatic: true,
        collisionFilter: {
          category: CATEGORY_WALL,
          mask: CATEGORY_ACTOR | CATEGORY_BLIP,
        },
        restitution: 0.3,
        friction: 0.1,
      });

      this.wallBodies.push(obstacleBody);

      // Store obstacle bounds for spawn collision checking
      this.obstacles.push({ x, y, width, height });
    }

    this.engine = new Engine(this, this.obstacles);

    // Set up Matter collision events -- handle both initial contact and
    // ongoing contact so bump sensors fire every frame while actors overlap
    const handleCollisionPairs = (pairs: Phaser.Types.Physics.Matter.MatterCollisionPair[]) => {
      for (const pair of pairs) {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;

        // Check if both bodies belong to actors (have actorId in gameObject data)
        const spriteA = bodyA.gameObject as Phaser.Physics.Matter.Sprite | null;
        const spriteB = bodyB.gameObject as Phaser.Physics.Matter.Sprite | null;

        if (spriteA?.data && spriteB?.data) {
          const actorIdA = spriteA.data.get("actorId");
          const actorIdB = spriteB.data.get("actorId");
          const blipIdA = spriteA.data.get("blipId");
          const blipIdB = spriteB.data.get("blipId");

          // Blip-Actor collision
          if (blipIdA !== undefined && actorIdB !== undefined) {
            this.engine.handleBlipActorCollision(blipIdA, actorIdB);
          } else if (blipIdB !== undefined && actorIdA !== undefined) {
            this.engine.handleBlipActorCollision(blipIdB, actorIdA);
          } else if (actorIdA !== undefined && actorIdB !== undefined) {
            // Actor-Actor collision
            this.engine.handleActorCollision(actorIdA, actorIdB);
          }
        } else {
          // One body may be a wall. Check for blip-wall collisions.
          if (spriteA?.data) {
            const blipId = spriteA.data.get("blipId");
            if (blipId !== undefined) this.engine.handleBlipWallCollision(blipId);
          }
          if (spriteB?.data) {
            const blipId = spriteB.data.get("blipId");
            if (blipId !== undefined) this.engine.handleBlipWallCollision(blipId);
          }
        }
      }
    };

    this.matter.world.on("collisionstart", (event: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
      handleCollisionPairs(event.pairs);
    });

    this.matter.world.on("collisionactive", (event: Phaser.Physics.Matter.Events.CollisionActiveEvent) => {
      handleCollisionPairs(event.pairs);
    });

    this.engine.start();

    // Set up cleanup for brainDefs when scene shuts down (including restart)
    this.events.once("shutdown", this.shutdown, this);

    // Notify React that the scene is ready
    const onReady = this.registry.get(SCENE_READY_KEY) as ((scene: Phaser.Scene) => void) | undefined;
    onReady?.(this);
  }

  private shutdown() {
    this.engine.shutdown();
  }

  update(time: number, delta: number): void {
    const scaledDelta = delta * this.timeSpeed;
    this.engine.tick(time, scaledDelta);

    // Update sprite tints to reflect each actor's current energy level.
    this.engine.updateEnergyVisuals();

    // TODO: re-enable once pupil gaze math is corrected
    // this.engine.updatePupils();

    // Always update debug vision cones (clears them when debug is off)
    this.engine.drawDebugVisionCones();
  }

  public randomPositionWithinBounds(radius: number = 20): Vector2 {
    const maxAttempts = 100;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = Phaser.Math.Between(40, this.scale.width - 40);
      const y = Phaser.Math.Between(40, this.scale.height - 40);

      // Check if position overlaps with any obstacle
      let overlaps = false;
      for (const obstacle of this.obstacles) {
        // Check if circle (actor) intersects with rectangle (obstacle)
        const closestX = Math.max(obstacle.x - obstacle.width / 2, Math.min(x, obstacle.x + obstacle.width / 2));
        const closestY = Math.max(obstacle.y - obstacle.height / 2, Math.min(y, obstacle.y + obstacle.height / 2));
        const distanceX = x - closestX;
        const distanceY = y - closestY;
        const distanceSquared = distanceX * distanceX + distanceY * distanceY;

        if (distanceSquared < radius * radius) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        return new Vector2(x, y);
      }
    }

    // Fallback: return a position anyway after max attempts
    return new Vector2(Phaser.Math.Between(40, this.scale.width - 40), Phaser.Math.Between(40, this.scale.height - 40));
  }

  public spawn(actor: Actor): Phaser.Physics.Matter.Sprite {
    const config = ARCHETYPES[actor.archetype].physics;
    const pos = this.randomPositionWithinBounds(config.radius);
    const textureKey = `tex_${actor.archetype}`;

    // Create a Matter sprite with a circular body
    const sprite = this.matter.add.sprite(pos.X, pos.Y, textureKey, undefined, {
      shape: {
        type: "circle",
        radius: config.radius * config.scale,
      },
      collisionFilter: {
        category: CATEGORY_ACTOR,
        mask: CATEGORY_WALL | CATEGORY_ACTOR | CATEGORY_BLIP,
      },
      mass: config.mass,
      frictionAir: config.frictionAir,
      restitution: config.restitution,
      friction: config.friction,
    });

    sprite.setScale(config.scale);

    // Set initial random facing direction
    sprite.setRotation(Phaser.Math.FloatBetween(0, Math.PI * 2));

    // Prevent the body from sleeping (so forces always apply)
    sprite.setFixedRotation(); // Let our mover control rotation, not physics
    const body = sprite.body as MatterJS.BodyType;
    body.sleepThreshold = Number.POSITIVE_INFINITY; // Never auto-sleep

    // Configure spring anchor if archetype uses it
    if (actor.plantComp) {
      actor.plantComp.springAnchor = { x: pos.X, y: pos.Y };
    }

    sprite.setDataEnabled();
    sprite.data.set("actorId", actor.actorId);

    // Create debug graphics for this actor
    actor.debugGraphics = this.add.graphics();
    actor.debugGraphics.setDepth(-1); // Render below actors

    // Create health bar graphics, rendered above actors
    actor.healthBarGfx = this.add.graphics();
    actor.healthBarGfx.setDepth(2);

    // Dynamic pupil circles disabled for now (see updatePupils() WIP)
    // if (actor.animalComp) {
    //   const pupilRadius = 1.5 * config.scale;
    //   const p1 = this.add.circle(0, 0, pupilRadius, 0x000000);
    //   const p2 = this.add.circle(0, 0, pupilRadius, 0x000000);
    //   p1.setDepth(1);
    //   p2.setDepth(1);
    //   actor.pupils = [p1, p2];
    // }

    return sprite;
  }

  /**
   * Activate a pooled blip at the given position with initial velocity.
   * If the blip does not yet have a sprite, one is created; otherwise
   * the existing sprite is repositioned and re-enabled.
   *
   * Blip bodies are **sensors** -- they trigger collision callbacks
   * without participating in the constraint solver, which keeps the
   * Matter.js step cheap even with thousands of active blips.
   */
  public activateBlip(blip: Blip, x: number, y: number, velX: number, velY: number): void {
    if (!blip.sprite) {
      // First activation -- create the sprite once; it will be reused.
      const sprite = this.matter.add.sprite(x, y, "tex_blip", undefined, {
        shape: { type: "circle", radius: BLIP_RADIUS },
        collisionFilter: {
          category: CATEGORY_BLIP,
          mask: CATEGORY_WALL | CATEGORY_ACTOR,
        },
        mass: 0.01,
        frictionAir: 0,
        restitution: 0,
        friction: 0,
        isSensor: true,
      });

      sprite.setScale(1);
      sprite.setFixedRotation();

      const body = sprite.body as MatterJS.BodyType;
      body.sleepThreshold = Number.POSITIVE_INFINITY;

      sprite.setDataEnabled();
      blip.sprite = sprite;
    } else {
      // Reuse existing sprite -- reposition and re-enable
      const body = blip.sprite.body as MatterJS.BodyType;
      body.collisionFilter.category = CATEGORY_BLIP;
      body.collisionFilter.mask = CATEGORY_WALL | CATEGORY_ACTOR;
      blip.sprite.setPosition(x, y);
      blip.sprite.setVisible(true);
      blip.sprite.setActive(true);
    }

    blip.sprite.data.set("blipId", blip.blipId);
    blip.sprite.setVelocity(velX, velY);
  }

  // Method to toggle physics debug mode
  toggleDebugMode() {
    if (this.matter.world.drawDebug) {
      this.matter.world.debugGraphic.clear();
      this.matter.world.drawDebug = false;
    } else {
      this.matter.world.createDebugGraphic();
      this.matter.world.drawDebug = true;
    }
  }

  // Method to set time scale for the simulation
  setTimeSpeed(speed: number) {
    this.timeSpeed = speed;
    if (speed === 0) {
      this.matter.world.pause();
    } else {
      this.matter.world.resume();
      // Scale the underlying Matter.js engine timing so collisions,
      // velocity integration, and force application all run at the
      // desired speed. Our brain/mover code also receives scaledDelta.
      this.matter.world.engine.timing.timeScale = speed;
    }
  }

  // Methods to access and update engine braindefs
  getBrainDef(archetype: Archetype): BrainDef {
    return this.engine.getBrainDef(archetype);
  }

  updateBrainDef(archetype: Archetype, newBrainDef: BrainDef) {
    this.engine.updateBrainDef(archetype, newBrainDef);
  }

  getScoreSnapshot(): ScoreSnapshot {
    return this.engine.getScoreSnapshot();
  }

  setDesiredCount(archetype: Archetype, count: number): void {
    this.engine.setDesiredCount(archetype, count);
  }

  getDesiredCount(archetype: Archetype): number {
    return this.engine.getDesiredCount(archetype);
  }
}
