import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IBrainDef, MindcraftEnvironment, Vector2 } from "@mindcraft-lang/core/app";
import type { Actor, Archetype } from "@/brain/actor";
import { ARCHETYPE_NAMES, ARCHETYPES } from "@/brain/archetypes";
import { BLIP_RADIUS, type Blip } from "@/brain/blip";
import { Engine } from "@/brain/engine";
import {
  actorBodyOptions,
  actorBodyRadius,
  blipBodyOptions,
  blipCollisionFilter,
  boundaryWalls,
  defaultDesiredCounts,
  generateObstacles,
  obstacleBodyOptions,
  randomFacing,
  randomSpawnPosition,
  WORLD_GRAVITY,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type WorldRandom,
} from "@/brain/world-definition";
import type { Playground } from "@/game/scenes/Playground";
import { deserializeBrainFromArrayBuffer } from "@/services/brain-persistence";
import type { EcosimEnvironmentStore } from "@/services/ecosim-environment-store";

// -- Matter.js, loaded without Phaser -------------------------------------------

const requireMatter = createRequire(import.meta.url);
const MATTER_LIB = "phaser/src/physics/matter-js/lib";

const MatterEngine = requireMatter(`${MATTER_LIB}/core/Engine.js`) as typeof MatterJS.Engine;
const MatterEvents = requireMatter(`${MATTER_LIB}/core/Events.js`) as typeof MatterJS.Events;
const MatterBodies = requireMatter(`${MATTER_LIB}/factory/Bodies.js`) as typeof MatterJS.Bodies;
const MatterBody = requireMatter(`${MATTER_LIB}/body/Body.js`) as typeof MatterJS.Body;
const MatterComposite = requireMatter(`${MATTER_LIB}/body/Composite.js`) as typeof MatterJS.Composite;

/** Fixed simulation step in milliseconds, matching the app's 60 Hz physics substep. */
export const STEP_MS = 1000 / 60;

/** Project namespace the shipped brain documents deserialize under. */
const PROJECT_NAMESPACE = "ecosim-rehearsal";

/** The app directory this module was loaded from, resolved from the module's own location. */
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Directory holding the brain documents the app ships for each archetype. */
const BRAIN_ASSET_DIR = join(APP_DIR, "public", "assets", "brain", "defs");

/** The world-construction draws of one run, taken from its seeded stream. */
function seededRandom(rng: () => number): WorldRandom {
  return {
    int: (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min,
    unit: rng,
  };
}

// -- Observation ----------------------------------------------------------------

/**
 * Hooks a caller installs to watch the world's presentation events. Every hook is
 * optional; a hook that is absent is not called.
 */
export interface WorldObserver {
  /** An actor that has just been spawned into the world and given a body. */
  onSpawn?(actor: Actor): void;
  /** A chat bubble reaching presentation, one per `say` the world renders. */
  onSay?(): void;
  /** A blip put into flight, one per `shoot` the world launches. */
  onBlipFired?(): void;
}

// -- Stubs standing in for Phaser presentation ----------------------------------

/** A drawing surface stand-in: accepts every draw call and records nothing. */
function stubGraphics(): Phaser.GameObjects.Graphics {
  const gfx = {
    setDepth: () => gfx,
    clear: () => gfx,
    destroy: () => {},
    fillStyle: () => gfx,
    lineStyle: () => gfx,
    fillRect: () => gfx,
    fillRoundedRect: () => gfx,
    strokeRoundedRect: () => gfx,
    fillTriangle: () => gfx,
    lineBetween: () => gfx,
    beginPath: () => gfx,
    moveTo: () => gfx,
    lineTo: () => gfx,
    closePath: () => gfx,
    strokePath: () => gfx,
    fillPath: () => gfx,
    arc: () => gfx,
  };
  return gfx as unknown as Phaser.GameObjects.Graphics;
}

/** Key/value store stand-in for a game object's data manager. */
class StubData {
  private readonly values = new Map<string, unknown>();
  get(key: string): unknown {
    return this.values.get(key);
  }
  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

// -- Matter-backed sprite stand-in ----------------------------------------------

/**
 * The surface of `Phaser.Physics.Matter.Sprite` that engine, actor, movement,
 * sensor and actuator code touches, backed by a real Matter body. Transform and
 * velocity operations delegate to the same `Matter.Body` calls the Phaser
 * component makes.
 */
class BodySprite {
  readonly data = new StubData();
  private alive = true;

  constructor(
    readonly body: MatterJS.BodyType,
    readonly scene: HeadlessScene
  ) {}

  get x(): number {
    return this.body.position.x;
  }

  get y(): number {
    return this.body.position.y;
  }

  get rotation(): number {
    return this.body.angle;
  }

  setPosition(x: number, y: number): this {
    MatterBody.setPosition(this.body, { x, y });
    return this;
  }

  setRotation(radians: number): this {
    MatterBody.setAngle(this.body, radians);
    return this;
  }

  setVelocity(x: number, y: number): this {
    MatterBody.setVelocity(this.body, { x, y });
    return this;
  }

  applyForce(force: { x: number; y: number }): this {
    MatterBody.applyForce(this.body, { x: this.body.position.x, y: this.body.position.y }, force);
    return this;
  }

  setVisible(_visible: boolean): this {
    return this;
  }

  setActive(_active: boolean): this {
    return this;
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    MatterComposite.remove(this.scene.matterWorld, this.body);
  }
}

// -- Headless scene -------------------------------------------------------------

/** Listener registration, keyed by event name, matching the emitter surface the engine uses. */
interface WorldListener {
  fn: (event: { timestamp: number }) => void;
  context: unknown;
}

/**
 * The `Playground` surface the engine and actors depend on, backed by a real
 * Matter engine stepped directly by {@link HeadlessScene.step}. Owns the world
 * bodies (walls, obstacles, actor bodies, blip bodies), the collision wiring
 * that turns Matter pairs into engine bump / blip events, and the seeded
 * placement its world construction draws.
 */
class HeadlessScene {
  readonly scale = { width: WORLD_WIDTH, height: WORLD_HEIGHT };
  readonly matterEngine: MatterJS.Engine;
  readonly obstacleBodies: MatterJS.BodyType[] = [];
  readonly matter: { world: unknown };
  readonly add = {
    graphics: () => stubGraphics(),
    text: () => {
      this.observer.onSay?.();
      return {
        width: 40,
        height: 12,
        setOrigin: () => undefined,
        setPosition: () => undefined,
        destroy: () => undefined,
      } as unknown as Phaser.GameObjects.Text;
    },
    container: () =>
      ({
        setDepth: () => undefined,
        setPosition: () => undefined,
        destroy: () => undefined,
      }) as unknown as Phaser.GameObjects.Container,
  };
  readonly time = {
    delayedCall: () => ({ elapsed: 0, remove: () => undefined }) as unknown as Phaser.Time.TimerEvent,
  };

  private readonly listeners = new Map<string, WorldListener[]>();
  private readonly random: WorldRandom;
  private engine!: Engine;

  constructor(
    rng: () => number,
    private readonly observer: WorldObserver
  ) {
    this.random = seededRandom(rng);
    this.matterEngine = MatterEngine.create();
    this.matterEngine.world.gravity.x = WORLD_GRAVITY.x;
    this.matterEngine.world.gravity.y = WORLD_GRAVITY.y;
    this.matterEngine.world.gravity.scale = WORLD_GRAVITY.scale;

    this.matter = {
      world: {
        drawDebug: false,
        on: (event: string, fn: WorldListener["fn"], context: unknown) => {
          const list = this.listeners.get(event) ?? [];
          list.push({ fn, context });
          this.listeners.set(event, list);
        },
        off: (event: string, fn: WorldListener["fn"], context: unknown) => {
          const list = this.listeners.get(event) ?? [];
          this.listeners.set(
            event,
            list.filter((entry) => entry.fn !== fn || entry.context !== context)
          );
        },
      },
    };

    this.createWalls();
    this.createObstacles();
    this.wireMatterEvents();
  }

  /** The Matter composite every body in this world belongs to. */
  get matterWorld(): MatterJS.CompositeType {
    return this.matterEngine.world as unknown as MatterJS.CompositeType;
  }

  /** Bind the ecosim engine whose actors this scene spawns bodies for. */
  attachEngine(engine: Engine): void {
    this.engine = engine;
  }

  /**
   * Advance the world one fixed step: gameplay first (brains think, steering is
   * applied), then physics, in the order the scene's update and the Matter
   * plugin run in.
   */
  step(time: number): void {
    this.engine.tick(time, STEP_MS);
    MatterEngine.update(this.matterEngine, STEP_MS);
  }

  private createWalls(): void {
    for (const { x, y, width, height } of boundaryWalls()) {
      const body = MatterBodies.rectangle(x + width / 2, y + height / 2, width, height, {
        isStatic: true,
        friction: 0,
        frictionStatic: 0,
      });
      MatterComposite.add(this.matterWorld, body);
    }
  }

  private createObstacles(): void {
    for (const { x, y, width, height, rotation } of generateObstacles(this.random)) {
      const body = MatterBodies.rectangle(x, y, width, height, obstacleBodyOptions(rotation));
      MatterBody.setStatic(body, true);
      MatterComposite.add(this.matterWorld, body);
      this.obstacleBodies.push(body);
    }
  }

  /**
   * Forward the Matter engine's own events to the listeners the ecosim engine
   * registered, and translate collision pairs into engine bump / blip calls the
   * same way the scene does.
   */
  private wireMatterEvents(): void {
    MatterEvents.on(this.matterEngine, "afterUpdate", (event: { timestamp: number }) => {
      for (const entry of this.listeners.get("afterupdate") ?? []) {
        entry.fn.call(entry.context, event);
      }
    });
    const onPairs = (event: { pairs: Array<{ bodyA: MatterJS.BodyType; bodyB: MatterJS.BodyType }> }) => {
      for (const pair of event.pairs) {
        this.handlePair(pair.bodyA, pair.bodyB);
      }
    };
    MatterEvents.on(this.matterEngine, "collisionStart", onPairs);
    MatterEvents.on(this.matterEngine, "collisionActive", onPairs);
  }

  private handlePair(bodyA: MatterJS.BodyType, bodyB: MatterJS.BodyType): void {
    const spriteA = bodyA.gameObject as unknown as BodySprite | undefined;
    const spriteB = bodyB.gameObject as unknown as BodySprite | undefined;
    if (spriteA && spriteB) {
      const actorIdA = spriteA.data.get("actorId") as number | undefined;
      const actorIdB = spriteB.data.get("actorId") as number | undefined;
      const blipIdA = spriteA.data.get("blipId") as number | undefined;
      const blipIdB = spriteB.data.get("blipId") as number | undefined;

      if (blipIdA !== undefined && actorIdB !== undefined) {
        this.engine.handleBlipActorCollision(blipIdA, actorIdB);
      } else if (blipIdB !== undefined && actorIdA !== undefined) {
        this.engine.handleBlipActorCollision(blipIdB, actorIdA);
      } else if (actorIdA !== undefined && actorIdB !== undefined) {
        this.engine.handleActorCollision(actorIdA, actorIdB);
      }
      return;
    }
    for (const sprite of [spriteA, spriteB]) {
      const blipId = sprite?.data.get("blipId") as number | undefined;
      if (blipId !== undefined) this.engine.handleBlipWallCollision(blipId);
    }
  }

  /** A spawn position inside the world bounds that clears every obstacle by `radius` pixels. */
  randomPositionWithinBounds(radius?: number): Vector2 {
    return randomSpawnPosition(this.random, this.obstacleBodies, radius);
  }

  /** Create the physical body and presentation resources for a newly spawned actor. */
  spawn(actor: Actor): Phaser.Physics.Matter.Sprite {
    const config = ARCHETYPES[actor.archetype].physics;
    const pos = this.randomPositionWithinBounds(config.radius);
    const body = MatterBodies.circle(pos.X, pos.Y, actorBodyRadius(config), actorBodyOptions(config));
    MatterBody.scale(body, config.scale, config.scale);
    MatterBody.setAngle(body, randomFacing(this.random));
    MatterComposite.add(this.matterWorld, body);

    const sprite = new BodySprite(body, this);
    body.gameObject = sprite as unknown as Phaser.GameObjects.GameObject;
    sprite.data.set("actorId", actor.actorId);

    if (actor.plantComp) {
      actor.plantComp.springAnchor = { x: pos.X, y: pos.Y };
    }
    actor.debugGraphics = stubGraphics();
    actor.healthBarGfx = stubGraphics();
    this.observer.onSpawn?.(actor);

    return sprite as unknown as Phaser.Physics.Matter.Sprite;
  }

  /** Put a pooled blip into flight, creating its sensor body on first use. */
  activateBlip(blip: Blip, x: number, y: number, velX: number, velY: number): void {
    this.observer.onBlipFired?.();
    if (!blip.sprite) {
      const body = MatterBodies.circle(x, y, BLIP_RADIUS, blipBodyOptions());
      MatterBody.setInertia(body, Number.POSITIVE_INFINITY);
      MatterComposite.add(this.matterWorld, body);
      const sprite = new BodySprite(body, this);
      body.gameObject = sprite as unknown as Phaser.GameObjects.GameObject;
      blip.sprite = sprite as unknown as Phaser.Physics.Matter.Sprite;
    } else {
      const body = blip.sprite.body as MatterJS.BodyType;
      const filter = blipCollisionFilter();
      body.collisionFilter.category = filter.category;
      body.collisionFilter.mask = filter.mask;
      blip.sprite.setPosition(x, y);
      blip.sprite.setVisible(true);
      blip.sprite.setActive(true);
    }
    blip.sprite.data.set("blipId", blip.blipId);
    blip.sprite.setVelocity(velX, velY);
  }
}

// -- World content --------------------------------------------------------------

/** The brain the app ships for each archetype, deserialized through the app's own loader. */
function loadShippedBrains(env: MindcraftEnvironment): Record<Archetype, IBrainDef> {
  const brains: Partial<Record<Archetype, IBrainDef>> = {};
  for (const archetype of ARCHETYPE_NAMES) {
    const file = readFileSync(join(BRAIN_ASSET_DIR, `default-${archetype}.brain`));
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    const brain = deserializeBrainFromArrayBuffer(env, buffer, PROJECT_NAMESPACE);
    if (!brain) throw new Error(`the shipped ${archetype} brain did not deserialize`);
    brains[archetype] = brain;
  }
  return brains as Record<Archetype, IBrainDef>;
}

/**
 * The environment-store surface the engine reads: the live environment, the
 * fresh-project population targets, and the per-archetype brains, with no
 * project override.
 */
function headlessStore(env: MindcraftEnvironment, brains: Record<Archetype, IBrainDef>): EcosimEnvironmentStore {
  return {
    env,
    getDesiredCounts: () => defaultDesiredCounts(),
    loadBrainFromProject: async () => undefined,
    getDefaultBrain: (archetype: Archetype) => brains[archetype],
    saveBrainForArchetype: async () => {},
    flushPendingBrainRebuilds: () => {},
  } as unknown as EcosimEnvironmentStore;
}

/** Every live actor, ordered by actor id. */
export function liveActors(engine: Engine): Actor[] {
  const actors: Actor[] = [];
  for (const archetype of ARCHETYPE_NAMES) {
    actors.push(...engine.getActorsByArchetype(archetype));
  }
  actors.sort((a, b) => a.actorId - b.actorId);
  return actors;
}

// -- Rehearsal world ------------------------------------------------------------

/** How one rehearsal world is staged. */
export interface RehearsalWorldOptions {
  /** Environment the world's brains are built and run in. */
  readonly environment: MindcraftEnvironment;
  /**
   * The run's seeded random stream. Every world-construction choice draws from
   * it -- obstacle layout, spawn positions, spawn facing -- so the same stream
   * reproduces the world exactly.
   */
  readonly next: () => number;
  readonly observer: WorldObserver;
  /** Brains to run in place of the shipped defaults, built against {@link environment}. */
  readonly brains?: Partial<Record<Archetype, IBrainDef>>;
}

/** A staged, running rehearsal world. */
export interface RehearsalWorld {
  /** Static obstacle bodies the world was built with. */
  readonly obstacleCount: number;
  /** Advance the world one fixed step of {@link STEP_MS} milliseconds. */
  step(): void;
  /** Every live actor, ordered by actor id. */
  actors(): Actor[];
  /** Tear the world down; no step may follow. */
  shutdown(): void;
}

/**
 * Stage a whole ecosim world headlessly: the app's shipped brains loaded into
 * `options.environment`, and a Matter world stepped directly. The world is
 * populated by its first {@link RehearsalWorld.step}.
 */
export async function createRehearsalWorld(options: RehearsalWorldOptions): Promise<RehearsalWorld> {
  const { environment, next, observer } = options;
  const brains = { ...loadShippedBrains(environment), ...options.brains };

  const scene = new HeadlessScene(next, observer);
  const engine = new Engine(scene as unknown as Playground, scene.obstacleBodies, headlessStore(environment, brains));
  scene.attachEngine(engine);
  engine.start();
  await engine.loadBrains();

  let time = 0;
  return {
    obstacleCount: scene.obstacleBodies.length,
    step: () => {
      scene.step(time);
      time += STEP_MS;
    },
    actors: () => liveActors(engine),
    shutdown: () => engine.shutdown(),
  };
}
