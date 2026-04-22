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

type ObstacleBody = MatterJS.BodyType & { _obstacleSize: { width: number; height: number } };

export class Playground extends Scene {
  private engine: Engine;
  private timeSpeed: number = 1;
  private gameplayPaused: boolean = false;
  private unsubProjectUnloading?: () => void;
  private unsubProjectLoaded?: () => void;
  private obstacleBodies: ObstacleBody[] = [];

  constructor() {
    super("Playground");
  }

  create() {
    // scene.restart() re-runs create() on the same Scene instance, so any
    // class fields populated below would otherwise accumulate across reloads.
    this.obstacleBodies = [];

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
    // For brand-new projects, generate random obstacles AND assign each a
    // random rotation. For persisted projects, honor the saved rotation
    // (or 0 if the field is missing from older saves) so reloading
    // doesn't shuffle obstacles around.
    const obstacleData: Array<{ x: number; y: number; width: number; height: number; rotation: number }> =
      persisted && persisted.length > 0
        ? persisted.map((o) => ({
            x: o.x,
            y: o.y,
            width: o.width,
            height: o.height,
            rotation: o.rotation ?? 0,
          }))
        : this.generateRandomObstacles().map((o) => ({
            ...o,
            rotation: Phaser.Math.FloatBetween(0, Math.PI * 2),
          }));

    for (const { x, y, width, height, rotation } of obstacleData) {
      const rect = this.add.rectangle(x, y, width, height, brownColor, 0.8);
      const obstacleGO = this.matter.add.gameObject(rect, {
        shape: { type: "rectangle", width, height },
        angle: rotation,
        collisionFilter: {
          category: CATEGORY_WALL,
          mask: CATEGORY_WALL | CATEGORY_ACTOR | CATEGORY_BLIP,
        },
      }) as Phaser.GameObjects.Rectangle & { body: MatterJS.BodyType };

      // Construct dynamic so Matter computes a real mass/inertia from
      // density*area, then freeze. If we constructed static, the dynamic
      // properties would be zeroed and a later setStatic(false) on drag
      // would leave the body with bad mass/inertia (NaN propagates and
      // the visual disappears).
      const obstacleBody = obstacleGO.body as ObstacleBody;
      obstacleBody._obstacleSize = { width, height };
      this.matter.body.setStatic(obstacleBody, true);
      this.obstacleBodies.push(obstacleBody);
    }

    if (!persisted || persisted.length === 0) {
      this.persistObstacles();
    }

    this.engine = new Engine(this, this.obstacleBodies, store);

    // Pointer drag for actors and obstacles. The pointer
    // constraint is a soft spring (low stiffness, zero angularStiffness)
    // so pulling a body by its corner generates real torque and rotates
    // it like a box dragged across a floor. Per-body drag-time tweaks
    // (density boost for heft, frictionAir for ground-friction-style
    // damping) are applied on DRAG_START and restored on DRAG_END.
    const DRAG_DENSITY = 0.05;
    const DRAG_FRICTION_AIR = 0.4;
    const dragOriginals = new Map<MatterJS.BodyType, { density: number; frictionAir: number }>();

    this.matter.add.pointerConstraint({
      stiffness: 0.05,
      damping: 0.1,
      angularStiffness: 0,
      collisionFilter: {
        category: 0x0001,
        mask: CATEGORY_WALL | CATEGORY_ACTOR,
        group: 0,
      },
    } as Phaser.Types.Physics.Matter.MatterConstraintConfig);

    this.matter.world.on("dragstart", (body: MatterJS.BodyType) => {
      if ("_obstacleSize" in body) {
        // Obstacle was static; flip dynamic so the constraint can move it.
        this.matter.body.setStatic(body, false);
      }
      dragOriginals.set(body, { density: body.density, frictionAir: body.frictionAir });
      this.matter.body.setDensity(body, DRAG_DENSITY);
      body.frictionAir = DRAG_FRICTION_AIR;
      const actor = this.lookupActorByBody(body);
      if (actor) actor.isBeingDragged = true;
    });

    this.matter.world.on("dragend", (body: MatterJS.BodyType) => {
      const orig = dragOriginals.get(body);
      if (orig) {
        this.matter.body.setDensity(body, orig.density);
        body.frictionAir = orig.frictionAir;
        dragOriginals.delete(body);
      }
      const isObstacle = "_obstacleSize" in body;
      if (isObstacle) {
        this.matter.body.setStatic(body, true);
        this.persistObstacles();
      } else {
        //this.matter.body.setAngularVelocity(body, 0);
        //this.matter.body.setVelocity(body, { x: 0, y: 0 });
        const actor = this.lookupActorByBody(body);
        if (actor) {
          actor.isBeingDragged = false;
          if (actor.plantComp?.springAnchor) {
            actor.plantComp.springAnchor.x = body.position.x;
            actor.plantComp.springAnchor.y = body.position.y;
          }
        }
      }
    });

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
      if (this.gameplayPaused) return;
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
    if (!this.gameplayPaused) {
      const scaledDelta = delta * this.timeSpeed;
      this.engine.tick(time, scaledDelta);
    }

    // Update sprite tints to reflect each actor's current energy level.
    this.engine.updateEnergyVisuals();

    // Always update debug vision cones (clears them when debug is off)
    this.engine.drawDebugVisionCones();
  }

  private lookupActorByBody(body: MatterJS.BodyType): Actor | undefined {
    const sprite = body.gameObject as Phaser.Physics.Matter.Sprite | null;
    const actorId = sprite?.data?.get("actorId");
    if (typeof actorId !== "number") return undefined;
    return this.engine.getActorById(actorId);
  }

  private persistObstacles(): void {
    const store = this.game.registry.get(STORE_REGISTRY_KEY) as SimEnvironmentStore;
    store.setObstacles(
      this.obstacleBodies.map((b) => ({
        x: b.position.x,
        y: b.position.y,
        width: b._obstacleSize.width,
        height: b._obstacleSize.height,
        rotation: b.angle,
      }))
    );
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

      // Check if position overlaps with any obstacle. Read live world
      // AABBs from each Matter body so we don't spawn into an obstacle
      // that has been dragged to a new location.
      let overlaps = false;
      for (const body of this.obstacleBodies) {
        const b = body.bounds;
        const closestX = Math.max(b.min.x, Math.min(x, b.max.x));
        const closestY = Math.max(b.min.y, Math.min(y, b.max.y));
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

    const body = sprite.body as MatterJS.BodyType;
    body.sleepThreshold = Number.POSITIVE_INFINITY;

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

  setPaused(paused: boolean) {
    this.gameplayPaused = paused;
  }

  // Method to set time scale for the simulation
  setTimeSpeed(speed: number) {
    this.timeSpeed = speed;
    this.matter.world.engine.timing.timeScale = speed;
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
