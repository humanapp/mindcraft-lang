import { type BrainDef, Vector2 } from "@mindcraft-lang/core/app";
import { Scene } from "phaser";
import type { Actor, Archetype } from "@/brain/actor";
import { ARCHETYPES, type ArchetypePhysicsConfig } from "@/brain/archetypes";
import type { Blip } from "@/brain/blip";
import { BLIP_RADIUS } from "@/brain/blip";
import { Engine } from "@/brain/engine";
import type { ScoreSnapshot } from "@/brain/score";
import { STORE_REGISTRY_KEY } from "@/game/main";
import type { SimEnvironmentStore } from "@/services/sim-environment-store";
/**
 * Registry key where `StartGame` stores its scene-ready callback.
 * Playground reads this in `create()` to notify React without an EventBus.
 */
export const SCENE_READY_KEY = "__onSceneReady";

// Collision categories for Matter.js (bitmask)
const CATEGORY_WALL = 0x0001;
const CATEGORY_ACTOR = 0x0002;
const CATEGORY_BLIP = 0x0004;

export class Playground extends Scene {
  private wallBodies: MatterJS.BodyType[] = [];
  private engine: Engine;
  private timeSpeed: number = 1;
  private unsubProjectUnloading?: () => void;
  private unsubProjectLoaded?: () => void;
  private obstacles: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];
  private draggedActor?: Actor;
  private draggedObstacle?: {
    body: MatterJS.BodyType;
    constraint: MatterJS.ConstraintType;
  };

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

    // Create static obstacles. Use the project's persisted obstacle set if
    // one exists; otherwise generate a fresh random set and persist it so
    // the same obstacles are restored on subsequent loads of this project.
    const store = this.game.registry.get(STORE_REGISTRY_KEY) as SimEnvironmentStore;
    const brownColor = 0x6c757d;

    const persisted = store.getObstacles();
    const obstacleData =
      persisted && persisted.length > 0
        ? persisted.map((o) => ({ x: o.x, y: o.y, width: o.width, height: o.height }))
        : this.generateRandomObstacles();

    for (const { x, y, width, height } of obstacleData) {
      const rect = this.add.rectangle(x, y, width, height, brownColor, 0.8);
      const obstacleGO = this.matter.add.gameObject(rect, {
        shape: { type: "rectangle", width, height },
        isStatic: false,
        mass: 2000,
        frictionAir: 0.9,
        friction: 0.95,
        restitution: 0.05,
        collisionFilter: {
          category: CATEGORY_WALL,
          mask: CATEGORY_WALL | CATEGORY_ACTOR | CATEGORY_BLIP,
        },
      }) as Phaser.GameObjects.Rectangle & { body: MatterJS.BodyType };

      const obstacleBody = obstacleGO.body as MatterJS.BodyType;
      obstacleBody.sleepThreshold = Number.POSITIVE_INFINITY;

      this.wallBodies.push(obstacleBody);
      this.obstacles.push({ x, y, width, height });

      obstacleGO.setInteractive({ useHandCursor: true });
      obstacleGO.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
        this.startDraggingObstacle(obstacleBody, pointer);
      });
    }

    if (!persisted || persisted.length === 0) {
      store.setObstacles(this.obstacles);
    }

    this.engine = new Engine(this, this.obstacles, store);

    this.unsubProjectUnloading = store.onProjectUnloading(() => {
      this.engine.shutdown();
    });
    this.unsubProjectLoaded = store.onProjectLoaded(() => {
      this.engine.shutdown();
      // Wait for the store to finish reloading project app data (obstacles,
      // desired counts) before restarting the scene. Otherwise create() may
      // run with stale cached data from the previous project.
      void store.waitForProjectDataReload().then(() => {
        this.scene.restart();
      });
    });

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

    // Release the dragged actor when the pointer is lifted anywhere. The
    // pointer-down handler that picks an actor up is bound per-sprite in
    // `spawn()` so it only fires when the pointer is actually over an actor.
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.releaseDraggedActor();
      this.releaseDraggedObstacle();
    });
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, () => {
      this.releaseDraggedActor();
      this.releaseDraggedObstacle();
    });

    this.engine.start();

    // After scene.restart(), the new Matter world's timing.timeScale resets
    // to 1. Re-apply the persisted timeSpeed so blips (which integrate via
    // Matter) stay in sync with actor movement (which uses scaledDelta).
    this.setTimeSpeed(store.getUiPreferences().timeScale);

    // Set up cleanup for brainDefs when scene shuts down (including restart)
    this.events.once("shutdown", this.shutdown, this);

    // Pause update loop until async brain loading finishes
    this.scene.pause();
    this.engine.loadBrains().then(
      () => {
        this.scene.resume();
        const onReady = this.registry.get(SCENE_READY_KEY) as ((scene: Phaser.Scene) => void) | undefined;
        onReady?.(this);
      },
      (err) => {
        console.error("Failed to load brains:", err);
        this.scene.resume();
      }
    );
  }

  private shutdown() {
    this.unsubProjectUnloading?.();
    this.unsubProjectUnloading = undefined;
    this.unsubProjectLoaded?.();
    this.unsubProjectLoaded = undefined;
    this.engine.shutdown();
  }

  update(time: number, delta: number): void {
    const scaledDelta = delta * this.timeSpeed;
    this.engine.tick(time, scaledDelta);

    // Drive the dragged actor toward the pointer. Setting velocity (rather
    // than teleporting position) keeps Matter's solver in charge of
    // collisions, so the dragged body still pushes neighbors out of the way.
    if (this.draggedActor) {
      const actor = this.draggedActor;
      const sprite = actor.sprite;
      if (actor.isDying || !sprite?.body) {
        this.releaseDraggedActor();
      } else {
        const pointer = this.input.activePointer;
        const dx = pointer.worldX - sprite.x;
        const dy = pointer.worldY - sprite.y;
        // Matter's velocity units are pixels-per-step. Clamp the per-step
        // travel so a fast pointer flick cannot tunnel through walls or
        // other bodies.
        const maxStep = 20;
        const distSq = dx * dx + dy * dy;
        let vx = dx;
        let vy = dy;
        if (distSq > maxStep * maxStep) {
          const scale = maxStep / Math.sqrt(distSq);
          vx = dx * scale;
          vy = dy * scale;
        }
        sprite.setVelocity(vx, vy);
      }
    }

    if (this.draggedObstacle) {
      const pointer = this.input.activePointer;
      const c = this.draggedObstacle.constraint as unknown as {
        pointA: { x: number; y: number };
      };
      c.pointA.x = pointer.worldX;
      c.pointA.y = pointer.worldY;
      // Damp the body's velocity each frame to keep heavy obstacles from
      // building up momentum and overshooting.
      const body = this.draggedObstacle.body;
      this.matter.body.setVelocity(body, {
        x: body.velocity.x * 0.85,
        y: body.velocity.y * 0.85,
      });
      this.matter.body.setAngularVelocity(body, body.angularVelocity * 0.85);
    }

    // Update sprite tints to reflect each actor's current energy level.
    this.engine.updateEnergyVisuals();

    // Always update debug vision cones (clears them when debug is off)
    this.engine.drawDebugVisionCones();
  }

  private releaseDraggedActor(): void {
    const actor = this.draggedActor;
    if (!actor) return;
    actor.isBeingDragged = false;
    this.draggedActor = undefined;

    // The actor may have been killed (sprite destroyed, body removed) while
    // being dragged; only touch the body / anchor if it still exists.
    const sprite = actor.sprite;
    if (!sprite?.body) return;
    sprite.setVelocity(0, 0);

    // Plants are anchored to a fixed point by their spring; re-anchor to the
    // drop location so they don't snap back to where they originally spawned.
    if (actor.plantComp?.springAnchor) {
      actor.plantComp.springAnchor.x = sprite.x;
      actor.plantComp.springAnchor.y = sprite.y;
    }
  }

  private startDraggingObstacle(body: MatterJS.BodyType, pointer: Phaser.Input.Pointer): void {
    this.releaseDraggedActor();
    this.releaseDraggedObstacle();

    // Express the click point in the body's local frame so the joint
    // anchors at the exact spot the user grabbed (off-center grabs will
    // produce torque and let the obstacle swing/rotate).
    const dx = pointer.worldX - body.position.x;
    const dy = pointer.worldY - body.position.y;
    const cos = Math.cos(-body.angle);
    const sin = Math.sin(-body.angle);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    // A soft, heavily-damped spring from the world (cursor) to the body.
    // Low stiffness + high damping + the body's heavy mass + high
    // frictionAir keeps motion controlled and sluggish.
    const constraint = this.matter.add.worldConstraint(body, 0, 0.02, {
      pointA: { x: pointer.worldX, y: pointer.worldY },
      pointB: { x: localX, y: localY },
      damping: 0.9,
    });
    this.draggedObstacle = { body, constraint };
  }

  private releaseDraggedObstacle(): void {
    if (!this.draggedObstacle) return;
    this.matter.world.removeConstraint(this.draggedObstacle.constraint);
    this.matter.body.setVelocity(this.draggedObstacle.body, { x: 0, y: 0 });
    this.matter.body.setAngularVelocity(this.draggedObstacle.body, 0);
    this.draggedObstacle = undefined;
  }

  private generateRandomObstacles(): Array<{ x: number; y: number; width: number; height: number }> {
    const obstacleCount = 4;
    const minWidth = 30;
    const maxWidth = 120;
    const minHeight = 30;
    const maxHeight = 120;
    const margin = 100; // Keep obstacles away from edges

    const obstacles: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (let i = 0; i < obstacleCount; i++) {
      const width = Phaser.Math.Between(minWidth, maxWidth);
      const height = Phaser.Math.Between(minHeight, maxHeight);
      const x = Phaser.Math.Between(margin, this.scale.width - margin);
      const y = Phaser.Math.Between(margin, this.scale.height - margin);
      obstacles.push({ x, y, width, height });
    }
    return obstacles;
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

    // Allow the user to grab the actor with the pointer. Use the default
    // (texture-frame) hit area so the entire visible sprite is clickable.
    sprite.setInteractive({ useHandCursor: true });
    sprite.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (this.draggedActor && this.draggedActor !== actor) {
        this.releaseDraggedActor();
      }
      this.draggedActor = actor;
      actor.isBeingDragged = true;
    });

    // Create debug graphics for this actor
    actor.debugGraphics = this.add.graphics();
    actor.debugGraphics.setDepth(-1); // Render below actors

    // Create health bar graphics, rendered above actors
    actor.healthBarGfx = this.add.graphics();
    actor.healthBarGfx.setDepth(2);

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
