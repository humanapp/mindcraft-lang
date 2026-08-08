import { headingCFrame, PX_PER_STEP_TO_STUDS_PER_SECOND, simToWorld, worldXToSimX, worldZToSimY } from "./scale";

/** Attribute carrying an actor's engine id on its Roblox part. */
export const ACTOR_ID_ATTRIBUTE = "ActorId";

/** CollectionService tag applied to every creature part. */
export const ACTOR_TAG = "EcosimActor";

/**
 * The physics view of a creature that mirrored ecosim code reads through
 * `actor.sprite.body`. Units match ecosim's Matter body: mass in Matter mass
 * units, velocity in pixels per simulation step.
 */
export interface SpriteBody {
  /** Mass in ecosim mass units, taken from the archetype's physics config. */
  readonly mass: number;
  /** Velocity in pixels per simulation step. */
  readonly velocity: { x: number; y: number };
}

/**
 * Facade presenting a Roblox part with the surface ecosim's brain code expects
 * from a Phaser Matter sprite: pixel positions, a radian heading, and pixel
 * per step velocities.
 *
 * `x`, `y`, and `body.velocity` are a snapshot of the part refreshed by
 * {@link sync} once per frame and kept current by every write on this facade,
 * so shoves applied by a player are visible to the simulation. Heading is
 * authoritative simulation state held here and pushed onto the part's yaw,
 * never read back from it.
 */
export class CreatureSprite {
  /** Simulation x of the part's centre, in pixels. */
  x = 0;

  /** Simulation y of the part's centre, in pixels. */
  y = 0;

  /** Current heading in radians. */
  rotation = 0;

  /** The live physics view, or undefined once {@link destroy} has run. */
  body: SpriteBody | undefined;

  private readonly bodyState: SpriteBody;
  private touchedConnection?: RBXScriptConnection;

  /**
   * @param part - The Roblox part this facade drives.
   * @param mass - Mass in ecosim mass units reported through {@link body}.
   * @param initialHeading - Starting heading in radians.
   */
  constructor(
    readonly part: BasePart,
    mass: number,
    initialHeading: number
  ) {
    this.bodyState = { mass, velocity: { x: 0, y: 0 } };
    this.body = this.bodyState;
    this.sync();
    this.setRotation(initialHeading);
  }

  /**
   * Refreshes the cached position and velocity from the part. Call once per
   * frame, before anything reads the facade.
   */
  sync(): void {
    if (!this.body) return;
    const position = this.part.Position;
    this.x = worldXToSimX(position.X);
    this.y = worldZToSimY(position.Z);
    const velocity = this.part.AssemblyLinearVelocity;
    this.bodyState.velocity.x = velocity.X / PX_PER_STEP_TO_STUDS_PER_SECOND;
    this.bodyState.velocity.y = velocity.Z / PX_PER_STEP_TO_STUDS_PER_SECOND;
  }

  /**
   * Teleports the part to a simulation position, preserving its height.
   *
   * @param x - Simulation x in pixels.
   * @param y - Simulation y in pixels.
   */
  setPosition(x: number, y: number): void {
    if (!this.body) return;
    this.x = x;
    this.y = y;
    this.part.CFrame = headingCFrame(simToWorld(x, y, this.part.Position.Y), this.rotation);
  }

  /**
   * Sets the authoritative heading and turns the part to match.
   *
   * @param radians - Heading in radians.
   */
  setRotation(radians: number): void {
    this.rotation = radians;
    if (!this.body) return;
    this.part.CFrame = headingCFrame(this.part.Position, radians);
  }

  /**
   * Sets the horizontal velocity, preserving the vertical component so gravity
   * keeps working.
   *
   * @param vx - Velocity along simulation x, in pixels per step.
   * @param vy - Velocity along simulation y, in pixels per step.
   */
  setVelocity(vx: number, vy: number): void {
    if (!this.body) return;
    this.bodyState.velocity.x = vx;
    this.bodyState.velocity.y = vy;
    const current = this.part.AssemblyLinearVelocity;
    this.part.AssemblyLinearVelocity = new Vector3(
      vx * PX_PER_STEP_TO_STUDS_PER_SECOND,
      current.Y,
      vy * PX_PER_STEP_TO_STUDS_PER_SECOND
    );
  }

  /**
   * Routes part touches that involve another creature to `handler`. Touches
   * from walls, the ground, and player characters are ignored. Replaces any
   * previously bound handler.
   *
   * @param handler - Receives the other creature's actor id.
   */
  bindTouched(handler: (otherActorId: number) => void): void {
    this.touchedConnection?.Disconnect();
    this.touchedConnection = this.part.Touched.Connect((other) => {
      const otherActorId = other.GetAttribute(ACTOR_ID_ATTRIBUTE);
      if (typeIs(otherActorId, "number")) {
        handler(otherActorId);
      }
    });
  }

  /** Disconnects the touch handler and removes the part from the world. */
  destroy(): void {
    if (!this.body) return;
    this.body = undefined;
    this.touchedConnection?.Disconnect();
    this.touchedConnection = undefined;
    this.part.Destroy();
  }
}
