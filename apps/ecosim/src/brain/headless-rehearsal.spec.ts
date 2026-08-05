import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import {
  coreModule,
  createMindcraftEnvironment,
  type ExecutionContext,
  type IBrainDef,
  type MindcraftEnvironment,
  type MindcraftModule,
  type MindcraftModuleApi,
  type ReadonlyList,
  type Value,
  Vector2,
} from "@mindcraft-lang/core/app";
import type { Playground } from "../game/scenes/Playground";
import { deserializeBrainFromArrayBuffer } from "../services/brain-persistence";
import type { EcosimEnvironmentStore } from "../services/ecosim-environment-store";
import type { Actor, Archetype } from "./actor";
import { ARCHETYPE_NAMES, ARCHETYPES } from "./archetypes";
import { BLIP_RADIUS, type Blip } from "./blip";
import { Engine } from "./engine";
import { getSelf } from "./execution-context-types";
import { createEcosimModule } from "./index";

// -- Matter.js, loaded without Phaser -------------------------------------------

const requireMatter = createRequire(import.meta.url);
const MATTER_LIB = "phaser/src/physics/matter-js/lib";

const MatterEngine = requireMatter(`${MATTER_LIB}/core/Engine.js`) as typeof MatterJS.Engine;
const MatterEvents = requireMatter(`${MATTER_LIB}/core/Events.js`) as typeof MatterJS.Events;
const MatterBodies = requireMatter(`${MATTER_LIB}/factory/Bodies.js`) as typeof MatterJS.Bodies;
const MatterBody = requireMatter(`${MATTER_LIB}/body/Body.js`) as typeof MatterJS.Body;
const MatterComposite = requireMatter(`${MATTER_LIB}/body/Composite.js`) as typeof MatterJS.Composite;

/** Fixed simulation step in milliseconds, matching the app's 60 Hz physics substep. */
const STEP_MS = 1000 / 60;

/** World extent, matching the Phaser game config the app boots with. */
const WORLD_WIDTH = 1024;
const WORLD_HEIGHT = 768;

/** Thickness of the boundary walls, matching the app's `setBounds` call. */
const WALL_THICKNESS = 32;

/** Matter collision categories, matching the app's scene. */
const CATEGORY_WALL = 0x0001;
const CATEGORY_ACTOR = 0x0002;
const CATEGORY_BLIP = 0x0004;

/** Number of fixed steps a rehearsal runs. */
const RUN_TICKS = 600;

/** Project namespace the shipped brain documents deserialize under. */
const PROJECT_NAMESPACE = "ecosim-rehearsal";

// -- Seeded randomness ----------------------------------------------------------

/**
 * A seeded pseudo-random generator producing values in `[0, 1)`. The same seed
 * always yields the same sequence, so every world-construction choice a
 * rehearsal makes (obstacle layout, spawn positions, spawn facing, wander
 * target expiry) is reproducible.
 */
function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Seeded stand-in for the integer range helper the scene uses when placing bodies. */
function randomInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// -- Stubs standing in for Phaser presentation ----------------------------------

/**
 * The two-component vector the movement code constructs through the ambient
 * `Phaser` global before handing it to `Body.applyForce`.
 */
class StubVector2 {
  constructor(
    public x: number,
    public y: number
  ) {}
}

/**
 * Install the single member of the ambient `Phaser` global that brain-path code
 * reads at runtime: `Phaser.Math.Vector2`. Returns a function restoring the
 * previous state.
 */
function installPhaserGlobal(): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Phaser");
  Object.defineProperty(globalThis, "Phaser", {
    configurable: true,
    value: { Math: { Vector2: StubVector2 } },
  });
  return () => {
    if (previous) {
      Object.defineProperty(globalThis, "Phaser", previous);
      return;
    }
    Reflect.deleteProperty(globalThis, "Phaser");
  };
}

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

// -- Observation ----------------------------------------------------------------

/** One rehearsal's accumulated observations. */
interface RunObservations {
  /** Per-tick, per-actor host-action dispatch counts keyed `actorId -> actionKey -> count`. */
  tickDispatch: Map<number, Map<string, number>>;
  /** Total host-action dispatches over the whole run, keyed by action key. */
  totalDispatch: Map<string, number>;
  /** Number of `think` calls the run executed. */
  thinks: number;
  /** Number of chat-bubble creations (the `say` actuator reaching presentation). */
  says: number;
  /** Number of blips activated (the `shoot` actuator reaching presentation). */
  blipsFired: number;
  /** Number of actors spawned into the world, initial population plus respawns. */
  spawns: number;
}

function newObservations(): RunObservations {
  return {
    tickDispatch: new Map(),
    totalDispatch: new Map(),
    thinks: 0,
    says: 0,
    blipsFired: 0,
    spawns: 0,
  };
}

/** The host sensor / actuator definition shape the module API accepts. */
type HostDefinition = Parameters<MindcraftModuleApi["registerHostSensor"]>[0];

/**
 * Wrap a synchronous host action's `exec` so every dispatch is recorded against
 * the dispatching actor. Asynchronous actions pass through unchanged.
 */
function traced(def: HostDefinition, obs: RunObservations): HostDefinition {
  if (def.descriptor.isAsync) return def;
  const actionFn = def.actionFn as { exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => Value };
  const key = def.descriptor.key;
  const exec = actionFn.exec;
  return {
    ...def,
    actionFn: {
      ...actionFn,
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>): Value => {
        const actorId = getSelf(ctx)?.actorId ?? 0;
        let perActor = obs.tickDispatch.get(actorId);
        if (!perActor) {
          perActor = new Map<string, number>();
          obs.tickDispatch.set(actorId, perActor);
        }
        perActor.set(key, (perActor.get(key) ?? 0) + 1);
        obs.totalDispatch.set(key, (obs.totalDispatch.get(key) ?? 0) + 1);
        return exec(ctx, args);
      },
    },
  };
}

/** A module API that records every host-action dispatch made through the definitions it registers. */
function tracingApi(api: MindcraftModuleApi, obs: RunObservations): MindcraftModuleApi {
  return {
    brainServices: api.brainServices,
    defineType: (def) => api.defineType(def),
    registerHostSensor: (def) => api.registerHostSensor(traced(def, obs)),
    registerHostActuator: (def) => api.registerHostActuator(traced(def, obs)),
    registerFunction: (def) => api.registerFunction(def),
    registerTile: (def) => api.registerTile(def),
    registerModifiers: (defs) => api.registerModifiers(defs),
    registerParameters: (defs) => api.registerParameters(defs),
    registerOperator: (def) => api.registerOperator(def),
    registerConversion: (def) => api.registerConversion(def),
  };
}

/** The module with every host action it installs wrapped for dispatch observation. */
function tracingModule(inner: MindcraftModule, obs: RunObservations): MindcraftModule {
  return {
    id: inner.id,
    migrateBrainJson: inner.migrateBrainJson,
    install: (api: MindcraftModuleApi) => inner.install(tracingApi(api, obs)),
  };
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
 * placement the scene takes from the renderer's RNG in the app.
 */
class HeadlessScene {
  readonly scale = { width: WORLD_WIDTH, height: WORLD_HEIGHT };
  readonly matterEngine: MatterJS.Engine;
  readonly obstacleBodies: MatterJS.BodyType[] = [];
  readonly matter: { world: unknown };
  readonly add = {
    graphics: () => stubGraphics(),
    text: () => {
      this.obs.says++;
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
  private engine!: Engine;

  constructor(
    private readonly rng: () => number,
    private readonly obs: RunObservations
  ) {
    this.matterEngine = MatterEngine.create();
    this.matterEngine.world.gravity.x = 0;
    this.matterEngine.world.gravity.y = 0;
    this.matterEngine.world.gravity.scale = 0.001;

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
    const walls: Array<[number, number, number, number]> = [
      [-WALL_THICKNESS, -WALL_THICKNESS, WALL_THICKNESS, WORLD_HEIGHT + WALL_THICKNESS * 2],
      [WORLD_WIDTH, -WALL_THICKNESS, WALL_THICKNESS, WORLD_HEIGHT + WALL_THICKNESS * 2],
      [0, -WALL_THICKNESS, WORLD_WIDTH, WALL_THICKNESS],
      [0, WORLD_HEIGHT, WORLD_WIDTH, WALL_THICKNESS],
    ];
    for (const [x, y, width, height] of walls) {
      const body = MatterBodies.rectangle(x + width / 2, y + height / 2, width, height, {
        isStatic: true,
        friction: 0,
        frictionStatic: 0,
      });
      MatterComposite.add(this.matterWorld, body);
    }
  }

  private createObstacles(): void {
    const obstacleCount = 4;
    const margin = 100;
    for (let i = 0; i < obstacleCount; i++) {
      const width = randomInt(this.rng, 30, 120);
      const height = randomInt(this.rng, 30, 120);
      const x = randomInt(this.rng, margin, WORLD_WIDTH - margin);
      const y = randomInt(this.rng, margin, WORLD_HEIGHT - margin);
      const rotation = this.rng() * Math.PI * 2;
      const body = MatterBodies.rectangle(x, y, width, height, {
        angle: rotation,
        collisionFilter: {
          category: CATEGORY_WALL,
          mask: CATEGORY_WALL | CATEGORY_ACTOR | CATEGORY_BLIP,
          group: 0,
        },
      });
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

  /** A position inside the bounds that overlaps no obstacle, mirroring the scene's placement rule. */
  randomPositionWithinBounds(radius: number = 20): Vector2 {
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = randomInt(this.rng, 40, WORLD_WIDTH - 40);
      const y = randomInt(this.rng, 40, WORLD_HEIGHT - 40);
      let overlaps = false;
      for (const body of this.obstacleBodies) {
        const b = body.bounds;
        const closestX = Math.max(b.min.x, Math.min(x, b.max.x));
        const closestY = Math.max(b.min.y, Math.min(y, b.max.y));
        const dx = x - closestX;
        const dy = y - closestY;
        if (dx * dx + dy * dy < radius * radius) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) return new Vector2(x, y);
    }
    return new Vector2(randomInt(this.rng, 40, WORLD_WIDTH - 40), randomInt(this.rng, 40, WORLD_HEIGHT - 40));
  }

  /** Create the physical body and presentation resources for a newly spawned actor. */
  spawn(actor: Actor): Phaser.Physics.Matter.Sprite {
    const config = ARCHETYPES[actor.archetype].physics;
    const pos = this.randomPositionWithinBounds(config.radius);
    const body = MatterBodies.circle(pos.X, pos.Y, config.radius * config.scale, {
      collisionFilter: {
        category: CATEGORY_ACTOR,
        mask: CATEGORY_WALL | CATEGORY_ACTOR | CATEGORY_BLIP,
        group: 0,
      },
      mass: config.mass,
      frictionAir: config.frictionAir,
      restitution: config.restitution,
      friction: config.friction,
    });
    MatterBody.scale(body, config.scale, config.scale);
    MatterBody.setAngle(body, this.rng() * Math.PI * 2);
    body.sleepThreshold = Number.POSITIVE_INFINITY;
    MatterComposite.add(this.matterWorld, body);

    const sprite = new BodySprite(body, this);
    body.gameObject = sprite as unknown as Phaser.GameObjects.GameObject;
    sprite.data.set("actorId", actor.actorId);

    if (actor.plantComp) {
      actor.plantComp.springAnchor = { x: pos.X, y: pos.Y };
    }
    actor.debugGraphics = stubGraphics();
    actor.healthBarGfx = stubGraphics();
    this.obs.spawns++;

    return sprite as unknown as Phaser.Physics.Matter.Sprite;
  }

  /** Put a pooled blip into flight, creating its sensor body on first use. */
  activateBlip(blip: Blip, x: number, y: number, velX: number, velY: number): void {
    this.obs.blipsFired++;
    if (!blip.sprite) {
      const body = MatterBodies.circle(x, y, BLIP_RADIUS, {
        collisionFilter: {
          category: CATEGORY_BLIP,
          mask: CATEGORY_WALL | CATEGORY_ACTOR,
          group: 0,
        },
        mass: 0.01,
        frictionAir: 0,
        restitution: 0,
        friction: 0,
        isSensor: true,
      });
      MatterBody.setInertia(body, Number.POSITIVE_INFINITY);
      body.sleepThreshold = Number.POSITIVE_INFINITY;
      MatterComposite.add(this.matterWorld, body);
      const sprite = new BodySprite(body, this);
      body.gameObject = sprite as unknown as Phaser.GameObjects.GameObject;
      blip.sprite = sprite as unknown as Phaser.Physics.Matter.Sprite;
    } else {
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
}

// -- World content --------------------------------------------------------------

/** The brain the app ships for each archetype, deserialized through the app's own loader. */
function loadShippedBrains(env: MindcraftEnvironment): Record<Archetype, IBrainDef> {
  const brains: Partial<Record<Archetype, IBrainDef>> = {};
  for (const archetype of ARCHETYPE_NAMES) {
    const path = new URL(`../../public/assets/brain/defs/default-${archetype}.brain`, import.meta.url);
    const file = readFileSync(path);
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    const brain = deserializeBrainFromArrayBuffer(env, buffer, PROJECT_NAMESPACE);
    assert.ok(brain, `the shipped ${archetype} brain deserializes`);
    brains[archetype] = brain;
  }
  return brains as Record<Archetype, IBrainDef>;
}

/**
 * The environment-store surface the engine reads: the live environment, the
 * fresh-project population targets, and the shipped brains as the per-archetype
 * defaults, with no project override.
 */
function headlessStore(env: MindcraftEnvironment, brains: Record<Archetype, IBrainDef>): EcosimEnvironmentStore {
  return {
    env,
    getDesiredCounts: () => ({
      carnivore: ARCHETYPES.carnivore.initialSpawnCount,
      herbivore: ARCHETYPES.herbivore.initialSpawnCount,
      plant: ARCHETYPES.plant.initialSpawnCount,
    }),
    loadBrainFromProject: async () => undefined,
    getDefaultBrain: (archetype: Archetype) => brains[archetype],
    saveBrainForArchetype: async () => {},
    flushPendingBrainRebuilds: () => {},
  } as unknown as EcosimEnvironmentStore;
}

// -- Rehearsal ------------------------------------------------------------------

/** What one rehearsal produced. */
interface RunResult {
  /** One line per tick, in order. Byte-identical lines mean identical runs. */
  trace: string[];
  /** Hex SHA-256 of the whole trace. */
  hash: string;
  observations: RunObservations;
  /** Distinct brain defs held by the actors alive at the end of the run. */
  brainsExecuted: number;
  /** Actor count at the end of the run. */
  finalActors: number;
  /** Static obstacle bodies the world was built with. */
  obstacleCount: number;
}

/** Every live actor, ordered by actor id. */
function liveActors(engine: Engine): Actor[] {
  const actors: Actor[] = [];
  for (const archetype of ARCHETYPE_NAMES) {
    actors.push(...engine.getActorsByArchetype(archetype));
  }
  actors.sort((a, b) => a.actorId - b.actorId);
  return actors;
}

/** One tick's serialization: every actor's state plus the actions its brain dispatched. */
function traceTick(tick: number, engine: Engine, obs: RunObservations): string {
  const parts: string[] = [`t=${tick}`];
  for (const actor of liveActors(engine)) {
    const fired = obs.tickDispatch.get(actor.actorId);
    const firedText = fired
      ? [...fired.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([key, count]) => `${key}:${count}`)
          .join("+")
      : "-";
    parts.push(
      [
        actor.actorId,
        actor.archetype,
        actor.sprite.x.toFixed(6),
        actor.sprite.y.toFixed(6),
        actor.sprite.rotation.toFixed(6),
        actor.energy.toFixed(6),
        firedText,
      ].join(":")
    );
  }
  return parts.join("|");
}

/**
 * Run one whole-world rehearsal: load the shipped brains, populate the world to
 * the app's default counts, and step gameplay and physics at a fixed timestep
 * for `ticks` steps, recording a trace line per tick.
 */
async function runRehearsal(seed: number, ticks: number): Promise<RunResult> {
  const obs = newObservations();
  const rng = createSeededRng(seed);
  const env = createMindcraftEnvironment({
    modules: [tracingModule(coreModule(), obs), tracingModule(createEcosimModule(), obs)],
    rng: { next: () => rng() },
  });

  const brains = loadShippedBrains(env);
  const scene = new HeadlessScene(rng, obs);
  const engine = new Engine(scene as unknown as Playground, scene.obstacleBodies, headlessStore(env, brains));
  scene.attachEngine(engine);
  engine.start();
  await engine.loadBrains();

  const trace: string[] = [];
  let time = 0;
  for (let tick = 0; tick < ticks; tick++) {
    obs.tickDispatch.clear();
    obs.thinks += liveActors(engine).length;
    scene.step(time);
    time += STEP_MS;
    trace.push(traceTick(tick, engine, obs));
  }

  const brainsExecuted = new Set(liveActors(engine).map((actor) => actor.brainDef)).size;
  const finalActors = liveActors(engine).length;
  engine.shutdown();

  return {
    trace,
    hash: createHash("sha256").update(trace.join("\n")).digest("hex"),
    observations: obs,
    brainsExecuted,
    finalActors,
    obstacleCount: scene.obstacleBodies.length,
  };
}

/** The number of actor entries a trace line carries. */
function actorsInTraceLine(line: string): number {
  return line.split("|").length - 1;
}

/** The first line index at which two traces differ, or -1 when they are identical. */
function firstDivergence(a: string[], b: string[]): number {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : limit;
}

/** The first field index at which two trace lines differ. */
function firstDifferingField(a: string, b: string): string {
  const fieldsA = a.split("|");
  const fieldsB = b.split("|");
  const limit = Math.min(fieldsA.length, fieldsB.length);
  for (let i = 0; i < limit; i++) {
    if (fieldsA[i] !== fieldsB[i]) return `field ${i}: ${fieldsA[i]} vs ${fieldsB[i]}`;
  }
  return `field count ${fieldsA.length} vs ${fieldsB.length}`;
}

function formatDispatch(totals: Map<string, number>): string {
  return [...totals.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, count]) => `${key}=${count}`)
    .join(" ");
}

describe("headless whole-world rehearsal", () => {
  test("runs the shipped world at a fixed timestep and reproduces it from the same seed", async () => {
    const restorePhaser = installPhaserGlobal();
    try {
      const first = await runRehearsal(20260805, RUN_TICKS);
      const second = await runRehearsal(20260805, RUN_TICKS);
      const other = await runRehearsal(20260806, RUN_TICKS);

      const initialPopulation = actorsInTraceLine(first.trace[0] ?? "");
      const peakPopulation = first.trace.reduce((peak, line) => Math.max(peak, actorsInTraceLine(line)), 0);
      const divergence = firstDivergence(first.trace, second.trace);
      const verdict =
        divergence < 0
          ? "identical"
          : `diverged at tick ${divergence} (${firstDifferingField(first.trace[divergence] ?? "", second.trace[divergence] ?? "")})`;

      console.log(
        [
          "",
          "-- headless whole-world rehearsal --",
          `ticks:            ${RUN_TICKS} at ${STEP_MS.toFixed(4)} ms fixed step`,
          `world:            ${WORLD_WIDTH}x${WORLD_HEIGHT}, ${first.obstacleCount} obstacles, 4 boundary walls`,
          `entities:         ${initialPopulation} on the first step, ${peakPopulation} at peak, ${first.observations.spawns} spawned in total, ${first.finalActors} alive at end`,
          `brains executed:  ${first.brainsExecuted} distinct brain defs (${ARCHETYPE_NAMES.join(", ")})`,
          `thinks:           ${first.observations.thinks}`,
          `dispatches:       ${formatDispatch(first.observations.totalDispatch)}`,
          `say / shoot:      ${first.observations.says} chat bubbles, ${first.observations.blipsFired} blips fired`,
          `trace hash run 1: ${first.hash}`,
          `trace hash run 2: ${second.hash}`,
          `trace hash alt:   ${other.hash} (different seed)`,
          `trace verdict:    ${verdict}`,
          "",
        ].join("\n")
      );

      const expectedPopulation = ARCHETYPE_NAMES.reduce(
        (sum, archetype) => sum + ARCHETYPES[archetype].initialSpawnCount,
        0
      );
      assert.equal(peakPopulation, expectedPopulation, "the world populates to the app's default counts");
      assert.equal(first.obstacleCount, 4, "the world carries the scene's obstacle set");
      assert.equal(first.brainsExecuted, 3, "one distinct brain def per archetype is executing");
      assert.ok(first.observations.thinks > 0, "brains thought during the run");
      assert.ok(first.observations.totalDispatch.has("sensor.see"), "brains sensed each other");
      assert.ok(first.observations.totalDispatch.has("actuator.move"), "brains acted on the world");
      assert.equal(first.trace.length, RUN_TICKS, "one trace line per tick");
      assert.equal(divergence, -1, verdict);
      assert.equal(first.hash, second.hash, "identical seeds produce byte-identical traces");
      assert.notEqual(first.hash, other.hash, "the seed drives the world the trace records");
    } finally {
      restorePhaser();
    }
  });
});
