import type { Engine } from "./engine";

/** How much energy a blip drains from an actor on impact. */
export const BLIP_DAMAGE = 10;

/** Speed in px/s at which blips travel. */
export const BLIP_SPEED = 6;

/** Maximum lifetime in ms before a blip self-destructs. */
export const BLIP_MAX_LIFETIME_MS = 3000;

/** Radius of the blip circle body (px). */
export const BLIP_RADIUS = 4;

/** Hard ceiling on simultaneously active blips. */
export const MAX_ACTIVE_BLIPS = 2000;

/**
 * A blip is a small, fast projectile fired by the "shoot" actuator.
 * It has no brain and is not an Actor -- just a Matter.js sensor body
 * that travels in a straight line, damages the first actor it hits,
 * then returns to the pool for reuse.
 *
 * Blips are **pooled**: call {@link BlipPool.acquire} / {@link BlipPool.release}
 * instead of constructing / destroying directly.
 */
export class Blip {
  /** Monotonically-increasing id assigned by the Engine. */
  blipId = 0;

  /** The Phaser sprite backing this blip (assigned once, reused across lives). */
  sprite: Phaser.Physics.Matter.Sprite = null!;

  /** Engine timestamp (ms) when the blip was fired. */
  bornAt = 0;

  /** Actor id of the shooter (so we don't damage ourselves). */
  shooterActorId = 0;

  /** True while the blip is in-flight and should participate in collisions. */
  alive = false;

  /** Returns true when the blip has exceeded its maximum lifetime. */
  isExpired(now: number): boolean {
    return now - this.bornAt > BLIP_MAX_LIFETIME_MS;
  }
}

/**
 * Fixed-capacity pool that recycles Blip instances **and** their backing
 * Phaser sprites so we never allocate or GC blip objects during gameplay.
 *
 * All sprites are created up-front (lazily on first acquire) and toggled
 * between active / inactive via `setVisible` + `setActive` + body-enable
 * rather than being added to / removed from the Matter world repeatedly.
 */
export class BlipPool {
  /** All blip instances (pre-allocated up to MAX_ACTIVE_BLIPS). */
  private readonly pool: Blip[] = [];

  /** Indices of pool slots that are currently free. */
  private readonly freeList: number[] = [];

  /** Live blips indexed by blipId for O(1) collision lookups. */
  readonly activeById = new Map<number, Blip>();

  /** Next monotonically-increasing blip id. */
  private nextId = 1;

  constructor(readonly engine: Engine) {}

  /**
   * Acquire a blip from the pool.
   * Returns undefined if the pool is exhausted (blip cap reached).
   */
  acquire(shooterActorId: number, now: number): Blip | undefined {
    let blip: Blip;

    if (this.freeList.length > 0) {
      const idx = this.freeList.pop()!;
      blip = this.pool[idx];
    } else if (this.pool.length < MAX_ACTIVE_BLIPS) {
      blip = new Blip();
      this.pool.push(blip);
    } else {
      // Pool exhausted -- cap reached
      return undefined;
    }

    blip.blipId = this.nextId++;
    blip.shooterActorId = shooterActorId;
    blip.bornAt = now;
    blip.alive = true;

    this.activeById.set(blip.blipId, blip);
    return blip;
  }

  /** Return a blip to the pool and deactivate its sprite. */
  release(blip: Blip): void {
    if (!blip.alive) return;
    blip.alive = false;
    this.activeById.delete(blip.blipId);

    // Hide and disable the physics body without destroying the sprite
    if (blip.sprite) {
      blip.sprite.setVisible(false);
      blip.sprite.setActive(false);
      blip.sprite.setVelocity(0, 0);
      blip.sprite.setPosition(-100, -100);
      const body = blip.sprite.body as MatterJS.BodyType | null;
      if (body) {
        // Disable collisions entirely by zeroing the mask
        body.collisionFilter.mask = 0;
      }
    }

    const idx = this.pool.indexOf(blip);
    if (idx >= 0) this.freeList.push(idx);
  }

  /** Release every active blip (used during shutdown). */
  releaseAll(): void {
    for (const blip of this.activeById.values()) {
      this.release(blip);
    }
  }

  /** Destroy every sprite in the pool (scene shutdown). */
  destroyAll(): void {
    this.releaseAll();
    for (const blip of this.pool) {
      if (blip.sprite) {
        blip.sprite.destroy();
        blip.sprite = null!;
      }
    }
    this.pool.length = 0;
    this.freeList.length = 0;
    this.activeById.clear();
  }
}
